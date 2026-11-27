import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_OPTIONS,
  LIVE_THEMES,
  resolveSmartScheme,
  useThemeStore,
} from './useThemeStore';

const DARK = LIVE_THEMES.find((t) => t.recommendedScheme === 'dark')!;
const LIGHT = LIVE_THEMES.find((t) => t.recommendedScheme === 'light')!;
const BOTH = LIVE_THEMES.find((t) => t.recommendedScheme === 'both')!;

describe('smart theme-based Auto', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({
      themeMode: 'system',
      osPrefersDark: false,
      liveTheme: BOTH.id,
      resolvedScheme: 'light',
      themeOptions: { ...DEFAULT_THEME_OPTIONS },
      previewSnapshot: null,
    });
  });
  afterEach(() => useThemeStore.setState({ previewSnapshot: null }));

  it('dark/light themes use their best mode; "both" themes follow the OS', () => {
    expect(resolveSmartScheme(DARK.id, false)).toBe('dark');
    expect(resolveSmartScheme(LIGHT.id, true)).toBe('light');
    expect(resolveSmartScheme(BOTH.id, true)).toBe('dark');
    expect(resolveSmartScheme(BOTH.id, false)).toBe('light');
  });

  it('switching theme switches the mode and the dark class automatically', () => {
    useThemeStore.getState().setLiveTheme(DARK.id);
    expect(useThemeStore.getState().resolvedScheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    useThemeStore.getState().setLiveTheme(LIGHT.id);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('OS changes only move "both" themes', () => {
    useThemeStore.getState().setLiveTheme(LIGHT.id);
    useThemeStore.getState().setOsPrefersDark(true, false);
    expect(useThemeStore.getState().resolvedScheme).toBe('light');
    useThemeStore.getState().setLiveTheme(BOTH.id);
    expect(useThemeStore.getState().resolvedScheme).toBe('dark');
  });

  it('legacy remote "dark" mode collapses to Auto', () => {
    useThemeStore.getState().applyRemoteThemeConfig({ themeMode: 'dark', liveTheme: LIGHT.id });
    expect(useThemeStore.getState().themeMode).toBe('system');
    expect(useThemeStore.getState().resolvedScheme).toBe('light');
  });

  it('voice "dark mode" picks a theme that looks best in dark', () => {
    useThemeStore.getState().setLiveTheme(LIGHT.id);
    useThemeStore.getState().setThemeMode('dark');
    expect(useThemeStore.getState().resolvedScheme).toBe('dark');
  });

  it('remote sync during a preview updates the Undo target, not the screen', () => {
    useThemeStore.getState().beginThemePreview();
    useThemeStore.getState().setLiveTheme(DARK.id);
    useThemeStore.getState().applyRemoteThemeConfig({ liveTheme: LIGHT.id });
    expect(useThemeStore.getState().liveTheme).toBe(DARK.id);
    useThemeStore.getState().undoThemePreview();
    expect(useThemeStore.getState().liveTheme).toBe(LIGHT.id);
  });
});
