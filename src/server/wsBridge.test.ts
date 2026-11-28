import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachWebSocketBridges, isAllowedWsOrigin, resolveWsClientIp } from './wsBridge';

// বাংলা মন্তব্য: WebSocket প্রক্সি IP নির্ণয়, Origin যাচাই এবং প্রোডাকশন tok_guest_* বাইপাস প্রতিরোধের টেস্ট
async function withWsServer(
  ctx: Parameters<typeof attachWebSocketBridges>[1],
  fn: (port: number) => Promise<void>
): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  attachWebSocketBridges(server, ctx);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function expectUpgradeRejected(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode || 0);
    });
    ws.once('open', () => {
      ws.close();
      reject(new Error('Expected WebSocket upgrade to be rejected, but connection opened.'));
    });
    ws.once('error', () => {
      // Handled by unexpected-response
    });
  });
}

describe('WebSocket bridge security hardening (wsBridge)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('extracts proxy-aware client IP and validates WebSocket Origin headers', () => {
    const fakeReq = {
      headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' },
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    } as unknown as http.IncomingMessage;

    expect(resolveWsClientIp(fakeReq)).toBe('203.0.113.42');
    expect(isAllowedWsOrigin('https://3000-sandbox.e2b.app', '3000-sandbox.e2b.app', true)).toBe(true);
    expect(isAllowedWsOrigin('https://tauri.localhost', '127.0.0.1:3000', true)).toBe(true);
    expect(isAllowedWsOrigin('https://evil-attacker.example', 'supremeai.studio', true)).toBe(false);
  });

  it('blocks cross-site Origins, WAF-blocked X-Forwarded-For IPs, and production tok_guest_* tokens, while allowing authenticated /ws clients', async () => {
    delete process.env.ALLOW_PUBLIC_LIVE_VOICE;

    await withWsServer(
      {
        isProduction: true,
        blockedIps: [{ ip: '198.51.100.77' }],
        platformConfig: { maintenanceMode: false },
        verifyBearerIdentity: async (token) =>
          token === 'valid-prod-token' ? { email: 'admin@supremeai.bd', isAdmin: true } : null,
      },
      async (port) => {
        // 1. Cross-site Origin is rejected with 403
        const crossOriginStatus = await expectUpgradeRejected(
          `ws://127.0.0.1:${port}/api/live?token=valid-prod-token`,
          { Origin: 'https://evil-attacker.example' }
        );
        expect(crossOriginStatus).toBe(403);

        // 2. Blocked client IP behind proxy (X-Forwarded-For) is rejected with 403
        const blockedIpStatus = await expectUpgradeRejected(
          `ws://127.0.0.1:${port}/api/live?token=valid-prod-token`,
          { 'X-Forwarded-For': '198.51.100.77' }
        );
        expect(blockedIpStatus).toBe(403);

        // 3. Synthetic tok_guest_* token is rejected with 401 in production
        const guestBypassStatus = await expectUpgradeRejected(
          `ws://127.0.0.1:${port}/api/live?token=tok_guest_spoofed`
        );
        expect(guestBypassStatus).toBe(401);

        // 4. Valid authenticated token connects to /ws broadcaster and receives pong
        const messages: Array<Record<string, unknown>> = [];
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=valid-prod-token`);
          ws.on('message', (raw) => {
            const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
            messages.push(parsed);
            if (parsed.type === 'connection_ack') {
              ws.send(JSON.stringify({ type: 'ping' }));
            } else if (parsed.type === 'pong') {
              ws.close();
              resolve();
            }
          });
          ws.on('error', reject);
        });
        expect(messages.some((m) => m.type === 'connection_ack')).toBe(true);
        expect(messages.some((m) => m.type === 'pong')).toBe(true);
      }
    );
  });
});
