import { describe, expect, it, vi } from 'vitest';
import { secureRandomToken } from './secureRandom';

describe('secureRandomToken', () => {
  it('returns lowercase alphanumeric tokens of the requested length', () => {
    const token = secureRandomToken(32);
    expect(token).toMatch(/^[a-z0-9]{32}$/);
  });

  it('uses crypto.getRandomValues, not Math.random', () => {
    const mathSpy = vi.spyOn(Math, 'random');
    const cryptoSpy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    secureRandomToken(20);
    expect(mathSpy).not.toHaveBeenCalled();
    expect(cryptoSpy).toHaveBeenCalled();
    mathSpy.mockRestore();
    cryptoSpy.mockRestore();
  });

  it('produces different tokens and handles bad lengths', () => {
    expect(secureRandomToken(24)).not.toBe(secureRandomToken(24));
    expect(secureRandomToken(0)).toBe('');
    expect(secureRandomToken(-3)).toBe('');
  });
});
