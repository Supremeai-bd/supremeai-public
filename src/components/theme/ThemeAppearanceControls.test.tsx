import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeAppearanceControls } from './ThemeAppearanceControls';
import { useThemeStore, LIVE_THEMES, DEFAULT_THEME_OPTIONS } from '../../stores/useThemeStore';
import { themeOptionGroupsFor } from '../../config/themeOptionGroups';

function pick(testId: string, value: string) {
  fireEvent.click(screen.getByTestId(`${testId}-trigger`));
  fireEvent.click(screen.getByTestId(`${testId}-option-${value}`));
}

describe('ThemeAppearanceControls', () => {
  beforeEach(() => {
    useThemeStore.setState({
      themeMode: 'system',
      resolvedScheme: 'light',
      liveTheme: LIVE_THEMES[0].id,
      liveMotion: true,
      overrideReducedMotion: false,
      prefersReducedMotion: false,
      motionSpeed: 'normal',
      surfaceTone: 'adaptive',
      scrimIntensity: 'balanced',
      themeOptions: { ...DEFAULT_THEME_OPTIONS },
      previewSnapshot: null,
    });
    localStorage.clear();
  });
  afterEach(cleanup);

  it('has no Auto/Dark/Light picker — the theme sets its own best mode (smart Auto)', () => {
    render(<ThemeAppearanceControls />);
    expect(screen.queryByTestId('theme-mode')).toBeNull();
    const dark = LIVE_THEMES.find((th) => th.recommendedScheme === 'dark')!;
    const light = LIVE_THEMES.find((th) => th.recommendedScheme === 'light')!;
    pick('theme-select', dark.id);
    expect(useThemeStore.getState().resolvedScheme).toBe('dark');
    expect(screen.getByTestId('theme-smart-auto').getAttribute('data-scheme')).toBe('dark');
    pick('theme-select', light.id);
    expect(useThemeStore.getState().resolvedScheme).toBe('light');
  });

  it('previews without saving; Save keeps the theme', () => {
    const before = useThemeStore.getState().liveTheme;
    const target = LIVE_THEMES.find((th) => th.id !== before)!;
    render(<ThemeAppearanceControls />);
    expect(screen.queryByTestId('theme-preview-bar')).toBeNull();
    pick('theme-select', target.id);
    expect(useThemeStore.getState().liveTheme).toBe(target.id);
    expect(localStorage.getItem('supremeai_studio_theme_v3') ?? '').not.toContain(target.id);
    fireEvent.click(screen.getByTestId('theme-preview-save'));
    expect(JSON.parse(localStorage.getItem('supremeai_studio_theme_v3')!).liveTheme).toBe(
      target.id
    );
    expect(screen.queryByTestId('theme-preview-bar')).toBeNull();
    cleanup();
    expect(useThemeStore.getState().liveTheme).toBe(target.id);
  });

  it('Undo button and closing without Save both restore the previous theme', () => {
    const before = useThemeStore.getState().liveTheme;
    const target = LIVE_THEMES.find((th) => th.id !== before)!;
    render(<ThemeAppearanceControls />);
    pick('theme-select', target.id);
    fireEvent.click(screen.getByTestId('theme-preview-undo'));
    expect(useThemeStore.getState().liveTheme).toBe(before);

    pick('theme-select', target.id);
    expect(useThemeStore.getState().liveTheme).toBe(target.id);
    cleanup(); // panel / popover closed without Save
    expect(useThemeStore.getState().liveTheme).toBe(before);
    expect(useThemeStore.getState().previewSnapshot).toBeNull();
  });

  it('lists every live theme in the dropdown and applies the pick', () => {
    render(<ThemeAppearanceControls />);
    fireEvent.click(screen.getByTestId('theme-select-trigger'));
    LIVE_THEMES.forEach((theme) => {
      expect(screen.getByTestId(`theme-select-option-${theme.id}`)).toBeTruthy();
    });
    const target = LIVE_THEMES[LIVE_THEMES.length - 1];
    fireEvent.click(screen.getByTestId(`theme-select-option-${target.id}`));
    expect(useThemeStore.getState().liveTheme).toBe(target.id);
  });

  it('shows only the effect controls of the selected theme and updates them', () => {
    const theme = LIVE_THEMES.find((th) =>
      themeOptionGroupsFor(th.id).some((g) => g.kind === 'choice')
    );
    expect(theme).toBeDefined();
    useThemeStore.setState({ liveTheme: theme!.id });
    render(<ThemeAppearanceControls />);

    const groups = themeOptionGroupsFor(theme!.id);
    groups.forEach((g) => expect(screen.getByTestId(`theme-effect-${g.key}`)).toBeTruthy());

    const choice = groups.find((g) => g.kind === 'choice')!;
    if (choice.kind !== 'choice') throw new Error('unreachable');
    const last = choice.choices[choice.choices.length - 1].value;
    pick(`theme-effect-${choice.key}`, last);
    expect((useThemeStore.getState().themeOptions as Record<string, unknown>)[choice.key]).toBe(
      last
    );

    // An effect from a different theme must not be rendered.
    const other = LIVE_THEMES.find(
      (th) => th.id !== theme!.id && themeOptionGroupsFor(th.id).length > 0
    )!;
    const foreign = themeOptionGroupsFor(other.id).find(
      (g) => !groups.some((own) => own.key === g.key)
    );
    if (foreign) expect(screen.queryByTestId(`theme-effect-${foreign.key}`)).toBeNull();
  });

  it('keeps advanced options collapsed until "more options" is opened', () => {
    render(<ThemeAppearanceControls />);
    expect(screen.queryByTestId('theme-scrim-focus')).toBeNull();
    fireEvent.click(screen.getByTestId('theme-more-options'));
    fireEvent.click(screen.getByTestId('theme-scrim-focus'));
    fireEvent.click(screen.getByTestId('theme-speed-dynamic'));
    fireEvent.click(screen.getByTestId('theme-surface-monochrome'));
    const s = useThemeStore.getState();
    expect(s.scrimIntensity).toBe('focus');
    expect(s.motionSpeed).toBe('dynamic');
    expect(s.surfaceTone).toBe('monochrome');
  });

  it('turning live animation on overrides the OS reduced-motion request', () => {
    useThemeStore.setState({ prefersReducedMotion: true, liveMotion: false });
    render(<ThemeAppearanceControls />);
    const toggle = screen.getByTestId('theme-live-animation');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    const s = useThemeStore.getState();
    expect(s.liveMotion).toBe(true);
    expect(s.overrideReducedMotion).toBe(true);
  });

  it('renders the live preview only in the full (Settings) variant', () => {
    const { unmount } = render(<ThemeAppearanceControls variant="full" />);
    expect(screen.getByTestId('theme-live-preview')).toBeTruthy();
    unmount();
    render(<ThemeAppearanceControls variant="compact" />);
    expect(screen.queryByTestId('theme-live-preview')).toBeNull();
    expect(screen.getByTestId('theme-controls-compact')).toBeTruthy();
  });
});
