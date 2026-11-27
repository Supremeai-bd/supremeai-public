import { describe, expect, it, vi } from 'vitest';
import {
  EDGE_CIPHER_PREFIX,
  POOL_MAX_ACTIVE_KEYS,
  PoolStore,
  computePoolQuota,
  decryptPoolKey,
  encryptPoolKey,
  isPoolKeyFormatValid,
  poolKeyFingerprint,
  poolKeyHint,
  resolvePoolStorage,
  validatePoolKeyUpstream,
} from './poolStore';

const GEMINI_KEY = 'AIzaSy' + 'A'.repeat(33);
const GROQ_KEY = 'gsk_' + 'b'.repeat(52);

describe('poolStore — "লিমিট বাড়ান" edge স্টোরেজ', () => {
  it('স্টোরেজ কনফিগ ছাড়া null (ভুয়া সফল নয়)', () => {
    expect(resolvePoolStorage({})).toBeNull();
    expect(
      resolvePoolStorage({
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'svc',
      })
    ).toBeNull();
    expect(
      resolvePoolStorage({
        SUPABASE_URL: 'https://x.supabase.co/',
        SUPABASE_SERVICE_ROLE_KEY: 'svc',
        POOL_ENCRYPTION_KEY: '0123456789abcdef0123',
      })
    ).toEqual({
      supabaseUrl: 'https://x.supabase.co',
      serviceKey: 'svc',
      encryptionSecret: '0123456789abcdef0123',
    });
  });

  it('ফরম্যাট যাচাই প্রোভাইডার অনুযায়ী', () => {
    expect(isPoolKeyFormatValid('gemini', GEMINI_KEY)).toBe(true);
    expect(isPoolKeyFormatValid('groq', GEMINI_KEY)).toBe(false);
    expect(isPoolKeyFormatValid('groq', GROQ_KEY)).toBe(true);
    expect(isPoolKeyFormatValid('unknown', GROQ_KEY)).toBe(false);
  });

  it('hint কাঁচা কী ফাঁস করে না', () => {
    const hint = poolKeyHint(GEMINI_KEY);
    expect(hint).toBe('AIza••••AAAA');
    expect(hint).not.toContain(GEMINI_KEY);
  });

  it('fingerprint = SHA-256 hex (ব্যাকএন্ডের hashlib-এর সাথে মেলে)', async () => {
    expect(await poolKeyFingerprint('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('AES-GCM এনক্রিপ্ট/ডিক্রিপ্ট রাউন্ড-ট্রিপ', async () => {
    const secret = 'super-secret-pool-key-123';
    const cipher = await encryptPoolKey(GROQ_KEY, secret);
    expect(cipher.startsWith(EDGE_CIPHER_PREFIX)).toBe(true);
    expect(cipher).not.toContain(GROQ_KEY);
    expect(await decryptPoolKey(cipher, secret)).toBe(GROQ_KEY);
    await expect(decryptPoolKey(cipher, 'wrong-secret-xxxxxxxx')).rejects.toBeTruthy();
  });

  it('কোটা: শুধু valid, সর্বোচ্চ ১০টি, kilo = 150K', () => {
    expect(
      computePoolQuota([
        { provider: 'kilo', status: 'valid' },
        { provider: 'gemini', status: 'valid' },
        { provider: 'groq', status: 'invalid' },
      ])
    ).toEqual({ valid_keys_count: 2, daily_bonus_tokens: 250000 });
    const many = Array.from({ length: 14 }, () => ({ provider: 'gemini', status: 'valid' }));
    expect(computePoolQuota(many).valid_keys_count).toBe(POOL_MAX_ACTIVE_KEYS);
  });

  it('লাইভ যাচাই: শুধু HTTP 200 বৈধ, নেটওয়ার্ক ত্রুটি = অবৈধ', async () => {
    const ok = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const denied = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const boom = vi.fn().mockRejectedValue(new Error('net'));
    expect(await validatePoolKeyUpstream('groq', GROQ_KEY, ok)).toBe(true);
    expect(ok.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/models');
    expect(await validatePoolKeyUpstream('groq', GROQ_KEY, denied)).toBe(false);
    expect(await validatePoolKeyUpstream('groq', GROQ_KEY, boom)).toBe(false);
    // প্রোব নেই এমন প্রোভাইডার (kilo) — শুধু ফরম্যাট-যাচাই, ব্যাকএন্ডের মতো
    expect(await validatePoolKeyUpstream('kilo', 'x', boom)).toBe(true);
  });

  it('PoolStore Supabase REST-এ service key দিয়ে ইউজার-স্কোপড কোয়েরি পাঠায়', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    const store = new PoolStore(
      { supabaseUrl: 'https://x.supabase.co', serviceKey: 'svc', encryptionSecret: 'z'.repeat(20) },
      fetchImpl as unknown as typeof fetch
    );
    await store.listUserKeys('user-1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/user_contributed_api_keys?');
    expect(String(url)).toContain('user_id=eq.user-1');
    expect(String(url)).not.toContain('encrypted_key');
    expect((init.headers as Headers).get('apikey')).toBe('svc');
  });
});
