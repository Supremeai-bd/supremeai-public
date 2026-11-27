import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_ARTIFACT,
  computeBackupHealth,
  handleAdminBackupsRoute,
  normalizeArtifacts,
  normalizeRuns,
  type BackupArtifact,
  type BackupRun,
} from './adminBackups';

const NOW = Date.parse('2026-11-28T00:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const artifact = (id: number, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: BACKUP_ARTIFACT,
  size_in_bytes: 1_234_567,
  created_at: hoursAgo(h),
  expires_at: hoursAgo(-24 * 29),
  expired: false,
  workflow_run: { id: id * 10, head_sha: 'abcdef1234567' },
  ...extra,
});
const run = (id: number, conclusion: string | null, status = 'completed') => ({
  id,
  status,
  conclusion,
  event: 'schedule',
  created_at: hoursAgo(1),
  html_url: `https://github.com/x/runs/${id}`,
});

function fakeGitHub(art: unknown, runs: unknown, runStatus = 200) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    if (url.includes('/artifacts')) return Response.json(art);
    return runStatus === 200
      ? Response.json(runs)
      : new Response('{"message":"Not Found"}', { status: runStatus });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function get(
  env: Record<string, string> | undefined,
  fetchImpl: typeof fetch,
  method = 'GET'
) {
  const res = await handleAdminBackupsRoute(
    '/api/admin/backups',
    new Request('https://studio.test/api/admin/backups', { method }),
    env,
    fetchImpl
  );
  return { status: res!.status, body: (await res!.json()) as Record<string, any> };
}

describe('normalizers', () => {
  it('keeps only live backup artifacts, newest first, with short commit', () => {
    const list = normalizeArtifacts({
      artifacts: [
        artifact(1, 30),
        artifact(2, 5),
        artifact(3, 2, { expired: true }),
        artifact(4, 1, { name: 'other-artifact' }),
      ],
    });
    expect(list.map((a) => a.id)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ sizeBytes: 1_234_567, runId: 20, commit: 'abcdef1' });
  });

  it('tolerates junk payloads', () => {
    expect(normalizeArtifacts(null)).toEqual([]);
    expect(normalizeRuns({ workflow_runs: 'x' })).toEqual([]);
  });
});

describe('computeBackupHealth', () => {
  const b = (h: number): BackupArtifact => ({
    id: 1,
    sizeBytes: 1,
    createdAt: hoursAgo(h),
    expiresAt: null,
    runId: 1,
    commit: null,
  });
  const r = (conclusion: string | null, status = 'completed'): BackupRun => ({
    id: 1,
    status,
    conclusion,
    event: 'schedule',
    createdAt: hoursAgo(1),
    url: '',
  });

  it('ok when the newest backup is fresh and the last run succeeded', () => {
    expect(computeBackupHealth([b(10)], [r('success')], NOW)).toBe('ok');
  });
  it('stale after 36h without a new backup', () => {
    expect(computeBackupHealth([b(40)], [r('success')], NOW)).toBe('stale');
  });
  it('failing when the last completed run failed, even with an older backup', () => {
    expect(computeBackupHealth([b(10)], [r(null, 'in_progress'), r('failure')], NOW)).toBe(
      'failing'
    );
  });
  it('never when nothing has run yet', () => {
    expect(computeBackupHealth([], [], NOW)).toBe('never');
  });
});

describe('GET /api/admin/backups', () => {
  it('ignores other paths', async () => {
    const res = await handleAdminBackupsRoute(
      '/api/admin/other',
      new Request('https://studio.test/api/admin/other'),
      {},
      vi.fn() as unknown as typeof fetch
    );
    expect(res).toBeNull();
  });

  it('503 when the edge has no GitHub token', async () => {
    const { fetchImpl, calls } = fakeGitHub({}, {});
    const { status, body } = await get({}, fetchImpl);
    expect(status).toBe(503);
    expect(body.configured).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('405 for writes — there is no run/restore endpoint by design', async () => {
    const { fetchImpl } = fakeGitHub({}, {});
    expect((await get({ GITHUB_TOKEN: 't' }, fetchImpl, 'POST')).status).toBe(405);
  });

  it('returns live state from the private repo with the token', async () => {
    const { fetchImpl, calls } = fakeGitHub(
      { artifacts: [artifact(7, 3)] },
      { workflow_runs: [run(70, 'success')] }
    );
    const { status, body } = await get({ GITHUB_TOKEN: ' gh-token ' }, fetchImpl);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      configured: true,
      retentionDays: 30,
      encryption: 'AES-256',
      lastRun: { id: 70, conclusion: 'success' },
    });
    expect(body.backups).toHaveLength(1);
    expect(['ok', 'stale']).toContain(body.health);
    expect(calls.every((c) => c.auth === 'Bearer gh-token')).toBe(true);
    expect(calls[0].url).toContain('/repos/Supremeai-bd/supremeai/actions/artifacts?name=');
  });

  it('reports not-deployed while the workflow is not on private main yet', async () => {
    const { fetchImpl } = fakeGitHub({ artifacts: [] }, {}, 404);
    const { status, body } = await get({ GITHUB_READONLY_TOKEN: 'ro' }, fetchImpl);
    expect(status).toBe(200);
    expect(body.health).toBe('not-deployed');
  });

  it('maps GitHub auth errors to 502', async () => {
    const { fetchImpl } = fakeGitHub({}, {}, 403);
    const { status, body } = await get({ GITHUB_TOKEN: 't' }, fetchImpl);
    expect(status).toBe(502);
    expect(body.error).toContain('403');
  });
});
