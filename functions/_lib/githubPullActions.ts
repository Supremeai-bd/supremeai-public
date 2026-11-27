/**
 * বাংলা মন্তব্য: Deploy & CI → "Approve PR" / "Auto-Merge" — এখন edge-এই সরাসরি GitHub-এ যায়।
 *
 * আগে অনুরোধ গেটওয়েতে যেত, যা GitHub-এর 422 ("Can not approve your own pull request")
 * পেয়েও HTTP 200 ফেরত দিত — তাই UI "completed" দেখাত অথচ GitHub-এ কোনো রিভিউ হতো না।
 * এখন আসল স্ট্যাটাস ও স্পষ্ট কারণ ফেরত যায়। approve-এর জন্য আলাদা রিভিউয়ার টোকেন
 * (GITHUB_REVIEW_TOKEN) থাকলে সেটাই ব্যবহার হয়, কারণ GitHub নিজের PR নিজে approve করতে দেয় না।
 */

type Env = Record<string, string | undefined> | undefined;

export type PullAction = 'approve' | 'merge';

export interface PullActionResult {
  status: number;
  body: { success: boolean; error?: string; code?: string; merged?: boolean };
}

const TIMEOUT_MS = 8000;

async function gh(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  url: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SupremeAI-Studio-Edge-Admin',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, data };
  } catch {
    return { status: 504, data: null };
  } finally {
    clearTimeout(timer);
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
  const mainToken = String(env?.GITHUB_TOKEN || '').trim();
  const reviewToken = String(env?.GITHUB_REVIEW_TOKEN || '').trim();
  const token = action === 'approve' ? reviewToken || mainToken : mainToken;
  if (!token) {
    return {
      status: 503,
      body: {
        success: false,
        code: 'no-token',
        error: 'GITHUB_TOKEN is not set on Cloudflare Pages, so PR actions cannot run.',
      },
    };
  }
  const api = `https://api.github.com/repos/${repo}/pulls/${number}`;

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
