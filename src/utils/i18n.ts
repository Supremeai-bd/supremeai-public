import { useEffect, useState } from 'react';
import { AppLanguage } from '../types';
import { useAppPreferencesStore } from '../stores/useAppPreferencesStore';
import { EN_DICT } from '../locales/en';
import type { TranslationKeys } from '../locales/en';

export type { TranslationKeys };
export { EN_DICT } from '../locales/en';

export const APP_LANGUAGE_OPTIONS: Array<{
  id: AppLanguage;
  label: string;
  nativeLabel: string;
  description: string;
  badge: string;
}> = [
  {
    id: 'en',
    label: 'English',
    nativeLabel: 'English',
    description: 'Interface and AI chat/voice replies default to English.',
    badge: 'EN',
  },
  {
    id: 'bn',
    label: 'Bangla (Bengali)',
    nativeLabel: 'বাংলা',
    description: 'ইন্টারফেস এবং AI চ্যাট ও ভয়েস উত্তর বাংলায় থাকবে।',
    badge: 'বাং',
  },
  {
    id: 'bn-ctg',
    label: 'Chittagonian (Chatgaiya)',
    nativeLabel: 'চাটগাঁইয়া',
    description: 'চট্টগ্রামের আঞ্চলিক ভাষায় ইন্টারফেস ও AI উত্তর।',
    badge: 'CTG',
  },
  {
    id: 'bn-syl',
    label: 'Sylheti',
    nativeLabel: 'সিলেটি',
    description: 'সিলেটের আঞ্চলিক ভাষায় ইন্টারফেস ও AI উত্তর।',
    badge: 'SYL',
  },
  {
    id: 'bn-raj',
    label: 'Rajshahi (Varendri)',
    nativeLabel: 'রাজশাহী',
    description: 'রাজশাহীর আঞ্চলিক ভাষায় ইন্টারফেস ও AI উত্তর।',
    badge: 'RAJ',
  },
  {
    id: 'bn-nkh',
    label: 'Noakhali (Noakhailla)',
    nativeLabel: 'নোয়াখাইল্যা',
    description: 'নোয়াখালীর আঞ্চলিক ভাষায় ইন্টারফেস ও AI উত্তর।',
    badge: 'NKH',
  },
  {
    id: 'es',
    label: 'Spanish',
    nativeLabel: 'Español',
    description: 'Interfaz y respuestas de IA en español.',
    badge: 'ES',
  },
  {
    id: 'fr',
    label: 'French',
    nativeLabel: 'Français',
    description: 'Interface et réponses IA en français.',
    badge: 'FR',
  },
  {
    id: 'ar',
    label: 'Arabic',
    nativeLabel: 'العربية',
    description: 'الواجهة وردود الذكاء الاصطناعي باللغة العربية.',
    badge: 'AR',
  },
  {
    id: 'hi',
    label: 'Hindi',
    nativeLabel: 'हिन्दी',
    description: 'इंटरफ़ेस और AI उत्तर हिन्दी में।',
    badge: 'HI',
  },
  {
    id: 'zh',
    label: 'Chinese (Simplified)',
    nativeLabel: '简体中文',
    description: '界面和 AI 回复使用简体中文。',
    badge: 'ZH',
  },
  {
    id: 'ja',
    label: 'Japanese',
    nativeLabel: '日本語',
    description: 'インターフェースとAIの応答を日本語にします。',
    badge: 'JA',
  },
  {
    id: 'de',
    label: 'German',
    nativeLabel: 'Deutsch',
    description: 'Oberfläche und KI-Antworten auf Deutsch.',
    badge: 'DE',
  },
  {
    id: 'pt',
    label: 'Portuguese',
    nativeLabel: 'Português',
    description: 'Interface e respostas de IA em português.',
    badge: 'PT',
  },
];

// বাংলা মন্তব্য: ফ্রন্টএন্ড বান্ডিলে শুধু EN_DICT থাকে; অন্য যেকোনো ভাষা DB/Auto-Translate থেকে লোড হয়।
const DYNAMIC_TRANSLATIONS: Record<string, Record<TranslationKeys, string>> = {
  en: EN_DICT,
};

const listeners = new Set<() => void>();
const inflightLoads = new Map<string, Promise<void>>();

function readCachedDict(lang: string): Record<TranslationKeys, string> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`supremeai_i18n_cache_${lang}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed && typeof parsed === 'object') {
      return { ...EN_DICT, ...parsed };
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export async function loadLanguageDictionary(lang: string): Promise<void> {
  const code = (lang || 'en').trim().toLowerCase();
  if (code === 'en' || DYNAMIC_TRANSLATIONS[code]) return;

  const localCached = readCachedDict(code);
  if (localCached) {
    DYNAMIC_TRANSLATIONS[code] = localCached;
    listeners.forEach((cb) => cb());
    return;
  }

  if (inflightLoads.has(code)) {
    return inflightLoads.get(code);
  }

  const job = (async () => {
    try {
      const res = await fetch(`/api/i18n/${encodeURIComponent(code)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { translations?: Record<string, string> };
      if (data?.translations && typeof data.translations === 'object') {
        const merged = { ...EN_DICT, ...data.translations };
        DYNAMIC_TRANSLATIONS[code] = merged;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`supremeai_i18n_cache_${code}`, JSON.stringify(merged));
          }
        } catch {
          // ignore storage quota errors
        }
        listeners.forEach((cb) => cb());
      }
    } catch {
      // Fallback to EN_DICT silently on network error
    } finally {
      inflightLoads.delete(code);
    }
  })();

  inflightLoads.set(code, job);
  return job;
}

export const TRANSLATIONS: Record<string, Record<TranslationKeys, string>> = DYNAMIC_TRANSLATIONS;

export function getTranslation(lang?: AppLanguage): Record<TranslationKeys, string> {
  const code = (lang || 'en').trim().toLowerCase();
  if (code === 'en') return EN_DICT;
  if (DYNAMIC_TRANSLATIONS[code]) return DYNAMIC_TRANSLATIONS[code];
  const cached = readCachedDict(code);
  if (cached) {
    DYNAMIC_TRANSLATIONS[code] = cached;
    return cached;
  }
  return EN_DICT;
}

export function useI18n() {
  const language = useAppPreferencesStore((s) => s.language || 'en');
  const setLanguage = useAppPreferencesStore((s) => s.setLanguage);
  const [, setTick] = useState(0);

  useEffect(() => {
    const onUpdate = () => setTick((n) => n + 1);
    listeners.add(onUpdate);
    if (language && language !== 'en') {
      void loadLanguageDictionary(language);
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, [language]);

  return {
    lang: language,
    setLanguage,
    t: getTranslation(language),
  };
}
