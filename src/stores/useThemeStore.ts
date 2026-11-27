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
      const validThemes: LiveThemeId[] = LIVE_THEMES.map((t) => t.id);
      const validSpeeds: MotionSpeed[] = ['calm', 'normal', 'dynamic'];
      const validTones: SurfaceTone[] = ['adaptive', 'monochrome'];
      const validScrims: ScrimIntensity[] = ['subtle', 'balanced', 'focus'];
      return {
        // Legacy manual Light/Dark → smart Auto (Light/Dark are no longer separate options).
        themeMode: 'system',
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

/**
 * Smart theme-based Auto (the only colour mode now).
 * বাংলা: প্রতিটা থিম নিজেই ঠিক করে কোন মোডে সবচেয়ে ভালো দেখায় — ডার্ক-থিম → ডার্ক,
 * লাইট-থিম → লাইট, দুই মোডেই ভালো (`both`) → ডিভাইসের (OS) পছন্দ। টেক্সটের রঙ
 * `getThemeChatTokens(theme, scheme)` থেকে সেই অনুযায়ী আপনাআপনি আসে।
 */
export const resolveSmartScheme = (
  liveTheme: LiveThemeId,
  osPrefersDark: boolean
): ResolvedColorScheme => {
  const theme = LIVE_THEMES.find((t) => t.id === liveTheme);
  if (theme?.recommendedScheme === 'dark' || theme?.recommendedScheme === 'light') {
    return theme.recommendedScheme;
  }
  return osPrefersDark ? 'dark' : 'light';
};

/** Theme config fields the user can preview and then Save / Undo. */
const pickPersistable = (s: PersistedThemeConfig): PersistedThemeConfig => ({
  themeMode: 'system',
  liveTheme: s.liveTheme,
  liveMotion: s.liveMotion,
  overrideReducedMotion: s.overrideReducedMotion,
  motionSpeed: s.motionSpeed,
  surfaceTone: s.surfaceTone,
  scrimIntensity: s.scrimIntensity,
  themeOptions: { ...s.themeOptions },
});

export const isThemeConfigEqual = (a: PersistedThemeConfig, b: PersistedThemeConfig): boolean =>
  JSON.stringify(pickPersistable(a)) === JSON.stringify(pickPersistable(b));

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

  /** Snapshot taken when the theme panel opens; non-null = previewing (nothing is saved). */
  previewSnapshot: PersistedThemeConfig | null;
  beginThemePreview: () => void;
  /** Keep the previewed theme (persist + sync). */
  saveThemePreview: () => void;
  /** Throw the preview away and restore the previous theme. */
  undoThemePreview: () => void;

  /** Voice/chat "dark mode"/"light mode": picks a theme that looks best in that mode. */
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
const initialResolved: ResolvedColorScheme = resolveSmartScheme(
  initialConfig.liveTheme,
  initialOsDark
);

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
  // বাংলা: প্রিভিউ চলাকালীন কিছু সেভ হয় না — Save চাপলে তবেই।
  if (s.previewSnapshot) return;
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

  previewSnapshot: null,

  beginThemePreview: () => {
    const state = get();
    if (state.previewSnapshot) return;
    set({ previewSnapshot: pickPersistable(state) });
  },

  saveThemePreview: () => {
    const state = get();
    if (!state.previewSnapshot) return;
    const next = { ...state, previewSnapshot: null };
    set({ previewSnapshot: null });
    persistFromState(next);
  },

  undoThemePreview: () => {
    const state = get();
    const snap = state.previewSnapshot;
    if (!snap) return;
    const resolvedScheme = resolveSmartScheme(snap.liveTheme, state.osPrefersDark);
    applyThemeToDom(resolvedScheme, 'system', snap.liveTheme, true, snap.surfaceTone, {
      motionSpeed: snap.motionSpeed,
      isAnimating: computeIsAnimating(
        snap.liveMotion,
        state.prefersReducedMotion,
        snap.overrideReducedMotion
      ),
    });
    set({
      ...snap,
      themeMode: 'system',
      resolvedScheme,
      accentTokens: getThemeTokens(snap.liveTheme, resolvedScheme),
      previewSnapshot: null,
    });
  },

  setThemeMode: (mode) => {
    // Smart Auto only: "dark"/"light" requests switch to a theme that looks best in
    // that mode (the current theme is kept when it already resolves to it).
    const state = get();
    if (mode === 'system') return;
    if (resolveSmartScheme(state.liveTheme, state.osPrefersDark) === mode) return;
    const match =
      LIVE_THEMES.find((t) => t.recommendedScheme === mode) ||
      LIVE_THEMES.find((t) => resolveSmartScheme(t.id, state.osPrefersDark) === mode);
    if (match) get().setLiveTheme(match.id);
  },

  cycleThemeMode: () => {
    const state = get();
    const current = resolveSmartScheme(state.liveTheme, state.osPrefersDark);
    get().setThemeMode(current === 'dark' ? 'light' : 'dark');
  },

  setLiveTheme: (liveTheme) => {
    const state = get();
    const resolvedScheme = resolveSmartScheme(liveTheme, state.osPrefersDark);
    applyThemeToDom(resolvedScheme, 'system', liveTheme, true, state.surfaceTone, {
      motionSpeed: state.motionSpeed,
      isAnimating: computeIsAnimating(
        state.liveMotion,
        state.prefersReducedMotion,
        state.overrideReducedMotion
      ),
    });
    const nextState = {
      ...state,
      themeMode: 'system' as const,
      liveTheme,
      resolvedScheme,
      accentTokens: getThemeTokens(liveTheme, resolvedScheme),
      lastSyncedAt: Date.now(),
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
    const validThemes: LiveThemeId[] = LIVE_THEMES.map((t) => t.id);
    const validSpeeds: MotionSpeed[] = ['calm', 'normal', 'dynamic'];
    const validTones: SurfaceTone[] = ['adaptive', 'monochrome'];
    const validScrims: ScrimIntensity[] = ['subtle', 'balanced', 'focus'];

    // Legacy remote Light/Dark collapse to smart Auto.
    const themeMode: ThemeMode = 'system';
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

    const resolvedScheme = resolveSmartScheme(liveTheme, state.osPrefersDark);

    const incoming: PersistedThemeConfig = {
      themeMode,
      liveTheme,
      liveMotion,
      overrideReducedMotion,
      motionSpeed,
      surfaceTone,
      scrimIntensity,
      themeOptions,
    };
    if (state.previewSnapshot) {
      // বাংলা: প্রিভিউ চলছে — স্ক্রিন বদলাবো না; Undo করলে এই নতুন সেভ-করা থিমে ফিরবে।
      savePersistedConfig(incoming);
      set({ previewSnapshot: incoming, lastSyncedAt: Date.now() });
      return;
    }

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
    const resolvedScheme = resolveSmartScheme(state.liveTheme, osPrefersDark);

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
