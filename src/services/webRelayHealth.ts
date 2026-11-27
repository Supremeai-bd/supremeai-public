/**
 * বাংলা মন্তব্য: Web relay (Stealth Webhook) সার্কিট-ব্রেকার।
 * গেটওয়ে relay-only মডেলে (supremeai-web) relay ডাউন থাকলে 502
 * "Stealth Webhook relay is unavailable" দেয়। অটো-রাউটার লাইভ-ওয়েব প্রশ্ন
 * নিজে থেকেই supremeai-web-এ পাঠায়, তাই ব্যবহারকারী কোনো মডেল না বেছেও
 * হার্ড এরর দেখত। এখন একবার ব্যর্থ হলে ৫ মিনিট relay এড়িয়ে সরাসরি API pool।
 */

export const WEB_RELAY_MODEL = 'supremeai-web';
export const WEB_RELAY_FALLBACK_MODEL = 'supremeai-api';
export const WEB_RELAY_COOLDOWN_MS = 5 * 60 * 1000;

const STORAGE_KEY = 'supremeai_web_relay_down_until';
let downUntilMemory = 0;

const RELAY_FAILURE_PATTERNS: RegExp[] = [
  /stealth\s+webhook\s+relay/i,
  /webhook\s+relay\s+is\s+(currently\s+)?(offline|unavailable|unconfigured|unreachable)/i,
  /web\s+relay\s+(is\s+)?(offline|unavailable|unreachable)/i,
  /relay[-\s]only/i,
];

/** True when an error message is the gateway telling us the web relay lane is down. */
export function isWebRelayFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return RELAY_FAILURE_PATTERNS.some((re) => re.test(message));
}

function readStoredUntil(): number {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function markWebRelayDown(now: number = Date.now()): void {
  downUntilMemory = now + WEB_RELAY_COOLDOWN_MS;
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, String(downUntilMemory));
  } catch {
    // storage blocked — the in-memory value still protects this tab
  }
}

export function isWebRelayDown(now: number = Date.now()): boolean {
  return Math.max(downUntilMemory, readStoredUntil()) > now;
}

export function resetWebRelayHealth(): void {
  downUntilMemory = 0;
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
