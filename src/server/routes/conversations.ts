import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Persistent Local Conversations API — `GET/POST /api/v1/conversations*`
 *
 * WHY THIS FILE EXISTS
 *   The conversations surface (6 route handlers + 2 stores + Supabase
 *   persistence + file persistence) lived inline in `server.ts` (~377
 *   lines). It is cohesive (single `expressConversationStore`, single
 *   `conversationPersistFile`, dual local/Supabase writes) and has no
 *   other consumer except the federation proxy that must sit AFTER it
 *   (registration order matters). Moving it keeps the monolith shrinking
 *   with only 1 external dependency.
 *
 * CONTRACT WITH server.ts
 *   - `studioDataDir: path.join(process.cwd(), '.studio-data')` is the
 *     single persisted datum that would otherwise be imported. It is
 *     re-derived here (same expression, same semantics) so the module
 *     owns its persistence path. `server.ts` keeps its own identical
 *     `studioDataDir` for any remaining consumers (none after this split
 *     except federation, which does not use it).
 *   - `resolveAuthenticatedEmail` is injected via ctx because it closes
 *     over `customerDirectory`, JWT secrets, etc. inside `startServer()`
 *     and cannot be imported. A lazy method ref avoids TDZ.
 *   - `app.use('/api', federationProxy)` is registered AFTER this call
 *     in server.ts — that ordering is preserved (conversations must be
 *     mounted BEFORE the federation catch-all, otherwise the proxy would
 *     swallow them).
 *   - All Supabase helpers (`CONV_SB_URL/KEY`, `convSupabaseRest`, …)
 *     are owned here; no other route reads `expressConversationStore`.
 */

interface StoredConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model?: string;
  ownerEmail?: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
}

export interface ConversationsContext {
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
}

export function registerConversationsRoutes(app: Express, ctx: ConversationsContext): void {
  const studioDataDir = path.join(process.cwd(), '.studio-data');
  const conversationPersistFile = path.join(studioDataDir, 'conversations.json');
  const expressConversationStore = new Map<string, StoredConversation>();

  const loadExpressConversations = () => {
    try {
      if (fs.existsSync(conversationPersistFile)) {
        const raw = fs.readFileSync(conversationPersistFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.id) {
              expressConversationStore.set(String(item.id), item as StoredConversation);
            }
          }
        }
      }
    } catch {}
  };

  const persistExpressConversations = () => {
    try {
      fs.mkdirSync(studioDataDir, { recursive: true });
      fs.writeFileSync(
        conversationPersistFile,
        JSON.stringify(Array.from(expressConversationStore.values()), null, 2),
        'utf-8'
      );
    } catch {}
  };

  loadExpressConversations();

  const CONV_SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const CONV_SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const convSupabaseConfigured = () => Boolean(CONV_SB_URL && CONV_SB_KEY);
  const convSb = (value: string) => encodeURIComponent(value);
  const convSupabaseRest = async (
    pathAndQuery: string,
    method: string,
    body?: unknown,
    prefer = 'return=representation'
  ): Promise<any> => {
    const res = await fetch(`${CONV_SB_URL}/rest/v1/${pathAndQuery}`, {
      method,
      headers: {
        apikey: CONV_SB_KEY,
        Authorization: `Bearer ${CONV_SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok)
      throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]} -> HTTP ${res.status}`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  app.get('/api/v1/conversations', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    if (convSupabaseConfigured()) {
      try {
        const rows = await convSupabaseRest(
          `conversations?owner_email=eq.${convSb(owner)}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=${limit}`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convs: any[] = Array.isArray(rows) ? rows : [];
        const counts: Record<string, number> = {};
        const ids = convs.map((c) => c.id).filter(Boolean);
        if (ids.length > 0) {
          const msgs = await convSupabaseRest(
            `conversation_messages?conversation_id=in.(${ids.map((i) => convSb(String(i))).join(',')})&select=conversation_id`,
            'GET',
            undefined,
            'return=minimal'
          );
          for (const m of Array.isArray(msgs) ? msgs : []) {
            counts[m.conversation_id] = (counts[m.conversation_id] || 0) + 1;
          }
        }
        res.json({
          conversations: convs.map((c) => ({
            id: c.id,
            title: c.title,
            created_at: c.created_at,
            updated_at: c.updated_at,
            message_count: counts[c.id] || 0,
          })),
        });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const list = Array.from(expressConversationStore.values())
      .filter((c) => (c.ownerEmail || '') === owner)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
        message_count: c.messages?.length || 0,
      }));
    res.json({ conversations: list });
  });

  app.post('/api/v1/conversations', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    const id = String(
      body.conversationId ||
        body.id ||
        `conv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    );
    const existingConv = expressConversationStore.get(id);
    if (existingConv && existingConv.ownerEmail && existingConv.ownerEmail !== owner) {
      res.status(403).json({ error: 'Cannot overwrite another user conversation.' });
      return;
    }
    const nowIso = new Date().toISOString();
    if (convSupabaseConfigured()) {
      try {
        const titleVal =
          typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Chat';
        const modelVal = typeof body.model === 'string' ? body.model : 'supreme-spark';
        await convSupabaseRest('conversations', 'POST', [
          {
            id,
            owner_email: owner,
            title: titleVal,
            model: modelVal,
            created_at: nowIso,
            updated_at: nowIso,
          },
        ]);
        res.status(201).json({
          id,
          title: titleVal,
          created_at: nowIso,
          updated_at: nowIso,
          model: modelVal,
          messages: [],
        });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv: StoredConversation = {
      id,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Chat',
      created_at: nowIso,
      updated_at: nowIso,
      model: typeof body.model === 'string' ? body.model : 'supreme-spark',
      messages: [],
      ownerEmail: owner,
    };
    expressConversationStore.set(id, conv);
    persistExpressConversations();
    res.status(201).json(conv);
  });

  app.get('/api/v1/conversations/:id/messages', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const convRows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&select=owner_email`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convRow = Array.isArray(convRows) ? convRows[0] : null;
        if (!convRow || convRow.owner_email !== owner) {
          res.json({ messages: [] });
          return;
        }
        const msgs = await convSupabaseRest(
          `conversation_messages?conversation_id=eq.${convSb(req.params.id)}&select=id,role,content,created_at&order=created_at.asc`,
          'GET',
          undefined,
          'return=minimal'
        );
        res.json({ messages: Array.isArray(msgs) ? msgs : [] });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.json({ messages: [] });
      return;
    }
    res.json({ messages: conv.messages || [] });
  });

  app.post('/api/v1/conversations/:id/messages', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const convRows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&select=owner_email`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convRow = Array.isArray(convRows) ? convRows[0] : null;
        if (!convRow || convRow.owner_email !== owner) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }
        const nowIso = new Date().toISOString();
        const newMsg = {
          id: String(req.body?.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`),
          conversation_id: req.params.id,
          role: req.body?.role === 'assistant' ? 'assistant' : 'user',
          content: String(req.body?.content || ''),
          created_at: nowIso,
        };
        await convSupabaseRest('conversation_messages', 'POST', [newMsg]);
        await convSupabaseRest(`conversations?id=eq.${convSb(req.params.id)}`, 'PATCH', {
          updated_at: nowIso,
        });
        res.status(201).json({
          id: newMsg.id,
          role: newMsg.role,
          content: newMsg.content,
          created_at: newMsg.created_at,
        });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const body = req.body || {};
    const newMsg = {
      id: String(body.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`),
      role: body.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(body.content || ''),
      created_at: new Date().toISOString(),
    };
    conv.messages.push(newMsg);
    conv.updated_at = new Date().toISOString();
    persistExpressConversations();
    res.status(201).json(newMsg);
  });

  app.patch('/api/v1/conversations/:id', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof req.body?.title === 'string') patch.title = req.body.title.trim();
        const rows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&owner_email=eq.${convSb(owner)}`,
          'PATCH',
          patch
        );
        const updated = Array.isArray(rows) ? rows[0] : null;
        if (!updated) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }
        res.json(updated);
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (typeof req.body?.title === 'string') {
      conv.title = req.body.title.trim();
    }
    conv.updated_at = new Date().toISOString();
    persistExpressConversations();
    res.json(conv);
  });

  app.delete('/api/v1/conversations/:id', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const convRows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&select=owner_email`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convRow = Array.isArray(convRows) ? convRows[0] : null;
        if (!convRow || convRow.owner_email !== owner) {
          res.json({ success: true, deleted: false });
          return;
        }
        await convSupabaseRest(
          `conversation_messages?conversation_id=eq.${convSb(req.params.id)}`,
          'DELETE',
          undefined,
          'return=minimal'
        );
        await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&owner_email=eq.${convSb(owner)}`,
          'DELETE',
          undefined,
          'return=minimal'
        );
        res.json({ success: true, deleted: true });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.json({ success: true, deleted: false });
      return;
    }
    expressConversationStore.delete(req.params.id);
    persistExpressConversations();
    res.json({ success: true, deleted: true });
  });
}
