import type { AppLanguage } from '../types';
import type { LiveVoiceName } from '../hooks/useLiveVoiceSession';
import { schedulePreferencesPatch } from '../services/userPreferencesSyncBus';

export const VOICE_AVATAR_SYNC_EVENT = 'supremeai:voice-avatar-updated';

export function sanitizeSpeechText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_>~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SpeechSegment {
  text: string;
  lang: 'bn-BD' | 'en-US';
}

/**
 * Segments speech strictly at sentence/paragraph boundaries so inline English
 * technical identifiers (e.g. `gateway/api`, `auth shield`, `core`) inside a
 * Bengali sentence stay on ONE single unified voice — preventing mid-sentence
 * male/female voice ping-pong on Android & Neural TTS.
 */
export function splitByScriptSegments(text: string): SpeechSegment[] {
  const clean = text.trim();
  if (!clean) return [];

  const messageHasBengali = /[\u0980-\u09FF]/.test(clean) || detectBengaliOrBanglish(clean);
  if (!messageHasBengali) {
    return [{ text: clean, lang: 'en-US' }];
  }

  // Split only at sentence/line breaks, never mid-sentence around Latin words
  const sentences = clean
    .split(/\n+|(?<=[।.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const segments: SpeechSegment[] = [];
  for (const sentence of sentences) {
    const sentenceHasBengali =
      /[\u0980-\u09FF]/.test(sentence) || detectBengaliOrBanglish(sentence);
    const latinWordsCount = (sentence.match(/[A-Za-z]{2,}/g) || []).length;
    const isLongPureEnglishParagraph =
      !sentenceHasBengali && sentence.length >= 100 && latinWordsCount >= 12;

    const lang: 'bn-BD' | 'en-US' = isLongPureEnglishParagraph ? 'en-US' : 'bn-BD';
    const prev = segments[segments.length - 1];
    if (prev && prev.lang === lang) {
      prev.text = `${prev.text} ${sentence}`;
    } else {
      segments.push({ text: sentence, lang });
    }
  }

  return segments.length > 0 ? segments : [{ text: clean, lang: 'bn-BD' }];
}

export function chunkSpeechSegment(text: string, maxChars: number = 220): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    let splitAt = Math.max(
      slice.lastIndexOf('।'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf(', ')
    );
    if (splitAt < maxChars * 0.4) {
      splitAt = slice.lastIndexOf(' ');
    }
    if (splitAt <= 0) {
      splitAt = maxChars;
    } else {
      splitAt += 1;
    }
    const piece = remaining.slice(0, splitAt).trim();
    if (piece) chunks.push(piece);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export interface MinimalSpeechVoice {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

export type BanglaAccentId = 'bn-bd' | 'bn-in';

export const BANGLA_ACCENT_STORAGE_KEY = 'supremeai_bangla_accent_v1';
export const DEFAULT_BANGLA_ACCENT: BanglaAccentId = 'bn-bd';

export const VOICE_PITCH_STORAGE_KEY = 'supremeai_voice_pitch_v1';
export const DEFAULT_VOICE_PITCH = 1.0;
export const MIN_VOICE_PITCH = 0.6;
export const MAX_VOICE_PITCH = 1.6;

export function normalizeBanglaAccent(raw: unknown): BanglaAccentId {
  return raw === 'bn-in' ? 'bn-in' : 'bn-bd';
}

export function loadBanglaAccentPreference(): BanglaAccentId {
  try {
    const raw = localStorage.getItem(BANGLA_ACCENT_STORAGE_KEY);
    if (raw === 'bn-in' || raw === 'bn-bd') return raw;
  } catch {
    // Ignore storage issues gracefully
  }
  return DEFAULT_BANGLA_ACCENT;
}

export function buildVoiceTtsSyncSnapshotFromStorage(
  overrides: Partial<{
    language: AppLanguage;
    voicePersona: LiveVoiceName;
    pitch: number;
    banglaAccent: BanglaAccentId;
    micGain: number;
  }> = {}
): {
  language: AppLanguage;
  voicePersona: LiveVoiceName;
  pitch: number;
  banglaAccent: BanglaAccentId;
  micGain: number;
} {
  let language: AppLanguage = 'en';
  let voicePersona: LiveVoiceName = 'Zephyr';
  let pitch = loadVoicePitchPreference();
  let banglaAccent = loadBanglaAccentPreference();
  const micGain =
    typeof overrides.micGain === 'number'
      ? clampMicInputGain(overrides.micGain)
      : loadMicInputGainPreference();

  try {
    const rawSettings = localStorage.getItem('supremeai_studio_user_settings');
    if (rawSettings) {
      const parsedSettings = JSON.parse(rawSettings) as { language?: unknown };
      if (parsedSettings?.language === 'bn') language = 'bn';
    }
    const rawVoice = localStorage.getItem('supremeai_live_voice_name_v1') as LiveVoiceName | null;
    if (rawVoice && ['Zephyr', 'Puck', 'Kore', 'Charon', 'Fenrir'].includes(rawVoice)) {
      voicePersona = rawVoice;
    }
    const rawTts = localStorage.getItem('supremeai_global_tts_config_v1');
    if (rawTts) {
      const parsedTts = JSON.parse(rawTts) as {
        language?: unknown;
        voicePersona?: unknown;
        pitch?: unknown;
        banglaAccent?: unknown;
      };
      if (parsedTts?.language === 'bn') language = 'bn';
      else if (parsedTts?.language === 'en' && language !== 'bn') language = 'en';
      if (
        typeof parsedTts?.voicePersona === 'string' &&
        ['Zephyr', 'Puck', 'Kore', 'Charon', 'Fenrir'].includes(parsedTts.voicePersona)
      ) {
        voicePersona = parsedTts.voicePersona as LiveVoiceName;
      }
      if (typeof parsedTts?.pitch === 'number') {
        pitch = clampVoicePitch(parsedTts.pitch);
      }
      if (parsedTts?.banglaAccent === 'bn-bd' || parsedTts?.banglaAccent === 'bn-in') {
        banglaAccent = parsedTts.banglaAccent;
      }
    }
  } catch {
    // Ignore storage issues gracefully
  }

  return {
    language:
      overrides.language === 'bn' || overrides.language === 'en' ? overrides.language : language,
    voicePersona: overrides.voicePersona || voicePersona,
    pitch: typeof overrides.pitch === 'number' ? clampVoicePitch(overrides.pitch) : pitch,
    banglaAccent: overrides.banglaAccent
      ? normalizeBanglaAccent(overrides.banglaAccent)
      : banglaAccent,
    micGain,
  };
}

export function saveBanglaAccentPreference(
  accent: BanglaAccentId,
  syncRemote: boolean = true
): void {
  const safe = normalizeBanglaAccent(accent);
  try {
    localStorage.setItem(BANGLA_ACCENT_STORAGE_KEY, safe);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_AVATAR_SYNC_EVENT));
    }
  } catch {
    // Ignore storage issues gracefully
  }
  if (syncRemote) {
    schedulePreferencesPatch({
      voice_tts_config: buildVoiceTtsSyncSnapshotFromStorage({ banglaAccent: safe }),
    });
  }
}

export function clampVoicePitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return DEFAULT_VOICE_PITCH;
  return Math.min(MAX_VOICE_PITCH, Math.max(MIN_VOICE_PITCH, Math.round(pitch * 100) / 100));
}

export function loadVoicePitchPreference(): number {
  try {
    const raw = localStorage.getItem(VOICE_PITCH_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return clampVoicePitch(parsed);
      }
    }
  } catch {
    // Ignore storage issues gracefully
  }
  return DEFAULT_VOICE_PITCH;
}

export function saveVoicePitchPreference(pitch: number, syncRemote: boolean = true): void {
  const safe = clampVoicePitch(pitch);
  try {
    localStorage.setItem(VOICE_PITCH_STORAGE_KEY, String(safe));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_AVATAR_SYNC_EVENT));
    }
  } catch {
    // Ignore storage issues gracefully
  }
  if (syncRemote) {
    schedulePreferencesPatch({
      voice_tts_config: buildVoiceTtsSyncSnapshotFromStorage({ pitch: safe }),
    });
  }
}

/**
 * Converts client pitch multiplier (0.60 .. 1.60, default 1.00) into an SSML
 * relative pitch percentage string accepted by Edge Neural TTS (e.g. "+15%", "-15%", "+0%").
 */
export function voicePitchToSsml(pitch: number): string {
  const safe = clampVoicePitch(pitch);
  const deltaPct = Math.max(-35, Math.min(35, Math.round((safe - 1.0) * 50)));
  if (deltaPct === 0) return '+0%';
  return deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`;
}

/**
 * Builds rich vocal pitch & authentic Bangladeshi Dhaka / Kolkata Bangla
 * pronunciation directives for Gemini neural TTS & Gemini Live sessions.
 */
export function buildBanglaSpeechStylePrompt(options: {
  pitch: number;
  accent: BanglaAccentId;
  hasBengali: boolean;
  hasLatin: boolean;
  language: AppLanguage;
}): string {
  const safePitch = clampVoicePitch(options.pitch);
  const accent = normalizeBanglaAccent(options.accent);

  const pitchCue =
    safePitch <= 0.82
      ? 'Speak in a noticeably deep, warm, grounded lower vocal pitch.'
      : safePitch <= 0.94
        ? 'Speak in a rich, slightly lower vocal register.'
        : safePitch >= 1.2
          ? 'Speak in a crisp, elevated, higher vocal pitch.'
          : safePitch >= 1.06
            ? 'Speak in a bright, slightly higher vocal register.'
            : 'Speak in a balanced, natural conversational vocal pitch.';

  const accentCue =
    accent === 'bn-in'
      ? 'Use standard Kolkata West Bengal Bengali (প্রমিত বাংলা) pronunciation and melodic cadence.'
      : 'Use authentic Bangladeshi Standard Bengali (প্রমিত ঢাকা / বাংলাদেশি বাংলা) pronunciation: crisp retroflex ড়/ঢ়, natural nasal vowels, expressive Bangladeshi sentence melody, and smooth native transition on inline English technical terms without ever skipping Bengali words.';

  if (options.hasBengali && options.hasLatin) {
    return `Bilingual speaker fluent in Bengali (বাংলা) and English. ${accentCue} ${pitchCue} Pronounce every Bengali and English word clearly and audibly.`;
  }
  if (options.hasBengali || options.language === 'bn') {
    return `Warm, expressive native Bengali (বাংলা) conversational speaker. ${accentCue} ${pitchCue} Speak every word clearly with natural phrasing.`;
  }
  return `Clear, natural, expressive conversational speaker. ${pitchCue}`;
}

export function pickNativeSpeechVoice<T extends MinimalSpeechVoice>(
  voices: T[],
  targetLang: 'bn-BD' | 'en-US',
  preferredPersona?: LiveVoiceName,
  banglaAccent: BanglaAccentId = DEFAULT_BANGLA_ACCENT
): T | undefined {
  if (!voices || voices.length === 0) return undefined;
  const preferMale =
    preferredPersona === 'Puck' || preferredPersona === 'Charon' || preferredPersona === 'Fenrir';

  if (targetLang === 'bn-BD') {
    const bnVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('bn'));
    if (bnVoices.length === 0) return undefined;

    const genderRegex = preferMale
      ? /(pradeep|tanmoy|bashkar|male|man)/i
      : /(nabanita|tanishaa|female|woman)/i;
    const primaryPrefix = banglaAccent === 'bn-in' ? 'bn-in' : 'bn-bd';
    const secondaryPrefix = banglaAccent === 'bn-in' ? 'bn-bd' : 'bn-in';
    return (
      bnVoices.find(
        (v) =>
          v.lang.toLowerCase().replace(/_/g, '-').startsWith(primaryPrefix) &&
          genderRegex.test(v.name)
      ) ||
      bnVoices.find((v) => v.lang.toLowerCase().replace(/_/g, '-').startsWith(primaryPrefix)) ||
      bnVoices.find(
        (v) =>
          v.lang.toLowerCase().replace(/_/g, '-').startsWith(secondaryPrefix) &&
          genderRegex.test(v.name)
      ) ||
      bnVoices.find((v) => v.lang.toLowerCase().replace(/_/g, '-').startsWith(secondaryPrefix)) ||
      bnVoices[0]
    );
  }

  const enVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (enVoices.length === 0) return undefined;
  const genderRegex = preferMale
    ? /(andrew|guy|david|mark|daniel|ryan|chris|male)/i
    : /(ava|aria|jenny|samantha|zira|emma|female)/i;

  return (
    enVoices.find((v) => v.lang.toLowerCase().startsWith('en-us') && genderRegex.test(v.name)) ||
    enVoices.find((v) => v.lang.toLowerCase().startsWith('en-us')) ||
    enVoices.find((v) => genderRegex.test(v.name)) ||
    enVoices[0]
  );
}

const INTERNATIONAL_EDGE_VOICES: Record<string, { male: string; female: string; lang: string }> = {
  es: { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural', lang: 'es-ES' },
  fr: { male: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural', lang: 'fr-FR' },
  ar: { male: 'ar-SA-HamedNeural', female: 'ar-SA-ZariyahNeural', lang: 'ar-SA' },
  hi: { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural', lang: 'hi-IN' },
  zh: { male: 'zh-CN-YunxiNeural', female: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN' },
  ja: { male: 'ja-JP-KeitaNeural', female: 'ja-JP-NanamiNeural', lang: 'ja-JP' },
  de: { male: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural', lang: 'de-DE' },
  pt: { male: 'pt-BR-AntonioNeural', female: 'pt-BR-FranciscaNeural', lang: 'pt-BR' },
};

export function resolveEdgeNeuralVoice(
  text: string,
  preferredPersona: LiveVoiceName,
  language: AppLanguage,
  banglaAccent: BanglaAccentId = DEFAULT_BANGLA_ACCENT
): { voice: string; lang: string } {
  const hasBengaliScript = /[\u0980-\u09FF]/.test(text);
  const isBanglaFamily = language === 'bn' || language.startsWith('bn-');
  const preferMale =
    preferredPersona === 'Puck' || preferredPersona === 'Charon' || preferredPersona === 'Fenrir';
  const accent = normalizeBanglaAccent(banglaAccent);

  // Respect explicit international language selection first unless text actually contains Bengali script
  const intlVoice = INTERNATIONAL_EDGE_VOICES[language];
  if (intlVoice && !hasBengaliScript) {
    return {
      voice: preferMale ? intlVoice.male : intlVoice.female,
      lang: intlVoice.lang,
    };
  }

  if (hasBengaliScript || (isBanglaFamily && !/[A-Za-z]{2,}/.test(text)) || (isBanglaFamily && detectBengaliOrBanglish(text))) {
    if (accent === 'bn-in' && language === 'bn') {
      return {
        voice: preferMale ? 'bn-IN-BashkarNeural' : 'bn-IN-TanishaaNeural',
        lang: 'bn-IN',
      };
    }
    return {
      voice: preferMale ? 'bn-BD-PradeepNeural' : 'bn-BD-NabanitaNeural',
      lang: 'bn-BD',
    };
  }

  return {
    voice: preferMale ? 'en-US-AndrewMultilingualNeural' : 'en-US-AvaMultilingualNeural',
    lang: 'en-US',
  };
}

export function buildClientDirectTtsUrl(text: string, lang: 'bn-BD' | 'bn-IN' | 'en-US'): string {
  const tl = lang === 'bn-BD' || lang === 'bn-IN' ? 'bn' : 'en';
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(text)}`;
}

export interface TtsAudioChunk {
  audioBase64: string;
  mimeType: string;
  lang: 'bn-BD' | 'bn-IN' | 'en-US';
}

export const MIC_INPUT_GAIN_STORAGE_KEY = 'supremeai_mic_input_gain_v1';
export const DEFAULT_MIC_INPUT_GAIN = 1.0;
export const MIN_MIC_INPUT_GAIN = 0.25;
export const MAX_MIC_INPUT_GAIN = 3.0;

export function clampMicInputGain(gain: number): number {
  if (!Number.isFinite(gain)) return DEFAULT_MIC_INPUT_GAIN;
  return Math.min(MAX_MIC_INPUT_GAIN, Math.max(MIN_MIC_INPUT_GAIN, Math.round(gain * 100) / 100));
}

export function loadMicInputGainPreference(): number {
  try {
    const raw = localStorage.getItem(MIC_INPUT_GAIN_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return clampMicInputGain(parsed);
      }
    }
  } catch {
    // Ignore storage issues gracefully
  }
  return DEFAULT_MIC_INPUT_GAIN;
}

export function saveMicInputGainPreference(gain: number, syncRemote: boolean = true): void {
  const safe = clampMicInputGain(gain);
  try {
    localStorage.setItem(MIC_INPUT_GAIN_STORAGE_KEY, String(safe));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_AVATAR_SYNC_EVENT));
    }
  } catch {
    // Ignore storage issues gracefully
  }
  if (syncRemote) {
    schedulePreferencesPatch({
      voice_tts_config: buildVoiceTtsSyncSnapshotFromStorage({ micGain: safe }),
    });
  }
}

export function computeScaledRms(samples: Float32Array, inputGain: number = 1.0): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  const safeGain = clampMicInputGain(inputGain);
  return Math.min(1, Math.sqrt(sum / samples.length) * 4.2 * safeGain);
}

const BANGLISH_MARKER_REGEX =
  /\b(kemon|kmn|acho|aso|accho|tumi|apni|tui|amake|tomake|apnake|kothay|kivabe|kibhabe|bhalo|valo|dhonnobad|nomoshkar|korbo|korte|korchi|koro|parbo|parchi|parce|parbe|hocche|hobe|hoye|geche|amader|tomader|apnar|tomar|bolen|bolun|bolte|bolchi|likho|lekho|shuno|janau|jano|lagbe|parina|janina|bujhi|bujhte|achha|accha|khobor|obostha|bangla|bengali|banglate|banglay|banglai)\b/i;

const EXPLICIT_BENGALI_REQUEST_REGEX =
  /\b(in\s+bangla|in\s+bengali|reply\s+in\s+bangla|respond\s+in\s+bangla|speak\s+bangla|speak\s+bengali)\b/i;

export function detectBengaliOrBanglish(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (/[\u0980-\u09FF]/.test(clean)) return true;
  if (EXPLICIT_BENGALI_REQUEST_REGEX.test(clean)) return true;
  return BANGLISH_MARKER_REGEX.test(clean);
}

function normalizeVoiceLocale(locale: string): string {
  return locale.trim().replace(/_/g, '-');
}

export function resolveSpeechUtteranceTarget<T extends MinimalSpeechVoice>(
  text: string,
  segmentLangHint: 'bn-BD' | 'en-US' | undefined,
  defaultLanguage: AppLanguage,
  voices: T[],
  preferredPersona?: LiveVoiceName,
  banglaAccent: BanglaAccentId = DEFAULT_BANGLA_ACCENT
): { lang: string; targetScriptLang: 'bn-BD' | 'en-US'; voice: T | undefined } {
  const hasBengaliScript = /[\u0980-\u09FF]/.test(text);
  const isBanglishOrBn = hasBengaliScript || detectBengaliOrBanglish(text);
  const targetScriptLang: 'bn-BD' | 'en-US' =
    isBanglishOrBn || segmentLangHint === 'bn-BD'
      ? 'bn-BD'
      : defaultLanguage === 'bn' && !/[a-zA-Z]{2,}/.test(text)
        ? 'bn-BD'
        : 'en-US';

  const voice = pickNativeSpeechVoice(voices, targetScriptLang, preferredPersona, banglaAccent);
  let lang: string =
    targetScriptLang === 'bn-BD'
      ? normalizeBanglaAccent(banglaAccent) === 'bn-in'
        ? 'bn-IN'
        : 'bn-BD'
      : 'en-US';

  if (voice?.lang) {
    const normalized = normalizeVoiceLocale(voice.lang);
    if (targetScriptLang === 'bn-BD' && normalized.toLowerCase().startsWith('bn')) {
      lang = normalized;
    } else if (targetScriptLang === 'en-US' && normalized.toLowerCase().startsWith('en')) {
      lang = normalized.toLowerCase().startsWith('en-us') ? 'en-US' : normalized;
    }
  }

  return { lang, targetScriptLang, voice };
}
