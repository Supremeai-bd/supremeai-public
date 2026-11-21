// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './chat';

describe('chat request validation', () => {
  it('preserves valid multimodal content and supplies the default role and model', async () => {
    using fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ choices: [{ message: { content: 'A reply' } }] }));
    const content = [{ type: 'text', text: 'Hello' }];
    const response = await onRequest({
      env: { SUPREMEAI_BACKEND_URL: 'https://backend.example.test' },
      request: new Request('https://example.test/api/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-user-session' },
        body: JSON.stringify({ messages: [{ content }], systemInstruction: ' Be brief. ' }),
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: 'A reply', model: 'supreme-spark' });
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content },
      ],
    });
  });

  it.each([
    '{',
    'null',
    '[]',
    '{}',
    '{"messages":[]}',
    '{"messages":[null]}',
    '{"messages":[{"content":[null]}]}',
    '{"messages":[{"content":"hello","role":123}]}',
    '{"messages":[{"content":"hello"}],"systemInstruction":42}',
    '{"messages":[{"content":"hello"}],"groundingContext":{}}',
  ])('returns 400 before calling the gateway for %s', async (body) => {
    using fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await onRequest({
      request: new Request('https://example.test/api/chat', { method: 'POST', body }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
