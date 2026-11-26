import { Hono } from 'hono';
import type { ApiDeps, ApiEnv } from '../app';

export const SHARE_MAX_BODY_BYTES = 1024 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

// বাংলা মন্তব্য: stateless permalink-এ payload কেবল base64url; encryption/authentication নয়।
function encodePayload(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// বাংলা মন্তব্য: header না থাকলেও/মিথ্যা হলেও actual UTF-8 bytes গোনা হয়; limit ছাড়ালে stream বন্ধ।
async function readBody(request: Request): Promise<Record<string, unknown> | 400 | 413> {
  if (Number(request.headers.get('content-length')) > SHARE_MAX_BODY_BYTES) return 413;
  const reader = request.body?.getReader();
  if (!reader) return 400;
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SHARE_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : 400;
  } catch {
    return 400;
  } finally {
    reader.releaseLock();
  }
}

function optionalString(body: Record<string, unknown>, key: string): boolean {
  return body[key] === undefined || typeof body[key] === 'string';
}

export function createShareRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();
  const now = deps.now ?? Date.now;
  routes.use('/api/share/*', async (c, next) => {
    // বাংলা মন্তব্য: shared conversation/code যেন browser/proxy-তে cache না হয়।
    c.header('Cache-Control', 'no-store');
    await next();
  });

  routes.post('/api/share/generate', async (c) => {
    const body = await readBody(c.req.raw);
    if (typeof body === 'number')
      return c.json(
        { error: body === 413 ? 'Payload too large' : 'Invalid JSON object' },
        body,
        NO_STORE
      );
    // বাংলা মন্তব্য: DB conversation id-কে blank stateless conversation-এ রূপান্তর করা যাবে না।
    if (body.conversation_id !== undefined)
      return c.json(
        {
          error:
            'Stored conversation sharing requires the backend share API; provide content/messages for a stateless link.',
        },
        400,
        NO_STORE
      );
    if (
      !optionalString(body, 'title') ||
      !optionalString(body, 'content') ||
      (body.messages !== undefined && !Array.isArray(body.messages))
    ) {
      return c.json({ error: 'Invalid conversation fields' }, 400, NO_STORE);
    }
    const token = encodePayload({
      title: body.title || 'Shared Conversation',
      content: body.content || '',
      messages: body.messages || [],
      createdAt: new Date(now()).toISOString(),
    });
    return c.json(
      {
        id: token,
        share_url: `${new URL(c.req.url).origin}/?share=${token}#chat`,
        mode: 'edge-stateless',
      },
      200,
      NO_STORE
    );
  });
  routes.all('/api/share/generate', (c) =>
    c.json({ error: 'Method not allowed' }, 405, { ...NO_STORE, Allow: 'POST' })
  );

  routes.post('/api/share/artifact', async (c) => {
    const body = await readBody(c.req.raw);
    if (typeof body === 'number')
      return c.json(
        { error: body === 413 ? 'Payload too large' : 'Invalid JSON object' },
        body,
        NO_STORE
      );
    if (typeof body.code !== 'string' || !body.code.trim())
      return c.json({ error: 'Artifact code is required.' }, 400, NO_STORE);
    if (
      !optionalString(body, 'lang') ||
      !optionalString(body, 'title') ||
      (body.createdAt !== undefined &&
        (typeof body.createdAt !== 'number' || !Number.isFinite(body.createdAt)))
    ) {
      return c.json({ error: 'Invalid artifact fields' }, 400, NO_STORE);
    }
    const timestamp = now();
    const token = encodePayload({
      code: body.code,
      lang: ((typeof body.lang === 'string' && body.lang) || 'html').toLowerCase(),
      title: body.title || 'SupremeAI App',
      createdAt: body.createdAt || timestamp,
    });
    return c.json(
      {
        id: `art_${timestamp.toString(36)}`,
        share_url: `${new URL(c.req.url).origin}/?artifact=${token}#chat`,
        mode: 'edge-permalink',
      },
      200,
      NO_STORE
    );
  });
  routes.get('/api/share/artifact', (c) =>
    c.json({ status: 'ok', mode: 'edge-permalink' }, 200, NO_STORE)
  );
  routes.all('/api/share/artifact', (c) =>
    c.json({ error: 'Method not allowed' }, 405, { ...NO_STORE, Allow: 'GET, HEAD, POST' })
  );

  routes.get('/api/share/:id', (c) => {
    const id = new URL(c.req.url).pathname.slice('/api/share/'.length);
    try {
      const token = decodeURIComponent(id).replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(token + '='.repeat((4 - (token.length % 4)) % 4));
      const payload: unknown = JSON.parse(
        new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
      );
      if (isObject(payload)) return c.json({ ...payload, id, status: 'ok' }, 200, NO_STORE);
    } catch {
      // বাংলা মন্তব্য: malformed percent/base64/JSON token মানে not_found, uncaught 500 নয়।
    }
    return c.json({ id, content: '', status: 'not_found' }, 404, NO_STORE);
  });
  routes.all('/api/share/:id', (c) =>
    c.json({ error: 'Method not allowed' }, 405, { ...NO_STORE, Allow: 'GET, HEAD' })
  );
  return routes;
}
