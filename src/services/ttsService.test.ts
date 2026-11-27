import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ttsService, TTS_CONFIG_STORAGE_KEY } from './ttsService';
import { useCustomerStore } from '../stores/useCustomerStore';
import { chatService } from './chatService';
import { researchService } from './researchService';

function createMemoryStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('Unified Language Preference & Global ttsService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    ttsService.resetDefaults('en');
    useCustomerStore.getState().updateSettings({ language: 'en' }, true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('propagates language updates from useCustomerStore.updateSettings into global ttsService config', () => {
    const initial = ttsService.getConfig();
    expect(initial.language).toBe('en');
    expect(initial.locale).toBe('en-US');
    expect(initial.edgeVoice).toBe('en-US-AvaMultilingualNeural');

    useCustomerStore.getState().updateSettings({ language: 'bn' }, true);
    const bnCfg = ttsService.getConfig();
    expect(bnCfg.language).toBe('bn');
    expect(bnCfg.locale).toBe('bn-BD');
    expect(bnCfg.edgeVoice).toBe('bn-BD-NabanitaNeural');
    expect(bnCfg.rate).toBe(0.98);

    const savedJson = localStorage.getItem(TTS_CONFIG_STORAGE_KEY);
    expect(savedJson).toBeTruthy();
    expect(JSON.parse(savedJson!).locale).toBe('bn-BD');

    useCustomerStore.getState().updateSettings({ language: 'en' }, true);
    const backToEn = ttsService.getConfig();
    expect(backToEn.language).toBe('en');
    expect(backToEn.locale).toBe('en-US');
    expect(backToEn.edgeVoice).toBe('en-US-AvaMultilingualNeural');
  });

  it('combines language, Bangla regional accent, persona gender, and pitch inside global TTS payloads', () => {
    useCustomerStore.getState().updateSettings({ language: 'bn' }, true);
    ttsService.updateConfig({
      voicePersona: 'Charon',
      banglaAccent: 'bn-in',
      pitch: 0.85,
    });

    const cfg = ttsService.getConfig();
    expect(cfg.locale).toBe('bn-IN');
    expect(cfg.edgeVoice).toBe('bn-IN-BashkarNeural');
    expect(cfg.pitch).toBe(0.85);

    const payload = ttsService.buildSynthesizePayload('নমস্কার বন্ধু');
    expect(payload).toEqual({
      text: 'নমস্কার বন্ধু',
      voiceName: 'Charon',
      language: 'bn',
      locale: 'bn-IN',
      edgeVoice: 'bn-IN-BashkarNeural',
      pitch: 0.85,
      accent: 'bn-in',
    });

    expect(ttsService.getSamplePhrase('bn')).toContain('নমস্কার');
    expect(ttsService.getSamplePhrase('en')).toContain('global TTS voice settings');
  });

  it('speaks regional Bangla dialects with a Bangla voice instead of falling back to English', () => {
    for (const dialect of ['bn-ctg', 'bn-syl', 'bn-raj', 'bn-nkh']) {
      const cfg = ttsService.setLanguage(dialect);
      expect(cfg.language).toBe('bn');
      expect(cfg.locale).toBe('bn-BD');
      expect(ttsService.getSamplePhrase(dialect)).toContain('SupremeAI');
      expect(ttsService.getSamplePhrase(dialect)).not.toContain('Hello');
    }
    ttsService.setLanguage('en');
  });

  it('notifies subscribers when global TTS settings change and stops after unsubscribe', () => {
    const events: string[] = [];
    const unsubscribe = ttsService.subscribe((cfg) => {
      events.push(`${cfg.language}:${cfg.locale}:${cfg.pitch}`);
    });

    ttsService.setLanguage('bn');
    ttsService.setPitch(1.2);
    unsubscribe();
    ttsService.setLanguage('en');

    expect(events).toEqual(['bn:bn-BD:1', 'bn:bn-BD:1.2']);
  });

  it('influences chatService and researchService payloads according to selected preference', async () => {
    const capturedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const urlStr = String(url);
      const parsedBody =
        init?.body && typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      capturedRequests.push({ url: urlStr, body: parsedBody });

      if (urlStr.includes('/api/research/deep')) {
        const isBn = parsedBody.language === 'bn';
        return new Response(
          JSON.stringify({
            id: 'res_test',
            steps_completed: 4,
            total_sources: 3,
            report: {
              title: isBn
                ? 'ডিপ রিসার্চ বিশ্লেষণ: API Gateway'
                : 'Deep Research Analysis: API Gateway',
              summary: 'Summary',
              sections: [],
              sources: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    await chatService.streamChat({
      model: 'supreme-core',
      messages: [
        { id: '1', role: 'user', content: 'Explain distributed caching.', timestamp: Date.now() },
      ],
      language: 'bn',
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].body.language).toBe('bn');
    expect(capturedRequests[0].body.language_pref).toBe('bn');
    const bnSystemMsgs = (
      capturedRequests[0].body.messages as Array<{ role: string; content: string }>
    ).filter((m) => m.role === 'system');
    expect(bnSystemMsgs.some((m) => m.content.includes('Bengali (বাংলা script'))).toBe(true);

    await chatService.streamChat({
      model: 'supreme-core',
      messages: [
        { id: '2', role: 'user', content: 'Explain distributed caching.', timestamp: Date.now() },
      ],
      language: 'en',
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    });

    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests[1].body.language).toBe('en');
    const enSystemMsgs = (
      capturedRequests[1].body.messages as Array<{ role: string; content: string }>
    ).filter((m) => m.role === 'system');
    expect(enSystemMsgs.some((m) => m.content.includes('English by default'))).toBe(true);

    const bnReport = await researchService.execute('API Gateway', 4, 'bn');
    expect(capturedRequests[2].body.language).toBe('bn');
    expect(capturedRequests[2].body.language_pref).toBe('bn');
    expect(bnReport.report.title).toContain('ডিপ রিসার্চ');

    const enReport = await researchService.execute('API Gateway', 4, 'en');
    expect(capturedRequests[3].body.language).toBe('en');
    expect(capturedRequests[3].body.language_pref).toBe('en');
    expect(enReport.report.title).toContain('Deep Research Analysis');
  });
});
