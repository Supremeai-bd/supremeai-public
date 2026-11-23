/**
 * বাংলা মন্তব্য: ফিচার ফ্ল্যাগের সবচেয়ে বড় মিথ্যা ছিল — অ্যাডমিন প্যানেল বলত
 * "... has been ENABLED server-wide", কিন্তু ২৫টি ফ্ল্যাগের মধ্যে মাত্র **একটি**
 * (`enable_multimodal_vision`) আসলে কোনো UI ফিচার গেট করত।
 *
 * এই ফাইলটাই এখন সত্যের একমাত্র উৎস: কোন ফ্ল্যাগ কোথায় পড়া হয়। কোনো ফ্ল্যাগ এখানে
 * না থাকলে অ্যাডমিন প্যানেল স্পষ্ট করে বলবে "এটি এখনো কোনো UI ফিচার গেট করে না"।
 *
 * ⚠️ নিয়ম: নতুন ফ্ল্যাগ-চেক যোগ করলে এখানে এন্ট্রিও যোগ করতে হবে, নাহলে ব্যাজ মিথ্যা বলবে।
 */

export interface FlagConsumer {
  /** যে ফ্ল্যাগের কথা */
  key: string;
  /** যে ফাইল(গুলো) এটি পড়ে */
  files: string[];
  /** ব্যবহারকারীর দৃষ্টিতে কী বদলায় */
  effect: string;
}

export const FEATURE_FLAG_CONSUMERS: readonly FlagConsumer[] = [
  {
    key: 'enable_multimodal_vision',
    files: ['src/components/ChatInput.tsx:142'],
    effect: 'চ্যাট ইনপুটে ইমেজ/ভিশন সংযুক্তি দেখানো বা লুকানো।',
  },
] as const;

/** বাংলা মন্তব্য: একটি ফ্ল্যাগ কতগুলো UI জায়গায় প্রভাব ফেলে */
export function countFlagConsumers(key: string): number {
  return FEATURE_FLAG_CONSUMERS.filter((c) => c.key === key).length;
}

/** বাংলা মন্তব্য: ব্যাজ/টুলটিপে দেখানোর জন্য মানুষের পড়ার মতো সারাংশ */
export function describeFlagConsumers(key: string): string {
  const found = FEATURE_FLAG_CONSUMERS.filter((c) => c.key === key);
  if (found.length === 0) {
    return 'এই ফ্ল্যাগটি সংরক্ষিত হয়, কিন্তু এখনো কোনো UI ফিচার এটি পড়ে না।';
  }
  return found.map((c) => `${c.effect} (${c.files.join(', ')})`).join(' · ');
}

/** বাংলা মন্তব্য: কতগুলো ফ্ল্যাগ সত্যিই কিছু নিয়ন্ত্রণ করে — ড্যাশবোর্ডে দেখানোর জন্য */
export function wiredFlagKeys(): string[] {
  return [...new Set(FEATURE_FLAG_CONSUMERS.map((c) => c.key))];
}
