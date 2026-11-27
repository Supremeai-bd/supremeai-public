/**
 * Single source of truth for theme appearance choices, shared by
 * Settings → Appearance and the Sidebar / login theme popover.
 *
 * বাংলা: আগে প্রতিটা থিমের এফেক্ট দুই ফাইলে আলাদা নামে হার্ড-কোড করা ছিল
 * ("Forest Fireflies" বনাম "Fireflies")। এখন একটাই তালিকা, সব লেবেল অনুবাদযোগ্য।
 */

import type { TranslationKeys } from '../locales/en';
import type {
  LiveThemeId,
  MotionSpeed,
  ScrimIntensity,
  SurfaceTone,
  ThemeMode,
  ThemeSpecificOptions,
} from '../data/themePresets';

type ChoiceKey = {
  [K in keyof ThemeSpecificOptions]-?: NonNullable<ThemeSpecificOptions[K]> extends string
    ? K
    : never;
}[keyof ThemeSpecificOptions];

type ToggleKey = {
  [K in keyof ThemeSpecificOptions]-?: NonNullable<ThemeSpecificOptions[K]> extends boolean
    ? K
    : never;
}[keyof ThemeSpecificOptions];

export interface ThemeChoiceGroup {
  kind: 'choice';
  key: ChoiceKey;
  labelKey: TranslationKeys;
  defaultValue: string;
  choices: ReadonlyArray<{ value: string; labelKey: TranslationKeys }>;
}

export interface ThemeToggleGroup {
  kind: 'toggle';
  key: ToggleKey;
  labelKey: TranslationKeys;
  defaultValue: boolean;
}

export type ThemeOptionGroup = ThemeChoiceGroup | ThemeToggleGroup;

export const THEME_OPTION_GROUPS: Record<LiveThemeId, ReadonlyArray<ThemeOptionGroup>> = {
  'alpine-dunes': [
    {
      kind: 'choice',
      key: 'alpineTime',
      labelKey: 'themeOptionAtmosphereTone',
      defaultValue: 'daylight',
      choices: [
        { value: 'daylight', labelKey: 'themeChoiceSunlitSnow' },
        { value: 'moonlit', labelKey: 'themeChoiceMoonlitNight' },
      ],
    },
    {
      kind: 'choice',
      key: 'snowIntensity',
      labelKey: 'themeOptionSnowfall',
      defaultValue: 'gentle',
      choices: [
        { value: 'gentle', labelKey: 'themeChoiceGentle' },
        { value: 'brisk', labelKey: 'themeChoiceBrisk' },
        { value: 'off', labelKey: 'themeChoiceOff' },
      ],
    },
  ],
  'misty-fjords': [
    {
      kind: 'choice',
      key: 'waterRipple',
      labelKey: 'themeOptionLakeRipples',
      defaultValue: 'lively',
      choices: [
        { value: 'calm', labelKey: 'themeChoiceCalm' },
        { value: 'lively', labelKey: 'themeChoiceLively' },
        { value: 'off', labelKey: 'themeChoiceOff' },
      ],
    },
    {
      kind: 'choice',
      key: 'mistDensity',
      labelKey: 'themeOptionValleyMist',
      defaultValue: 'lively',
      choices: [
        { value: 'light', labelKey: 'themeChoiceThin' },
        { value: 'lively', labelKey: 'themeChoiceLively' },
        { value: 'dense', labelKey: 'themeChoiceDense' },
      ],
    },
  ],
  'emerald-highlands': [
    {
      kind: 'choice',
      key: 'forestEffect',
      labelKey: 'themeOptionForest',
      defaultValue: 'fireflies',
      choices: [
        { value: 'fireflies', labelKey: 'themeChoiceFireflies' },
        { value: 'rain', labelKey: 'themeChoiceRain' },
        { value: 'mist', labelKey: 'themeChoiceMistOnly' },
      ],
    },
  ],
  'amber-canyon': [
    {
      kind: 'choice',
      key: 'canyonEffect',
      labelKey: 'themeOptionCanyonLight',
      defaultValue: 'heat-dust',
      choices: [
        { value: 'heat-dust', labelKey: 'themeChoiceDustMotes' },
        { value: 'sunbeams', labelKey: 'themeChoiceSunbeams' },
        { value: 'mist', labelKey: 'themeChoiceDesertHaze' },
      ],
    },
  ],
  'midnight-peaks': [
    {
      kind: 'choice',
      key: 'midnightSky',
      labelKey: 'themeOptionNightSky',
      defaultValue: 'shooting-stars',
      choices: [
        { value: 'shooting-stars', labelKey: 'themeChoiceShootingStars' },
        { value: 'polar-glow', labelKey: 'themeChoicePolarGlow' },
        { value: 'starfield', labelKey: 'themeChoiceStarfield' },
      ],
    },
  ],
  nebula: [
    {
      kind: 'choice',
      key: 'nebulaEffect',
      labelKey: 'themeOptionCosmicStar',
      defaultValue: 'warp-stars',
      choices: [
        { value: 'warp-stars', labelKey: 'themeChoiceWarpStars' },
        { value: 'constellation', labelKey: 'themeChoiceConstellation' },
        { value: 'drift', labelKey: 'themeChoiceCosmicDrift' },
      ],
    },
  ],
  cyberpunk: [
    {
      kind: 'choice',
      key: 'cyberPalette',
      labelKey: 'themeOptionMatrixPalette',
      defaultValue: 'neon-emerald',
      choices: [
        { value: 'neon-emerald', labelKey: 'themeChoiceGreenPink' },
        { value: 'cyber-cyan', labelKey: 'themeChoiceCyanViolet' },
        { value: 'synth-amber', labelKey: 'themeChoiceAmberRed' },
      ],
    },
    {
      kind: 'choice',
      key: 'cyberDensity',
      labelKey: 'themeOptionRainDensity',
      defaultValue: 'normal',
      choices: [
        { value: 'sparse', labelKey: 'themeChoiceSparse' },
        { value: 'normal', labelKey: 'themeChoiceNormal' },
        { value: 'overdrive', labelKey: 'themeChoiceOverdrive' },
      ],
    },
    {
      kind: 'toggle',
      key: 'cyberScanlines',
      labelKey: 'themeOptionCrtScanlines',
      defaultValue: true,
    },
  ],
  'aurora-borealis': [
    {
      kind: 'choice',
      key: 'auroraPalette',
      labelKey: 'themeOptionAuroraPalette',
      defaultValue: 'polar-emerald',
      choices: [
        { value: 'polar-emerald', labelKey: 'themeChoicePolarGreen' },
        { value: 'cosmic-violet', labelKey: 'themeChoiceCosmicViolet' },
        { value: 'solar-crimson', labelKey: 'themeChoiceSolarCrimson' },
      ],
    },
  ],
  'oceanic-horizon': [
    {
      kind: 'choice',
      key: 'oceanWaveEnergy',
      labelKey: 'themeOptionOceanWave',
      defaultValue: 'rolling',
      choices: [
        { value: 'calm', labelKey: 'themeChoiceCalm' },
        { value: 'rolling', labelKey: 'themeChoiceRolling' },
        { value: 'choppy', labelKey: 'themeChoiceChoppy' },
      ],
    },
  ],
  'solar-meadow': [
    {
      kind: 'toggle',
      key: 'dawnSunbeams',
      labelKey: 'themeOptionSunbeams',
      defaultValue: true,
    },
  ],
  'cyber-studio': [
    {
      kind: 'toggle',
      key: 'neuralMesh',
      labelKey: 'themeOptionNeuralMesh',
      defaultValue: true,
    },
  ],
};

export function themeOptionGroupsFor(themeId: LiveThemeId): ReadonlyArray<ThemeOptionGroup> {
  return THEME_OPTION_GROUPS[themeId] ?? [];
}

/** Current value of a group, falling back to its default. */
export function readChoice(options: ThemeSpecificOptions, group: ThemeChoiceGroup): string {
  const raw = options[group.key];
  return typeof raw === 'string' && group.choices.some((c) => c.value === raw)
    ? raw
    : group.defaultValue;
}

export function readToggle(options: ThemeSpecificOptions, group: ThemeToggleGroup): boolean {
  const raw = options[group.key];
  return typeof raw === 'boolean' ? raw : group.defaultValue;
}

export const THEME_MODE_CHOICES: ReadonlyArray<{ value: ThemeMode; labelKey: TranslationKeys }> = [
  { value: 'system', labelKey: 'schemeAutoTitle' },
  { value: 'light', labelKey: 'schemeLightTitle' },
  { value: 'dark', labelKey: 'schemeDarkTitle' },
];

export const SURFACE_TONE_CHOICES: ReadonlyArray<{
  value: SurfaceTone;
  labelKey: TranslationKeys;
}> = [
  { value: 'adaptive', labelKey: 'tintedGlassLabel' },
  { value: 'monochrome', labelKey: 'classicBwLabel' },
];

export const MOTION_SPEED_CHOICES: ReadonlyArray<{
  value: MotionSpeed;
  labelKey: TranslationKeys;
}> = [
  { value: 'calm', labelKey: 'themeChoiceCalm' },
  { value: 'normal', labelKey: 'themeChoiceNormal' },
  { value: 'dynamic', labelKey: 'themeChoiceDynamic' },
];

export const SCRIM_CHOICES: ReadonlyArray<{ value: ScrimIntensity; labelKey: TranslationKeys }> = [
  { value: 'subtle', labelKey: 'themeChoiceVibrant' },
  { value: 'balanced', labelKey: 'themeChoiceBalanced' },
  { value: 'focus', labelKey: 'themeChoiceFocus' },
];
