import {
  PagesContext,
  extractLlmCompletionText,
  handleCorsPreflight,
  isRestrictedEdgeHost,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  fetchWithTimeout,
  safeEdgeFetch,
} from '../../_lib/edgeHelpers';
import {
  buildScheduleEvaluationPrompt,
  extractHtmlTitle,
  extractReadablePageSnippet,
  type ScheduleRunStage,
} from '../../../src/shared/scheduleExecution';

interface StoredSchedule {
  id: string;
  title?: string;
  domain?: string;
  targetUrl?: string;
  instruction?: string;
  enabled?: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string;
  /** Audit 2026-11-24 (item 1.6): fetched ≠ analyzed — see ScheduleRunStage. */
  lastRunStage?: ScheduleRunStage;
  lastRunSummary?: string;
  lastRunAiReport?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

async function fetchUserSchedules(
  upstreamOrigin: string,
  authHeader: string
): Promise<{ ok: boolean; status: number; schedules: StoredSchedule[] }> {
  const res = await fetchWithTimeout(
    `${upstreamOrigin}/api/v1/user/preferences`,
    { headers: { Authorization: authHeader, Accept: 'application/json' } },
    5500
  );
  if (!res.ok) {
    return { ok: false, status: res.status, schedules: [] };
  }
  const data = (await res.json().catch(() => null)) as any;
  const remote = data?.preferences?.browser_schedules;
  return {
    ok: true,
    status: 200,
    schedules: Array.isArray(remote) ? remote : [],
  };
}

function validateScheduleTargetUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !isRestrictedEdgeHost(parsed.hostname);
  } catch {
    return false;
  }
}

async function evaluateEdgeScheduleWithAi(params: {
  env?: Record<string, string | undefined>;
  upstreamOrigin: string;
  authHeader: string;
  target: StoredSchedule;
  targetUrl: string;
  statusCode: number;
  pageTitle: string;
  rawBody: string;
}): Promise<{ headline?: string; report?: string } | null> {
  const pageText = extractReadablePageSnippet(params.rawBody, 3500);
  const instruction = String(params.target.instruction || '').trim();
  if (!pageText && !instruction) return null;

  const evalPrompt = buildScheduleEvaluationPrompt({
    title: String(params.target.title || params.target.domain || 'Web Check'),
    targetUrl: params.targetUrl,
    instruction,
    pageTitle: params.pageTitle,
    statusCode: params.statusCode,
    pageText,
  });

  const parseJson = (raw: string): { headline?: string; report?: string } | null => {
    const clean = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    if (!clean) return null;
    try {
      const parsed = JSON.parse(clean) as { headline?: string; report?: string };
      return {
        headline: parsed.headline?.trim(),
        report: parsed.report?.trim(),
      };
    } catch {
      return null;
    }
  };

  const geminiKey = params.env?.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const geminiRes = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${encodeURIComponent(
          geminiKey
        )}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: evalPrompt }] }],
            generationConfig: {
              thinkingConfig: { thinkingLevel: 'LOW' },
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  headline: { type: 'STRING' },
                  report: { type: 'STRING' },
                },
                required: ['headline', 'report'],
              },
            },
          }),
        },
        6500
      );
      if (geminiRes.ok) {
        const gJson = (await geminiRes.json().catch(() => null)) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        } | null;
        const parsed = parseJson(gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '');
        if (parsed) return parsed;
      }
    } catch {
      // Fall through to upstream
    }
  }

  try {
    const text = await extractLlmCompletionText(
      params.upstreamOrigin,
      {
        Authorization: params.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      {
        model: 'supreme-spark',
        messages: [{ role: 'user', content: evalPrompt }],
      },
      7000
    );
    return parseJson(text);
  } catch {
    return null;
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const upstreamOrigin = resolveUpstreamOrigin(env);
  const authHeader = (request.headers.get('Authorization') || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearer || bearer.startsWith('tok_guest_') || bearer.startsWith('sk-supreme-guest')) {
    return jsonEdgeResponse(
      { error: 'Authenticated user session is required to manage schedules.' },
      401,
      request,
      undefined,
      env
    );
  }

  try {
    const loaded = await fetchUserSchedules(upstreamOrigin, authHeader);
    if (!loaded.ok) {
      return jsonEdgeResponse(
        { error: 'Could not verify user schedule session.' },
        loaded.status === 401 || loaded.status === 403 ? loaded.status : 502,
        request,
        undefined,
        env
      );
    }

    const schedules = [...loaded.schedules];

    if (request.method === 'GET') {
      return jsonEdgeResponse({ schedules }, 200, request, undefined, env);
    }

    const body = (await request.json().catch(() => ({}))) as Partial<StoredSchedule> & {
      action?: string;
    };
    const targetId = String(incomingUrl.searchParams.get('id') || body.id || '').trim();

    if (request.method === 'POST' && body.action === 'run' && targetId) {
      const idx = schedules.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return jsonEdgeResponse({ error: 'Schedule not found.' }, 404, request, undefined, env);
      }
      const target = schedules[idx];
      const targetUrl = String(body.targetUrl || target?.targetUrl || '').trim();
      const now = new Date().toISOString();
      let runStatus: 'ok' | 'error' = 'error';
      let runStage: ScheduleRunStage = 'failed';
      let runSummary = 'Restricted or invalid target URL';
      let runAiReport: string | undefined;

      if (targetUrl && validateScheduleTargetUrl(targetUrl)) {
        const started = Date.now();
        try {
          const probe = await safeEdgeFetch(targetUrl, { method: 'GET' }, 7000);
          const latencyMs = Date.now() - started;
          const rawBody = await probe.text().catch(() => '');
          const pageTitle = extractHtmlTitle(rawBody, String(target?.domain || 'web'));
          runStatus = probe.ok ? 'ok' : 'error';
          runStage = probe.ok ? 'fetched' : 'failed';
          // Audit 2026-11-24 (item 1.6): distinguish fetch success from analysis.
          runSummary = probe.ok
            ? `Fetched HTTP ${probe.status} · ${pageTitle} · ${latencyMs}ms (no AI evaluation yet)`
            : `Fetch failed with HTTP ${probe.status} · ${latencyMs}ms`;

          if (probe.ok) {
            const evaluated = await evaluateEdgeScheduleWithAi({
              env,
              upstreamOrigin,
              authHeader,
              target,
              targetUrl,
              statusCode: probe.status,
              pageTitle,
              rawBody,
            });
            if (evaluated?.headline) {
              runStage = 'analyzed';
              runSummary = `${evaluated.headline} (${latencyMs}ms)`;
            }
            if (evaluated?.report) {
              runAiReport = evaluated.report.slice(0, 1400);
            }
          }
        } catch (err: unknown) {
          runStatus = 'error';
          runStage = 'failed';
          runSummary = err instanceof Error ? err.message : 'Fetch failed';
        }
      }

      schedules[idx] = {
        ...target,
        lastRunAt: now,
        lastRunStatus: runStatus,
        lastRunStage: runStage,
        lastRunSummary: runSummary.slice(0, 240),
        ...(runAiReport ? { lastRunAiReport: runAiReport } : {}),
        updatedAt: now,
      };

      const saveRes = await fetchWithTimeout(
        `${upstreamOrigin}/api/v1/user/preferences`,
        {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser_schedules: schedules }),
        },
        5500
      ).catch(() => null);
      if (!saveRes?.ok) {
        return jsonEdgeResponse(
          {
            success: false,
            persisted: false,
            status: runStatus,
            summary: runSummary,
            error: 'Failed to persist schedule run results.',
          },
          saveRes?.status === 401 || saveRes?.status === 403 ? saveRes.status : 502,
          request,
          undefined,
          env
        );
      }

      return jsonEdgeResponse(
        {
          success: runStatus === 'ok',
          persisted: true,
          status: runStatus,
          summary: runSummary,
          ...(runAiReport ? { aiReport: runAiReport } : {}),
          schedule: schedules[idx],
          schedules,
        },
        200,
        request,
        undefined,
        env
      );
    }

    if (request.method === 'POST') {
      const targetUrl = String(
        body.targetUrl || (body.domain ? `https://${body.domain}` : '')
      ).trim();
      if (targetUrl && !validateScheduleTargetUrl(targetUrl)) {
        return jsonEdgeResponse(
          { error: 'Schedule target URL points to a restricted or invalid address.' },
          400,
          request,
          undefined,
          env
        );
      }
      const id = String(body.id || `sched_${Date.now()}`);
      const created: StoredSchedule = {
        ...body,
        id,
        ...(targetUrl ? { targetUrl } : {}),
        updatedAt: String(body.updatedAt || new Date().toISOString()),
      };
      const existingIdx = schedules.findIndex((s) => s.id === id);
      if (existingIdx >= 0) {
        schedules[existingIdx] = created;
      } else {
        schedules.unshift(created);
      }
    } else if (request.method === 'PATCH' && targetId) {
      const idx = schedules.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return jsonEdgeResponse({ error: 'Schedule not found.' }, 404, request, undefined, env);
      }
      if (body.targetUrl && !validateScheduleTargetUrl(String(body.targetUrl))) {
        return jsonEdgeResponse(
          { error: 'Schedule target URL points to a restricted or invalid address.' },
          400,
          request,
          undefined,
          env
        );
      }
      schedules[idx] = {
        ...schedules[idx],
        ...body,
        id: targetId,
        updatedAt: new Date().toISOString(),
      };
    } else if (request.method === 'DELETE' && targetId) {
      const idx = schedules.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return jsonEdgeResponse({ error: 'Schedule not found.' }, 404, request, undefined, env);
      }
      schedules.splice(idx, 1);
    } else {
      return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
    }

    const saveRes = await fetchWithTimeout(
      `${upstreamOrigin}/api/v1/user/preferences`,
      {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser_schedules: schedules }),
      },
      5500
    );
    if (!saveRes.ok) {
      return jsonEdgeResponse(
        { error: 'Failed to persist schedule updates.' },
        saveRes.status === 401 || saveRes.status === 403 ? saveRes.status : 502,
        request,
        undefined,
        env
      );
    }

    return jsonEdgeResponse({ success: true, schedules }, 200, request, undefined, env);
  } catch (err: unknown) {
    return jsonEdgeResponse(
      { error: err instanceof Error ? err.message : 'Schedule upstream error' },
      502,
      request,
      undefined,
      env
    );
  }
}
