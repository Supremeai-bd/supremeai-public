import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BANGLA_ACCENT_STORAGE_KEY,
  buildBanglaSpeechStylePrompt,
  buildClientDirectTtsUrl,
  chunkSpeechSegment,
  clampMicInputGain,
  clampVoicePitch,
  computeScaledRms,
  detectBengaliOrBanglish,
  loadBanglaAccentPreference,
  loadMicInputGainPreference,
  loadVoicePitchPreference,
  MIC_INPUT_GAIN_STORAGE_KEY,
  normalizeBanglaAccent,
  pickNativeSpeechVoice,
  resolveEdgeNeuralVoice,
  resolveSpeechUtteranceTarget,
  sanitizeSpeechText,
  saveBanglaAccentPreference,
  saveMicInputGainPreference,
  saveVoicePitchPreference,
  splitByScriptSegments,
  VOICE_PITCH_STORAGE_KEY,
  voicePitchToSsml,
} from './speechUtils';
import { TRANSLATIONS } from './i18n';
import { SUPREMEAI_MODELS, getModelColorTheme } from '../data/models';
import { LIVE_THEMES, getThemeChatTokens } from '../stores/useThemeStore';

describe('speechUtils (Unified Voice & Bilingual Speech)', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
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
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('clamps, persists, and scales RMS amplitude according to mic input gain', () => {
    expect(loadMicInputGainPreference()).toBe(1.0);
    expect(clampMicInputGain(0.05)).toBe(0.25);
    expect(clampMicInputGain(8)).toBe(3.0);
    expect(clampMicInputGain(Number.NaN)).toBe(1.0);

    saveMicInputGainPreference(2.4);
    expect(store[MIC_INPUT_GAIN_STORAGE_KEY]).toBe('2.4');
    expect(loadMicInputGainPreference()).toBe(2.4);

    const quietSamples = new Float32Array([0.02, -0.02, 0.02, -0.02]);
    const baseRms = computeScaledRms(quietSamples, 1.0);
    const boostedRms = computeScaledRms(quietSamples, 2.5);
    const attenuatedRms = computeScaledRms(quietSamples, 0.5);
    expect(boostedRms).toBeGreaterThan(baseRms);
    expect(attenuatedRms).toBeLessThan(baseRms);

    const loudSamples = new Float32Array([0.9, -0.9, 0.9, -0.9]);
    expect(computeScaledRms(loudSamples, 3.0)).toBe(1);
    expect(computeScaledRms(new Float32Array(0), 2.0)).toBe(0);
  });

  it('sanitizes markdown, code blocks, and URLs cleanly for speech', () => {
    const raw =
      'Hello **world**! Check `const x = 1;` and [docs](https://example.com/a) ```ts\nconst y=2;\n``` ধন্যবাদ।';
    expect(sanitizeSpeechText(raw)).toBe('Hello world ! Check const x = 1; and docs ধন্যবাদ।');
  });

  it('keeps inline English technical terms inside Bengali sentences on a single unified voice (no mid-sentence switching)', () => {
    const technicalBn =
      'ফেডারেশন আর্কিটেকচারে সবচেয়ে বড় ভুল হলো gateway/api যদি auth shield সামলায় তাহলে core-এ সমস্যা হবে।';
    expect(splitByScriptSegments(technicalBn)).toEqual([
      {
        text: technicalBn,
        lang: 'bn-BD',
      },
    ]);

    const mixedFramework = 'আমি React এবং TypeScript দিয়ে আপনার অ্যাপ তৈরি করেছি।';
    expect(splitByScriptSegments(mixedFramework)).toEqual([
      {
        text: mixedFramework,
        lang: 'bn-BD',
      },
    ]);

    const pureEnglish = 'Always validate JWT tokens at the API gateway edge.';
    expect(splitByScriptSegments(pureEnglish)).toEqual([
      {
        text: pureEnglish,
        lang: 'en-US',
      },
    ]);
  });

  it('builds valid direct client TTS fallback URLs for both Bengali and English', () => {
    const bnUrl = buildClientDirectTtsUrl('কেমন আছো', 'bn-BD');
    const enUrl = buildClientDirectTtsUrl('Hello world', 'en-US');
    expect(bnUrl).toContain('tl=bn');
    expect(bnUrl).toContain(encodeURIComponent('কেমন আছো'));
    expect(enUrl).toContain('tl=en');
  });

  it('chunks long speech runs cleanly under the browser synthesis limit', () => {
    const sentence = 'এটি একটি দীর্ঘ বাংলা বাক্য যা স্বয়ংক্রিয়ভাবে ছোট অংশে ভাগ হওয়া উচিত। ';
    const longText = sentence.repeat(8);
    const chunks = chunkSpeechSegment(longText, 180);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(180);
    }
  });

  it('resolves bn-BD and en-US voices respecting persona gender cues', () => {
    const mockVoices = [
      { name: 'Google US English', lang: 'en-US' },
      { name: 'Microsoft Pradeep Online (Natural) - Bengali (Bangladesh)', lang: 'bn-BD' },
      { name: 'Microsoft Nabanita Online (Natural) - Bengali (Bangladesh)', lang: 'bn-BD' },
      { name: 'Google UK English Male', lang: 'en-GB' },
    ];

    const bnFemale = pickNativeSpeechVoice(mockVoices, 'bn-BD', 'Zephyr');
    const bnMale = pickNativeSpeechVoice(mockVoices, 'bn-BD', 'Puck');
    expect(bnFemale?.name).toContain('Nabanita');
    expect(bnMale?.name).toContain('Pradeep');

    const enVoice = pickNativeSpeechVoice(mockVoices, 'en-US', 'Zephyr');
    expect(enVoice?.lang).toBe('en-US');
  });

  it('dynamically selects Web Speech language and browser voice per detected utterance language', () => {
    const mockVoices = [
      { name: 'Google US English', lang: 'en-US' },
      { name: 'Google বাংলা (ভারত)', lang: 'bn_IN' },
    ];

    const bnResult = resolveSpeechUtteranceTarget(
      'আমি বাংলায় বলছি gateway/api নিয়ে',
      'bn-BD',
      'en',
      mockVoices,
      'Zephyr'
    );
    expect(bnResult.targetScriptLang).toBe('bn-BD');
    expect(bnResult.lang).toBe('bn-IN');
    expect(bnResult.voice?.name).toContain('বাংলা');

    const banglishResult = resolveSpeechUtteranceTarget(
      'tumi kemon acho bhai',
      'en-US',
      'en',
      mockVoices,
      'Zephyr'
    );
    expect(banglishResult.targetScriptLang).toBe('bn-BD');
    expect(banglishResult.lang).toBe('bn-IN');

    const enResult = resolveSpeechUtteranceTarget(
      'TypeScript builds cleanly',
      'en-US',
      'bn',
      mockVoices,
      'Zephyr'
    );
    expect(enResult.targetScriptLang).toBe('en-US');
    expect(enResult.lang).toBe('en-US');
    expect(enResult.voice?.name).toBe('Google US English');

    const fallbackBn = resolveSpeechUtteranceTarget('হ্যালো', 'bn-BD', 'bn', [], 'Zephyr');
    expect(fallbackBn.lang).toBe('bn-BD');
    expect(fallbackBn.voice).toBeUndefined();
  });

  it('resolves Edge Neural voices accurately for Bengali and English', () => {
    expect(resolveEdgeNeuralVoice('বাংলায় কথা বলো', 'Zephyr', 'en')).toEqual({
      voice: 'bn-BD-NabanitaNeural',
      lang: 'bn-BD',
    });
    expect(resolveEdgeNeuralVoice('বাংলায় কথা বলো', 'Charon', 'bn')).toEqual({
      voice: 'bn-BD-PradeepNeural',
      lang: 'bn-BD',
    });
    expect(resolveEdgeNeuralVoice('Hello world', 'Zephyr', 'en')).toEqual({
      voice: 'en-US-AvaMultilingualNeural',
      lang: 'en-US',
    });
    expect(resolveEdgeNeuralVoice('Hello world', 'Fenrir', 'en')).toEqual({
      voice: 'en-US-AndrewMultilingualNeural',
      lang: 'en-US',
    });
  });

  it('detects Bengali script and Romanized Banglish without false-triggering English', () => {
    expect(detectBengaliOrBanglish('কেমন আছো তুমি?')).toBe(true);
    expect(detectBengaliOrBanglish('tumi kemon acho bhai')).toBe(true);
    expect(detectBengaliOrBanglish('amake banglay explain koro')).toBe(true);
    expect(detectBengaliOrBanglish('Please reply in Bangla')).toBe(true);
    expect(detectBengaliOrBanglish('Build a fast React and TypeScript API dashboard')).toBe(false);
  });

  it('clamps, persists, and converts voice pitch cleanly for SSML', () => {
    expect(loadVoicePitchPreference()).toBe(1.0);
    expect(clampVoicePitch(0.2)).toBe(0.6);
    expect(clampVoicePitch(2.4)).toBe(1.6);
    expect(clampVoicePitch(Number.NaN)).toBe(1.0);

    saveVoicePitchPreference(1.25);
    expect(store[VOICE_PITCH_STORAGE_KEY]).toBe('1.25');
    expect(loadVoicePitchPreference()).toBe(1.25);

    expect(voicePitchToSsml(1.0)).toBe('+0%');
    expect(voicePitchToSsml(1.3)).toBe('+15%');
    expect(voicePitchToSsml(0.7)).toBe('-15%');
  });

  it('persists Bangla accent defaulting to bn-BD Dhaka and routes native/Edge voices accordingly', () => {
    expect(loadBanglaAccentPreference()).toBe('bn-bd');
    expect(normalizeBanglaAccent('unknown')).toBe('bn-bd');
    expect(normalizeBanglaAccent('bn-in')).toBe('bn-in');

    saveBanglaAccentPreference('bn-in');
    expect(store[BANGLA_ACCENT_STORAGE_KEY]).toBe('bn-in');
    expect(loadBanglaAccentPreference()).toBe('bn-in');

    expect(resolveEdgeNeuralVoice('বাংলায় কথা বলো', 'Zephyr', 'bn', 'bn-bd')).toEqual({
      voice: 'bn-BD-NabanitaNeural',
      lang: 'bn-BD',
    });
    expect(resolveEdgeNeuralVoice('বাংলায় কথা বলো', 'Puck', 'bn', 'bn-bd')).toEqual({
      voice: 'bn-BD-PradeepNeural',
      lang: 'bn-BD',
    });
    expect(resolveEdgeNeuralVoice('বাংলায় কথা বলো', 'Zephyr', 'bn', 'bn-in')).toEqual({
      voice: 'bn-IN-TanishaaNeural',
      lang: 'bn-IN',
    });
    expect(resolveEdgeNeuralVoice('বাংলায় কথা বলো', 'Charon', 'bn', 'bn-in')).toEqual({
      voice: 'bn-IN-BashkarNeural',
      lang: 'bn-IN',
    });

    const mixedBnVoices = [
      { name: 'Microsoft Tanishaa Online - Bengali (India)', lang: 'bn-IN' },
      { name: 'Microsoft Nabanita Online - Bengali (Bangladesh)', lang: 'bn-BD' },
    ];
    expect(pickNativeSpeechVoice(mixedBnVoices, 'bn-BD', 'Zephyr', 'bn-bd')?.lang).toBe('bn-BD');
    expect(pickNativeSpeechVoice(mixedBnVoices, 'bn-BD', 'Zephyr', 'bn-in')?.lang).toBe('bn-IN');

    const bdPrompt = buildBanglaSpeechStylePrompt({
      pitch: 0.75,
      accent: 'bn-bd',
      hasBengali: true,
      hasLatin: true,
      language: 'bn',
    });
    expect(bdPrompt).toContain('বাংলাদেশি বাংলা');
    expect(bdPrompt).toContain('lower vocal pitch');
  });
});

describe('i18n translation parity', () => {
  it('maintains non-empty EN base translation dictionary for dynamic DB localization', () => {
    const enKeys = Object.keys(TRANSLATIONS.en).sort();
    expect(enKeys.length).toBeGreaterThan(0);

    for (const key of enKeys as Array<keyof typeof TRANSLATIONS.en>) {
      expect(TRANSLATIONS.en[key].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('SupremeAI 6-model color mapping', () => {
  it('assigns 6 distinct color themes across all 6 foundation models', () => {
    expect(SUPREMEAI_MODELS).toHaveLength(6);
    const themes = SUPREMEAI_MODELS.map((m) => getModelColorTheme(m.id));
    const uniqueThemeIds = new Set(themes.map((t) => t.id));
    const uniqueHexColors = new Set(themes.map((t) => t.hex));
    expect(uniqueThemeIds.size).toBe(6);
    expect(uniqueHexColors.size).toBe(6);
    expect(getModelColorTheme('unknown-fallback').id).toBe('cyan');
  });
});

describe('Theme-adaptive transparent chat tokens', () => {
  it('provides non-empty contrasting chat text and sheer surface tokens for all 11 themes in light and dark modes', () => {
    for (const theme of LIVE_THEMES) {
      const light = getThemeChatTokens(theme.id, 'light');
      const dark = getThemeChatTokens(theme.id, 'dark');
      expect(light.textPrimary).toMatch(/^#/);
      expect(dark.textPrimary).toMatch(/^#/);
      expect(light.userBg).toContain('rgba(');
      expect(dark.userBg).toContain('rgba(');
      expect(light.textShadow.length).toBeGreaterThan(0);
      expect(dark.textShadow.length).toBeGreaterThan(0);
    }
    // Midnight Peaks photo remains nocturnal in light mode so its text must stay bright
    expect(getThemeChatTokens('midnight-peaks', 'light').textPrimary).toBe('#f8fafc');
  });
});
