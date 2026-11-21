import { create } from 'zustand';
import { schedulePreferencesPatch } from '../services/userPreferencesSyncBus';
import {
  DEFAULT_THEME_OPTIONS,
  getThemeBackdropConfig,
  getThemeChatTokens,
  getThemeSurfaces,
  getThemeTokens,
  LIVE_THEMES,
  MOTION_SPEED_MULTIPLIER,
  type DomThemeMotionOptions,
  type LiveThemeId,
  type MotionSpeed,
  type ResolvedColorScheme,
  type ScrimIntensity,
  type SurfaceTone,
  type ThemeAccentTokens,
  type ThemeMode,
  type ThemePersistedConfig,
  type ThemeSpecificOptions,
} from '../data/themePresets';

export * from '../data/themePresets';

const THEME_STORAGE_KEY = 'supremeai_studio_theme_v3';

type PersistedThemeConfig = ThemePersistedConfig;

const getInitialOsDark = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const getInitialReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const loadPersistedConfig = (): PersistedThemeConfig => {
  const defaults: PersistedThemeConfig = {
    themeMode: 'system',
    liveTheme: 'alpine-dunes',
    liveMotion: true,
    overrideReducedMotion: true,
    motionSpeed: 'normal',
    surfaceTone: 'adaptive',
    scrimIntensity: 'balanced',
    themeOptions: { ...DEFAULT_THEME_OPTIONS },
  };

  try {
    const raw =
      localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem('supremeai_studio_theme_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      const validModes: ThemeMode[] = ['system', 'light', 'dark'];
      const validThemes: LiveThemeId[] = LIVE_THEMES.map((t) => t.id);
      const validSpeeds: MotionSpeed[] = ['calm', 'normal', 'dynamic'];
      const validTones: SurfaceTone[] = ['adaptive', 'monochrome'];
      const validScrims: ScrimIntensity[] = ['subtle', 'balanced', 'focus'];
      return {
        themeMode: validModes.includes(parsed.themeMode) ? parsed.themeMode : 'system',
        liveTheme: validThemes.includes(parsed.liveTheme) ? parsed.liveTheme : 'alpine-dunes',
        liveMotion: typeof parsed.liveMotion === 'boolean' ? parsed.liveMotion : true,
        overrideReducedMotion:
          typeof parsed.overrideReducedMotion === 'boolean' ? parsed.overrideReducedMotion : true,
        motionSpeed: validSpeeds.includes(parsed.motionSpeed) ? parsed.motionSpeed : 'normal',
        surfaceTone: validTones.includes(parsed.surfaceTone) ? parsed.surfaceTone : 'adaptive',
        scrimIntensity: validScrims.includes(parsed.scrimIntensity)
          ? parsed.scrimIntensity
          : 'balanced',
        themeOptions: {
          ...DEFAULT_THEME_OPTIONS,
          ...(parsed.themeOptions && typeof parsed.themeOptions === 'object'
            ? parsed.themeOptions
            : {}),
        },
      };
    }
  } catch {
    // Ignore storage read failures
  }

  return defaults;
};

const savePersistedConfig = (cfg: PersistedThemeConfig) => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage write failures
  }
};

let themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;



export const applyThemeToDom = (
  resolvedScheme: ResolvedColorScheme,
  themeMode: ThemeMode,
  liveTheme: LiveThemeId,
  animateTransition: boolean = false,
  surfaceTone: SurfaceTone = 'adaptive',
  motionOptions: DomThemeMotionOptions = {}
) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (animateTransition) {
    root.classList.add('theme-transitioning');
    if (themeTransitionTimer) clearTimeout(themeTransitionTimer);
    themeTransitionTimer = setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 520);
  }

  if (resolvedScheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const motionSpeed: MotionSpeed = motionOptions.motionSpeed || 'normal';
  const isAnimating = motionOptions.isAnimating !== false;
  const backdropConfig = getThemeBackdropConfig(liveTheme);
  const speedRatio =
    (MOTION_SPEED_MULTIPLIER[motionSpeed] || 1) * backdropConfig.animationSpeed.canvasSpeed;

  root.style.colorScheme = resolvedScheme;
  root.dataset.themeMode = themeMode;
  root.dataset.liveTheme = liveTheme;
  root.dataset.surfaceTone = surfaceTone;
  root.dataset.aesthetic = backdropConfig.aesthetic;
  root.dataset.motionSpeed = motionSpeed;
  root.dataset.liveMotion = isAnimating ? 'live' : 'paused';

  const tokens = getThemeTokens(liveTheme, resolvedScheme);
  root.style.setProperty('--theme-accent', tokens.accent);
  root.style.setProperty('--theme-accent-hover', tokens.accentHover);
  root.style.setProperty('--theme-accent-soft', tokens.accentSoft);
  root.style.setProperty('--theme-accent-ring', tokens.accentRing);
  root.style.setProperty('--theme-accent-contrast', tokens.accentContrast);
  root.style.setProperty('--theme-accent-gradient', tokens.accentGradient);
  root.style.setProperty('--theme-accent-secondary', tokens.accentSecondary);

  const surfaces = getThemeSurfaces(liveTheme, resolvedScheme, surfaceTone);
  root.style.setProperty('--theme-surface-glass', surfaces.surfaceGlass);
  root.style.setProperty('--theme-surface-strong', surfaces.surfaceStrong);
  root.style.setProperty('--theme-surface-sidebar', surfaces.surfaceSidebar);
  root.style.setProperty('--theme-surface-input', surfaces.surfaceInput);
  root.style.setProperty('--theme-surface-border', surfaces.surfaceBorder);
  root.style.setProperty('--theme-scrim-overlay', surfaces.scrimOverlay);
  root.style.setProperty('--theme-card-shadow', surfaces.cardShadow);

  const chatTokens = getThemeChatTokens(liveTheme, resolvedScheme);
  root.style.setProperty('--theme-chat-text', chatTokens.textPrimary);
  root.style.setProperty('--theme-chat-text-secondary', chatTokens.textSecondary);
  root.style.setProperty('--theme-chat-text-muted', chatTokens.textMuted);
  root.style.setProperty('--theme-chat-text-shadow', chatTokens.textShadow);
  root.style.setProperty('--theme-chat-user-bg', chatTokens.userBg);
  root.style.setProperty('--theme-chat-user-border', chatTokens.userBorder);
  root.style.setProperty('--theme-chat-inline-code-bg', chatTokens.inlineCodeBg);
  root.style.setProperty('--theme-chat-inline-code-text', chatTokens.inlineCodeText);
  root.style.setProperty('--theme-chat-blockquote-bg', chatTokens.blockquoteBg);
  root.style.setProperty('--theme-chat-table-header-bg', chatTokens.tableHeaderBg);
  root.style.setProperty('--theme-chat-hover-bg', chatTokens.hoverBg);

  // Inject backdrop gradients & animation speeds directly onto :root
  root.style.setProperty('--theme-backdrop-base', backdropConfig.baseGradient[resolvedScheme]);
  root.style.setProperty(
    '--theme-backdrop-radials',
    backdropConfig.radialOverlays[resolvedScheme].join(', ') || 'none'
  );
  root.style.setProperty('--theme-backdrop-vignette', backdropConfig.vignette[resolvedScheme]);
  root.style.setProperty('--theme-motion-speed', speedRatio.toFixed(3));
  root.style.setProperty(
    '--theme-gradient-duration',
    `${(backdropConfig.animationSpeed.gradientDurationSec / speedRatio).toFixed(2)}s`
  );
  root.style.setProperty(
    '--theme-grid-duration',
    `${(backdropConfig.animationSpeed.gridDurationSec / speedRatio).toFixed(2)}s`
  );
  root.style.setProperty(
    '--theme-aurora-duration',
    `${Math.max(4, (backdropConfig.animationSpeed.gradientDurationSec * 0.9) / speedRatio).toFixed(2)}s`
  );
};

interface ThemeStoreState {
  themeMode: ThemeMode;
  osPrefersDark: boolean;
  resolvedScheme: ResolvedColorScheme;
  liveTheme: LiveThemeId;
  liveMotion: boolean;
  overrideReducedMotion: boolean;
  motionSpeed: MotionSpeed;
  surfaceTone: SurfaceTone;
  scrimIntensity: ScrimIntensity;
  themeOptions: ThemeSpecificOptions;
  prefersReducedMotion: boolean;
  lastSyncedAt: number | null;
  accentTokens: ThemeAccentTokens;

  setThemeMode: (mode: ThemeMode) => void;
  cycleThemeMode: () => void;
  setLiveTheme: (theme: LiveThemeId) => void;
  setLiveMotion: (enabled: boolean) => void;
  setOverrideReducedMotion: (override: boolean) => void;
  setMotionSpeed: (speed: MotionSpeed) => void;
  setSurfaceTone: (tone: SurfaceTone) => void;
  setScrimIntensity: (intensity: ScrimIntensity) => void;
  updateThemeOptions: (partial: Partial<ThemeSpecificOptions>) => void;
  applyRemoteThemeConfig: (remote: Partial<ThemePersistedConfig>) => void;
  setOsPrefersDark: (prefersDark: boolean, animate?: boolean) => void;
  setPrefersReducedMotion: (reduced: boolean) => void;
}

const initialConfig = loadPersistedConfig();
const initialOsDark = getInitialOsDark();
const initialReducedMotion = getInitialReducedMotion();
const initialResolved: ResolvedColorScheme =
  initialConfig.themeMode === 'system'
    ? initialOsDark
      ? 'dark'
      : 'light'
    : initialConfig.themeMode;

applyThemeToDom(
  initialResolved,
  initialConfig.themeMode,
  initialConfig.liveTheme,
  false,
  initialConfig.surfaceTone,
  {
    motionSpeed: initialConfig.motionSpeed,
    isAnimating:
      initialConfig.liveMotion && (!initialReducedMotion || initialConfig.overrideReducedMotion),
  }
);

const persistFromState = (s: ThemeStoreState) => {
  const payload: PersistedThemeConfig = {
    themeMode: s.themeMode,
    liveTheme: s.liveTheme,
    liveMotion: s.liveMotion,
    overrideReducedMotion: s.overrideReducedMotion,
    motionSpeed: s.motionSpeed,
    surfaceTone: s.surfaceTone,
    scrimIntensity: s.scrimIntensity,
    themeOptions: s.themeOptions,
  };
  savePersistedConfig(payload);
  schedulePreferencesPatch({ theme_config: payload });
};

const computeIsAnimating = (
  liveMotion: boolean,
  prefersReducedMotion: boolean,
  overrideReducedMotion: boolean
) => liveMotion && (!prefersReducedMotion || overrideReducedMotion);

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  themeMode: initialConfig.themeMode,
  osPrefersDark: initialOsDark,
  resolvedScheme: initialResolved,
  liveTheme: initialConfig.liveTheme,
  liveMotion: initialConfig.liveMotion,
  overrideReducedMotion: initialConfig.overrideReducedMotion,
  motionSpeed: initialConfig.motionSpeed,
  surfaceTone: initialConfig.surfaceTone,
  scrimIntensity: initialConfig.scrimIntensity,
  themeOptions: initialConfig.themeOptions,
  prefersReducedMotion: initialReducedMotion,
  lastSyncedAt: Date.now(),
  accentTokens: getThemeTokens(initialConfig.liveTheme, initialResolved),

  setThemeMode: (themeMode) => {
    const state = get();
    const resolvedScheme: ResolvedColorScheme =
      themeMode === 'system' ? (state.osPrefersDark ? 'dark' : 'light') : themeMode;

    applyThemeToDom(resolvedScheme, themeMode, state.liveTheme, true, state.surfaceTone, {
      motionSpeed: state.motionSpeed,
      isAnimating: computeIsAnimating(
        state.liveMotion,
        state.prefersReducedMotion,
        state.overrideReducedMotion
      ),
    });
    const nextState = {
      ...state,
      themeMode,
      resolvedScheme,
      accentTokens: getThemeTokens(state.liveTheme, resolvedScheme),
      lastSyncedAt: Date.now(),
    };
    persistFromState(nextState);
    set(nextState);
  },

  cycleThemeMode: () => {
    const current = get().themeMode;
    const nextOrder: Record<ThemeMode, ThemeMode> = {
      system: 'light',
      light: 'dark',
      dark: 'system',
    };
    get().setThemeMode(nextOrder[current]);
  },

  setLiveTheme: (liveTheme) => {
    const state = get();
    applyThemeToDom(state.resolvedScheme, state.themeMode, liveTheme, true, state.surfaceTone, {
      motionSpeed: state.motionSpeed,
      isAnimating: computeIsAnimating(
        state.liveMotion,
        state.prefersReducedMotion,
        state.overrideReducedMotion
      ),
    });
    const nextState = {
      ...state,
      liveTheme,
      accentTokens: getThemeTokens(liveTheme, state.resolvedScheme),
    };
    persistFromState(nextState);
    set(nextState);
  },

  setLiveMotion: (liveMotion) => {
    const state = get();
    applyThemeToDom(
      state.resolvedScheme,
      state.themeMode,
      state.liveTheme,
      false,
      state.surfaceTone,
      {
        motionSpeed: state.motionSpeed,
        isAnimating: computeIsAnimating(
          liveMotion,
          state.prefersReducedMotion,
          state.overrideReducedMotion
        ),
      }
    );
    const nextState = { ...state, liveMotion };
    persistFromState(nextState);
    set({ liveMotion });
  },

  setOverrideReducedMotion: (overrideReducedMotion) => {
    const state = get();
    applyThemeToDom(
      state.resolvedScheme,
      state.themeMode,
      state.liveTheme,
      false,
      state.surfaceTone,
      {
        motionSpeed: state.motionSpeed,
        isAnimating: computeIsAnimating(
          state.liveMotion,
          state.prefersReducedMotion,
          overrideReducedMotion
        ),
      }
    );
    const nextState = { ...state, overrideReducedMotion };
    persistFromState(nextState);
    set({ overrideReducedMotion });
  },

  setMotionSpeed: (motionSpeed) => {
    const state = get();
    applyThemeToDom(
      state.resolvedScheme,
      state.themeMode,
      state.liveTheme,
      false,
      state.surfaceTone,
      {
        motionSpeed,
        isAnimating: computeIsAnimating(
          state.liveMotion,
          state.prefersReducedMotion,
          state.overrideReducedMotion
        ),
      }
    );
    const nextState = { ...state, motionSpeed };
    persistFromState(nextState);
    set({ motionSpeed });
  },

  setSurfaceTone: (surfaceTone) => {
    const state = get();
    applyThemeToDom(state.resolvedScheme, state.themeMode, state.liveTheme, true, surfaceTone, {
      motionSpeed: state.motionSpeed,
      isAnimating: computeIsAnimating(
        state.liveMotion,
        state.prefersReducedMotion,
        state.overrideReducedMotion
      ),
    });
    const nextState = { ...state, surfaceTone };
    persistFromState(nextState);
    set({ surfaceTone });
  },

  setScrimIntensity: (scrimIntensity) => {
    const state = get();
    const nextState = { ...state, scrimIntensity };
    persistFromState(nextState);
    set({ scrimIntensity });
  },

  updateThemeOptions: (partial) => {
    const state = get();
    const themeOptions = { ...state.themeOptions, ...partial };
    const nextState = { ...state, themeOptions };
    persistFromState(nextState);
    set({ themeOptions });
  },

  applyRemoteThemeConfig: (remote) => {
    if (!remote || typeof remote !== 'object') return;
    const state = get();
    const validModes: ThemeMode[] = ['system', 'light', 'dark'];
    const validThemes: LiveThemeId[] = LIVE_THEMES.map((t) => t.id);
    const validSpeeds: MotionSpeed[] = ['calm', 'normal', 'dynamic'];
    const validTones: SurfaceTone[] = ['adaptive', 'monochrome'];
    const validScrims: ScrimIntensity[] = ['subtle', 'balanced', 'focus'];

    const themeMode =
      remote.themeMode && validModes.includes(remote.themeMode)
        ? remote.themeMode
        : state.themeMode;
    const liveTheme =
      remote.liveTheme && validThemes.includes(remote.liveTheme)
        ? remote.liveTheme
        : state.liveTheme;
    const liveMotion =
      typeof remote.liveMotion === 'boolean' ? remote.liveMotion : state.liveMotion;
    const overrideReducedMotion =
      typeof remote.overrideReducedMotion === 'boolean'
        ? remote.overrideReducedMotion
        : state.overrideReducedMotion;
    const motionSpeed =
      remote.motionSpeed && validSpeeds.includes(remote.motionSpeed)
        ? remote.motionSpeed
        : state.motionSpeed;
    const surfaceTone =
      remote.surfaceTone && validTones.includes(remote.surfaceTone)
        ? remote.surfaceTone
        : state.surfaceTone;
    const scrimIntensity =
      remote.scrimIntensity && validScrims.includes(remote.scrimIntensity)
        ? remote.scrimIntensity
        : state.scrimIntensity;
    const themeOptions: ThemeSpecificOptions = {
      ...state.themeOptions,
      ...(remote.themeOptions && typeof remote.themeOptions === 'object'
        ? remote.themeOptions
        : {}),
    };

    const resolvedScheme: ResolvedColorScheme =
      themeMode === 'system' ? (state.osPrefersDark ? 'dark' : 'light') : themeMode;

    applyThemeToDom(resolvedScheme, themeMode, liveTheme, true, surfaceTone, {
      motionSpeed,
      isAnimating: computeIsAnimating(
        liveMotion,
        state.prefersReducedMotion,
        overrideReducedMotion
      ),
    });

    const payload: PersistedThemeConfig = {
      themeMode,
      liveTheme,
      liveMotion,
      overrideReducedMotion,
      motionSpeed,
      surfaceTone,
      scrimIntensity,
      themeOptions,
    };
    savePersistedConfig(payload);
    set({
      ...payload,
      resolvedScheme,
      accentTokens: getThemeTokens(liveTheme, resolvedScheme),
      lastSyncedAt: Date.now(),
    });
  },

  setOsPrefersDark: (osPrefersDark, animate = true) => {
    const state = get();
    const resolvedScheme: ResolvedColorScheme =
      state.themeMode === 'system' ? (osPrefersDark ? 'dark' : 'light') : state.themeMode;

    applyThemeToDom(resolvedScheme, state.themeMode, state.liveTheme, animate, state.surfaceTone, {
      motionSpeed: state.motionSpeed,
      isAnimating: computeIsAnimating(
        state.liveMotion,
        state.prefersReducedMotion,
        state.overrideReducedMotion
      ),
    });
    set({
      osPrefersDark,
      resolvedScheme,
      accentTokens: getThemeTokens(state.liveTheme, resolvedScheme),
      lastSyncedAt: Date.now(),
    });
  },

  setPrefersReducedMotion: (prefersReducedMotion) => {
    const state = get();
    applyThemeToDom(
      state.resolvedScheme,
      state.themeMode,
      state.liveTheme,
      false,
      state.surfaceTone,
      {
        motionSpeed: state.motionSpeed,
        isAnimating: computeIsAnimating(
          state.liveMotion,
          prefersReducedMotion,
          state.overrideReducedMotion
        ),
      }
    );
    set({ prefersReducedMotion });
  },
}));
