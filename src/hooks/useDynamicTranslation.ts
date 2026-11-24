/**
 * Zero-Bundle Dynamic JIT Translation hook (Master Blueprint §3, Trojan Horse).
 *
 * বাংলা মন্তব্য: ফ্রন্টএন্ডে কোনো ভারী ভাষা-বান্ডল শিপ হয় না — কোডে শুধু
 * Canonical English Keys থাকে। ইউজার অন্য ভাষা বেছে নিলে এই হুক:
 *
 *  1. লোকাল ক্যাশ (in-memory Map + localStorage) দেখে — থাকলে ০ms-এ দেখায়;
 *  2. মিস হলে ব্যাকগ্রাউন্ডে ব্যাকএন্ডের BhashaBot সেমান্টিক-ক্যাশ এন্ডপয়েন্ট
 *     (``POST /api/v1/localization/ai-translate``) হিট করে;
 *  3. অনুবাদ এলে পারমানেন্ট ক্যাশে জমায় — পরের সব ইউজার সেটা ফ্রি-ফরএভার পায়;
 *  4. ব্যর্থতায় সৎ fallback: ক্যানোনিক্যাল ইংরেজি কী-ই দেখায়, বানায় না।
 *
 * Write-Once, Free-Forever: একবার অনুবাদ হলে আর কখনো দরকার নেই।
 */

import { useCallback, useState } from 'react';
import { DEFAULT_GATEWAY_URL } from '../bridge/desktopBridge';
import { useAppPreferencesStore } from '../stores/useAppPreferencesStore';
import type { AppLanguage } from '../types';

const CACHE_PREFIX = 'supremeai.jit.translations.v1';

type CacheMap = Record<string, string>;

/** প্রতি-ভাষা in-memory ক্যাশ — প্রথম রিকোয়েস্টের পরে localStorage-ও নেই। */
const memoryCache = new Map<string, CacheMap>();
/** একই কী-তে ডুপ্লিকেট নেটওয়ার্ক কল ঠেকাতে in-flight ডিডাপ। */
const inFlight = new Map<string, Promise<string>>();

function storageKey(lang: string): string {
  return `${CACHE_PREFIX}.${lang}`;
}

function loadCache(lang: string): CacheMap {
  const mem = memoryCache.get(lang);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(storageKey(lang));
    const parsed = raw ? (JSON.parse(raw) as CacheMap) : {};
    if (parsed && typeof parsed === 'object') {
      memoryCache.set(lang, parsed);
      return parsed;
    }
  } catch {
    // Corrupt cache — honest empty start, never a crash.
  }
  const empty: CacheMap = {};
  memoryCache.set(lang, empty);
  return empty;
}

function saveCache(lang: string, map: CacheMap): void {
  try {
    localStorage.setItem(storageKey(lang), JSON.stringify(map));
  } catch {
    // Quota/private-mode — memory cache still works this session.
  }
}

export function getCachedTranslation(lang: string, key: string): string | null {
  if (lang === 'en') return key;
  const cache = loadCache(lang);
  return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
}

function gatewayBase(): string {
  const fromEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPREMEAI_GATEWAY_URL
      : undefined;
  return (fromEnv || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
}

/**
 * One canonical English key → translated string (cached, deduped, honest).
 * Fallback is always the key itself — English first, never fabricated text.
 */
export async function requestTranslation(
  lang: string,
  key: string,
  context = 'ui',
): Promise<string> {
  if (lang === 'en') return key;
  const flightKey = `${lang}::${key}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const token =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('supremeai_access_token')
          : null;
      const res = await fetch(`${gatewayBase()}/api/v1/localization/ai-translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ key, target_lang: lang, source_lang: 'en', context }),
      });
      if (!res.ok) return key;
      const data = (await res.json()) as { translation?: string };
      const translated = (data.translation || '').trim();
      if (!translated || translated === key) return key;
      const cache = loadCache(lang);
      cache[key] = translated;
      saveCache(lang, cache);
      return translated;
    } catch {
      return key; // Offline-resilient: canonical English stays on screen.
    } finally {
      inFlight.delete(flightKey);
    }
  })();

  inFlight.set(flightKey, promise);
  return promise;
}

export interface DynamicTranslation {
  lang: AppLanguage;
  /** ক্যানোনিক্যাল ইংরেজি কী → প্রদর্শনযোগ্য অনুবাদ (মিস হলে কী-ই ফেরত)। */
  tr: (key: string) => string;
  /** true হলে কোনো নেটওয়ার্ক লুকআপই হবে না (canonical English mode)। */
  isCanonical: boolean;
}

export function useDynamicTranslation(): DynamicTranslation {
  const lang = useAppPreferencesStore((s) => s.language || 'en');
  const [, setTick] = useState(0);

  const tr = useCallback(
    (key: string): string => {
      if (lang === 'en') return key;
      const cached = getCachedTranslation(lang, key);
      if (cached) return cached;
      // মিস → ব্যাকগ্রাউন্ড অনুবাদ; এলে re-render করে সত্যিকারের টেক্সট দেখাও।
      void requestTranslation(lang, key).then((translated) => {
        if (translated !== key) setTick((t) => t + 1);
      });
      return key;
    },
    [lang],
  );

  return { lang, tr, isCanonical: lang === 'en' };
}
