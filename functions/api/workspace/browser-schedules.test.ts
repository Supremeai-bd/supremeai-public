// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './browser-schedules';

describe('manual browser schedule run', () => {
  it.each([
    { writeStatus: 204, responseStatus: 200, persisted: true },
    { writeStatus: 403, responseStatus: 403, persisted: false },
    { writeStatus: 503, responseStatus: 502, persisted: false },
    { writeStatus: null, responseStatus: 502, persisted: false },
  ])(
    'reports whether the probe result was saved ($writeStatus)',
    async ({ writeStatus, responseStatus, persisted }) => {
      using fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://example.com/probe') return new Response(null, { status: 200 });
        if (url !== 'https://backend.example.test/api/v1/user/preferences')
          throw new Error(`Unexpected URL: ${url}`);
        if (init?.method === 'POST') {
          if (writeStatus === null) throw new DOMException('Request timed out', 'TimeoutError');
          return new Response(null, { status: writeStatus });
        }
        return Response.json({
          preferences: {
            browser_schedules: [{ id: 'schedule-1', targetUrl: 'https://example.com/probe' }],
          },
        });
      });
      const response = await onRequest({
        env: { SUPREMEAI_BACKEND_URL: 'https://backend.example.test' },
        request: new Request('https://example.test/api/workspace/browser-schedules', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-user-session' },
          body: JSON.stringify({ action: 'run', id: 'schedule-1' }),
        }),
      });
      expect(response.status).toBe(responseStatus);
      const result = await response.json();
      expect(result).toMatchObject({ success: persisted, persisted, status: 'ok' });
      if (persisted) expect(result.schedule.lastRunStatus).toBe('ok');
      else expect(result).not.toHaveProperty('schedule');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    }
  );
});
