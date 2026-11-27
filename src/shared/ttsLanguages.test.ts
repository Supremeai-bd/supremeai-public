import { describe, expect, it } from 'vitest';
import {
  googleTlForLocale,
  isIntlTtsLanguage,
  normalizeTtsLanguage,
  sampleTtsPhrase,
} from './ttsLanguages';
import {
  buildClientDirectTtsUrl,
  resolveEdgeNeuralVoice,
  resolveSpeechUtteranceTarget,
} from '../utils/speechUtils';

describe('ttsLanguages — Voice Preview language/dialect', () => {
  it('keeps Hindi and other voiced languages instead of collapsing them to English', () => {
    expect(normalizeTtsLanguage('hi')).toBe('hi');
    expect(normalizeTtsLanguage('es')).toBe('es');
    expect(normalizeTtsLanguage('pt-BR')).toBe('pt');
    expect(normalizeTtsLanguage('bn-ctg')).toBe('bn');
    expect(normalizeTtsLanguage('bn-syl')).toBe('bn');
    expect(normalizeTtsLanguage('xx')).toBe('en');
    expect(isIntlTtsLanguage('hi')).toBe(true);
    expect(isIntlTtsLanguage('bn-raj')).toBe(false);
  });

  it('writes the preview sentence in the selected language and dialect', () => {
    expect(sampleTtsPhrase('hi')).toMatch(/[\u0900-\u097F]/);
    const standard = sampleTtsPhrase('bn');
    for (const dialect of ['bn-ctg', 'bn-syl', 'bn-raj', 'bn-nkh']) {
      const phrase = sampleTtsPhrase(dialect);
      expect(phrase).toMatch(/[\u0980-\u09FF]/);
      expect(phrase).not.toBe(standard);
    }
    expect(sampleTtsPhrase('bn-ctg')).toContain('আঁই');
    expect(sampleTtsPhrase('bn-syl')).toContain('আফনার');
    expect(sampleTtsPhrase('bn', 'bn-in')).toContain('নমস্কার');
    expect(sampleTtsPhrase('ja')).toMatch(/[\u3040-\u30FF]/);
    expect(sampleTtsPhrase('unknown')).toMatch(/^Hello!/);
  });

  it('maps locales to Google fallback codes', () => {
    expect(googleTlForLocale('hi-IN')).toBe('hi');
    expect(googleTlForLocale('bn-IN')).toBe('bn');
    expect(googleTlForLocale('zh-CN')).toBe('zh-CN');
    expect(googleTlForLocale('en-US')).toBe('en');
    expect(buildClientDirectTtsUrl('नमस्ते', 'hi-IN')).toContain('tl=hi');
  });

  it('picks the Hindi neural voice and native hi-IN browser voice', () => {
    const hiText = sampleTtsPhrase('hi');
    expect(resolveEdgeNeuralVoice(hiText, 'Zephyr', 'hi')).toEqual({
      voice: 'hi-IN-SwaraNeural',
      lang: 'hi-IN',
    });
    const voices = [
      { name: 'Google US English', lang: 'en-US' },
      { name: 'Google हिन्दी', lang: 'hi-IN' },
    ];
    const target = resolveSpeechUtteranceTarget(hiText, undefined, 'hi', voices, 'Zephyr');
    expect(target.lang).toBe('hi-IN');
    expect(target.voice?.lang).toBe('hi-IN');
    // No Hindi voice installed → still tags the utterance hi-IN (never en-US)
    const none = resolveSpeechUtteranceTarget(hiText, undefined, 'hi', [voices[0]], 'Zephyr');
    expect(none.voice).toBeUndefined();
    expect(none.lang).toBe('hi-IN');
  });
});
