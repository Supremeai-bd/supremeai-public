/**
 * বাংলা মন্তব্য: API কী / webhook সিক্রেট বানাতে নিরাপদ র‍্যান্ডম (Web Crypto)।
 * আগে `Math.random()` ব্যবহার হত — সেটা অনুমানযোগ্য, সিক্রেটের জন্য অনিরাপদ।
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function secureRandomToken(length: number): string {
  if (!Number.isInteger(length) || length <= 0) return '';
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generator is unavailable in this environment.');
  }
  // 252 = 36 × 7 → modulo bias ছাড়া সমান বণ্টন (rejection sampling)
  const out: string[] = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    cryptoApi.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < 252) out.push(ALPHABET[byte % 36]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}
