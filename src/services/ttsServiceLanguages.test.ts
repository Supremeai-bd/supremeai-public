import { afterEach, describe, expect, it } from 'vitest';
import { ttsService } from './ttsService';

describe('ttsService — selected language reaches the voice', () => {
  afterEach(() => {
    ttsService.setLanguage('en', { syncRemote: false });
  });

  it('Hindi selection resolves a hi-IN locale and Hindi neural voice (was en-US)', () => {
    const cfg = ttsService.setLanguage('hi', { syncRemote: false });
    expect(cfg.language).toBe('hi');
    expect(cfg.locale).toBe('hi-IN');
    const payload = ttsService.buildSynthesizePayload(ttsService.getSamplePhrase('hi'));
    expect(payload.language).toBe('hi');
    expect(payload.locale).toBe('hi-IN');
    expect(payload.edgeVoice).toMatch(/^hi-IN-/);
  });

  it('a Bangla dialect speaks with the Bangla voice and a dialect sample sentence', () => {
    const cfg = ttsService.setLanguage('bn-ctg', { syncRemote: false });
    expect(cfg.language).toBe('bn');
    expect(cfg.locale).toMatch(/^bn-/);
    const sample = ttsService.getSamplePhrase('bn-ctg');
    expect(sample).toContain('চাটগাঁইয়া');
    expect(ttsService.buildSynthesizePayload(sample).edgeVoice).toMatch(/^bn-/);
  });
});
