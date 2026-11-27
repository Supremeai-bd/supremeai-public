/**
 * Single source of truth for the Language & Voice settings.
 *
 * বাংলা: মূল ভাষার ড্রপডাউনে বাংলা একবারই থাকে। বাংলা বাছলে সাব-ড্রপডাউনে আঞ্চলিক
 * ভাষা ও উচ্চারণ আসে — প্রমিত (বাংলাদেশ/কলকাতা), চাটগাঁইয়া, সিলেটি, রাজশাহী,
 * নোয়াখাইল্যা। আগের আলাদা "বাংলা উচ্চারণ" সেটিং এখানেই মিশে গেছে।
 */

import type { AppLanguage } from '../types';
import type { TranslationKeys } from '../locales/en';
import { APP_LANGUAGE_OPTIONS } from '../utils/i18n';
import type { BanglaAccentId } from '../utils/speechUtils';
import type { LiveVoiceName } from '../hooks/useLiveVoiceSession';
import type { OptionSelectItem } from '../components/ui/OptionSelect';

export const BANGLA_DIALECT_LANGUAGES = ['bn-ctg', 'bn-syl', 'bn-raj', 'bn-nkh'] as const;

export type BanglaVariantId = 'bn-bd' | 'bn-in' | (typeof BANGLA_DIALECT_LANGUAGES)[number];

export interface BanglaVariant {
  id: BanglaVariantId;
  /** UI / chat language this variant selects. */
  language: AppLanguage;
  /** Text-to-speech accent this variant selects. */
  accent: BanglaAccentId;
  nativeLabel: string;
  englishLabel: string;
}

export const BANGLA_VARIANTS: ReadonlyArray<BanglaVariant> = [
  {
    id: 'bn-bd',
    language: 'bn',
    accent: 'bn-bd',
    nativeLabel: 'প্রমিত বাংলা (বাংলাদেশ)',
    englishLabel: 'Standard — Bangladesh',
  },
  {
    id: 'bn-in',
    language: 'bn',
    accent: 'bn-in',
    nativeLabel: 'প্রমিত বাংলা (কলকাতা)',
    englishLabel: 'Standard — Kolkata',
  },
  {
    id: 'bn-ctg',
    language: 'bn-ctg',
    accent: 'bn-bd',
    nativeLabel: 'চাটগাঁইয়া',
    englishLabel: 'Chittagonian',
  },
  {
    id: 'bn-syl',
    language: 'bn-syl',
    accent: 'bn-bd',
    nativeLabel: 'সিলেটি',
    englishLabel: 'Sylheti',
  },
  {
    id: 'bn-raj',
    language: 'bn-raj',
    accent: 'bn-bd',
    nativeLabel: 'রাজশাহী (বরেন্দ্রী)',
    englishLabel: 'Rajshahi (Varendri)',
  },
  {
    id: 'bn-nkh',
    language: 'bn-nkh',
    accent: 'bn-bd',
    nativeLabel: 'নোয়াখাইল্যা',
    englishLabel: 'Noakhali',
  },
];

export function isBanglaLanguage(language: string | null | undefined): boolean {
  const code = String(language || '').toLowerCase();
  return code === 'bn' || code.startsWith('bn-');
}

/** The entry shown in the main language dropdown ("bn" for every Bangla variant). */
export function primaryLanguageOf(language: AppLanguage): AppLanguage {
  return isBanglaLanguage(language) ? 'bn' : language;
}

/** Which Bangla variant the current language + accent pair represents. */
export function banglaVariantOf(language: AppLanguage, accent: BanglaAccentId): BanglaVariantId {
  const dialect = BANGLA_VARIANTS.find((v) => v.language === language && v.language !== 'bn');
  if (dialect) return dialect.id;
  return accent === 'bn-in' ? 'bn-in' : 'bn-bd';
}

export function applyBanglaVariant(id: BanglaVariantId): {
  language: AppLanguage;
  accent: BanglaAccentId;
} {
  const variant = BANGLA_VARIANTS.find((v) => v.id === id) ?? BANGLA_VARIANTS[0];
  return { language: variant.language, accent: variant.accent };
}

/** Main dropdown: one entry per language, Bangla dialects folded into "বাংলা". */
export function primaryLanguageOptions(): OptionSelectItem<AppLanguage>[] {
  return APP_LANGUAGE_OPTIONS.filter(
    (opt) => !(BANGLA_DIALECT_LANGUAGES as readonly string[]).includes(String(opt.id))
  ).map((opt) => ({
    value: opt.id,
    label: opt.nativeLabel,
    description: opt.id === 'bn' ? 'Bangla (Bengali)' : opt.label,
    badge: opt.badge,
  }));
}

export function banglaVariantOptions(): OptionSelectItem<BanglaVariantId>[] {
  return BANGLA_VARIANTS.map((v) => ({
    value: v.id,
    label: v.nativeLabel,
    description: v.englishLabel,
  }));
}

/** Voices are named by how they sound; the persona name is secondary. */
export const VOICE_TONE_KEYS: Record<LiveVoiceName, TranslationKeys> = {
  Zephyr: 'voiceToneZephyr',
  Puck: 'voiceTonePuck',
  Kore: 'voiceToneKore',
  Charon: 'voiceToneCharon',
  Fenrir: 'voiceToneFenrir',
};

export function voiceOptions(
  t: Record<TranslationKeys, string>
): OptionSelectItem<LiveVoiceName>[] {
  return (Object.keys(VOICE_TONE_KEYS) as LiveVoiceName[]).map((id) => ({
    value: id,
    label: t[VOICE_TONE_KEYS[id]],
    description: id,
  }));
}
