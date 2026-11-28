import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { isRestrictedProxyTarget } from '../../../shared/serverSecurity';
import { getCronMinuteKey, matchesCronAtDate } from '../../../shared/cronMatcher';
import {
  buildScheduleEvaluationPrompt,
  extractHtmlTitle,
  extractReadablePageSnippet,
  type ScheduleRunStage,
} from '../../../shared/scheduleExecution';

/**
 * Workspace Browser Schedules — zero-secret vault-bound automation tasks
 *
 * WHY THIS FILE EXISTS
 *   The scheduled browser-automation surface (`GET/POST/PATCH/DELETE
 *   /api/workspace/browser-schedules*` + `POST .../run`) plus its
 *   persistence (`expressScheduleStore` + `.studio-data/browser-schedules.json`)
 *   and minute-cron executor lived inline in the monolith (~260 lines).
 *   It is cohesive (single store, single timer, single execution helper)
 *   and has no other consumer. Moving it keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `resolveAuthenticatedEmail` is injected via ctx (closure over
 *     customerDirectory/JWT — cannot be imported, lazy method ref avoids TDZ).
 *   - `safeFetchWithRedirectCheck` + `isRestrictedProxyTarget` are the SSRF-
 *     hardened fetch path; the former is a closure helper (injected), the
 *     latter is a shared pure function imported directly.
 *   - `APP_VERSION` is injected (read from package.json in server.ts).
 *   - Cron helpers are imported directly from `src/shared/cronMatcher`.
 *   - Persistence is owned here — `expressScheduleStore` + file + timer live
 *     in this module after extraction. No other route touches the map.
 *   - The `setInterval` cron tick is started at registration (30s) and
 *     `unref()`-ed, mirroring the monolith's startup behaviour.
 */

interface StoredScheduleRecord {
  id: string;
  title: string;
  domain: string;
  targetUrl: string;
  vaultEntryId: string;
  vaultMode: 'session' | 'credentials';
  cadence: 'hourly' | 'daily' | 'weekly' | 'custom';
  cronExpression: string;
  instruction: string;
  enabled: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: 'idle' | 'ok' | 'error';
  /**
   * Audit 2026-11-24 (item 1.6): an HTTP 200 is NOT a completed instruction.
   * The run stage records what actually happened: fetched (page retrieved,
   * no AI evaluation), analyzed (AI evaluation completed), failed.
   */
  lastRunStage?: ScheduleRunStage;
  lastRunSummary?: string;
  lastRunAiReport?: string;
  ownerEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBrowserSchedulesContext {
  APP_VERSION: string;
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
  safeFetchWithRedirectCheck: (
    initialUrl: string | URL,
    init?: RequestInit,
    isLocalRelative?: boolean,
    maxRedirects?: number
  ) => Promise<globalThis.Response>;
}

export function registerWorkspaceBrowserSchedulesRoutes(
  app: Express,
  ctx: WorkspaceBrowserSchedulesContext
): void {
  const studioDataDir = path.join(process.cwd(), '.studio-data');
  const schedulePersistFile = path.join(studioDataDir, 'browser-schedules.json');
  const expressScheduleStore = new Map<string, StoredScheduleRecord>();
  const expressScheduleOwner = new Map<string, string>();
  const lastCronRunMinuteById = new Map<string, string>();

  const loadPersistedExpressSchedules = () => {
    try {
      if (fs.existsSync(schedulePersistFile)) {
        const raw = fs.readFileSync(schedulePersistFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.id) {
              const rec = item as StoredScheduleRecord;
              expressScheduleStore.set(String(rec.id), rec);
              if (rec.ownerEmail) {
                expressScheduleOwner.set(String(rec.id), String(rec.ownerEmail).toLowerCase());
              }
            }
          }
        }
      }
    } catch {
      // Ignore malformed schedule store file cleanly
    }
  };

  const persistExpressSchedules = () => {
    try {
      fs.mkdirSync(studioDataDir, { recursive: true });
      fs.writeFileSync(
        schedulePersistFile,
        JSON.stringify(Array.from(expressScheduleStore.values()), null, 2),
        'utf-8'
      );
    } catch {
      // Non-fatal persistence failure
    }
  };

  const getScheduleOwner = (record?: StoredScheduleRecord): string => {
    if (!record) return '';
    return (record.ownerEmail || expressScheduleOwner.get(record.id) || '').toLowerCase();
  };

  const evaluateFetchedScheduleWithAi = async (params: {
    record: StoredScheduleRecord;
    statusCode: number;
    pageTitle: string;
    rawBody: string;
  }): Promise<{ headline?: string; report?: string } | null> => {
    const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
    if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') return null;

    const pageText = extractReadablePageSnippet(params.rawBody, 3500);
    if (!pageText && !params.record.instruction.trim()) return null;

    try {
      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: buildScheduleEvaluationPrompt({
          title: params.record.title,
          targetUrl: params.record.targetUrl,
          instruction: params.record.instruction,
          pageTitle: params.pageTitle,
          statusCode: params.statusCode,
          pageText,
        }),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              report: { type: Type.STRING },
            },
            required: ['headline', 'report'],
          },
        },
      });
      const parsed = JSON.parse((response.text || '{}').trim()) as {
        headline?: string;
        report?: string;
      };
      return {
        headline: parsed.headline?.trim(),
        report: parsed.report?.trim(),
      };
    } catch {
      return null;
    }
  };

  const executeServerScheduleRecord = async (
    record: StoredScheduleRecord
  ): Promise<StoredScheduleRecord> => {
    const nowIso = new Date().toISOString();
    let status: 'ok' | 'error';
    let stage: ScheduleRunStage;
    let summary: string;
    let aiReport: string | undefined;

    try {
      const parsedTarget = new URL(record.targetUrl);
      const started = Date.now();
      const resp = await ctx.safeFetchWithRedirectCheck(
        parsedTarget,
        {
          method: 'GET',
          headers: {
            'User-Agent': `SupremeAI-Studio-Scheduler/${ctx.APP_VERSION}`,
            Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(8000),
        },
        false
      );
      const latencyMs = Date.now() - started;
      const rawBody = await resp.text().catch(() => '');
      const pageTitle = extractHtmlTitle(rawBody, record.domain);
      status = resp.ok ? 'ok' : 'error';
      stage = resp.ok ? 'fetched' : 'failed';
      // Audit 2026-11-24 (item 1.6): say what actually happened, not just HTTP.
      summary = resp.ok
        ? `Fetched HTTP ${resp.status} · ${pageTitle} · ${latencyMs}ms (no AI evaluation yet)`
        : `Fetch failed with HTTP ${resp.status} · ${latencyMs}ms`;

      if (resp.ok) {
        const evaluated = await evaluateFetchedScheduleWithAi({
          record,
          statusCode: resp.status,
          pageTitle,
          rawBody,
        });
        if (evaluated?.headline) {
          stage = 'analyzed';
          summary = `${evaluated.headline} (${latencyMs}ms)`;
        }
        if (evaluated?.report) {
          aiReport = evaluated.report.slice(0, 1400);
        }
      }
    } catch (err: unknown) {
      status = 'error';
      stage = 'failed';
      summary = err instanceof Error ? err.message : 'Request failed';
    }

    const updated: StoredScheduleRecord = {
      ...record,
      lastRunAt: nowIso,
      lastRunStatus: status,
      lastRunStage: stage,
      lastRunSummary: summary.slice(0, 240),
      ...(aiReport ? { lastRunAiReport: aiReport } : {}),
      updatedAt: nowIso,
    };
    expressScheduleStore.set(record.id, updated);
    persistExpressSchedules();
    return updated;
  };

  loadPersistedExpressSchedules();

  const serverCronTimer = setInterval(() => {
    const now = new Date();
    const minuteKey = getCronMinuteKey(now);
    for (const record of expressScheduleStore.values()) {
      if (!record.enabled || !record.cronExpression) continue;
      if (lastCronRunMinuteById.get(record.id) === minuteKey) continue;
      if (matchesCronAtDate(record.cronExpression, now)) {
        lastCronRunMinuteById.set(record.id, minuteKey);
        void executeServerScheduleRecord(record);
      }
    }
  }, 30000);
  serverCronTimer.unref?.();

  app.get('/api/workspace/browser-schedules', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const domainFilter = String(req.query.domain || '')
      .trim()
      .toLowerCase();
    const schedules = Array.from(expressScheduleStore.values())
      .filter((s) => getScheduleOwner(s) === owner)
      .filter((s) => !domainFilter || s.domain === domainFilter);
    res.json({ schedules });
  });

  app.post('/api/workspace/browser-schedules/run', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const id = String(req.query.id || (req.body as Record<string, unknown>)?.id || '').trim();
    const existing = expressScheduleStore.get(id);
    if (!existing || getScheduleOwner(existing) !== owner) {
      res.status(404).json({ error: 'Schedule not found.' });
      return;
    }
    const updated = await executeServerScheduleRecord(existing);
    res.json({ success: updated.lastRunStatus === 'ok', schedule: updated });
  });

  app.post('/api/workspace/browser-schedules', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = (req.body || {}) as Partial<StoredScheduleRecord> & { action?: string };
    if (body.action === 'run' && body.id) {
      const existing = expressScheduleStore.get(String(body.id));
      if (!existing || getScheduleOwner(existing) !== owner) {
        res.status(404).json({ error: 'Schedule not found.' });
        return;
      }
      const updated = await executeServerScheduleRecord(existing);
      res.json({ success: updated.lastRunStatus === 'ok', schedule: updated });
      return;
    }
    if (typeof body.domain !== 'string' || !body.domain.trim() || !body.vaultEntryId) {
      res.status(400).json({ error: 'domain and vaultEntryId are required.' });
      return;
    }
    const id =
      typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `sched_${Date.now()}`;
    const existing = expressScheduleStore.get(id);
    if (existing && getScheduleOwner(existing) && getScheduleOwner(existing) !== owner) {
      res.status(403).json({ error: 'Cannot overwrite another user schedule.' });
      return;
    }
    const rawTargetUrl = (body.targetUrl || `https://${body.domain.trim()}`).trim();
    try {
      const targetCheck = isRestrictedProxyTarget(new URL(rawTargetUrl), false);
      if (targetCheck.restricted) {
        res.status(400).json({ error: targetCheck.reason || 'Restricted schedule target URL.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid schedule target URL.' });
      return;
    }
    const now = new Date().toISOString();
    const record: StoredScheduleRecord = {
      id,
      title: (body.title || `${body.domain} task`).trim().slice(0, 80),
      domain: body.domain.trim().toLowerCase(),
      targetUrl: rawTargetUrl,
      vaultEntryId: String(body.vaultEntryId),
      vaultMode: body.vaultMode === 'credentials' ? 'credentials' : 'session',
      cadence:
        body.cadence === 'hourly' || body.cadence === 'weekly' || body.cadence === 'custom'
          ? body.cadence
          : 'daily',
      cronExpression: (body.cronExpression || '0 8 * * *').trim().slice(0, 64),
      instruction: (body.instruction || '').trim().slice(0, 1200),
      enabled: body.enabled !== false,
      lastRunAt: body.lastRunAt ?? existing?.lastRunAt ?? null,
      lastRunStatus: body.lastRunStatus ?? existing?.lastRunStatus ?? 'idle',
      lastRunSummary: body.lastRunSummary ?? existing?.lastRunSummary,
      ownerEmail: owner,
      createdAt:
        typeof body.createdAt === 'string' && body.createdAt.trim()
          ? body.createdAt
          : existing?.createdAt || now,
      updatedAt: now,
    };
    expressScheduleStore.set(id, record);
    expressScheduleOwner.set(id, owner);
    persistExpressSchedules();
    res.json({ success: true, schedule: record });
  });

  app.patch(
    ['/api/workspace/browser-schedules', '/api/workspace/browser-schedules/:id'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const id = String(
        (req.params as Record<string, string>).id ||
          (req.query as Record<string, string>).id ||
          (req.body as Record<string, unknown>)?.id ||
          ''
      ).trim();
      const existing = expressScheduleStore.get(id);
      if (!existing || getScheduleOwner(existing) !== owner) {
        res.status(404).json({ error: 'Schedule not found.' });
        return;
      }
      const body = (req.body || {}) as Partial<StoredScheduleRecord>;
      const updated: StoredScheduleRecord = {
        ...existing,
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(body.lastRunAt !== undefined ? { lastRunAt: body.lastRunAt } : {}),
        ...(body.lastRunStatus ? { lastRunStatus: body.lastRunStatus } : {}),
        ...(body.lastRunStage ? { lastRunStage: body.lastRunStage } : {}),
        ...(typeof body.lastRunSummary === 'string'
          ? { lastRunSummary: body.lastRunSummary.slice(0, 500) }
          : {}),
        ...(typeof body.lastRunAiReport === 'string'
          ? { lastRunAiReport: body.lastRunAiReport.slice(0, 1400) }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      expressScheduleStore.set(id, updated);
      persistExpressSchedules();
      res.json({ success: true, schedule: updated });
    }
  );

  app.delete(
    ['/api/workspace/browser-schedules', '/api/workspace/browser-schedules/:id'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const id = String(
        (req.params as Record<string, string>).id ||
          (req.query as Record<string, string>).id ||
          ''
      ).trim();
      if (!id) {
        res.status(400).json({ error: 'id parameter is required.' });
        return;
      }
      const existing = expressScheduleStore.get(id);
      if (!existing || getScheduleOwner(existing) !== owner) {
        res.status(404).json({ error: 'Schedule not found.' });
        return;
      }
      expressScheduleOwner.delete(id);
      expressScheduleStore.delete(id);
      persistExpressSchedules();
      res.json({ success: true, id });
    }
  );
}
