/**
 * বাংলা মন্তব্য: "Boost my limit" → প্রতিটা প্রোভাইডারের সরাসরি API-কী তৈরির পেজ + Tips Card-এর ধাপ।
 *
 * প্রোভাইডার তালিকা ব্যাকএন্ড (pool.py) থেকেও আসতে পারে, যেখানে পুরনো হোমপেজ লিংক থাকতে পারে।
 * তাই লিংক আর ধাপ এখানে id ধরে রাখা — UI সবসময় এটাই আগে নেয়, তারপর manifest-এর লিংক।
 * হোমপেজ নয়, যে পেজে গিয়ে সরাসরি কী বানানো যায় সেটাই দিতে হবে।
 */

export interface ProviderKeyGuide {
  /** Direct link to the page where the key is created (never the marketing homepage). */
  keyPageUrl: string;
  /** What the user does on that page, in order. */
  steps: { bn: string; en: string }[];
  /** What a correct key starts with — shown so the user knows they copied the right thing. */
  keyPrefix?: string;
}

export const PROVIDER_KEY_GUIDES: Record<string, ProviderKeyGuide> = {
  kilo: {
    keyPageUrl: 'https://app.kilo.ai/profile',
    keyPrefix: 'eyJ…',
    steps: [
      { bn: 'Google (Gmail) দিয়ে সাইন ইন করুন', en: 'Sign in with Google (Gmail)' },
      {
        bn: 'Profile পেজে নিচে "API Key" অংশে যান',
        en: 'On the Profile page, scroll to the "API Key" section',
      },
      { bn: 'কপি বাটনে চাপ দিয়ে কী কপি করুন', en: 'Press the copy button next to the key' },
      { bn: 'এখানে ফিরে এসে উপরের বক্সে পেস্ট করুন', en: 'Come back and paste it in the box above' },
    ],
  },
  gemini: {
    keyPageUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIzaSy…',
    steps: [
      { bn: 'Gmail দিয়ে সাইন ইন করুন', en: 'Sign in with your Gmail' },
      { bn: '"Create API key" চাপুন', en: 'Press "Create API key"' },
      {
        bn: 'প্রজেক্ট চাইলে যেকোনোটা বা নতুন একটা বেছে নিন',
        en: 'If it asks for a project, pick any or create a new one',
      },
      { bn: 'কী কপি করে এখানে পেস্ট করুন', en: 'Copy the key and paste it here' },
    ],
  },
  groq: {
    keyPageUrl: 'https://console.groq.com/keys',
    keyPrefix: 'gsk_…',
    steps: [
      { bn: 'Google দিয়ে সাইন ইন করুন', en: 'Sign in with Google' },
      {
        bn: '"Create API Key" চাপুন, যেকোনো নাম দিন',
        en: 'Press "Create API Key" and give it any name',
      },
      {
        bn: 'কী একবারই দেখায় — তখনই কপি করুন',
        en: 'The key is shown only once — copy it right away',
      },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
  cerebras: {
    keyPageUrl: 'https://cloud.cerebras.ai/',
    keyPrefix: 'csk-…',
    steps: [
      { bn: 'Google দিয়ে সাইন ইন করুন', en: 'Sign in with Google' },
      { bn: 'বাঁ পাশের মেনু থেকে "API Keys" খুলুন', en: 'Open "API Keys" in the left menu' },
      { bn: '"Generate API Key" চাপুন', en: 'Press "Generate API Key"' },
      { bn: 'কী কপি করে এখানে পেস্ট করুন', en: 'Copy the key and paste it here' },
    ],
  },
  sambanova: {
    keyPageUrl: 'https://cloud.sambanova.ai/apis',
    steps: [
      { bn: 'Google দিয়ে সাইন ইন করুন', en: 'Sign in with Google' },
      { bn: '"Generate New API Key" চাপুন', en: 'Press "Generate New API Key"' },
      {
        bn: 'কী একবারই দেখায় — তখনই কপি করুন',
        en: 'The key is shown only once — copy it right away',
      },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
  openrouter: {
    keyPageUrl: 'https://openrouter.ai/settings/keys',
    keyPrefix: 'sk-or-v1-…',
    steps: [
      { bn: 'Google দিয়ে সাইন ইন করুন', en: 'Sign in with Google' },
      {
        bn: '"Create API Key" চাপুন, যেকোনো নাম দিন',
        en: 'Press "Create API Key" and give it any name',
      },
      {
        bn: 'Credit limit ফাঁকা রাখুন, "Create" চাপুন',
        en: 'Leave the credit limit empty and press "Create"',
      },
      { bn: 'কী কপি করে এখানে পেস্ট করুন', en: 'Copy the key and paste it here' },
    ],
  },
  github: {
    keyPageUrl: 'https://github.com/settings/personal-access-tokens/new',
    keyPrefix: 'github_pat_…',
    steps: [
      { bn: 'GitHub-এ সাইন ইন করুন', en: 'Sign in to GitHub' },
      { bn: 'যেকোনো নাম দিন, মেয়াদ বেছে নিন', en: 'Give it any name and pick an expiry' },
      {
        bn: 'Permissions → "Models" → Read-only দিন',
        en: 'Under Permissions, set "Models" to Read-only',
      },
      {
        bn: '"Generate token" চাপুন, কপি করে এখানে পেস্ট করুন',
        en: 'Press "Generate token", copy it and paste it here',
      },
    ],
  },
  mistral: {
    keyPageUrl: 'https://console.mistral.ai/api-keys',
    steps: [
      {
        bn: 'সাইন ইন করুন (প্রথমবার ফ্রি প্ল্যান বেছে নিন)',
        en: 'Sign in (pick the free plan the first time)',
      },
      { bn: '"Create new key" চাপুন', en: 'Press "Create new key"' },
      {
        bn: 'কী একবারই দেখায় — তখনই কপি করুন',
        en: 'The key is shown only once — copy it right away',
      },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
  cohere: {
    keyPageUrl: 'https://dashboard.cohere.com/api-keys',
    steps: [
      { bn: 'Google দিয়ে সাইন ইন করুন', en: 'Sign in with Google' },
      {
        bn: '"Trial keys" অংশে আগে থেকেই একটা কী থাকে',
        en: 'A key is already waiting under "Trial keys"',
      },
      { bn: 'কপি আইকনে চাপ দিন', en: 'Press the copy icon' },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
};

/** Direct key-creation link for a provider: local guide first, then whatever the manifest says. */
export function providerKeyPageUrl(id: string, fallback?: string | null): string {
  return PROVIDER_KEY_GUIDES[id]?.keyPageUrl || fallback || '';
}
