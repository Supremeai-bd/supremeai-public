// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildGeminiPartsFromMessage,
  buildOpenAiVisionMessages,
  collectGroundingSourcesAndUsage,
  countImagesInMessages,
  extractSdkErrorMetadata,
  messageHasActualImage,
  messageHasVisionOrAttachment,
  resolveServerAutoModel,
  type IncomingChatMessage,
} from './geminiVision';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TEXT_B64 = Buffer.from('hello from a file').toString('base64');

describe('geminiVision helpers', () => {
  it('detects images across content parts, attachments and inline parts', () => {
    expect(messageHasActualImage(null)).toBe(false);
    expect(
      messageHasActualImage({ attachments: [{ data: PNG, mimeType: 'image/png', name: 'a.png' }] })
    ).toBe(true);
    expect(
      messageHasActualImage({
        content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }],
      })
    ).toBe(true);
    expect(messageHasActualImage({ parts: [{ inlineData: { data: PNG } }] })).toBe(true);
    expect(messageHasActualImage({ attachment: { data: TEXT_B64, mimeType: 'text/plain' } })).toBe(
      false
    );
    expect(
      messageHasVisionOrAttachment({ attachment: { data: TEXT_B64, mimeType: 'text/plain' } })
    ).toBe(true);
  });

  it('builds Gemini parts with de-duplicated inline data and decoded text files', () => {
    const msg: IncomingChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
      ],
      attachments: [
        { data: PNG, mimeType: 'image/png', name: 'dup.png' },
        { data: TEXT_B64, mimeType: 'text/plain', name: 'notes.txt' },
        null,
      ],
    };
    const parts = buildGeminiPartsFromMessage(msg);
    expect(parts[0]).toEqual({ text: 'What is this?' });
    expect(parts.filter((p) => p.inlineData)).toHaveLength(1);
    expect(parts.some((p) => p.text?.includes('[ATTACHED FILE: notes.txt]'))).toBe(true);
    expect(buildGeminiPartsFromMessage(undefined)).toEqual([{ text: '' }]);
  });

  it('counts each distinct image once per message', () => {
    expect(
      countImagesInMessages([
        {
          attachments: [
            { data: PNG, mimeType: 'image/png' },
            { data: PNG, mimeType: 'image/png' },
          ],
        },
        { parts: [{ inlineData: { data: PNG, mimeType: 'image/png' } }] },
        null,
      ])
    ).toBe(2);
  });

  it('maps messages to OpenAI vision format', () => {
    const out = buildOpenAiVisionMessages(
      [
        { role: 'user', content: 'Describe', attachment: { data: PNG, mimeType: 'image/png' } },
        { role: 'assistant', content: 'Sure' },
        { role: 'tool', content: 'ignored' },
      ],
      'SYS'
    );
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(out[1].role).toBe('user');
    expect(Array.isArray(out[1].content) && out[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG}` },
    });
    expect(out[2]).toEqual({ role: 'assistant', content: 'Sure' });
    expect(out).toHaveLength(3);
  });

  it('collects grounding sources and token usage from a stream chunk', () => {
    const sources = new Map<string, { title: string; uri: string }>();
    const usage = collectGroundingSourcesAndUsage(
      {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://example.com/a', title: '' } },
                { web: { uri: 'javascript:alert(1)' } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
      },
      sources,
      null
    );
    expect([...sources.values()]).toEqual([{ title: 'example.com', uri: 'https://example.com/a' }]);
    expect(usage).toEqual({ promptTokens: 3, candidateTokens: 4, totalTokens: 7 });
    expect(collectGroundingSourcesAndUsage(null, sources, usage)).toBe(usage);
  });

  it('reads status and retry-after from SDK, fetch-style and plain errors', () => {
    const withHeaders = Object.assign(new Error('rate limited'), {
      status: 429,
      response: { headers: new Headers({ 'retry-after': '12' }) },
    });
    expect(extractSdkErrorMetadata(withHeaders)).toEqual({
      status: 429,
      retryAfterHeader: '12',
      message: 'rate limited',
    });
    expect(
      extractSdkErrorMetadata({ response: { status: 503, headers: { 'retry-after': '5' } } })
    ).toMatchObject({ status: 503, retryAfterHeader: '5' });
    expect(extractSdkErrorMetadata('boom')).toEqual({
      status: undefined,
      retryAfterHeader: null,
      message: 'boom',
    });
  });

  it('routes vision prompts to the core model in auto mode', () => {
    expect(
      resolveServerAutoModel('auto', [
        { role: 'user', content: 'hi', attachments: [{ data: PNG, mimeType: 'image/png' }] },
      ])
    ).toBe('supreme-core');
    expect(resolveServerAutoModel('auto', [{ role: 'user', content: 'hi' }])).toBe('supreme-spark');
  });
});
