import React, { useEffect, useRef, useState } from 'react';
import {
  User,
  Check,
  Save,
  Gauge,
  Sparkles,
  ArrowRight,
  Sun,
  Moon,
  Monitor,
  Palette,
  Play,
  Pause,
  Columns3,
  Maximize2,
  Minimize2,
  Terminal,
  MessageSquareCode,
  Code2,
  Database,
  Lightbulb,
  AudioLines,
  SlidersHorizontal,
  Upload,
  Trash2,
  Volume2,
  Loader2,
  ShieldCheck,
  AlertCircle,
  Globe,
  RotateCcw,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLanguage, UserAccountSettings, UserRole, WorkspaceContentLayout } from '../../types';
import { APP_LANGUAGE_OPTIONS, TranslationKeys, useI18n } from '../../utils/i18n';
import { AccountSettingsPanel } from './settings/AccountSettingsPanel';
import { PersonalMcpHubCard } from './PersonalMcpHubCard';
import { SUPREMEAI_MODELS } from '../../data/models';
import {
  useThemeStore,
  LIVE_THEMES,
  ThemeMode,
  LiveThemeId,
  SurfaceTone,
  MotionSpeed,
  ScrimIntensity,
} from '../../stores/useThemeStore';
import { useChatStore } from '../../stores/useChatStore';
import { useAppPreferencesStore } from '../../stores/useAppPreferencesStore';
import { toast } from '../../stores/useToastStore';
import { LIVE_VOICE_OPTIONS, LiveVoiceName } from '../../hooks/useLiveVoiceSession';
import { LiveVoiceAvatarCanvas } from '../chat/LiveVoiceAvatarCanvas';
import {
  AVATAR_PRESETS,
  AvatarPreference,
  loadAvatarPreference,
  saveAvatarPreference,
  resolveAvatarSource,
  processCustomFaceUpload,
  saveVoicePreference,
  VOICE_AVATAR_SYNC_EVENT,
} from '../../utils/hologramAvatar';
import {
  type BanglaAccentId,
  clampVoicePitch,
  DEFAULT_VOICE_PITCH,
  MAX_VOICE_PITCH,
  MIN_VOICE_PITCH,
} from '../../utils/speechUtils';
import { ttsService, type TtsServiceConfig } from '../../services/ttsService';
import {
  connectGitOAuthPopup,
  fetchGitOAuthStatus,
  GitOAuthStatus,
  GitProvider,
  loadGitTokens,
} from '../../services/gitExportService';

export type SettingsSubTab = 'general' | 'appearance' | 'voice-avatar' | 'account';

interface UserSettingsViewProps {
  settings: UserAccountSettings;
  onUpdateSettings: (newSettings: Partial<UserAccountSettings>) => void;
  onSwitchRole?: (newRole: UserRole) => void;
  currentRole?: UserRole;
  isAdminEligible?: boolean;
  onOpenAdminConsole?: () => void;
  isDeveloperEligible?: boolean;
  effectiveDeveloperMode?: boolean;
  onToggleDeveloperMode?: () => void;
  onToggleDeveloperEligibility?: (eligible: boolean) => void;
  trustedUntil?: number | null;
  onRevokeTrustedBrowser?: () => void;
  onSignOut?: () => void;
  onOpenFeedbackSurvey?: () => void;
  onOpenKnowledgeBase?: () => void;
  initialSubTab?: SettingsSubTab;
  subTabRequestKey?: number;
  onOpenLiveVoice?: () => void;
  onPreviewVoice?: (sampleText?: string) => void;
}

const SETTINGS_TABS: Array<{
  id: SettingsSubTab;
  labelKey: TranslationKeys;
  icon: React.ReactNode;
}> = [
  { id: 'general', labelKey: 'tabGeneral', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  { id: 'appearance', labelKey: 'tabAppearance', icon: <Palette className="w-3.5 h-3.5" /> },
  { id: 'voice-avatar', labelKey: 'tabVoiceAvatar', icon: <AudioLines className="w-3.5 h-3.5" /> },
  { id: 'account', labelKey: 'tabAccount', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
];

export const UserSettingsView: React.FC<UserSettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onSwitchRole,
  currentRole: currentRoleProp,
  isAdminEligible = false,
  onOpenAdminConsole,
  isDeveloperEligible = false,
  effectiveDeveloperMode,
  onToggleDeveloperMode,
  onToggleDeveloperEligibility,
  trustedUntil = null,
  onRevokeTrustedBrowser,
  onOpenFeedbackSurvey,
  onSignOut,
  onOpenKnowledgeBase,
  initialSubTab = 'general',
  subTabRequestKey = 0,
  onOpenLiveVoice,
  onPreviewVoice,
}) => {
  const [gitTokensState, setGitTokensState] = useState(() => loadGitTokens());
  const [gitOAuthConnecting, setGitOAuthConnecting] = useState<GitProvider | null>(null);
  const [gitOAuthStatus, setGitOAuthStatus] = useState<GitOAuthStatus | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>(initialSubTab);

  useEffect(() => {
    setActiveSubTab(initialSubTab);
  }, [initialSubTab, subTabRequestKey]);

  useEffect(() => {
    if (activeSubTab !== 'account') return;
    void fetchGitOAuthStatus().then((status) => setGitOAuthStatus(status));
  }, [activeSubTab]);

  const handleSettingsGitOAuthConnect = async (provider: GitProvider) => {
    setGitOAuthConnecting(provider);
    try {
      const res = await connectGitOAuthPopup(
        provider,
        provider === 'gitlab' ? gitTokensState.gitlabHost : undefined
      );
      setGitTokensState((prev) => ({
        ...prev,
        ...(provider === 'github'
          ? { githubToken: res.token }
          : { gitlabToken: res.token, ...(res.host ? { gitlabHost: res.host } : {}) }),
      }));
      toast.success(
        provider === 'github' ? t.gitProviderGithub : t.gitProviderGitlab,
        t.gitOAuthConnected
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'OAuth connection failed.';
      toast.error(provider === 'github' ? t.gitProviderGithub : t.gitProviderGitlab, msg);
    } finally {
      setGitOAuthConnecting(null);
    }
  };

  const [name, setName] = useState(settings.name);
  const [email, setEmail] = useState(settings.email);
  const [showWorkspaceTips, setShowWorkspaceTips] = useState(settings.showWorkspaceTips !== false);
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [autoModelRouting, setAutoModelRouting] = useState(settings.autoModelRouting !== false);
  const [customInstructions, setCustomInstructions] = useState(settings.customInstructions || '');
  const [contentLayout, setContentLayout] = useState<WorkspaceContentLayout>(
    settings.contentLayout || 'fluid'
  );
  const [savedSuccess, setSavedSuccess] = useState(false);
  const language = useAppPreferencesStore((s) => s.language);
  const setCentralizedLanguage = useAppPreferencesStore((s) => s.setLanguage);
  const centralizedRole = useAppPreferencesStore((s) => s.role);
  const setCentralizedRole = useAppPreferencesStore((s) => s.setRole);
  const currentRole = currentRoleProp ?? centralizedRole;
  const handleSwitchRole = onSwitchRole ?? setCentralizedRole;
  const { t } = useI18n();

  // Voice & 3D Hologram Avatar state (synced live with global ttsService & LiveVoicePanel)
  const [ttsConfig, setTtsConfig] = useState<TtsServiceConfig>(() => ttsService.getConfig());
  const [avatarPref, setAvatarPref] = useState<AvatarPreference>(() => loadAvatarPreference());
  const [voiceName, setVoiceName] = useState<LiveVoiceName>(
    () => ttsService.getConfig().voicePersona
  );
  const [voicePitch, setVoicePitch] = useState<number>(() => ttsService.getConfig().pitch);
  const [banglaAccent, setBanglaAccent] = useState<BanglaAccentId>(
    () => ttsService.getConfig().banglaAccent
  );
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isPreviewPulsing, setIsPreviewPulsing] = useState(false);
  const [outgoingPreviewSrc, setOutgoingPreviewSrc] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewLevelsRef = useRef({ input: 0, output: 0 });
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAvatarSrcRef = useRef<string | null>(null);
  const crossFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setName(settings.name);
    setEmail(settings.email);
    setShowWorkspaceTips(settings.showWorkspaceTips !== false);
    setDefaultModel(settings.defaultModel);
    setAutoModelRouting(settings.autoModelRouting !== false);
    setCustomInstructions(settings.customInstructions || '');
    setContentLayout(settings.contentLayout || 'fluid');
  }, [settings]);

  useEffect(() => {
    const unsubscribeTts = ttsService.subscribe((nextCfg) => {
      setTtsConfig(nextCfg);
      setVoiceName(nextCfg.voicePersona);
      setVoicePitch(nextCfg.pitch);
      setBanglaAccent(nextCfg.banglaAccent);
    });
    const handleSync = () => {
      setAvatarPref(loadAvatarPreference());
      const latestCfg = ttsService.getConfig();
      setTtsConfig(latestCfg);
      setVoiceName(latestCfg.voicePersona);
      setVoicePitch(latestCfg.pitch);
      setBanglaAccent(latestCfg.banglaAccent);
    };
    window.addEventListener(VOICE_AVATAR_SYNC_EVENT, handleSync);
    return () => {
      unsubscribeTts();
      window.removeEventListener(VOICE_AVATAR_SYNC_EVENT, handleSync);
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
      if (crossFadeTimeoutRef.current) clearTimeout(crossFadeTimeoutRef.current);
    };
  }, []);

  const devModeActive =
    effectiveDeveloperMode !== undefined
      ? effectiveDeveloperMode
      : Boolean(settings.developerMode && (isDeveloperEligible || currentRole === 'admin'));

  const setChatCustomInstruction = useChatStore((s) => s.setCustomInstruction);
  const setIsRoleModalOpen = useChatStore((s) => s.setIsRoleModalOpen);
  const activeRole = useChatStore((s) => s.activeRole);

  const themeMode = useThemeStore((s) => s.themeMode);
  const osPrefersDark = useThemeStore((s) => s.osPrefersDark);
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

  const isAnimating = liveMotion && (!prefersReducedMotion || overrideReducedMotion);
  const activeThemeMeta = LIVE_THEMES.find((t) => t.id === liveTheme) || LIVE_THEMES[0];
  const activeAvatarSource = resolveAvatarSource(avatarPref);

  useEffect(() => {
    if (lastAvatarSrcRef.current && lastAvatarSrcRef.current !== activeAvatarSource.src) {
      setOutgoingPreviewSrc(lastAvatarSrcRef.current);
      if (crossFadeTimeoutRef.current) clearTimeout(crossFadeTimeoutRef.current);
      crossFadeTimeoutRef.current = setTimeout(() => {
        setOutgoingPreviewSrc(null);
      }, 420);
    }
    lastAvatarSrcRef.current = activeAvatarSource.src;
  }, [activeAvatarSource.src]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const matchedModel = SUPREMEAI_MODELS.find((m) => m.id === defaultModel);
    if (matchedModel) {
      useChatStore.getState().selectModel(matchedModel);
    }
    onUpdateSettings({
      name,
      email,
      streamResponses: settings.streamResponses ?? true,
      enableKnowledgeGrounding: settings.enableKnowledgeGrounding ?? true,
      showWorkspaceTips,
      defaultModel,
      autoModelRouting,
      language,
      contentLayout,
      customInstructions,
    });
    setChatCustomInstruction(customInstructions);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleSelectLanguage = (nextLang: AppLanguage) => {
    setCentralizedLanguage(nextLang);
    setTtsConfig(ttsService.getConfig());
  };

  const triggerPreviewPulse = () => {
    if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
    setIsPreviewPulsing(true);
    const start = performance.now();
    const duration = 2600;
    pulseTimerRef.current = setInterval(() => {
      const elapsedSec = (performance.now() - start) / 1000;
      if (elapsedSec * 1000 >= duration) {
        if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
        pulseTimerRef.current = null;
        previewLevelsRef.current.output = 0;
        setIsPreviewPulsing(false);
        return;
      }
      // Natural varying speech amplitude curve so lips, jaw, teeth & brows animate realistically
      const phrase =
        0.48 +
        0.28 * Math.sin(elapsedSec * 11.2) +
        0.18 * Math.cos(elapsedSec * 19.5) +
        0.1 * Math.sin(elapsedSec * 5.0);
      previewLevelsRef.current.output = Math.max(0.18, Math.min(0.95, phrase));
    }, 40);
  };

  const handleSelectPresetAvatar = (presetId: 'female' | 'male') => {
    const next: AvatarPreference = {
      ...avatarPref,
      preset: presetId,
    };
    setAvatarPref(next);
    setAvatarError(null);
    saveAvatarPreference(next);
  };

  const handleSelectCustomAvatar = () => {
    if (!avatarPref.customImageDataUrl) {
      avatarFileInputRef.current?.click();
      return;
    }
    const next: AvatarPreference = {
      ...avatarPref,
      preset: 'custom',
    };
    setAvatarPref(next);
    setAvatarError(null);
    saveAvatarPreference(next);
  };

  const handleAvatarUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsProcessingAvatar(true);
    setAvatarError(null);
    try {
      const { dataUrl, traits } = await processCustomFaceUpload(file);
      const next: AvatarPreference = {
        preset: 'custom',
        customImageDataUrl: dataUrl,
        customImageName: file.name,
        customTraits: traits,
      };
      setAvatarPref(next);
      saveAvatarPreference(next);
      triggerPreviewPulse();
      toast.success(
        'Face Verified & Matched',
        'Detected your face, extracted skin & hair tones, and mapped it onto your 3D avatar.'
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No human face could be detected. Please upload a clear portrait.';
      setAvatarError(msg);
      toast.error('Face Not Detected', msg);
    } finally {
      setIsProcessingAvatar(false);
    }
  };

  const handleClearCustomAvatar = () => {
    const next: AvatarPreference = {
      preset: avatarPref.preset === 'male' ? 'male' : 'female',
      customImageDataUrl: null,
      customImageName: undefined,
    };
    setAvatarPref(next);
    setAvatarError(null);
    saveAvatarPreference(next);
    toast.info('Custom Photo Removed', 'Switched back to preset 3D hologram avatar.');
  };

  const handleSelectVoice = (voice: LiveVoiceName) => {
    setVoiceName(voice);
    saveVoicePreference(voice);
    setTtsConfig(ttsService.setVoicePersona(voice));
    triggerPreviewPulse();
  };

  const handleChangeVoicePitch = (nextVal: number) => {
    const safe = clampVoicePitch(nextVal);
    setVoicePitch(safe);
    setTtsConfig(ttsService.setPitch(safe));
  };

  const handleSelectBanglaAccent = (nextAccent: BanglaAccentId) => {
    setBanglaAccent(nextAccent);
    setTtsConfig(ttsService.setBanglaAccent(nextAccent));
    triggerPreviewPulse();
  };

  const handlePreviewVoiceSample = (forceBangla: boolean = false) => {
    triggerPreviewPulse();
    if (!onPreviewVoice) return;
    const sample = ttsService.getSamplePhrase(forceBangla ? 'bn' : language);
    onPreviewVoice(sample);
  };

  const usagePercent = Math.min(
    100,
    Math.round((settings.monthlyTokensUsed / Math.max(1, settings.monthlyTokensLimit)) * 100)
  );
  const userInitial = (settings.name || name || 'U').trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 workspace-container space-y-6 text-slate-800 dark:text-slate-200">
      {/* Header & Clean Sub-Tab Navigation */}
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-4 space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.settingsTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {devModeActive ? t.settingsSubtitleDev : t.settingsSubtitleUser}
          </p>
        </div>

        <nav
          aria-label="Settings sections"
          className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1"
        >
          {SETTINGS_TABS.map((tab) => {
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                    : 'border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <span className={active ? 'theme-accent-text' : 'text-slate-400'}>{tab.icon}</span>
                <span>{t[tab.labelKey]}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ============================================================
          SUB-TAB 1: GENERAL
      ============================================================ */}
      {activeSubTab === 'general' && (
        <div className="space-y-6">
          {/* Role Workspace Switcher Card - Only visible when Admin User ID is matched */}
          {Boolean(isAdminEligible) && (
            <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-50/80 to-indigo-50/80 dark:from-slate-900 dark:to-slate-900/90 border border-blue-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                    {t.activeWorkspaceLabel}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {currentRole === 'admin' ? t.adminStudio : t.customerWorkspaceLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {currentRole === 'admin' ? t.adminModeSummary : t.customerModeSummary}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {currentRole === 'admin' && onOpenAdminConsole && (
                  <button
                    type="button"
                    onClick={onOpenAdminConsole}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-blue-300 dark:border-blue-700/70 bg-white/80 dark:bg-slate-800 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:border-blue-500 transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{t.opsConsoleTitle}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSwitchRole(currentRole === 'admin' ? 'user' : 'admin')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                >
                  <span>
                    {currentRole === 'admin' ? t.switchToUserViewBtn : t.switchToAdminStudio}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Profile + Usage Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-4 shadow-xs">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                <span>{t.profileInfoTitle}</span>
              </h2>

              <div className="flex items-center gap-4 pt-1">
                <div className="w-12 h-12 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-base font-bold flex items-center justify-center shrink-0 shadow-xs">
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span className="truncate">{settings.name}</span>
                    <span aria-hidden="true" className="text-slate-400">
                      ·
                    </span>
                    <span className="text-xs font-medium theme-accent-text shrink-0">
                      {settings.plan} {t.planBadgeSuffix}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 truncate">
                    {settings.email}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-slate-500" />
                  <span>
                    {devModeActive ? t.monthlyTokenQuotaTitle : t.monthlyUsageAllowanceTitle}
                  </span>
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {settings.monthlyTokensUsed.toLocaleString()} /{' '}
                  {settings.monthlyTokensLimit.toLocaleString()}{' '}
                  {devModeActive ? t.tokensWord : t.creditsWord}
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                <span>
                  {usagePercent}% {t.utilizedLabel}
                </span>
                <span>{t.resetsMonthlyLabel}</span>
              </div>
            </div>
          </div>

          {/* Preferences, Custom Instructions & Workspace Form */}
          <form
            onSubmit={handleSave}
            className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-5 shadow-xs"
          >
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-slate-500" />
              <span>{t.preferencesAiModeTitle}</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t.authFullNameLabel}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t.authWorkEmailLabel}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            {/* Unified Language Preference (Interface + Chat/Research + Global TTS) */}
            <div
              data-testid="unified-language-card"
              className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 theme-accent-text" />
                    <span>{t.languageCardTitle}</span>
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {t.languageCardSubtitle}
                  </p>
                </div>
                {onPreviewVoice && (
                  <button
                    type="button"
                    data-testid="preview-language-tts-btn"
                    onClick={() => handlePreviewVoiceSample(false)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-[var(--theme-accent)] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Volume2 className="w-3.5 h-3.5 theme-accent-text" />
                    <span>{t.previewLangVoiceBtn}</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {APP_LANGUAGE_OPTIONS.map((opt) => {
                  const active = language === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`lang-option-${opt.id}`}
                      onClick={() => handleSelectLanguage(opt.id)}
                      className={`flex items-start justify-between gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        active
                          ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{opt.nativeLabel}</span>
                          <span className="text-[10px] font-mono text-slate-400">{opt.label}</span>
                        </div>
                        <p className="text-[11px] opacity-80 mt-0.5">{opt.description}</p>
                      </div>
                      {active && (
                        <Check className="w-3.5 h-3.5 theme-accent-text shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live Propagation Summary across UI, Chat/Research, and Global TTS */}
              <div
                data-testid="unified-language-sync-summary"
                className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2.5 border-t border-slate-200/70 dark:border-slate-700/60 text-[11px]"
              >
                <div className="px-2.5 py-2 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t.langSyncUiLabel}
                  </div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5">
                    {language === 'bn' ? t.langSyncUiValueBn : t.langSyncUiValueEn}
                  </div>
                </div>
                <div className="px-2.5 py-2 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t.langSyncChatLabel}
                  </div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5">
                    {language === 'bn' ? t.langSyncChatValueBn : t.langSyncChatValueEn}
                  </div>
                </div>
                <div className="px-2.5 py-2 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t.langSyncTtsLabel}
                  </div>
                  <div
                    data-testid="settings-global-tts-summary"
                    className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 mt-0.5 truncate"
                    title={`${ttsConfig.locale} · ${ttsConfig.edgeVoice}`}
                  >
                    {ttsConfig.locale} · {ttsConfig.edgeVoice.replace(/Neural$/, '')}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {t.langUnifiedSyncNote}
              </p>
            </div>

            {/* Smart Auto Model Routing + Fallback Model */}
            <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 space-y-3">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 theme-accent-text" />
                      <span>{t.autoModelSettingLabel}</span>
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      {t.autoModelSettingDesc}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoModelRouting}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setAutoModelRouting(next);
                      onUpdateSettings({ autoModelRouting: next });
                    }}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                  />
                </label>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t.defaultModelLabel}
                  </label>
                  <select
                    value={defaultModel}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setDefaultModel(nextId);
                      const matched = SUPREMEAI_MODELS.find((m) => m.id === nextId);
                      if (matched) {
                        useChatStore.getState().selectModel(matched);
                      } else {
                        onUpdateSettings({ defaultModel: nextId });
                      }
                    }}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {SUPREMEAI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.tagline})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

            {/* Custom Instructions & Persona Section */}
            <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/70 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <MessageSquareCode className="w-3.5 h-3.5 theme-accent-text" />
                    <span>{t.customInstructionsTitle}</span>
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {/* বাংলা মন্তব্য: একক স্বয়ংক্রিয় অ্যাসিস্ট্যান্ট নির্দেশনা */}
                    {t.activePersonaLabel}{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      SupremeAI Autonomous Executive
                    </span>
                  </p>
                </div>
              </div>

              <textarea
                rows={3}
                value={customInstructions}
                onChange={(e) => {
                  setCustomInstructions(e.target.value);
                  setChatCustomInstruction(e.target.value);
                }}
                placeholder={
                  devModeActive
                    ? 'Example: Always answer concisely with bullet points. Prefer TypeScript examples over JavaScript.'
                    : 'Example: Always keep answers brief with clear bullet points and simple language.'
                }
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[var(--theme-accent)]"
              />
            </div>

            {devModeActive && (
              <>
                {/* Workspace Content Width Layout Switcher (Compact / Fluid / Maximized) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t.workspaceLayoutTitle}
                    </label>
                    <span className="text-[11px] font-mono text-slate-400">
                      {contentLayout === 'compact'
                        ? '800px focused column'
                        : contentLayout === 'fluid'
                          ? '1088px balanced width'
                          : '100% full-bleed canvas'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      {
                        id: 'compact' as WorkspaceContentLayout,
                        title: 'Compact',
                        desc: 'Narrow reading column for distraction-free focus (~800px).',
                        icon: <Minimize2 className="w-4 h-4" />,
                      },
                      {
                        id: 'fluid' as WorkspaceContentLayout,
                        title: 'Fluid',
                        desc: 'Balanced adaptive container across chats and views (~1088px).',
                        icon: <Columns3 className="w-4 h-4" />,
                      },
                      {
                        id: 'maximized' as WorkspaceContentLayout,
                        title: 'Maximized',
                        desc: 'Edge-to-edge full workspace width for wide monitors (100%).',
                        icon: <Maximize2 className="w-4 h-4" />,
                      },
                    ].map((opt) => {
                      const active = contentLayout === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setContentLayout(opt.id);
                            onUpdateSettings({ contentLayout: opt.id });
                          }}
                          className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div
                            className={`mt-0.5 shrink-0 ${active ? 'theme-accent-text' : 'text-slate-400'}`}
                          >
                            {opt.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold">{opt.title}</div>
                            <div className="text-[11px] opacity-80 mt-0.5">{opt.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Streamlined Preferences (Streaming SSE & Smart RAG are always active automatically) */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">

              {onOpenKnowledgeBase && (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{t.kbAutoRagStatusLabel}</span>
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      {t.kbAutoRagStatusDesc}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenKnowledgeBase()}
                    className="text-[11px] font-medium theme-accent-text hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {t.manageDocsBtn}
                  </button>
                </div>
              )}

              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <div>
                  <span className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t.workspaceTipsSettingLabel}</span>
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                    {t.workspaceTipsSettingDesc}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={showWorkspaceTips}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setShowWorkspaceTips(next);
                    onUpdateSettings({ showWorkspaceTips: next });
                  }}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                />
              </label>

            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              {savedSuccess ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  {t.settingsSavedToast}
                </span>
              ) : (
                <span className="text-xs text-slate-400">{t.preferencesLocalHint}</span>
              )}

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full theme-btn-primary text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{t.savePreferences}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ============================================================
          SUB-TAB 2: APPEARANCE & LIVE BACKDROPS
      ============================================================ */}
      {activeSubTab === 'appearance' && (
        <div className="p-5 rounded-2xl theme-surface-glass border space-y-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Palette className="w-4 h-4 theme-accent-text" />
                <span>{t.appearanceHeaderTitle}</span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {t.appearanceHeaderDesc}
              </p>
            </div>

            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
              OS:{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {osPrefersDark ? t.schemeDarkTitle : t.schemeLightTitle}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t.colorSchemeSyncLabel}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                {
                  id: 'system' as ThemeMode,
                  title: t.schemeAutoTitle,
                  desc: `(${osPrefersDark ? t.schemeDarkTitle : t.schemeLightTitle})`,
                  icon: <Monitor className="w-4 h-4" />,
                },
                {
                  id: 'light' as ThemeMode,
                  title: t.schemeLightTitle,
                  desc: t.schemeLightDesc,
                  icon: <Sun className="w-4 h-4" />,
                },
                {
                  id: 'dark' as ThemeMode,
                  title: t.schemeDarkTitle,
                  desc: t.schemeDarkDesc,
                  icon: <Moon className="w-4 h-4" />,
                },
              ].map((modeOpt) => {
                const active = themeMode === modeOpt.id;
                return (
                  <button
                    key={modeOpt.id}
                    type="button"
                    onClick={() => setThemeMode(modeOpt.id)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                        : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div
                      className={`mt-0.5 shrink-0 ${active ? 'theme-accent-text' : 'text-slate-400'}`}
                    >
                      {modeOpt.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{modeOpt.title}</div>
                      <div className="text-[11px] opacity-80 mt-0.5">{modeOpt.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Surface Style, Motion Speed & Backdrop Visibility */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t.uiSurfaceStyleLabel}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'adaptive' as SurfaceTone, label: t.tintedGlassLabel },
                  { id: 'monochrome' as SurfaceTone, label: t.classicBwLabel },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSurfaceTone(opt.id)}
                    className={`py-2 px-2.5 rounded-xl border text-[11px] font-medium cursor-pointer transition-all ${
                      surfaceTone === opt.id
                        ? 'theme-accent-active'
                        : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t.animationSpeedLabel}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['calm', 'normal', 'dynamic'] as MotionSpeed[]).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setMotionSpeed(sp)}
                    className={`py-2 px-2 rounded-xl border text-[11px] font-medium capitalize cursor-pointer transition-all ${
                      motionSpeed === sp
                        ? 'theme-accent-active'
                        : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {sp}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t.backdropClarityLabel}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'subtle' as ScrimIntensity, label: 'Vibrant' },
                  { id: 'balanced' as ScrimIntensity, label: 'Balanced' },
                  { id: 'focus' as ScrimIntensity, label: 'Focus' },
                ].map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setScrimIntensity(sc.id)}
                    className={`py-2 px-2 rounded-xl border text-[11px] font-medium cursor-pointer transition-all ${
                      scrimIntensity === sc.id
                        ? 'theme-accent-active'
                        : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {t.liveAnimatedBackdropLabel} ({LIVE_THEMES.length})
              </label>
              <div className="flex items-center gap-2">
                {prefersReducedMotion && (
                  <button
                    type="button"
                    onClick={() => setOverrideReducedMotion(!overrideReducedMotion)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      overrideReducedMotion
                        ? 'theme-accent-active'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {overrideReducedMotion
                      ? 'OS Reduced Motion: Bypassed'
                      : 'OS Reduced Motion Active (Click to Override)'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLiveMotion(!liveMotion)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                    isAnimating
                      ? 'theme-accent-active'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {isAnimating ? (
                    <>
                      <Pause className="w-3 h-3" />
                      <span>{t.liveAnimationOnBtn}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      <span>{t.staticScreenBtn}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {LIVE_THEMES.map((theme) => {
                const isSelected = liveTheme === theme.id;
                const previewBg =
                  resolvedScheme === 'dark'
                    ? theme.darkPreviewGradient
                    : theme.lightPreviewGradient;
                const schemeMismatch =
                  (theme.recommendedScheme === 'dark' && resolvedScheme === 'light') ||
                  (theme.recommendedScheme === 'light' && resolvedScheme === 'dark');

                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setLiveTheme(theme.id as LiveThemeId)}
                    className={`group rounded-xl border overflow-hidden text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'theme-accent-active ring-2 ring-[var(--theme-accent-ring)]'
                        : 'border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50/70 dark:bg-slate-800/50'
                    }`}
                  >
                    <div
                      className={`h-24 w-full relative overflow-hidden ${
                        !theme.previewImage && isAnimating ? 'theme-preview-animated' : ''
                      }`}
                      style={{ background: previewBg }}
                    >
                      {theme.previewImage && (
                        <img
                          src={theme.previewImage}
                          alt={theme.name}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          style={{
                            filter: theme.isNocturnalPhoto
                              ? resolvedScheme === 'dark'
                                ? 'brightness(0.86) contrast(1.06)'
                                : 'brightness(1.16) contrast(0.95) saturate(0.90)'
                              : resolvedScheme === 'dark'
                                ? 'brightness(0.54) contrast(1.12) saturate(0.88)'
                                : 'none',
                          }}
                        />
                      )}
                      <div className="absolute inset-x-4 top-5 h-3.5 rounded-full bg-white/80 dark:bg-slate-900/75 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-xs" />
                      {theme.schemeBadge && (
                        <span
                          className={`absolute bottom-1.5 left-2 px-1.5 py-0.5 rounded text-[9px] font-medium backdrop-blur-md ${
                            schemeMismatch
                              ? 'bg-amber-500/85 text-slate-950'
                              : 'bg-slate-950/60 text-white'
                          }`}
                        >
                          {schemeMismatch
                            ? theme.recommendedScheme === 'dark'
                              ? 'Best in Dark Mode'
                              : 'Best in Light Mode'
                            : theme.schemeBadge}
                        </span>
                      )}
                      {isSelected && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full theme-btn-primary flex items-center justify-center shadow-sm">
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center justify-between gap-1">
                        <span>{theme.name}</span>
                        <span className="text-[10px] font-normal theme-accent-text truncate">
                          {theme.animationLabel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                        {theme.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Theme Custom Controls */}
          <div className="p-4 rounded-xl bg-slate-50/75 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 theme-accent-text" />
                <span>
                  {activeThemeMeta.name} — {t.themeSpecificOptionsSuffix}
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {activeThemeMeta.animationLabel}
              </span>
            </div>

            {liveTheme === 'alpine-dunes' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Time of Day Grading</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['daylight', 'moonlit'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => updateThemeOptions({ alpineTime: opt })}
                        className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                          (themeOptions.alpineTime || 'daylight') === opt
                            ? 'theme-accent-active'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt === 'daylight' ? 'Sunlit Snow' : 'Moonlit Night'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Drifting Snow Intensity</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['gentle', 'brisk', 'off'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => updateThemeOptions({ snowIntensity: opt })}
                        className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium capitalize cursor-pointer ${
                          (themeOptions.snowIntensity || 'gentle') === opt
                            ? 'theme-accent-active'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {liveTheme === 'misty-fjords' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Lake Water Ripple</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['calm', 'lively', 'off'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => updateThemeOptions({ waterRipple: opt })}
                        className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium capitalize cursor-pointer ${
                          (themeOptions.waterRipple || 'lively') === opt
                            ? 'theme-accent-active'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Valley Fog Density</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['light', 'lively', 'dense'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => updateThemeOptions({ mistDensity: opt })}
                        className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium capitalize cursor-pointer ${
                          (themeOptions.mistDensity || 'lively') === opt
                            ? 'theme-accent-active'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {liveTheme === 'emerald-highlands' && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'fireflies', label: 'Forest Fireflies' },
                    { id: 'rain', label: 'Gentle Rain' },
                    { id: 'mist', label: 'Valley Mist Only' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateThemeOptions({ forestEffect: opt.id })}
                    className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      (themeOptions.forestEffect || 'fireflies') === opt.id
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {liveTheme === 'amber-canyon' && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'heat-dust', label: 'Golden Dust Motes' },
                    { id: 'sunbeams', label: 'Canyon Sunbeams' },
                    { id: 'mist', label: 'Desert Haze Only' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateThemeOptions({ canyonEffect: opt.id })}
                    className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      (themeOptions.canyonEffect || 'heat-dust') === opt.id
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {liveTheme === 'midnight-peaks' && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'shooting-stars', label: 'Shooting Stars' },
                    { id: 'polar-glow', label: 'Polar Night Glow' },
                    { id: 'starfield', label: 'Calm Starfield' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateThemeOptions({ midnightSky: opt.id })}
                    className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      (themeOptions.midnightSky || 'shooting-stars') === opt.id
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {liveTheme === 'nebula' && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'warp-stars', label: '3D Warp Starfield' },
                    { id: 'constellation', label: 'Constellation Web' },
                    { id: 'drift', label: 'Slow Cosmic Drift' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateThemeOptions({ nebulaEffect: opt.id })}
                    className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      (themeOptions.nebulaEffect || 'warp-stars') === opt.id
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {liveTheme === 'cyberpunk' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Neon Palette</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: 'neon-emerald', label: 'Green' },
                        { id: 'cyber-cyan', label: 'Cyan' },
                        { id: 'synth-amber', label: 'Amber' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateThemeOptions({ cyberPalette: opt.id })}
                        className={`py-1.5 px-1.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                          (themeOptions.cyberPalette || 'neon-emerald') === opt.id
                            ? 'theme-accent-active'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Rain Density</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['sparse', 'normal', 'overdrive'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updateThemeOptions({ cyberDensity: d })}
                        className={`py-1.5 px-1.5 rounded-lg border text-[11px] font-medium capitalize cursor-pointer ${
                          (themeOptions.cyberDensity || 'normal') === d
                            ? 'theme-accent-active'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">CRT Scanlines</div>
                  <button
                    type="button"
                    onClick={() =>
                      updateThemeOptions({ cyberScanlines: themeOptions.cyberScanlines === false })
                    }
                    className={`w-full py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      themeOptions.cyberScanlines !== false
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {themeOptions.cyberScanlines !== false ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>
            )}

            {liveTheme === 'aurora-borealis' && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'polar-emerald', label: 'Polar Green & Cyan' },
                    { id: 'cosmic-violet', label: 'Cosmic Violet' },
                    { id: 'solar-crimson', label: 'Solar Storm Crimson' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateThemeOptions({ auroraPalette: opt.id })}
                    className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                      (themeOptions.auroraPalette || 'polar-emerald') === opt.id
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {liveTheme === 'oceanic-horizon' && (
              <div className="grid grid-cols-3 gap-2">
                {(['calm', 'rolling', 'choppy'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => updateThemeOptions({ oceanWaveEnergy: opt })}
                    className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-medium capitalize cursor-pointer ${
                      (themeOptions.oceanWaveEnergy || 'rolling') === opt
                        ? 'theme-accent-active'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt} Waves
                  </button>
                ))}
              </div>
            )}

            {liveTheme === 'solar-meadow' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Volumetric Sweeping Horizon Sunbeams
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateThemeOptions({ dawnSunbeams: themeOptions.dawnSunbeams === false })
                  }
                  className={`py-1.5 px-3 rounded-lg border text-[11px] font-medium cursor-pointer ${
                    themeOptions.dawnSunbeams !== false
                      ? 'theme-accent-active'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  {themeOptions.dawnSunbeams !== false ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            )}

            {liveTheme === 'cyber-studio' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Autonomous Neural Constellation Mesh & Data Pulses
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateThemeOptions({ neuralMesh: themeOptions.neuralMesh === false })
                  }
                  className={`py-1.5 px-3 rounded-lg border text-[11px] font-medium cursor-pointer ${
                    themeOptions.neuralMesh !== false
                      ? 'theme-accent-active'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  {themeOptions.neuralMesh !== false ? 'Active' : 'Grid Only'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          SUB-TAB 3: VOICE & 3D HOLOGRAM AVATAR
      ============================================================ */}
      {activeSubTab === 'voice-avatar' && (
        <div className="space-y-6">
          <input
            ref={avatarFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleAvatarUploadChange}
            className="hidden"
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Live Transparent 3D Hologram Preview Stage */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-transparent flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t.liveAvatarPreviewTitle}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.liveAvatarPreviewHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handlePreviewVoiceSample(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[var(--theme-accent)] cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Volume2 className="w-3 h-3 theme-accent-text" />
                  <span>{isPreviewPulsing ? t.speakingNow : t.testVoiceLips}</span>
                </button>
              </div>

              {/* Clean WebGL stage with smooth cross-fade transition on avatar image switch */}
              <div className="relative h-72 w-full bg-transparent overflow-hidden">
                <motion.div
                  key={`${avatarPref.preset}-${activeAvatarSource.src.slice(-24)}`}
                  initial={{ opacity: 0.25, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.44, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full h-full"
                >
                  <LiveVoiceAvatarCanvas
                    status={isPreviewPulsing ? 'speaking' : 'idle'}
                    voiceName={voiceName}
                    levelsRef={previewLevelsRef}
                    avatarSrc={activeAvatarSource.src}
                    isPrestyledHologram={activeAvatarSource.isPrestyledHologram}
                    avatarPreset={avatarPref.preset}
                    customTraits={avatarPref.customTraits}
                    isDark={resolvedScheme === 'dark'}
                  />
                </motion.div>

                <AnimatePresence>
                  {outgoingPreviewSrc && (
                    <motion.img
                      key={outgoingPreviewSrc.slice(-32)}
                      src={outgoingPreviewSrc}
                      alt=""
                      aria-hidden="true"
                      referrerPolicy="no-referrer"
                      initial={{ opacity: 0.55, scale: 1 }}
                      animate={{ opacity: 0, scale: 1.05 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.42, ease: 'easeOut' }}
                      className="pointer-events-none absolute inset-0 m-auto h-52 w-52 rounded-full object-cover object-top blur-[2px]"
                    />
                  )}
                </AnimatePresence>
              </div>

              {onOpenLiveVoice && (
                <div className="px-4 py-3 border-t border-slate-200/70 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {t.activeVoiceLabel}:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">{voiceName}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={onOpenLiveVoice}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full theme-btn-primary text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span>{t.launchVoiceCompanion}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Avatar Presets & Custom Upload + Voice Persona Picker */}
            <div className="lg:col-span-7 space-y-5">
              {/* Hologram Avatar Selection */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 theme-accent-text" />
                      <span>{t.hologramAvatarTitle}</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {t.hologramAvatarSubtitle}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {AVATAR_PRESETS.map((preset) => {
                    const isSelected = avatarPref.preset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectPresetAvatar(preset.id)}
                        className={`rounded-xl border p-2.5 text-left transition-all duration-300 cursor-pointer flex flex-col gap-2 ${
                          isSelected
                            ? 'theme-accent-active ring-2 ring-[var(--theme-accent-ring)]'
                            : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <div className="relative h-28 w-full rounded-lg overflow-hidden bg-slate-950">
                          <img
                            src={preset.imageSrc}
                            alt={preset.label}
                            referrerPolicy="no-referrer"
                            className={`w-full h-full object-cover object-top transition-all duration-400 ${
                              isSelected ? 'scale-105 opacity-100' : 'opacity-80 hover:opacity-100'
                            }`}
                          />
                          <AnimatePresence>
                            {isSelected && (
                              <motion.span
                                initial={{ opacity: 0, scale: 0.7 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.7 }}
                                transition={{ duration: 0.22 }}
                                className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full theme-btn-primary flex items-center justify-center shadow-sm"
                              >
                                <Check className="w-3 h-3" />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-900 dark:text-white">
                            {preset.label}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {preset.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Custom Photo-to-Hologram Card */}
                  <div
                    className={`rounded-xl border p-2.5 text-left transition-all duration-300 flex flex-col gap-2 ${
                      avatarPref.preset === 'custom'
                        ? 'theme-accent-active ring-2 ring-[var(--theme-accent-ring)]'
                        : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={handleSelectCustomAvatar}
                      className="relative h-28 w-full rounded-lg overflow-hidden bg-slate-900/90 border border-dashed border-slate-700 flex items-center justify-center cursor-pointer group"
                    >
                      <AnimatePresence mode="wait">
                        {avatarPref.customImageDataUrl ? (
                          <motion.img
                            key={avatarPref.customImageDataUrl.slice(-32)}
                            src={avatarPref.customImageDataUrl}
                            alt="Custom avatar preview"
                            referrerPolicy="no-referrer"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.03 }}
                            transition={{ duration: 0.34, ease: 'easeInOut' }}
                            className="w-full h-full object-cover object-top"
                          />
                        ) : (
                          <motion.div
                            key="upload-empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            className="flex flex-col items-center gap-1.5 text-slate-400 group-hover:text-cyan-400 transition-colors px-2 text-center"
                          >
                            {isProcessingAvatar ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <Upload className="w-5 h-5" />
                            )}
                            <span className="text-[11px] font-medium">{t.uploadPortraitLabel}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <AnimatePresence>
                        {avatarPref.preset === 'custom' && avatarPref.customImageDataUrl && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            transition={{ duration: 0.22 }}
                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full theme-btn-primary flex items-center justify-center shadow-sm"
                          >
                            <Check className="w-3 h-3" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </button>

                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {t.faceMatched3dLabel}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {isProcessingAvatar ? '...' : avatarPref.customImageName || 'Portrait'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mt-auto pt-1">
                      <button
                        type="button"
                        disabled={isProcessingAvatar}
                        onClick={() => avatarFileInputRef.current?.click()}
                        className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-[var(--theme-accent)] cursor-pointer whitespace-nowrap disabled:opacity-60"
                      >
                        {isProcessingAvatar ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Upload className="w-3 h-3" />
                        )}
                        <span>
                          {isProcessingAvatar
                            ? '...'
                            : avatarPref.customImageDataUrl
                              ? t.changeBtn
                              : t.uploadBtn}
                        </span>
                      </button>
                      {avatarPref.customImageDataUrl && (
                        <button
                          type="button"
                          onClick={handleClearCustomAvatar}
                          aria-label="Remove custom avatar"
                          title="Remove custom avatar"
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-500 hover:border-rose-300 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {avatarError && (
                  <div
                    role="alert"
                    data-testid="avatar-upload-error"
                    className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{avatarError}</span>
                  </div>
                )}
              </div>

              {/* Voice Persona */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Volume2 className="w-4 h-4 theme-accent-text" />
                      <span>{t.voicePersonaTitle}</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {t.voicePersonaSubtitle}
                    </p>
                  </div>

                  {/* বাংলা মন্তব্য: এখানে আগে General ট্যাবের ভাষা-পিকারের হুবহু কপি
                      (একই handleSelectLanguage) ছিল। ভাষা এখন শুধু General-এ বদলায়;
                      নিচের Global TTS বার বর্তমান ভাষা/লোকেল দেখায়। */}
                </div>

                {/* Synchronized Global TTS Engine Bar */}
                <div
                  data-testid="voice-global-tts-bar"
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/70 text-[11px]"
                >
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {t.globalTtsConfigLabel}
                  </span>
                  <div className="flex flex-wrap items-center gap-3 font-mono text-slate-600 dark:text-slate-300">
                    <span>
                      {t.ttsLocaleLabel}:{' '}
                      <strong className="text-slate-900 dark:text-white">{ttsConfig.locale}</strong>
                    </span>
                    <span>
                      {t.ttsNeuralVoiceLabel}:{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {ttsConfig.edgeVoice}
                      </strong>
                    </span>
                    <span>
                      <strong className="text-slate-900 dark:text-white">
                        {ttsConfig.pitch.toFixed(2)}×
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {LIVE_VOICE_OPTIONS.map((opt) => {
                    const active = voiceName === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelectVoice(opt.id)}
                        className={`flex items-start justify-between gap-2 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                            : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold">{opt.label}</div>
                          <div className="text-[11px] opacity-80 mt-0.5">{opt.tone}</div>
                        </div>
                        {active && (
                          <Check className="w-3.5 h-3.5 theme-accent-text shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Pitch Control Slider */}
                <div className="pt-4 border-t border-slate-200/70 dark:border-slate-800/80 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label
                        htmlFor="settings-voice-pitch-slider"
                        className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
                      >
                        <AudioLines className="w-3.5 h-3.5 theme-accent-text" />
                        <span>{t.voicePitchLabel}</span>
                      </label>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {t.voicePitchDesc}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {Math.abs(voicePitch - DEFAULT_VOICE_PITCH) > 0.01 && (
                        <button
                          type="button"
                          data-testid="settings-reset-pitch-btn"
                          onClick={() => handleChangeVoicePitch(DEFAULT_VOICE_PITCH)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-[var(--theme-accent)] cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>{t.resetPitchBtn}</span>
                        </button>
                      )}
                      <span
                        data-testid="settings-voice-pitch-value"
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-xs font-mono font-semibold tabular-nums text-slate-900 dark:text-white"
                      >
                        {voicePitch.toFixed(2)}×
                      </span>
                    </div>
                  </div>

                  <input
                    id="settings-voice-pitch-slider"
                    data-testid="settings-voice-pitch-slider"
                    type="range"
                    min={MIN_VOICE_PITCH}
                    max={MAX_VOICE_PITCH}
                    step={0.05}
                    value={voicePitch}
                    aria-label={t.voicePitchLabel}
                    onChange={(e) => handleChangeVoicePitch(Number.parseFloat(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-cyan-500"
                  />

                  <div className="flex items-center justify-between text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    <span>{t.voicePitchLow} (0.60×)</span>
                    <span>{t.voicePitchNatural} (1.00×)</span>
                    <span>{t.voicePitchHigh} (1.60×)</span>
                  </div>
                </div>

                {/* Bangla Accent Selector */}
                <div
                  data-testid="settings-bangla-accent-selector"
                  className="pt-4 border-t border-slate-200/70 dark:border-slate-800/80 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 theme-accent-text" />
                        <span>{t.banglaAccentLabel}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {t.banglaAccentDesc}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid="test-bangla-accent-btn"
                      onClick={() => handlePreviewVoiceSample(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-[var(--theme-accent)] cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Volume2 className="w-3.5 h-3.5 theme-accent-text" />
                      <span>{t.testBanglaAccentBtn}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          id: 'bn-bd' as BanglaAccentId,
                          title: t.accentDhakaBdTitle,
                          desc: t.accentDhakaBdDesc,
                        },
                        {
                          id: 'bn-in' as BanglaAccentId,
                          title: t.accentKolkataInTitle,
                          desc: t.accentKolkataInDesc,
                        },
                      ] as const
                    ).map((accentOpt) => {
                      const active = banglaAccent === accentOpt.id;
                      return (
                        <button
                          key={accentOpt.id}
                          type="button"
                          data-testid={`bangla-accent-${accentOpt.id}`}
                          onClick={() => handleSelectBanglaAccent(accentOpt.id)}
                          className={`flex items-start justify-between gap-2 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                              : 'border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold">{accentOpt.title}</div>
                            <div className="text-[11px] opacity-80 mt-0.5">{accentOpt.desc}</div>
                          </div>
                          {active && (
                            <Check className="w-3.5 h-3.5 theme-accent-text shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SUB-TAB 4: ACCOUNT, SECURITY & FEEDBACK
      ============================================================ */}
      {activeSubTab === 'account' && (
        <div className="space-y-6">
          <PersonalMcpHubCard
            userId={settings.email}
            userEmail={settings.email}
            userName={settings.name}
          />
          <AccountSettingsPanel
            isAdminEligible={Boolean(isAdminEligible)}
            trustedUntil={trustedUntil}
            onRevokeTrustedBrowser={onRevokeTrustedBrowser}
            onOpenFeedbackSurvey={onOpenFeedbackSurvey}
            onSignOut={onSignOut}
            gitOAuthStatus={gitOAuthStatus}
            gitOAuthConnecting={gitOAuthConnecting}
            gitTokensState={gitTokensState}
            setGitTokensState={setGitTokensState}
            handleSettingsGitOAuthConnect={handleSettingsGitOAuthConnect}
          />
        </div>
      )}
    </div>
  );
};
