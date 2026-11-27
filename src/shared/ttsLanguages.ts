/**
 * বাংলা মন্তব্য: TTS-এর ভাষা টেবিল — leaf মডিউল (কোনো ইমপোর্ট নেই), তাই ব্রাউজার,
 * Express ও Cloudflare edge — তিন জায়গাতেই একই ম্যাপ ব্যবহার হয়।
 *
 * আগে TTS শুধু 'bn' | 'en' চিনত: हिन्दी (hi) সিলেক্ট করলেও 'en'-এ নেমে ইংরেজিতে
 * শোনাত, আর আঞ্চলিক বাংলা (bn-ctg …) প্রমিত বাংলার নমুনা পড়ত।
 * এখন: আঞ্চলিক বাংলা → বাংলা ভয়েস + সেই ডায়ালেক্টে লেখা নমুনা; hi/es/fr/… → নিজস্ব Edge ভয়েস।
 */

export interface TtsIntlVoice {
  male: string;
  female: string;
  /** BCP-47 locale used for SSML xml:lang and SpeechSynthesisUtterance.lang */
  lang: string;
  /** Google translate_tts `tl` code for the last-resort MP3 fallback */
  tl: string;
}

export const TTS_INTL_VOICES: Record<string, TtsIntlVoice> = {
  es: { male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural', lang: 'es-ES', tl: 'es' },
  fr: { male: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural', lang: 'fr-FR', tl: 'fr' },
  ar: { male: 'ar-SA-HamedNeural', female: 'ar-SA-ZariyahNeural', lang: 'ar-SA', tl: 'ar' },
  hi: { male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural', lang: 'hi-IN', tl: 'hi' },
  zh: { male: 'zh-CN-YunxiNeural', female: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', tl: 'zh-CN' },
  ja: { male: 'ja-JP-KeitaNeural', female: 'ja-JP-NanamiNeural', lang: 'ja-JP', tl: 'ja' },
  de: { male: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural', lang: 'de-DE', tl: 'de' },
  pt: { male: 'pt-BR-AntonioNeural', female: 'pt-BR-FranciscaNeural', lang: 'pt-BR', tl: 'pt' },
};

/** 'bn' | 'en' | an international code that has its own TTS voice. */
export type TtsLanguage = 'bn' | 'en' | keyof typeof TTS_INTL_VOICES;

/**
 * App language → TTS voice language. Bangla dialects speak with the Bangla voice
 * (no neural voice exists per dialect — the dialect lives in the text itself).
 */
export function normalizeTtsLanguage(raw: unknown): TtsLanguage {
  if (typeof raw !== 'string') return 'en';
  const code = raw.trim().toLowerCase();
  if (code === 'bn' || code.startsWith('bn-')) return 'bn';
  if (Object.prototype.hasOwnProperty.call(TTS_INTL_VOICES, code)) return code;
  const base = code.split(/[-_]/)[0];
  if (Object.prototype.hasOwnProperty.call(TTS_INTL_VOICES, base)) return base;
  return 'en';
}

export function isIntlTtsLanguage(raw: unknown): boolean {
  const lang = normalizeTtsLanguage(raw);
  return lang !== 'bn' && lang !== 'en';
}

/** Google translate_tts `tl` for a BCP-47 locale (bn-BD → bn, hi-IN → hi, zh-CN → zh-CN). */
export function googleTlForLocale(locale: string): string {
  const lower = (locale || '').toLowerCase();
  if (lower.startsWith('bn')) return 'bn';
  for (const v of Object.values(TTS_INTL_VOICES)) {
    if (v.lang.toLowerCase() === lower || lower.startsWith(v.tl.toLowerCase())) return v.tl;
  }
  return 'en';
}

const SAMPLE_PHRASES: Record<string, string> = {
  en: 'Hello! I am your SupremeAI voice avatar. Your unified interface, chat response, and global TTS voice settings are now active.',
  bn: 'আসসালামু আলাইকুম! আমি আপনার SupremeAI ভয়েস অবতার। আপনার পছন্দের বাংলাদেশি বাংলা উচ্চারণ ও গ্লোবাল TTS সেটিংস এখন সক্রিয়।',
  'bn-in':
    'নমস্কার! আমি আপনার SupremeAI ভয়েস অবতার। আপনার পছন্দের বাংলা ভাষা এবং গ্লোবাল TTS সেটিংস এখন সক্রিয়।',
  'bn-ctg':
    'আসসালামু আলাইকুম! আঁই অনর SupremeAI ভয়েস অবতার। অনে চাটগাঁইয়া ভাষা বাছি লইয়ন, এহন তুন আঁই অনর লগে চাটগাঁইয়াত কথা কইয়ুম।',
  'bn-syl':
    'আসসালামু আলাইকুম! আমি আফনার SupremeAI ভয়েস অবতার। আফনে সিলেটি বাছিয়া লইছইন, অখন থাকি আমি আফনার লগে সিলেটিত মাতমু।',
  'bn-raj':
    'আসসালামু আলাইকুম! হামি তোমার SupremeAI ভয়েস অবতার। তুমি রাজশাহীর ভাষা বাছ্যা লিছো, এখন থ্যাকা হামি তোমার সাথে এই ভাষাতেই কথা কহমু।',
  'bn-nkh':
    'আসসালামু আলাইকুম! আঁই আন্নের SupremeAI ভয়েস অবতার। আন্নে নোয়াখাইল্যা ভাষা বাছি লইছেন, অন তুন আঁই আন্নের লগে এই ভাষায় কতা কইয়ুম।',
  hi: 'नमस्ते! मैं आपका SupremeAI वॉइस अवतार हूँ। आपकी चुनी हुई हिन्दी भाषा और वॉइस सेटिंग्स अब सक्रिय हैं।',
  es: '¡Hola! Soy tu avatar de voz de SupremeAI. Tu idioma y tu configuración de voz ya están activos.',
  fr: 'Bonjour ! Je suis votre avatar vocal SupremeAI. Votre langue et vos réglages de voix sont maintenant actifs.',
  ar: 'مرحباً! أنا مساعدك الصوتي من SupremeAI. لغتك وإعدادات الصوت أصبحت مفعّلة الآن.',
  zh: '你好！我是你的 SupremeAI 语音助手。你选择的语言和语音设置现已生效。',
  ja: 'こんにちは！私はあなたの SupremeAI ボイスアバターです。選んだ言語と音声設定が有効になりました。',
  de: 'Hallo! Ich bin dein SupremeAI-Sprachavatar. Deine Sprache und Stimmeinstellungen sind jetzt aktiv.',
  pt: 'Olá! Eu sou o seu avatar de voz SupremeAI. Seu idioma e suas configurações de voz já estão ativos.',
};

/**
 * Preview sentence written in the exact app language — dialect codes (bn-ctg, bn-syl,
 * bn-raj, bn-nkh) get a sentence in that dialect; `accent` picks bn-IN for plain Bangla.
 */
export function sampleTtsPhrase(rawLanguage: unknown, accent?: string): string {
  const code = typeof rawLanguage === 'string' ? rawLanguage.trim().toLowerCase() : '';
  if (code === 'bn' && accent === 'bn-in') return SAMPLE_PHRASES['bn-in'];
  if (SAMPLE_PHRASES[code]) return SAMPLE_PHRASES[code];
  const lang = normalizeTtsLanguage(code);
  return SAMPLE_PHRASES[lang] ?? SAMPLE_PHRASES.en;
}
