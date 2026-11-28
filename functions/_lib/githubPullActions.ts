/**
 * বাংলা মন্তব্য: GitHub CI/CD & PR Pipeline Control — Unified Web-Standard Handler
 *
 * Cloudflare Pages Edge (`functions/api/admin/[[path]].ts`) এবং Node Express
 * (`src/server/routes/edgeParityRoutes.ts`) উভয় রানটাইম একই হ্যান্ডলার ব্যবহার করে।
 * `Supremeai-bd/supremeai` (প্রাইভেট SSOT) এবং `Supremeai-bd/supremeai-public`
 * (পাবলিক স্টুডিও) উভয় রিপোজিটরি সমর্থিত; ফাইন-গ্রেইনড `GITHUB_TOKEN` শুধুমাত্র
 * প্রাইভেট রিপোতে সীমাবদ্ধ থাকলে পাবলিক রিপোর রিড রিকোয়েস্ট স্বয়ংক্রিয়ভাবে টোকেনহীন
 * মোডে ফলব্যাক করে।
 */

import { GITHUB_MONOREPO_SLUG, GITHUB_PUBLIC_REPO_SLUG } from '../../src/config/platformEndpoints';
import {
  extractCiErrorSnippet,
  type GitHubFailedJobSummary,
  type GitHubRunAnnotation,
} from '../../src/utils/githubPipelineMetrics';
import { isSafeGitHubRepoSlug, jsonEdgeResponse } from './edgeHelpers';

type Env = Record<string, string | undefined> | undefined;

export type PullAction = 'approve' | 'merge';

export interface PullActionResult {
  status: number;
  body: { success: boolean; error?: string; code?: string; merged?: boolean };
}

const TIMEOUT_MS = 8000;
const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'startup_failure',
  'action_required',
  'stale',
]);

function isPublicSupremeRepo(repo: string): boolean {
  return repo.trim().toLowerCase() === GITHUB_PUBLIC_REPO_SLUG.toLowerCase();
}

function encodeGitHubRepoPath(repo: string): string | null {
  if (!isSafeGitHubRepoSlug(repo)) return null;
  const parts = repo.trim().split('/');
  if (parts.length !== 2) return null;
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}

export function resolveGitHubRepoToken(
  env: Env,
  repo: string,
  mode: 'read' | 'write' | 'approve' = 'read'
): string {
  const publicTok = String(env?.GITHUB_PUBLIC_TOKEN || '').trim();
  const mainTok = String(env?.GITHUB_TOKEN || '').trim();
  const reviewTok = String(env?.GITHUB_REVIEW_TOKEN || '').trim();
  const readonlyTok = String(env?.GITHUB_READONLY_TOKEN || '').trim();

  if (mode === 'approve') {
    return isPublicSupremeRepo(repo)
      ? reviewTok || publicTok || mainTok
      : reviewTok || mainTok;
  }
  if (mode === 'write') {
    return isPublicSupremeRepo(repo) ? publicTok || mainTok : mainTok;
  }
  return isPublicSupremeRepo(repo)
    ? publicTok || mainTok || readonlyTok
    : mainTok || readonlyTok || publicTok;
}

async function ghFetchRaw(
  fetchImpl: typeof fetch,
  url: string,
  init: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method: init.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SupremeAI-Studio-Edge-Admin',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Performs a GitHub GET request and automatically retries unauthenticated if a
 * repo-scoped fine-grained PAT returns 401/403 (allowing public repos such as
 * `Supremeai-bd/supremeai-public` to load even when `GITHUB_TOKEN` only covers
 * private `Supremeai-bd/supremeai`).
 */
async function ghFetchReadWithPublicFallback(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  timeoutMs = 5500
): Promise<Response> {
  const res = await ghFetchRaw(fetchImpl, url, { token, timeoutMs });
  if (token && (res.status === 401 || res.status === 403)) {
    const fallbackRes = await ghFetchRaw(fetchImpl, url, { timeoutMs });
    if (fallbackRes.ok) return fallbackRes;
  }
  return res;
}

async function gh(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  url: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await ghFetchRaw(fetchImpl, url, { method, token, body, timeoutMs: TIMEOUT_MS });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, data };
  } catch {
    return { status: 504, data: null };
  }
}

const login = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as { login?: unknown }).login || '') : '';

function githubMessage(data: Record<string, unknown> | null): string {
  const msg = String(data?.message || '').trim();
  const errors = Array.isArray(data?.errors)
    ? (data!.errors as unknown[]).map((e) => (typeof e === 'string' ? e : '')).filter(Boolean)
    : [];
  return [msg, ...errors].filter(Boolean).join(' — ').slice(0, 300);
}

export async function runPullAction(
  env: Env,
  repo: string,
  number: number,
  action: PullAction,
  fetchImpl: typeof fetch = fetch
): Promise<PullActionResult> {
  const safeRepoPath = encodeGitHubRepoPath(repo);
  const safePrNumber = Math.trunc(Number(number));
  if (!safeRepoPath || !Number.isFinite(safePrNumber) || safePrNumber <= 0) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'invalid-repo',
        error: 'Invalid GitHub repository slug or pull request number.',
      },
    };
  }
  const token = resolveGitHubRepoToken(env, repo, action === 'approve' ? 'approve' : 'write');
  if (!token) {
    return {
      status: 503,
      body: {
        success: false,
        code: 'no-token',
        error: 'GITHUB_TOKEN is not set on the server, so PR actions cannot run.',
      },
    };
  }
  const api = `https://api.github.com/repos/${safeRepoPath}/pulls/${encodeURIComponent(String(safePrNumber))}`;

  if (action === 'approve') {
    const [pr, me] = await Promise.all([
      gh(fetchImpl, token, 'GET', api),
      gh(fetchImpl, token, 'GET', 'https://api.github.com/user'),
    ]);
    if (pr.status !== 200) {
      return {
        status: pr.status === 404 ? 404 : 502,
        body: { success: false, error: `PR #${number} could not be read (HTTP ${pr.status}).` },
      };
    }
    const author = login(pr.data?.user);
    const reviewer = String(me.data?.login || '');
    if (author && reviewer && author.toLowerCase() === reviewer.toLowerCase()) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'self-approval',
          error:
            `GitHub does not allow approving your own PR: the dashboard token belongs to ${author}, ` +
            'who opened this PR. Add a separate reviewer account token as GITHUB_REVIEW_TOKEN.',
        },
      };
    }
    const review = await gh(fetchImpl, token, 'POST', `${api}/reviews`, {
      event: 'APPROVE',
      body: 'Approved via SupremeAI admin dashboard',
    });
    if (review.status === 200 || review.status === 201)
      return { status: 200, body: { success: true } };
    return {
      status: review.status === 422 ? 409 : 502,
      body: {
        success: false,
        error: `GitHub rejected the approval (HTTP ${review.status}): ${githubMessage(review.data) || 'no reason given'}`,
      },
    };
  }

  const merge = await gh(fetchImpl, token, 'PUT', `${api}/merge`, { merge_method: 'squash' });
  if (merge.status === 200) return { status: 200, body: { success: true, merged: true } };
  return {
    status: [405, 409, 422].includes(merge.status) ? 409 : 502,
    body: {
      success: false,
      error: `GitHub refused the merge (HTTP ${merge.status}): ${githubMessage(merge.data) || 'no reason given'}`,
    },
  };
}

export async function handleAdminGitHubRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { actor: string; details?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (!path.startsWith('/api/admin/github/')) return null;

  const incomingUrl = new URL(request.url);
  const queryRepo = incomingUrl.searchParams.get('repo')?.trim() || GITHUB_MONOREPO_SLUG;
  const safeQueryRepoPath = encodeGitHubRepoPath(queryRepo);
  if (!safeQueryRepoPath) {
    return jsonEdgeResponse(
      { error: 'Invalid GitHub repository slug.' },
      400,
      request,
      undefined,
      env
    );
  }

  const method = request.method.toUpperCase();

  // 1. GET /api/admin/github/runs?repo=...
  if (path === '/api/admin/github/runs' && method === 'GET') {
    const token = resolveGitHubRepoToken(env, queryRepo, 'read');
    try {
      const res = await ghFetchReadWithPublicFallback(
        fetchImpl,
        `https://api.github.com/repos/${safeQueryRepoPath}/actions/runs?per_page=10`,
        token,
        5500
      );
      if (!res.ok) {
        return jsonEdgeResponse(
          {
            runs: [],
            repo: queryRepo,
            tokenConfigured: Boolean(token),
            warning: `GitHub API returned HTTP ${res.status} for ${queryRepo}`,
          },
          200,
          request,
          undefined,
          env
        );
      }
      const data = (await res.json().catch(() => ({}))) as { workflow_runs?: unknown[] };
      const runs = (Array.isArray(data.workflow_runs) ? data.workflow_runs : []).map((raw) => {
        const rr = raw as Record<string, unknown>;
        return {
          id: rr.id,
          name: (rr.name as string) || 'CI Pipeline',
          status: (rr.status as string) || 'completed',
          conclusion: (rr.conclusion as string | null) ?? null,
          head_branch: (rr.head_branch as string) || 'main',
          head_sha: (rr.head_sha as string | null) ?? null,
          created_at: rr.created_at,
          run_started_at: rr.run_started_at ?? null,
          updated_at: rr.updated_at ?? null,
          run_number: rr.run_number ?? null,
          event: rr.event ?? null,
          html_url: rr.html_url,
          repo: queryRepo,
        };
      });
      return jsonEdgeResponse(
        { runs, repo: queryRepo, tokenConfigured: Boolean(token) || isPublicSupremeRepo(queryRepo) },
        200,
        request,
        undefined,
        env
      );
    } catch (err) {
      return jsonEdgeResponse(
        {
          runs: [],
          repo: queryRepo,
          tokenConfigured: Boolean(token),
          warning: err instanceof Error ? err.message : 'GitHub API unreachable',
        },
        200,
        request,
        undefined,
        env
      );
    }
  }

  // 2. GET /api/admin/github/pulls?repo=...
  if (path === '/api/admin/github/pulls' && method === 'GET') {
    const token = resolveGitHubRepoToken(env, queryRepo, 'read');
    try {
      const res = await ghFetchReadWithPublicFallback(
        fetchImpl,
        `https://api.github.com/repos/${safeQueryRepoPath}/pulls?state=open&per_page=10`,
        token,
        5500
      );
      if (!res.ok) {
        return jsonEdgeResponse(
          {
            pulls: [],
            repo: queryRepo,
            tokenConfigured: Boolean(token),
            warning: `GitHub API returned HTTP ${res.status} for ${queryRepo}`,
          },
          200,
          request,
          undefined,
          env
        );
      }
      const data = (await res.json().catch(() => [])) as unknown[];
      const pulls = (Array.isArray(data) ? data : []).map((raw) => {
        const p = raw as Record<string, unknown>;
        const user = p.user as Record<string, unknown> | undefined;
        return {
          number: p.number,
          title: p.title,
          state: p.state,
          head: p.head,
          base: p.base,
          user: { login: (user?.login as string) || 'contributor' },
          created_at: p.created_at,
          html_url: p.html_url,
          repo: queryRepo,
        };
      });
      return jsonEdgeResponse(
        {
          pulls,
          repo: queryRepo,
          tokenConfigured: Boolean(token) || isPublicSupremeRepo(queryRepo),
        },
        200,
        request,
        undefined,
        env
      );
    } catch (err) {
      return jsonEdgeResponse(
        {
          pulls: [],
          repo: queryRepo,
          tokenConfigured: Boolean(token),
          warning: err instanceof Error ? err.message : 'GitHub API unreachable',
        },
        200,
        request,
        undefined,
        env
      );
    }
  }

  // 3. GET /api/admin/github/runs/:id/logs?repo=...
  const logMatch = /^\/api\/admin\/github\/runs\/(\d{1,20})\/logs$/.exec(path);
  if (logMatch && method === 'GET') {
    const runId = encodeURIComponent(logMatch[1]);
    const token = resolveGitHubRepoToken(env, queryRepo, 'read');
    try {
      const jobsRes = await ghFetchReadWithPublicFallback(
        fetchImpl,
        `https://api.github.com/repos/${safeQueryRepoPath}/actions/runs/${runId}/jobs?per_page=30`,
        token,
        6000
      );
      if (!jobsRes.ok) {
        return jsonEdgeResponse(
          {
            runId,
            repo: queryRepo,
            available: false,
            reason:
              jobsRes.status === 401 || jobsRes.status === 403
                ? `GitHub API returned HTTP ${jobsRes.status} (${token ? 'check GITHUB_TOKEN actions:read permission' : 'configure GITHUB_TOKEN on server'}).`
                : `GitHub jobs API returned HTTP ${jobsRes.status}.`,
            failedJobs: [],
            annotations: [],
            stderrSnippet: '',
            truncated: false,
          },
          200,
          request,
          undefined,
          env
        );
      }

      const jobsPayload = (await jobsRes.json().catch(() => ({}))) as {
        jobs?: Array<Record<string, unknown>>;
      };
      const allJobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
      const failedRawJobs = allJobs.filter((j) =>
        FAILED_CONCLUSIONS.has(String(j.conclusion || '').toLowerCase())
      );
      const targetJobs =
        failedRawJobs.length > 0
          ? failedRawJobs
          : allJobs.filter((j) => String(j.conclusion || '').toLowerCase() !== 'success');

      const failedJobs: GitHubFailedJobSummary[] = targetJobs.slice(0, 5).map((j) => {
        const steps = Array.isArray(j.steps) ? (j.steps as Array<Record<string, unknown>>) : [];
        return {
          id: Number(j.id || 0),
          name: String(j.name || 'Workflow job'),
          conclusion: (j.conclusion as string | null) ?? null,
          html_url: typeof j.html_url === 'string' ? j.html_url : null,
          failedSteps: steps
            .filter((s) => FAILED_CONCLUSIONS.has(String(s.conclusion || '').toLowerCase()))
            .map((s) => ({
              name: String(s.name || 'Failed step'),
              number: Number(s.number || 0),
              conclusion: (s.conclusion as string | null) ?? null,
            })),
        };
      });

      const inspectedJobs = failedJobs.filter((j) => j.id > 0).slice(0, 2);
      const annotations: GitHubRunAnnotation[] = [];
      const snippetParts: string[] = [];
      let truncated = false;
      let logStatusReason: string | undefined;

      await Promise.all(
        inspectedJobs.map(async (job) => {
          const safeJobId = encodeURIComponent(String(Math.trunc(job.id)));
          const [annRes, logRes] = await Promise.allSettled([
            ghFetchReadWithPublicFallback(
              fetchImpl,
              `https://api.github.com/repos/${safeQueryRepoPath}/check-runs/${safeJobId}/annotations?per_page=15`,
              token,
              5000
            ),
            ghFetchRaw(
              fetchImpl,
              `https://api.github.com/repos/${safeQueryRepoPath}/actions/jobs/${safeJobId}/logs`,
              { token, timeoutMs: 7000 }
            ),
          ]);

          if (annRes.status === 'fulfilled' && annRes.value.ok) {
            const annJson = (await annRes.value.json().catch(() => [])) as Array<
              Record<string, unknown>
            >;
            if (Array.isArray(annJson)) {
              for (const item of annJson) {
                const msg = String(item.message || '').trim();
                if (!msg) continue;
                annotations.push({
                  path: String(item.path || ''),
                  startLine: Number(item.start_line || 0),
                  annotationLevel: String(item.annotation_level || 'failure'),
                  title: typeof item.title === 'string' && item.title ? item.title : null,
                  message: msg,
                });
              }
            }
          }

          if (logRes.status === 'fulfilled') {
            if (logRes.value.ok) {
              const rawText = await logRes.value.text();
              const bounded = rawText.length > 300_000 ? rawText.slice(-300_000) : rawText;
              const extracted = extractCiErrorSnippet(bounded, 40, 5000);
              if (extracted.truncated || rawText.length > 300_000) truncated = true;
              if (extracted.snippet) {
                const header = inspectedJobs.length > 1 ? `=== ${job.name} ===\n` : '';
                snippetParts.push(`${header}${extracted.snippet}`);
              }
            } else if (!logStatusReason) {
              logStatusReason =
                logRes.value.status === 410
                  ? 'Raw job logs have expired on GitHub.'
                  : `Raw job log download returned HTTP ${logRes.value.status}${
                      logRes.value.status === 401 || logRes.value.status === 403
                        ? token
                          ? ' (token may lack actions:read scope)'
                          : ' (configure GITHUB_TOKEN on server)'
                        : ''
                    }.`;
            }
          }
        })
      );

      const stderrSnippet = snippetParts.join('\n\n');
      const available = Boolean(stderrSnippet || annotations.length > 0);
      return jsonEdgeResponse(
        {
          runId,
          repo: queryRepo,
          available,
          reason: available
            ? logStatusReason
            : logStatusReason ||
              (failedJobs.length > 0
                ? 'No stderr lines or annotations were exposed by GitHub for this run.'
                : 'No failed job details found for this workflow run.'),
          failedJobs,
          annotations: annotations.slice(0, 12),
          stderrSnippet,
          truncated,
        },
        200,
        request,
        undefined,
        env
      );
    } catch (err) {
      return jsonEdgeResponse(
        {
          runId,
          repo: queryRepo,
          available: false,
          reason: err instanceof Error ? err.message : 'Unable to fetch GitHub job logs.',
          failedJobs: [],
          annotations: [],
          stderrSnippet: '',
          truncated: false,
        },
        200,
        request,
        undefined,
        env
      );
    }
  }

  // 4. POST /api/admin/github/runs/:id/(rerun|cancel)
  const runActionMatch = /^\/api\/admin\/github\/runs\/(\d{1,20})\/(rerun|cancel)$/.exec(path);
  if (runActionMatch && method === 'POST') {
    const runId = encodeURIComponent(runActionMatch[1]);
    const action = runActionMatch[2] === 'cancel' ? 'cancel' : 'rerun';
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { repo?: unknown };
    const rawTargetRepo =
      typeof body.repo === 'string' && body.repo.trim() ? body.repo.trim() : queryRepo;
    const safeTargetRepoPath = encodeGitHubRepoPath(rawTargetRepo);
    if (!safeTargetRepoPath) {
      return jsonEdgeResponse(
        { error: 'Invalid GitHub repository slug.' },
        400,
        request,
        undefined,
        env
      );
    }
    const token = resolveGitHubRepoToken(env, rawTargetRepo, 'write');
    if (!token) {
      return jsonEdgeResponse(
        { error: 'GITHUB_TOKEN is not configured on the server.' },
        503,
        request,
        undefined,
        env
      );
    }
    try {
      const ghRes = await ghFetchRaw(
        fetchImpl,
        `https://api.github.com/repos/${safeTargetRepoPath}/actions/runs/${runId}/${action}`,
        { method: 'POST', token, timeoutMs: 6000 }
      );
      if (!ghRes.ok) {
        const errData = (await ghRes.json().catch(() => null)) as Record<string, unknown> | null;
        return jsonEdgeResponse(
          {
            error: `GitHub API returned HTTP ${ghRes.status}${
              githubMessage(errData) ? `: ${githubMessage(errData)}` : ''
            }`,
          },
          ghRes.status,
          request,
          undefined,
          env
        );
      }
      audit.details = `Run #${runId} ${action} dispatched on ${rawTargetRepo}`;
      return jsonEdgeResponse({ success: true }, 200, request, undefined, env);
    } catch {
      return jsonEdgeResponse(
        { error: 'Failed to reach GitHub Actions API.' },
        504,
        request,
        undefined,
        env
      );
    }
  }

  // 5. POST /api/admin/github/pulls/:number/(approve|merge)
  const pullActionMatch = /^\/api\/admin\/github\/pulls\/(\d{1,7})\/(approve|merge)$/.exec(path);
  if (pullActionMatch && method === 'POST') {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { repo?: unknown };
    const rawTargetRepo =
      typeof body.repo === 'string' && body.repo.trim() ? body.repo.trim() : queryRepo;
    if (!isSafeGitHubRepoSlug(rawTargetRepo)) {
      return jsonEdgeResponse(
        { error: 'Invalid GitHub repository slug.' },
        400,
        request,
        undefined,
        env
      );
    }
    const action = pullActionMatch[2] as PullAction;
    const result = await runPullAction(
      env,
      rawTargetRepo,
      Number(pullActionMatch[1]),
      action,
      fetchImpl
    );
    audit.details = `PR #${pullActionMatch[1]} ${action} on ${rawTargetRepo} → ${
      result.body.success ? 'ok' : result.body.code || result.status
    }`;
    return jsonEdgeResponse(result.body, result.status, request, undefined, env);
  }

  return null;
}
