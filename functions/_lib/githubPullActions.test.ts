import { describe, expect, it, vi } from 'vitest';
import { runPullAction } from './githubPullActions';

type Route = { status: number; body: unknown };

function fakeGitHub(routes: Record<string, Route>) {
  const calls: { key: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method || 'GET'} ${url.pathname}`;
    calls.push({
      key,
      auth: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = routes[key];
    return r
      ? Response.json(r.body, { status: r.status })
      : Response.json({ message: 'Not Found' }, { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const PR = 'GET /repos/o/r/pulls/904';
const ME = 'GET /user';
const REVIEW = 'POST /repos/o/r/pulls/904/reviews';
const MERGE = 'PUT /repos/o/r/pulls/904/merge';

describe('runPullAction approve', () => {
  it('blocks self-approval with a clear reason instead of a fake success', async () => {
    const { fetchImpl, calls } = fakeGitHub({
      [PR]: { status: 200, body: { user: { login: 'paykaribazaronline' } } },
      [ME]: { status: 200, body: { login: 'PaykariBazarOnline' } },
    });
    const r = await runPullAction({ GITHUB_TOKEN: 't' }, 'o/r', 904, 'approve', fetchImpl);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('self-approval');
    expect(r.body.error).toContain('GITHUB_REVIEW_TOKEN');
    expect(calls.some((c) => c.key === REVIEW)).toBe(false);
  });

  it('uses GITHUB_REVIEW_TOKEN for approvals when set', async () => {
    const { fetchImpl, calls } = fakeGitHub({
      [PR]: { status: 200, body: { user: { login: 'author' } } },
      [ME]: { status: 200, body: { login: 'reviewer-bot' } },
      [REVIEW]: { status: 200, body: { id: 1 } },
    });
    const r = await runPullAction(
      { GITHUB_TOKEN: 'main', GITHUB_REVIEW_TOKEN: 'review' },
      'o/r',
      904,
      'approve',
      fetchImpl
    );
    expect(r).toEqual({ status: 200, body: { success: true } });
    const review = calls.find((c) => c.key === REVIEW)!;
    expect(review.auth).toBe('Bearer review');
    expect(review.body).toMatchObject({ event: 'APPROVE' });
  });

  it('surfaces GitHub 422 reasons as 409', async () => {
    const { fetchImpl } = fakeGitHub({
      [PR]: { status: 200, body: { user: { login: 'a' } } },
      [ME]: { status: 200, body: { login: 'b' } },
      [REVIEW]: {
        status: 422,
        body: { message: 'Unprocessable Entity', errors: ['PR is closed'] },
      },
    });
    const r = await runPullAction({ GITHUB_TOKEN: 't' }, 'o/r', 904, 'approve', fetchImpl);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('Unprocessable Entity — PR is closed');
  });

  it('fails clearly without a token', async () => {
    const r = await runPullAction({}, 'o/r', 904, 'approve', vi.fn() as unknown as typeof fetch);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('no-token');
  });
});

describe('runPullAction merge', () => {
  it('squash-merges and reports success', async () => {
    const { fetchImpl, calls } = fakeGitHub({ [MERGE]: { status: 200, body: { merged: true } } });
    const r = await runPullAction({ GITHUB_TOKEN: 't' }, 'o/r', 904, 'merge', fetchImpl);
    expect(r.body).toEqual({ success: true, merged: true });
    expect(calls[0].body).toEqual({ merge_method: 'squash' });
  });

  it('returns GitHub refusal reasons', async () => {
    const { fetchImpl } = fakeGitHub({
      [MERGE]: { status: 405, body: { message: 'Required status check is failing' } },
    });
    const r = await runPullAction({ GITHUB_TOKEN: 't' }, 'o/r', 904, 'merge', fetchImpl);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('Required status check is failing');
  });
});
