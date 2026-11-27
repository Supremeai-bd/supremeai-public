import React, { useState } from 'react';
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import {
  useThemeStore,
  LIVE_THEMES,
  type LiveThemeId,
  type ThemeMode,
} from '../../stores/useThemeStore';
import type { LiveThemeDefinition, ThemeSpecificOptions } from '../../data/themePresets';
import {
  MOTION_SPEED_CHOICES,
  readChoice,
  readToggle,
  SCRIM_CHOICES,
  SURFACE_TONE_CHOICES,
  THEME_MODE_CHOICES,
  themeOptionGroupsFor,
} from '../../config/themeOptionGroups';
import { OptionSelect, type OptionSelectItem } from '../ui/OptionSelect';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SettingSwitch } from '../ui/SettingSwitch';

/**
 * Theme controls shared by Settings → Appearance (`full`) and the Sidebar / login
 * theme popover (`compact`).
 *
 * বাংলা: মোড → থিম (ছবিসহ ড্রপডাউন) → থিমের এফেক্ট → লাইভ অ্যানিমেশন → "আরও অপশন"
 * (লুকানো)। একটাই কম্পোনেন্ট, একটাই তালিকা — দুই জায়গায় আর অমিল হবে না।
 */

const MODE_ICONS: Record<ThemeMode, React.ReactNode> = {
  system: <Monitor className="w-3.5 h-3.5" />,
  light: <Sun className="w-3.5 h-3.5" />,
  dark: <Moon className="w-3.5 h-3.5" />,
};

export function themePreviewImageFilter(theme: LiveThemeDefinition, isDark: boolean): string {
  if (theme.isNocturnalPhoto) {
    return isDark
      ? 'brightness(0.86) contrast(1.06)'
      : 'brightness(1.16) contrast(0.95) saturate(0.9)';
  }
  return isDark ? 'brightness(0.54) contrast(1.12) saturate(0.88)' : 'none';
}

/** Mini mock of the app on top of the selected theme; updates instantly. */
export const ThemeLivePreview: React.FC<{ theme: LiveThemeDefinition; isDark: boolean }> = ({
  theme,
  isDark,
}) => {
  const { t } = useI18n();
  return (
    <div data-testid="theme-live-preview" className="space-y-1.5">
      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {t.themeLivePreviewTitle}
      </div>
      <div
        className="relative h-56 rounded-2xl overflow-hidden border border-slate-200/80 dark:border-slate-700/80"
        style={{ background: isDark ? theme.darkPreviewGradient : theme.lightPreviewGradient }}
      >
        {theme.previewImage && (
          <img
            src={theme.previewImage}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: themePreviewImageFilter(theme, isDark) }}
          />
        )}
        <div className="absolute inset-3 rounded-xl theme-surface-glass border flex flex-col overflow-hidden shadow-lg">
          <div className="h-7 px-3 flex items-center gap-1.5 border-b border-slate-200/60 dark:border-white/10">
            <span className="w-2 h-2 rounded-full bg-red-400/80" />
            <span className="w-2 h-2 rounded-full bg-amber-400/80" />
            <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
            <span className="ml-2 text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">
              SupremeAI
            </span>
          </div>
          <div className="flex-1 p-3 space-y-2 text-[11px]">
            <div className="ml-auto max-w-[75%] w-fit px-2.5 py-1.5 rounded-xl theme-btn-primary">
              {t.themePreviewSampleUser}
            </div>
            <div className="max-w-[80%] w-fit px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 border border-slate-200/60 dark:border-white/10">
              {t.themePreviewSampleAi}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ThemeAppearanceControls: React.FC<{ variant?: 'full' | 'compact' }> = ({
  variant = 'full',
}) => {
  const { t } = useI18n();
  const compact = variant === 'compact';
  const [moreOpen, setMoreOpen] = useState(false);

  const themeMode = useThemeStore((s) => s.themeMode);
  const resolvedScheme = useThemeStore((s) => s.resolvedScheme);
  const liveTheme = useThemeStore((s) => s.liveTheme);
  const liveMotion = useThemeStore((s) => s.liveMotion);
  const overrideReducedMotion = useThemeStore((s) => s.overrideReducedMotion);
  const prefersReducedMotion = useThemeStore((s) => s.prefersReducedMotion);
  const motionSpeed = useThemeStore((s) => s.motionSpeed);
  const surfaceTone = useThemeStore((s) => s.surfaceTone);
  const scrimIntensity = useThemeStore((s) => s.scrimIntensity);
  const themeOptions = useThemeStore((s) => s.themeOptions);
  const setThemeMode = useThemeStore((s) => s.setThemeMode);
  const setLiveTheme = useThemeStore((s) => s.setLiveTheme);
  const setLiveMotion = useThemeStore((s) => s.setLiveMotion);
  const setOverrideReducedMotion = useThemeStore((s) => s.setOverrideReducedMotion);
  const setMotionSpeed = useThemeStore((s) => s.setMotionSpeed);
  const setSurfaceTone = useThemeStore((s) => s.setSurfaceTone);
  const setScrimIntensity = useThemeStore((s) => s.setScrimIntensity);
  const updateThemeOptions = useThemeStore((s) => s.updateThemeOptions);

  const isDark = resolvedScheme === 'dark';
  const isAnimating = liveMotion && (!prefersReducedMotion || overrideReducedMotion);
  const activeTheme = LIVE_THEMES.find((th) => th.id === liveTheme) || LIVE_THEMES[0];
  const placement = compact ? 'inline' : 'overlay';

  const themeItems: OptionSelectItem<LiveThemeId>[] = LIVE_THEMES.map((theme) => {
    const mismatch =
      (theme.recommendedScheme === 'dark' && !isDark) ||
      (theme.recommendedScheme === 'light' && isDark);
    return {
      value: theme.id,
      label: theme.name,
      description: theme.animationLabel,
      badge: mismatch
        ? theme.recommendedScheme === 'dark'
          ? t.themeBestInDark
          : t.themeBestInLight
        : undefined,
      thumbnail: {
        image: theme.previewImage,
        background: isDark ? theme.darkPreviewGradient : theme.lightPreviewGradient,
      },
    };
  });

  const handleAnimation = (on: boolean) => {
    setLiveMotion(on);
    if (on && prefersReducedMotion && !overrideReducedMotion) setOverrideReducedMotion(true);
  };

  const controls = (
    <div className="space-y-4" data-testid={`theme-controls-${variant}`}>
      <SegmentedControl
        label={t.colorSchemeSyncLabel}
        value={themeMode}
        onChange={setThemeMode}
        size={compact ? 'sm' : 'md'}
        testId="theme-mode"
        options={THEME_MODE_CHOICES.map((c) => ({
          value: c.value,
          label: c.value === 'system' ? t.themeModeAuto : t[c.labelKey],
          icon: MODE_ICONS[c.value],
        }))}
      />

      <OptionSelect
        label={t.themeSelectLabel}
        value={activeTheme.id}
        options={themeItems}
        onChange={setLiveTheme}
        menuPlacement={placement}
        testId="theme-select"
      />

      {themeOptionGroupsFor(activeTheme.id).map((group) =>
        group.kind === 'choice' ? (
          <OptionSelect
            key={group.key}
            label={t[group.labelKey]}
            value={readChoice(themeOptions, group)}
            options={group.choices.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            onChange={(value) =>
              updateThemeOptions({ [group.key]: value } as Partial<ThemeSpecificOptions>)
            }
            menuPlacement={placement}
            testId={`theme-effect-${group.key}`}
          />
        ) : (
          <SettingSwitch
            key={group.key}
            label={t[group.labelKey]}
            checked={readToggle(themeOptions, group)}
            onChange={(checked) =>
              updateThemeOptions({ [group.key]: checked } as Partial<ThemeSpecificOptions>)
            }
            testId={`theme-effect-${group.key}`}
          />
        )
      )}

      <SettingSwitch
        label={t.liveAnimationLabel}
        description={
          prefersReducedMotion && !overrideReducedMotion
            ? t.liveAnimationReducedHint
            : t.liveAnimationDesc
        }
        checked={isAnimating}
        onChange={handleAnimation}
        testId="theme-live-animation"
      />

      <div className="border-t border-slate-200/70 dark:border-slate-800 pt-3">
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          data-testid="theme-more-options"
          className="w-full flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          <span>{t.appearanceMoreOptions}</span>
          <ChevronDown
            aria-hidden="true"
            className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {moreOpen && (
          <div
            className={`mt-3 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}
          >
            <SegmentedControl
              label={t.uiSurfaceStyleLabel}
              value={surfaceTone}
              onChange={setSurfaceTone}
              size="sm"
              testId="theme-surface"
              options={SURFACE_TONE_CHOICES.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            />
            <SegmentedControl
              label={t.animationSpeedLabel}
              value={motionSpeed}
              onChange={setMotionSpeed}
              size="sm"
              testId="theme-speed"
              options={MOTION_SPEED_CHOICES.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            />
            <SegmentedControl
              label={t.backdropClarityLabel}
              value={scrimIntensity}
              onChange={setScrimIntensity}
              size="sm"
              testId="theme-scrim"
              options={SCRIM_CHOICES.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (compact) return controls;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {controls}
      <div className="lg:sticky lg:top-4">
        <ThemeLivePreview theme={activeTheme} isDark={isDark} />
      </div>
    </div>
  );
};
