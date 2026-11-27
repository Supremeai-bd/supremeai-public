import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_APP_LANGUAGE_CODES,
  dialectInstructionFor,
  htmlLangFor,
  normalizeSupportedLanguage,
  toChatLanguage,
} from './appLanguage';
import { APP_LANGUAGE_OPTIONS } from './i18n';

describe('appLanguage', () => {
  it('lists exactly the languages offered in the settings dropdown', () => {
    expect([...SUPPORTED_APP_LANGUAGE_CODES].sort()).toEqual(
      APP_LANGUAGE_OPTIONS.map((o) => String(o.id)).sort()
    );
  });

  it('keeps supported codes (including Bangla dialects) and falls back otherwise', () => {
    expect(normalizeSupportedLanguage('bn-ctg')).toBe('bn-ctg');
    expect(normalizeSupportedLanguage(' BN-SYL ')).toBe('bn-syl');
    expect(normalizeSupportedLanguage('fr')).toBe('fr');
    expect(normalizeSupportedLanguage('klingon')).toBe('en');
    expect(normalizeSupportedLanguage(undefined, 'bn')).toBe('bn');
    expect(normalizeSupportedLanguage(42, 'bn-raj')).toBe('bn-raj');
  });

  it('maps every Bangla variant to "bn" for chat/TTS backends', () => {
    expect(toChatLanguage('bn-nkh')).toBe('bn');
    expect(toChatLanguage('bn')).toBe('bn');
    expect(toChatLanguage('es')).toBe('en');
    expect(toChatLanguage(null)).toBe('en');
  });

  it('uses a valid <html lang> for dialects', () => {
    expect(htmlLangFor('bn-ctg')).toBe('bn');
    expect(htmlLangFor('ja')).toBe('ja');
    expect(htmlLangFor('nope')).toBe('en');
  });

  it('adds a dialect hint to the system prompt only for regional dialects', () => {
    expect(dialectInstructionFor('bn-ctg')).toContain('Chittagonian');
    expect(dialectInstructionFor('bn-syl')).toContain('Sylheti');
    expect(dialectInstructionFor('bn')).toBe('');
    expect(dialectInstructionFor('en')).toBe('');
  });
});
