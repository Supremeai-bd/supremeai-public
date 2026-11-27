import type { AppLanguage } from '../types';
import type { LiveVoiceName } from '../hooks/useLiveVoiceSession';
import {
  loadVoicePreference,
  saveVoicePreference,
  VOICE_AVATAR_SYNC_EVENT,
} from '../utils/hologramAvatar';
import {
  type BanglaAccentId,
  clampVoicePitch,
  DEFAULT_BANGLA_ACCENT,
  DEFAULT_VOICE_PITCH,
  loadBanglaAccentPreference,
  loadMicInputGainPreference,
  loadVoicePitchPreference,
  normalizeBanglaAccent,
  resolveEdgeNeuralVoice,
  saveBanglaAccentPreference,
  saveVoicePitchPreference,
} from '../utils/speechUtils';
import { schedulePreferencesPatch } from './userPreferencesSyncBus';
import { TTS_INTL_VOICES, normalizeTtsLanguage, sampleTtsPhrase } from '../shared/ttsLanguages';

export type TtsLocale = 'en-US' | 'bn-BD' | 'bn-IN' | (string & {});

export const TTS_CONFIG_STORAGE_KEY = 'supremeai_global_tts_config_v1';
export const TTS_CONFIG_SYNC_EVENT = 'supremeai:tts-config-updated';
const SETTINGS_STORAGE_KEY = 'supremeai_studio_user_settings';

export interface TtsServiceConfig {
  language: AppLanguage;
  locale: TtsLocale;
  voicePersona: LiveVoiceName;
  pitch: number;
  rate: number;
  banglaAccent: BanglaAccentId;
  edgeVoice: string;
  bengaliEdgeVoice: string;
  englishEdgeVoice: string;
  updatedAt: number;
}

export interface TtsSynthesizePayload {
  text: string;
  voiceName: LiveVoiceName;
  language: AppLanguage;
  locale: TtsLocale;
  edgeVoice: string;
  pitch: number;
  accent: BanglaAccentId;
}

type TtsConfigListener = (config: TtsServiceConfig) => void;

const VALID_VOICES: LiveVoiceName[] = ['Zephyr', 'Puck', 'Kore', 'Charon', 'Fenrir'];

// বাংলা মন্তব্য: TTS-এ শুধু বাংলা ও ইংরেজি ভয়েস আছে। আঞ্চলিক বাংলা (bn-ctg, bn-syl …)
// আগে 'en'-এ পড়ে ইংরেজি ভয়েসে কথা বলত — এখন বাংলা ভয়েসেই বলবে।
// hi/es/fr/ar/zh/ja/de/pt-ও এখন নিজের ভয়েসে বলে (আগে সব 'en'-এ নেমে যেত)।
function normalizeAppLanguage(raw: unknown): AppLanguage {
  return normalizeTtsLanguage(raw);
}

function normalizeVoicePersona(raw: unknown): LiveVoiceName {
  return typeof raw === 'string' && VALID_VOICES.includes(raw as LiveVoiceName)
    ? (raw as LiveVoiceName)
    : 'Zephyr';
}

function readStoredSettingsLanguage(): AppLanguage {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { language?: unknown };
      // বাংলা মন্তব্য: আঞ্চলিক বাংলা (bn-ctg …) সেভ থাকলে TTS-এ সেটাও বাংলা।
      if (parsed && typeof parsed.language === 'string' && parsed.language) {
        return normalizeAppLanguage(parsed.language);
      }
    }
  } catch {
    // Ignore storage issues gracefully
  }
  return 'en';
}

export function resolveLocaleForLanguage(
  language: AppLanguage,
  banglaAccent: BanglaAccentId = DEFAULT_BANGLA_ACCENT
): TtsLocale {
  if (language === 'bn') {
    return normalizeBanglaAccent(banglaAccent) === 'bn-in' ? 'bn-IN' : 'bn-BD';
  }
  const intl = TTS_INTL_VOICES[normalizeTtsLanguage(language)];
  return intl ? intl.lang : 'en-US';
}

function buildResolvedConfig(params: {
  language: AppLanguage;
  voicePersona: LiveVoiceName;
  pitch: number;
  banglaAccent: BanglaAccentId;
  updatedAt?: number;
}): TtsServiceConfig {
  const language = normalizeAppLanguage(params.language);
  const voicePersona = normalizeVoicePersona(params.voicePersona);
  const pitch = clampVoicePitch(params.pitch);
  const banglaAccent = normalizeBanglaAccent(params.banglaAccent);
  const locale = resolveLocaleForLanguage(language, banglaAccent);

  const bengaliResolved = resolveEdgeNeuralVoice('বাংলা', voicePersona, 'bn', banglaAccent);
  const englishResolved = resolveEdgeNeuralVoice('Hello', voicePersona, 'en', banglaAccent);
  const edgeVoice = language === 'bn' ? bengaliResolved.voice : englishResolved.voice;

  return {
    language,
    locale,
    voicePersona,
    pitch,
    rate: language === 'bn' ? 0.98 : 1.02,
    banglaAccent,
    edgeVoice,
    bengaliEdgeVoice: bengaliResolved.voice,
    englishEdgeVoice: englishResolved.voice,
    updatedAt: params.updatedAt ?? Date.now(),
  };
}

function loadInitialConfig(): TtsServiceConfig {
  let storedLanguage = readStoredSettingsLanguage();
  let storedVoice = loadVoicePreference();
  let storedPitch = loadVoicePitchPreference();
  let storedAccent = loadBanglaAccentPreference();

  try {
    const raw = localStorage.getItem(TTS_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TtsServiceConfig>;
      // User account settings language takes precedence when present
      // (Same outcome as before for bn/en — the account setting wins — now for every language.)
      if (typeof parsed.language === 'string' && parsed.language) {
        storedLanguage = readStoredSettingsLanguage();
      }
      if (parsed.voicePersona) {
        storedVoice = normalizeVoicePersona(parsed.voicePersona);
      }
      if (typeof parsed.pitch === 'number') {
        storedPitch = clampVoicePitch(parsed.pitch);
      }
      if (parsed.banglaAccent) {
        storedAccent = normalizeBanglaAccent(parsed.banglaAccent);
      }
    }
  } catch {
    // Ignore malformed JSON gracefully
  }

  return buildResolvedConfig({
    language: storedLanguage,
    voicePersona: storedVoice,
    pitch: storedPitch,
    banglaAccent: storedAccent,
  });
}

class GlobalTtsService {
  private config: TtsServiceConfig = loadInitialConfig();
  private listeners = new Set<TtsConfigListener>();

  getConfig(): TtsServiceConfig {
    return this.config;
  }

  private persistAndNotify(next: TtsServiceConfig, emitEvents: boolean = true): TtsServiceConfig {
    this.config = next;
    try {
      localStorage.setItem(TTS_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota issues gracefully
    }

    if (emitEvents && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent(TTS_CONFIG_SYNC_EVENT, { detail: next }));
        window.dispatchEvent(new CustomEvent(VOICE_AVATAR_SYNC_EVENT));
      } catch {
        // Ignore non-browser environments
      }
    }

    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // Isolate subscriber errors
      }
    }
    return next;
  }

  updateConfig(
    partial: Partial<{
      language: AppLanguage;
      voicePersona: LiveVoiceName;
      pitch: number;
      banglaAccent: BanglaAccentId;
    }>,
    options?: { syncRemote?: boolean }
  ): TtsServiceConfig {
    const nextLanguage =
      partial.language !== undefined
        ? normalizeAppLanguage(partial.language)
        : this.config.language;
    const nextVoice =
      partial.voicePersona !== undefined
        ? normalizeVoicePersona(partial.voicePersona)
        : this.config.voicePersona;
    const nextPitch =
      partial.pitch !== undefined ? clampVoicePitch(partial.pitch) : this.config.pitch;
    const nextAccent =
      partial.banglaAccent !== undefined
        ? normalizeBanglaAccent(partial.banglaAccent)
        : this.config.banglaAccent;

    // Keep underlying modular preference keys synchronized cleanly
    if (partial.voicePersona !== undefined && nextVoice !== this.config.voicePersona) {
      saveVoicePreference(nextVoice, false);
    }
    if (partial.pitch !== undefined && nextPitch !== this.config.pitch) {
      saveVoicePitchPreference(nextPitch, false);
    }
    if (partial.banglaAccent !== undefined && nextAccent !== this.config.banglaAccent) {
      saveBanglaAccentPreference(nextAccent, false);
    }

    const next = buildResolvedConfig({
      language: nextLanguage,
      voicePersona: nextVoice,
      pitch: nextPitch,
      banglaAccent: nextAccent,
    });

    const persisted = this.persistAndNotify(next, true);
    if (options?.syncRemote !== false) {
      schedulePreferencesPatch({
        voice_tts_config: {
          language: persisted.language,
          voicePersona: persisted.voicePersona,
          pitch: persisted.pitch,
          banglaAccent: persisted.banglaAccent,
          micGain: loadMicInputGainPreference(),
        },
      });
    }
    return persisted;
  }

  setLanguage(language: AppLanguage, options?: { syncRemote?: boolean }): TtsServiceConfig {
    return this.updateConfig({ language }, options);
  }

  setVoicePersona(
    voicePersona: LiveVoiceName,
    options?: { syncRemote?: boolean }
  ): TtsServiceConfig {
    return this.updateConfig({ voicePersona }, options);
  }

  setPitch(pitch: number, options?: { syncRemote?: boolean }): TtsServiceConfig {
    return this.updateConfig({ pitch }, options);
  }

  setBanglaAccent(
    banglaAccent: BanglaAccentId,
    options?: { syncRemote?: boolean }
  ): TtsServiceConfig {
    return this.updateConfig({ banglaAccent }, options);
  }

  syncFromStorage(): TtsServiceConfig {
    const next = buildResolvedConfig({
      language: readStoredSettingsLanguage(),
      voicePersona: loadVoicePreference(),
      pitch: loadVoicePitchPreference(),
      banglaAccent: loadBanglaAccentPreference(),
    });
    return this.persistAndNotify(next, false);
  }

  resetDefaults(language?: AppLanguage, options?: { syncRemote?: boolean }): TtsServiceConfig {
    const next = buildResolvedConfig({
      language: language ?? this.config.language,
      voicePersona: 'Zephyr',
      pitch: DEFAULT_VOICE_PITCH,
      banglaAccent: DEFAULT_BANGLA_ACCENT,
    });
    saveVoicePreference('Zephyr', false);
    saveVoicePitchPreference(DEFAULT_VOICE_PITCH, false);
    saveBanglaAccentPreference(DEFAULT_BANGLA_ACCENT, false);
    const persisted = this.persistAndNotify(next, true);
    if (options?.syncRemote !== false) {
      schedulePreferencesPatch({
        voice_tts_config: {
          language: persisted.language,
          voicePersona: persisted.voicePersona,
          pitch: persisted.pitch,
          banglaAccent: persisted.banglaAccent,
          micGain: loadMicInputGainPreference(),
        },
      });
    }
    return persisted;
  }

  subscribe(listener: TtsConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  resolveVoiceForText(text: string): {
    voice: string;
    lang: TtsLocale;
    pitch: number;
    rate: number;
    accent: BanglaAccentId;
    persona: LiveVoiceName;
    language: AppLanguage;
  } {
    const cfg = this.config;
    const resolved = resolveEdgeNeuralVoice(text, cfg.voicePersona, cfg.language, cfg.banglaAccent);
    return {
      voice: resolved.voice,
      lang: resolved.lang,
      pitch: cfg.pitch,
      rate: resolved.lang === 'en-US' ? 1.02 : 0.98,
      accent: cfg.banglaAccent,
      persona: cfg.voicePersona,
      language: cfg.language,
    };
  }

  buildSynthesizePayload(text: string): TtsSynthesizePayload {
    const resolved = this.resolveVoiceForText(text);
    return {
      text: text.slice(0, 1800),
      voiceName: resolved.persona,
      language: resolved.language,
      locale: resolved.lang,
      edgeVoice: resolved.voice,
      pitch: resolved.pitch,
      accent: resolved.accent,
    };
  }

  /** Preview sentence in the exact app language — dialect codes (bn-ctg …) get dialect text. */
  getSamplePhrase(language?: AppLanguage): string {
    return sampleTtsPhrase(language ?? this.config.language, this.config.banglaAccent);
  }
}

export const ttsService = new GlobalTtsService();
