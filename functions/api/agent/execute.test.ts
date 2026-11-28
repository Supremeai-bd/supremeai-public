import { describe, expect, it } from 'vitest';
import { onRequest } from './execute';

// বাংলা মন্তব্য: ক্লাউডফ্লেয়ার এজ রানটাইমে /api/agent/execute-এর অথেন্টিকেশন ও ALLOWED_ORIGINS যাচাইয়ের টেস্ট
describe('Cloudflare Edge /api/agent/execute security guard', () => {
  it('enforces ALLOWED_ORIGINS on CORS preflight', async () => {
    const req = new Request('https://supremeai-studio.pages.dev/api/agent/execute', {
      method: 'OPTIONS',
      headers: { Origin: 'https://custom-preview.example.com' },
    });
    const res = await onRequest({
      request: req,
      env: { ALLOWED_ORIGINS: 'https://custom-preview.example.com' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://custom-preview.example.com'
    );
  });

  it('rejects unauthenticated agent execution requests with 401', async () => {
    const req = new Request('https://supremeai-studio.pages.dev/api/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Inspect files' }),
    });
    const res = await onRequest({ request: req, env: { GEMINI_API_KEY: 'demo-key' } });
    expect(res.status).toBe(401);
  });

  it('allows authenticated sessions and falls back cleanly when GEMINI_API_KEY is unset', async () => {
    const req = new Request('https://supremeai-studio.pages.dev/api/agent/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-user-session',
      },
      body: JSON.stringify({ prompt: 'Create a simple React counter' }),
    });
    const res = await onRequest({ request: req, env: {} });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; reason?: string };
    expect(json.status).toBe('fallback_chat');
    expect(json.reason).toBe('no_gemini_key');
  });
});
