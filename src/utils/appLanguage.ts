/**
 * Supported app-language codes — a leaf module (no store / i18n imports) so the
 * stores can validate a saved language without a circular import.
 *
 * বাংলা: আগে customer store "bn" ছাড়া সব কিছুকে "en" বানিয়ে ফেলত — তাই চাটগাঁইয়া /
 * সিলেটি / রাজশাহী / নোয়াখাইল্যা বাছলেই সাথে সাথে ইংরেজিতে ফিরে যেত। এখন এই তালিকার
 * যেকোনো কোড যেমন আছে তেমনই সেভ থাকে; শুধু অচেনা মান হলে fallback।
 * `src/utils/i18n.ts`-এর APP_LANGUAGE_OPTIONS-এর সাথে মিল টেস্টে যাচাই করা হয়।
 */
import type { AppLanguage } from '../types';

export const SUPPORTED_APP_LANGUAGE_CODES = [
  'en',
  'bn',
  'bn-ctg',
  'bn-syl',
  'bn-raj',
  'bn-nkh',
  'es',
  'fr',
  'ar',
  'hi',
  'zh',
  'ja',
  'de',
  'pt',
] as const;

const SUPPORTED = new Set<string>(SUPPORTED_APP_LANGUAGE_CODES);

/** Returns the saved language when it is a supported code, otherwise `fallback`. */
export function normalizeSupportedLanguage(
  raw: unknown,
  fallback: AppLanguage = 'en'
): AppLanguage {
  if (typeof raw !== 'string') return fallback;
  const code = raw.trim().toLowerCase();
  return SUPPORTED.has(code) ? (code as AppLanguage) : fallback;
}

/** Language the chat/TTS backends understand: every Bangla variant is "bn". */
export function toChatLanguage(raw: unknown): 'en' | 'bn' {
  const code = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return code === 'bn' || code.startsWith('bn-') ? 'bn' : 'en';
}

/** Value for `<html lang>` — dialect codes are not valid BCP-47, so use the base. */
export function htmlLangFor(raw: unknown): string {
  const code = normalizeSupportedLanguage(raw);
  return code.startsWith('bn-') ? 'bn' : code;
}

const DIALECT_NAMES: Record<string, string> = {
  'bn-ctg': 'Chittagonian (চাটগাঁইয়া)',
  'bn-syl': 'Sylheti (সিলেটি)',
  'bn-raj': 'Rajshahi / Varendri (রাজশাহী)',
  'bn-nkh': 'Noakhali (নোয়াখাইল্যা)',
};

/** Extra system-prompt line so replies follow the chosen regional dialect. */
export function dialectInstructionFor(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const name = DIALECT_NAMES[code];
  if (!name) return '';
  return `\n\n[LANGUAGE]\nThe user chose the ${name} regional dialect. When you reply in Bangla, write naturally in that dialect using Bengali script; keep code, commands and technical terms unchanged.`;
}
