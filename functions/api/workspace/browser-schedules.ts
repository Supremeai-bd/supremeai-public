import {
  PagesContext,
  handleCorsPreflight,
  isRestrictedEdgeHost,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  fetchWithTimeout,
  safeEdgeFetch,
} from '../../_lib/edgeHelpers';

interface StoredSchedule {
  id: string;
  title?: string;
  domain?: string;
  targetUrl?: string;
  enabled?: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string;
  lastRunSummary?: string;
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
      let runSummary = 'Restricted or invalid target URL';

      if (targetUrl && validateScheduleTargetUrl(targetUrl)) {
        const started = Date.now();
        try {
          const probe = await safeEdgeFetch(targetUrl, { method: 'GET' }, 7000);
          runStatus = probe.ok ? 'ok' : 'error';
          runSummary = `HTTP ${probe.status} · ${Date.now() - started}ms`;
        } catch (err: unknown) {
          runStatus = 'error';
          runSummary = err instanceof Error ? err.message : 'Fetch failed';
        }
      }

      schedules[idx] = {
        ...target,
        lastRunAt: now,
        lastRunStatus: runStatus,
        lastRunSummary: runSummary.slice(0, 240),
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
