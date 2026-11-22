// বাংলা মন্তব্য: Edge Neural TTS-এর জন্য শেয়ার্ড কনস্ট্যান্ট ও BigInt Sec-MS-GEC টিক ক্যালকুলেশন (Node ও Cloudflare Edge উভয় রানটাইমে DRY নীতি বজায় রাখতে ব্যবহৃত)

export const DEFAULT_EDGE_TTS_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const DEFAULT_EDGE_TTS_GEC_VERSION = '1-143.0.3650.96';
export const EDGE_TTS_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
export const EDGE_TTS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

const WIN_EPOCH_OFFSET_SEC = 11644473600n;

/**
 * বাংলা মন্তব্য: বর্তমান সময়ের ওপর ভিত্তি করে ৫-মিনিট বাকেট করা Windows filetime ticks (100ns একক) স্ট্রিং তৈরি করে
 */
export function computeEdgeTtsSecMsGecInput(
  trustedClientToken: string = DEFAULT_EDGE_TTS_TRUSTED_CLIENT_TOKEN,
  nowMs: number = Date.now()
): string {
  const unixSec = BigInt(Math.floor(nowMs / 1000));
  let ticks = unixSec + WIN_EPOCH_OFFSET_SEC;
  ticks -= ticks % 300n;
  const ticks100Ns = ticks * 10000000n;
  return `${ticks100Ns.toString()}${trustedClientToken}`;
}

export function resolveEdgeTtsClientConfig(env?: Record<string, string | undefined>): {
  trustedClientToken: string;
  gecVersion: string;
} {
  const trustedClientToken =
    env?.EDGE_TTS_CLIENT_TOKEN?.trim() || DEFAULT_EDGE_TTS_TRUSTED_CLIENT_TOKEN;
  const gecVersion = env?.EDGE_TTS_GEC_VERSION?.trim() || DEFAULT_EDGE_TTS_GEC_VERSION;
  return { trustedClientToken, gecVersion };
}
