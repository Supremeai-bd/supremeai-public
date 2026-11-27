import { describe, expect, it } from 'vitest';
import { detectPoolProvider, maskPoolKey, normalizePoolProviders } from './poolService';
import { POOL_PROVIDER_MANIFESTS } from '../constants/poolProvidersManifest';

describe('poolService — কী থেকে প্রোভাইডার নিজে চেনা', () => {
  it.each([
    ['AIzaSy' + 'A'.repeat(33), 'gemini'],
    ['gsk_' + 'a'.repeat(52), 'groq'],
    ['sk-or-v1-' + 'a'.repeat(64), 'openrouter'],
    ['csk-' + 'a'.repeat(40), 'cerebras'],
    ['ghp_' + 'A'.repeat(36), 'github'],
  ])('%s → %s', (key, id) => {
    expect(detectPoolProvider(`  ${key}  `)?.id).toBe(id);
  });

  it('অচেনা/ছোট কী → null', () => {
    expect(detectPoolProvider('hello')).toBeNull();
    expect(detectPoolProvider('not-a-real-key-format!!')).toBeNull();
  });

  it('ব্যাকএন্ডের {id,name,bonus,pattern,console} আকার UI ম্যানিফেস্টে মেলে', () => {
    const out = normalizePoolProviders([
      {
        id: 'gemini',
        name: 'Google Gemini',
        bonus: 120000,
        pattern: '^AIza.+$',
        console: 'https://x.test',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].bonusTokensPerDay).toBe(120000);
    expect(out[0].keyPattern).toBe('^AIza.+$');
    expect(out[0].gmailAuthUrl).toBe('https://x.test');
    expect(out[0].logo).toBe(POOL_PROVIDER_MANIFESTS.find((m) => m.id === 'gemini')?.logo);
  });

  it('ফাঁকা/ভুল রেসপন্সে লোকাল ম্যানিফেস্ট', () => {
    expect(normalizePoolProviders(undefined)).toBe(POOL_PROVIDER_MANIFESTS);
    expect(normalizePoolProviders([])).toBe(POOL_PROVIDER_MANIFESTS);
  });

  it('মাস্ক কাঁচা কী দেখায় না', () => {
    expect(maskPoolKey('gsk_abcdefghijklmnop')).toBe('gsk_••••mnop');
  });
});
