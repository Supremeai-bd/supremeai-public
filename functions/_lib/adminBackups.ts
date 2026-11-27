/**
 * বাংলা মন্তব্য: Admin → Backups — আসল ডাটাবেস ব্যাকআপের অবস্থা।
 *
 * ব্যাকআপ নিজে চলে private রিপোর `db-backup.yml` workflow-এ (প্রতিরাত ০২:৩০ ঢাকা):
 * Supabase prod-এর pg_dump → AES-256 এনক্রিপ্ট → ৩০ দিনের GitHub artifact।
 * এই রুট শুধু পড়ে — GitHub API থেকে artifact তালিকা + শেষ রানগুলো। কোনো "Run" বাটন
 * নেই (সিস্টেম নিজেই চালায়), আর রিস্টোর ইচ্ছাকৃতভাবে মানুষ-চালিত (UI-তে runbook)।
 *
 * - GET /api/admin/backups → { configured, health, lastRun, backups[], schedule, ... }
 */

import { jsonEdgeResponse } from './edgeHelpers';

type Env = Record<string, string | undefined> | undefined;

export const BACKUP_REPO = 'Supremeai-bd/supremeai';
export const BACKUP_WORKFLOW = 'db-backup.yml';
export const BACKUP_ARTIFACT = 'supremeai-db-backup';
/** একটা দৈনিক রান মিস হলেও সহনীয়; দুটো মিস হলে "stale"। */
export const STALE_AFTER_HOURS = 36;

export type BackupHealth = 'ok' | 'stale' | 'failing' | 'never' | 'not-deployed';

export interface BackupArtifact {
  id: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
  runId: number | null;
  commit: string | null;
}

export interface BackupRun {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  createdAt: string;
  url: string;
}

export interface BackupState {
  configured: true;
  health: BackupHealth;
  schedule: string;
  retentionDays: number;
  encryption: string;
  lastRun: BackupRun | null;
  lastSuccessAt: string | null;
  backups: BackupArtifact[];
  workflowUrl: string;
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function normalizeArtifacts(payload: unknown): BackupArtifact[] {
  const list = asRecord(payload).artifacts;
  if (!Array.isArray(list)) return [];
  return list
    .map(asRecord)
    .filter((a) => a.name === BACKUP_ARTIFACT && a.expired !== true)
    .map((a) => {
      const run = asRecord(a.workflow_run);
      return {
        id: Number(a.id) || 0,
        sizeBytes: Number(a.size_in_bytes) || 0,
        createdAt: String(a.created_at || ''),
        expiresAt: a.expires_at ? String(a.expires_at) : null,
        runId: run.id ? Number(run.id) : null,
        commit: run.head_sha ? String(run.head_sha).slice(0, 7) : null,
      };
    })
    .filter((a) => a.id && a.createdAt)
    .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
}

export function normalizeRuns(payload: unknown): BackupRun[] {
  const list = asRecord(payload).workflow_runs;
  if (!Array.isArray(list)) return [];
  return list
    .map(asRecord)
    .map((r) => ({
      id: Number(r.id) || 0,
      status: String(r.status || 'unknown'),
      conclusion: r.conclusion ? String(r.conclusion) : null,
      event: String(r.event || ''),
      createdAt: String(r.created_at || ''),
      url: String(r.html_url || ''),
    }))
    .filter((r) => r.id);
}

export function computeBackupHealth(
  backups: BackupArtifact[],
  runs: BackupRun[],
  now: number = Date.now()
): BackupHealth {
  const newest = backups[0];
  const lastCompleted = runs.find((r) => r.status === 'completed');
  if (!newest) {
    return lastCompleted && lastCompleted.conclusion !== 'success' ? 'failing' : 'never';
  }
  if (lastCompleted && lastCompleted.conclusion !== 'success') {
    // বাংলা মন্তব্য: পুরনো ব্যাকআপ আছে কিন্তু শেষ রান ব্যর্থ — অ্যাডমিনকে জানাতে হবে।
    return 'failing';
  }
  const ageHours = (now - Date.parse(newest.createdAt)) / 3_600_000;
  return ageHours > STALE_AFTER_HOURS ? 'stale' : 'ok';
}

export async function handleAdminBackupsRoute(
  path: string,
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/backups') return null;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  if (request.method.toUpperCase() !== 'GET') {
    return reply({ success: false, error: 'Method not allowed.' }, 405);
  }
  const token = env?.GITHUB_TOKEN?.trim() || env?.GITHUB_READONLY_TOKEN?.trim() || '';
  if (!token) {
    return reply(
      { success: false, configured: false, error: 'GitHub token is not configured on the edge.' },
      503
    );
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'SupremeAI-Studio-Edge-Admin',
  };
  const base = `https://api.github.com/repos/${BACKUP_REPO}/actions`;
  const workflowUrl = `https://github.com/${BACKUP_REPO}/actions/workflows/${BACKUP_WORKFLOW}`;
  try {
    const [artRes, runRes] = await Promise.all([
      timedFetch(
        fetchImpl,
        `${base}/artifacts?name=${BACKUP_ARTIFACT}&per_page=30`,
        { headers },
        6000
      ),
      timedFetch(
        fetchImpl,
        `${base}/workflows/${BACKUP_WORKFLOW}/runs?per_page=10`,
        { headers },
        6000
      ),
    ]);
    if (runRes.status === 404) {
      // বাংলা মন্তব্য: workflow এখনো private main-এ পৌঁছায়নি (sync PR merge বাকি)।
      return reply({
        success: true,
        configured: true,
        health: 'not-deployed',
        schedule: 'daily 02:30 Asia/Dhaka',
        retentionDays: 30,
        encryption: 'AES-256',
        lastRun: null,
        lastSuccessAt: null,
        backups: [],
        workflowUrl,
      });
    }
    if (!artRes.ok || !runRes.ok) {
      const status = !artRes.ok ? artRes.status : runRes.status;
      return reply(
        { success: false, configured: true, error: `GitHub API returned HTTP ${status}.` },
        status === 401 || status === 403 ? 502 : 504
      );
    }
    const backups = normalizeArtifacts(await artRes.json().catch(() => null));
    const runs = normalizeRuns(await runRes.json().catch(() => null));
    const lastSuccess = runs.find((r) => r.conclusion === 'success');
    const state: BackupState = {
      configured: true,
      health: computeBackupHealth(backups, runs),
      schedule: 'daily 02:30 Asia/Dhaka',
      retentionDays: 30,
      encryption: 'AES-256',
      lastRun: runs[0] || null,
      lastSuccessAt: lastSuccess?.createdAt || backups[0]?.createdAt || null,
      backups,
      workflowUrl,
    };
    return reply({ success: true, ...state });
  } catch {
    return reply({ success: false, configured: true, error: 'GitHub API timed out.' }, 504);
  }
}
