import { describe, expect, it } from 'vitest';
import { EN_DICT } from '../locales/en';
import { BN_DICT } from '../locales/bn';
import { LIVE_THEMES, DEFAULT_THEME_OPTIONS } from '../data/themePresets';
import { LIVE_VOICE_OPTIONS } from '../hooks/useLiveVoiceSession';
import {
  applyBanglaVariant,
  banglaVariantOf,
  banglaVariantOptions,
  BANGLA_VARIANTS,
  isBanglaLanguage,
  primaryLanguageOf,
  primaryLanguageOptions,
  voiceOptions,
} from './languageVoiceOptions';
import {
  MOTION_SPEED_CHOICES,
  readChoice,
  readToggle,
  SCRIM_CHOICES,
  SURFACE_TONE_CHOICES,
  THEME_MODE_CHOICES,
  THEME_OPTION_GROUPS,
  themeOptionGroupsFor,
  type ThemeChoiceGroup,
  type ThemeToggleGroup,
} from './themeOptionGroups';

describe('language & voice options', () => {
  it('folds Bangla dialects into a single "বাংলা" entry in the main dropdown', () => {
    const values = primaryLanguageOptions().map((o) => o.value);
    expect(values).toContain('bn');
    expect(values).toContain('en');
    expect(values.filter((v) => String(v).startsWith('bn'))).toEqual(['bn']);
    expect(primaryLanguageOptions().find((o) => o.value === 'bn')?.label).toBe('বাংলা');
  });

  it('maps every Bangla language to the bn primary entry', () => {
    for (const lang of ['bn', 'bn-ctg', 'bn-syl', 'bn-raj', 'bn-nkh']) {
      expect(isBanglaLanguage(lang)).toBe(true);
      expect(primaryLanguageOf(lang)).toBe('bn');
    }
    expect(isBanglaLanguage('en')).toBe(false);
    expect(primaryLanguageOf('es')).toBe('es');
  });

  it('round-trips each Bangla variant through language + accent', () => {
    for (const variant of BANGLA_VARIANTS) {
      const { language, accent } = applyBanglaVariant(variant.id);
      expect(banglaVariantOf(language, accent)).toBe(variant.id);
    }
    expect(banglaVariantOf('bn', 'bn-in')).toBe('bn-in');
    expect(banglaVariantOf('bn', 'bn-bd')).toBe('bn-bd');
    expect(banglaVariantOf('bn-ctg', 'bn-in')).toBe('bn-ctg');
    expect(banglaVariantOptions()).toHaveLength(6);
  });

  it('names every voice by its tone, in both locales', () => {
    const en = voiceOptions(EN_DICT);
    const bn = voiceOptions(BN_DICT);
    expect(en.map((o) => o.value).sort()).toEqual(LIVE_VOICE_OPTIONS.map((o) => o.id).sort());
    for (const opt of [...en, ...bn]) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
      expect(opt.label).not.toBe(opt.value);
    }
  });
});

describe('theme option groups', () => {
  it('covers every live theme', () => {
    for (const theme of LIVE_THEMES) {
      expect(themeOptionGroupsFor(theme.id).length).toBeGreaterThan(0);
    }
    expect(Object.keys(THEME_OPTION_GROUPS).sort()).toEqual(LIVE_THEMES.map((t) => t.id).sort());
  });

  it('uses translation keys that exist in both English and Bangla', () => {
    const keys = new Set<string>();
    for (const groups of Object.values(THEME_OPTION_GROUPS)) {
      for (const g of groups) {
        keys.add(g.labelKey);
        if (g.kind === 'choice') g.choices.forEach((c) => keys.add(c.labelKey));
      }
    }
    for (const list of [
      THEME_MODE_CHOICES,
      SURFACE_TONE_CHOICES,
      MOTION_SPEED_CHOICES,
      SCRIM_CHOICES,
    ]) {
      list.forEach((c) => keys.add(c.labelKey));
    }
    for (const key of keys) {
      expect(EN_DICT[key as keyof typeof EN_DICT], key).toBeTruthy();
      expect(BN_DICT[key as keyof typeof BN_DICT], key).toBeTruthy();
    }
  });

  it('defaults match the persisted theme defaults and include their own value', () => {
    for (const groups of Object.values(THEME_OPTION_GROUPS)) {
      for (const g of groups) {
        const stored = DEFAULT_THEME_OPTIONS[g.key];
        if (stored !== undefined) expect(stored, g.key).toBe(g.defaultValue);
        if (g.kind === 'choice') {
          expect(g.choices.map((c) => c.value)).toContain(g.defaultValue);
        }
      }
    }
  });

  it('reads stored values and falls back to defaults for missing or unknown ones', () => {
    const forest = THEME_OPTION_GROUPS['emerald-highlands'][0] as ThemeChoiceGroup;
    expect(readChoice({}, forest)).toBe('fireflies');
    expect(readChoice({ forestEffect: 'rain' }, forest)).toBe('rain');
    expect(readChoice({ forestEffect: 'bogus' as never }, forest)).toBe('fireflies');

    const mesh = THEME_OPTION_GROUPS['cyber-studio'][0] as ThemeToggleGroup;
    expect(readToggle({}, mesh)).toBe(true);
    expect(readToggle({ neuralMesh: false }, mesh)).toBe(false);
  });
});
