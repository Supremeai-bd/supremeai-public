/**
 * বাংলা মন্তব্য: AI Memory — এক জায়গায় সব AI-এর মেমরি (রোডম্যাপ আইটেম ৪)।
 *
 * - ChatGPT / Claude / Gemini ইত্যাদির মেমরি পড়ার কোনো পাবলিক API নেই। তাই ইউজার ওই AI থেকে
 *   কপি করে এনে পেস্ট করেন (UI সরাসরি লিংক + কপি-করার প্রম্পট দেয়), আর এখানে উৎস ধরে জমা হয়।
 * - স্টোর: বিদ্যমান `public.memories` টেবিল (owner_id + source_type + status) — নতুন টেবিল নয়।
 *   `confirmed` = চ্যাটে ব্যবহার হয়; `candidate` = কোনো এজেন্ট প্রস্তাব করেছে, ইউজারের রিভিউ বাকি।
 * - ব্রাউজারের কাছে Supabase JWT নেই, তাই পরিচয় `verifyUpstreamSession`, পড়া/লেখা service role,
 *   আর প্রতিটা কোয়েরিতে `owner_id=eq.<user>` — অন্যের মেমরি কখনো ছোঁয়া যায় না।
 *
 * Routes (prefix `/api/user/memories`):
 *   GET    /                         → my memories (candidate + confirmed), newest first
 *   POST   /    {source, items:[{content, kind?}]}   → bulk import / add (duplicates skipped)
 *   PATCH  /:id {content?, kind?, status?: 'confirmed'}
 *   DELETE /:id
 *   DELETE /?source=chatgpt          → clear everything from one source
 */

import { jsonEdgeResponse, type UpstreamSessionVerification } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

export type MemoryKind = 'fact' | 'decision' | 'task' | 'preference' | 'contact' | 'doc_chunk';
export type MemoryStatus = 'candidate' | 'confirmed';

export interface UserMemoryDto {
  id: string;
  content: string;
  kind: MemoryKind;
  source: string;
  sourceRef: string | null;
  createdBy: string;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDeps {
  fetchImpl?: typeof fetch;
  verify: (request: Request) => Promise<UpstreamSessionVerification>;
}

/** Sources a user can import from / add as. Anything else already in the DB is still listed. */
export const IMPORT_SOURCES = new Set([
  'chatgpt',
  'claude',
  'gemini',
  'copilot',
  'perplexity',
  'grok',
  'deepseek',
  'meta',
  'other',
  'manual',
]);
const KINDS = new Set<MemoryKind>([
  'fact',
  'decision',
  'task',
  'preference',
  'contact',
  'doc_chunk',
]);
export const MAX_MEMORY_CHARS = 1000;
export const MAX_IMPORT_ITEMS = 200;
const MAX_LIST = 1000;
const TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id,content,kind,source_type,source_ref,created_by,status,created_at,updated_at';

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Lower-case, collapse spaces, drop trailing punctuation — used to skip duplicates on import. */
export function normalizeMemory(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?।\s]+$/u, '')
    .trim();
}

export function mapMemory(row: unknown): UserMemoryDto {
  const r = asRecord(row);
  return {
    id: String(r.id || ''),
    content: String(r.content || ''),
    kind: (KINDS.has(r.kind as MemoryKind) ? r.kind : 'fact') as MemoryKind,
    source: String(r.source_type || 'other'),
    sourceRef: r.source_ref ? String(r.source_ref) : null,
    createdBy: String(r.created_by || 'user'),
    status: r.status === 'candidate' ? 'candidate' : 'confirmed',
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || r.created_at || ''),
  };
}

async function db(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string },
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cfg = resolveSupabaseAdmin(env)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${cfg.url}/rest/v1/${path}`, {
      method: init.method || 'GET',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 504, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleUserMemoriesRequest(
  request: Request,
  env: Env,
  deps: MemoryDeps
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const fail = (status: number, error: string) => reply({ success: false, error }, status);

  const url = new URL(request.url);
  const segments = url.pathname
    .replace(/^\/api\/user\/memories\/?/, '')
    .split('/')
    .filter(Boolean);
  const method = request.method.toUpperCase();

  const session = await deps.verify(request);
  if (session.unavailable)
    return fail(503, 'Session check is temporarily unavailable. Please retry.');
  if (!session.valid || session.isGuest) return fail(401, 'Sign in to sync your AI memory.');
  const userId = String(session.user_id || '');
  // বাংলা মন্তব্য: বৈধ সেশন কিন্তু Supabase UUID নেই — 401 নয় (তাহলে সেশন কেটে যেত), 403।
  if (!UUID_RE.test(userId)) return fail(403, 'AI memory sync needs a Supabase account.');
  if (!resolveSupabaseAdmin(env)) return fail(503, 'Memory store not linked.');

  const mine = `owner_id=eq.${userId}`;
  const listMine = async () =>
    db(
      env,
      `memories?select=${COLS}&${mine}&workspace_id=is.null&status=in.(candidate,confirmed)&order=created_at.desc&limit=${MAX_LIST}`,
      {},
      fetchImpl
    );

  if (segments.length === 0) {
    if (method === 'GET') {
      const res = await listMine();
      if (!res.ok) return fail(502, 'Could not read your memories.');
      return reply({
        success: true,
        memories: (Array.isArray(res.data) ? res.data : []).map(mapMemory),
      });
    }

    if (method === 'POST') {
      const body = asRecord(await request.json().catch(() => null));
      const source = String(body.source || '').toLowerCase();
      if (!IMPORT_SOURCES.has(source)) return fail(400, 'Unknown memory source.');
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return fail(400, 'Nothing to save.');
      if (items.length > MAX_IMPORT_ITEMS) {
        return fail(400, `Too many memories at once (max ${MAX_IMPORT_ITEMS}).`);
      }

      const existing = await listMine();
      if (!existing.ok) return fail(502, 'Could not read your memories.');
      const seen = new Set(
        (Array.isArray(existing.data) ? existing.data : []).map((r) =>
          normalizeMemory(String(asRecord(r).content || ''))
        )
      );
      const rows: Record<string, unknown>[] = [];
      let skipped = 0;
      for (const raw of items) {
        const item = asRecord(raw);
        const content = String(item.content ?? '').trim();
        if (!content || content.length > MAX_MEMORY_CHARS) {
          skipped++;
          continue;
        }
        const key = normalizeMemory(content);
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        const kind = KINDS.has(item.kind as MemoryKind) ? item.kind : 'fact';
        rows.push({
          owner_id: userId,
          content,
          kind,
          source_type: source,
          created_by: 'user',
          status: 'confirmed',
          confidence: 1,
        });
      }
      if (rows.length === 0) return reply({ success: true, added: 0, skipped, memories: [] }, 200);
      const res = await db(
        env,
        `memories?select=${COLS}`,
        { method: 'POST', body: rows, prefer: 'return=representation' },
        fetchImpl
      );
      if (!res.ok) return fail(502, 'Could not save your memories.');
      const saved = (Array.isArray(res.data) ? res.data : []).map(mapMemory);
      return reply({ success: true, added: saved.length, skipped, memories: saved }, 201);
    }

    if (method === 'DELETE') {
      const source = String(url.searchParams.get('source') || '').toLowerCase();
      if (!/^[a-z0-9_-]{1,32}$/.test(source)) return fail(400, 'Pick which source to clear.');
      const res = await db(
        env,
        `memories?${mine}&workspace_id=is.null&source_type=eq.${source}&select=id`,
        { method: 'DELETE', prefer: 'return=representation' },
        fetchImpl
      );
      if (!res.ok) return fail(502, 'Could not clear these memories.');
      return reply({ success: true, removed: Array.isArray(res.data) ? res.data.length : 0 });
    }
    return fail(405, 'Method not allowed.');
  }

  const id = segments[0];
  if (segments.length !== 1 || !UUID_RE.test(id)) return fail(404, 'Memory not found.');
  const scope = `memories?id=eq.${id}&${mine}`;

  if (method === 'PATCH') {
    const body = asRecord(await request.json().catch(() => null));
    const patch: Record<string, unknown> = {};
    if (body.content !== undefined) {
      const content = String(body.content ?? '').trim();
      if (!content || content.length > MAX_MEMORY_CHARS) {
        return fail(400, `A memory must be 1–${MAX_MEMORY_CHARS} characters.`);
      }
      patch.content = content;
    }
    if (body.kind !== undefined) {
      if (!KINDS.has(body.kind as MemoryKind)) return fail(400, 'Unknown memory type.');
      patch.kind = body.kind;
    }
    if (body.status !== undefined) {
      if (body.status !== 'confirmed') return fail(400, 'Only "confirmed" can be set here.');
      patch.status = 'confirmed';
    }
    if (Object.keys(patch).length === 0) return fail(400, 'Nothing to update.');
    const res = await db(
      env,
      `${scope}&select=${COLS}`,
      { method: 'PATCH', body: patch, prefer: 'return=representation' },
      fetchImpl
    );
    if (!res.ok) return fail(502, 'Could not update this memory.');
    if (!Array.isArray(res.data) || !res.data[0]) return fail(404, 'Memory not found.');
    return reply({ success: true, memory: mapMemory(res.data[0]) });
  }

  if (method === 'DELETE') {
    const res = await db(
      env,
      `${scope}&select=id`,
      { method: 'DELETE', prefer: 'return=representation' },
      fetchImpl
    );
    if (!res.ok) {
      return res.status === 409
        ? fail(409, 'A newer memory replaced this one — remove that one first.')
        : fail(502, 'Could not remove this memory.');
    }
    if (!Array.isArray(res.data) || !res.data[0]) return fail(404, 'Memory not found.');
    return reply({ success: true });
  }

  return fail(405, 'Method not allowed.');
}
