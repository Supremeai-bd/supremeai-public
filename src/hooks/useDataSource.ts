import { useEffect, useMemo, useState } from 'react';
import { env } from '../config/env';
import type { DataSourceKind } from '../components/common/DataSourceBadge';

/**
 * বাংলা মন্তব্য: প্রশ্নটা "ডেটা লাইভ কি না" — তার উত্তর তিনটে আলাদা সত্যের সংমিশ্রণ,
 * তাই একটামাত্র boolean দিয়ে বলা যায় না:
 *
 *   ১. মক মোড চালু?        → সব ডেটা ডেমো (env.isMockEnabled)
 *   ২. অনুরোধ সফল হয়েছে?  → না হলে degraded/unknown
 *   ৩. ডেটা পুরনো?         → live হলেও stale হতে পারে
 *
 * আগে ভিউগুলো নিঃশব্দে ফলব্যাক ডেটা দেখাত। এখন প্রতিটি ভিউ বলতে বাধ্য —
 * `reason` বাধ্যতামূলক, তাই "DEMO" লেখা থাকলে কেন, সেটাও জানা যায়।
 */
export interface DataSourceState {
  source: DataSourceKind;
  /** ব্যবহারকারীকে দেখানোর মতো ব্যাখ্যা — সবসময় খালি নয় */
  reason: string;
  ageMs?: number;
  isMock: boolean;
}

export interface UseDataSourceOptions {
  /** সেই ভিউয়ের ডেটা অনুরোধ সফল হয়েছে কি না (false = ব্যর্থ) */
  loaded: boolean;
  /** শেষ সফল লোড কবে (epoch ms) */
  lastUpdatedMs?: number;
  /** ব্যর্থ হলে দেখানোর মেসেজ */
  error?: string | null;
  /** মক মোডে ভিউ-নির্দিষ্ট ব্যাখ্যা */
  demoReason?: string;
  /** এর বেশি পুরনো হলে degraded ধরা হবে (ডিফল্ট ৫ মিনিট) */
  staleAfterMs?: number;
}

const DEFAULT_STALE_MS = 5 * 60 * 1000;

export function useDataSource(options: UseDataSourceOptions): DataSourceState {
  const {
    loaded,
    lastUpdatedMs,
    error,
    demoReason,
    staleAfterMs = DEFAULT_STALE_MS,
  } = options;

  // বাংলা মন্তব্য: বয়স দেখাতে ঘড়ি দরকার। ৩০ সেকেন্ডে একবার আপডেট — প্রতি রেন্ডারে নয়,
  // নাহলে ব্যাজ নিজেই পারফরম্যান্স সমস্যা হয়ে দাঁড়াবে।
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastUpdatedMs) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [lastUpdatedMs]);

  return useMemo<DataSourceState>(() => {
    const isMock = env.isMockEnabled;

    if (isMock) {
      return {
        source: 'demo',
        isMock,
        reason:
          demoReason ??
          'মক মোড চালু (VITE_USE_MOCK বা রানটাইম override) — সার্ভার API কল হয়নি, src/data/* এর নমুনা দেখানো হচ্ছে।',
      };
    }

    if (error) {
      return {
        source: 'degraded',
        isMock,
        reason: `লাইভ API ব্যর্থ: ${error}`,
      };
    }

    if (!loaded) {
      return {
        source: 'unknown',
        isMock,
        reason: 'ডেটা এখনো লোড হয়নি।',
      };
    }

    if (lastUpdatedMs) {
      const ageMs = Math.max(0, now - lastUpdatedMs);
      if (ageMs > staleAfterMs) {
        return {
          source: 'degraded',
          isMock,
          ageMs,
          reason: `ডেটা ${Math.round(ageMs / 60000)} মিনিট পুরনো — রিফ্রেশ দরকার।`,
        };
      }
      return {
        source: 'live',
        isMock,
        ageMs,
        reason: 'লাইভ সার্ভার API থেকে প্রাপ্ত।',
      };
    }

    return {
      source: 'live',
      isMock,
      reason: 'লাইভ সার্ভার API থেকে প্রাপ্ত (টাইমস্ট্যাম্প নেই)।',
    };
  }, [loaded, lastUpdatedMs, error, demoReason, staleAfterMs, now]);
}

export default useDataSource;
