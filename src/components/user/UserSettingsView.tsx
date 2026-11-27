import React, { useEffect, useRef, useState } from 'react';
import {
  User,
  Check,
  Gauge,
  Sparkles,
  Palette,
  AudioLines,
  Upload,
  Trash2,
  Volume2,
  Loader2,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { UserAccountSettings, UserRole } from '../../types';
import { TranslationKeys, useI18n } from '../../utils/i18n';
import { AccountSettingsPanel } from './settings/AccountSettingsPanel';
import { LanguageVoicePanel } from './settings/LanguageVoicePanel';
import { ProfilePreferencesCard } from './settings/ProfilePreferencesCard';
import { AdminWorkspaceSwitcher } from './settings/AdminWorkspaceSwitcher';
import { VOICE_TONE_KEYS } from '../../config/languageVoiceOptions';
import { PersonalMcpHubCard } from './PersonalMcpHubCard';
import { useThemeStore } from '../../stores/useThemeStore';
import { useChatStore } from '../../stores/useChatStore';
import { useAppPreferencesStore } from '../../stores/useAppPreferencesStore';
import { toast } from '../../stores/useToastStore';
import { LiveVoiceName } from '../../hooks/useLiveVoiceSession';
import { LiveVoiceAvatarCanvas } from '../chat/LiveVoiceAvatarCanvas';
import { ThemeAppearanceControls } from '../theme/ThemeAppearanceControls';
import {
  AVATAR_PRESETS,
  AvatarPreference,
  loadAvatarPreference,
  saveAvatarPreference,
  resolveAvatarSource,
  processCustomFaceUpload,
  VOICE_AVATAR_SYNC_EVENT,
} from '../../utils/hologramAvatar';
import { ttsService } from '../../services/ttsService';
import {
  connectGitOAuthPopup,
  fetchGitOAuthStatus,
  GitOAuthStatus,
  GitProvider,
  loadGitTokens,
} from '../../services/gitExportService';

export type SettingsSubTab = 'general' | 'language-voice' | 'appearance' | 'account';

interface UserSettingsViewProps {
  settings: UserAccountSettings;
  onUpdateSettings: (newSettings: Partial<UserAccountSettings>) => void;
  onSwitchRole?: (newRole: UserRole) => void;
  currentRole?: UserRole;
  isAdminEligible?: boolean;
  onOpenAdminConsole?: () => void;
  onToggleDeveloperEligibility?: (eligible: boolean) => void;
  trustedUntil?: number | null;
  onRevokeTrustedBrowser?: () => void;
  onSignOut?: () => void;
  onOpenFeedbackSurvey?: () => void;
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
  { id: 'general', labelKey: 'tabProfile', icon: <User className="w-3.5 h-3.5" /> },
  {
    id: 'language-voice',
    labelKey: 'tabLanguageVoice',
    icon: <AudioLines className="w-3.5 h-3.5" />,
  },
  { id: 'appearance', labelKey: 'tabAppearance', icon: <Palette className="w-3.5 h-3.5" /> },
  { id: 'account', labelKey: 'tabAccount', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
];

export const UserSettingsView: React.FC<UserSettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onSwitchRole,
  currentRole: currentRoleProp,
  isAdminEligible = false,
  onOpenAdminConsole,
  onToggleDeveloperEligibility,
  trustedUntil = null,
  onRevokeTrustedBrowser,
  onOpenFeedbackSurvey,
  onSignOut,
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

  const language = useAppPreferencesStore((s) => s.language);
  const centralizedRole = useAppPreferencesStore((s) => s.role);
  const setCentralizedRole = useAppPreferencesStore((s) => s.setRole);
  const currentRole = currentRoleProp ?? centralizedRole;
  const handleSwitchRole = onSwitchRole ?? setCentralizedRole;
  const { t } = useI18n();

  // Voice & 3D Hologram Avatar state (synced live with global ttsService & LiveVoicePanel)
  const [avatarPref, setAvatarPref] = useState<AvatarPreference>(() => loadAvatarPreference());
  const [voiceName, setVoiceName] = useState<LiveVoiceName>(
    () => ttsService.getConfig().voicePersona
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
    const unsubscribeTts = ttsService.subscribe((nextCfg) => {
      setVoiceName(nextCfg.voicePersona);
    });
    const handleSync = () => {
      setAvatarPref(loadAvatarPreference());
      setVoiceName(ttsService.getConfig().voicePersona);
    };
    window.addEventListener(VOICE_AVATAR_SYNC_EVENT, handleSync);
    return () => {
      unsubscribeTts();
      window.removeEventListener(VOICE_AVATAR_SYNC_EVENT, handleSync);
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
      if (crossFadeTimeoutRef.current) clearTimeout(crossFadeTimeoutRef.current);
    };
  }, []);

  const setChatCustomInstruction = useChatStore((s) => s.setCustomInstruction);

  const resolvedScheme = useThemeStore((s) => s.resolvedScheme);

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
      toast.success(t.avatarFaceMatchedTitle, t.avatarFaceMatchedDesc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.avatarFaceMissingDesc;
      setAvatarError(msg);
      toast.error(t.avatarFaceMissingTitle, msg);
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
    toast.info(t.avatarPhotoRemovedTitle, t.avatarPhotoRemovedDesc);
  };

  const handlePreviewVoiceSample = () => {
    triggerPreviewPulse();
    if (!onPreviewVoice) return;
    const sample = ttsService.getSamplePhrase(language);
    onPreviewVoice(sample);
  };

  const usagePercent = Math.min(
    100,
    Math.round((settings.monthlyTokensUsed / Math.max(1, settings.monthlyTokensLimit)) * 100)
  );
  const userInitial = (settings.name || 'U').trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 workspace-container space-y-6 text-slate-800 dark:text-slate-200">
      {/* Header & Clean Sub-Tab Navigation */}
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-4 space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.settingsTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.settingsSubtitleUser}
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
                    {t.monthlyUsageAllowanceTitle}
                  </span>
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {settings.monthlyTokensUsed.toLocaleString()} /{' '}
                  {settings.monthlyTokensLimit.toLocaleString()}{' '}
                  {t.creditsWord}
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

          {/* বাংলা মন্তব্য: Save বাটন নেই — সব পরিবর্তন নিজে থেকেই সেভ হয় */}
          <ProfilePreferencesCard
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            onInstructionsLive={setChatCustomInstruction}
          />
        </div>
      )}

      {/* ============================================================
          SUB-TAB 2: APPEARANCE & LIVE BACKDROPS
      ============================================================ */}
      {activeSubTab === 'appearance' && (
        <div className="p-5 rounded-2xl theme-surface-glass border space-y-5 shadow-xs">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Palette className="w-4 h-4 theme-accent-text" />
              <span>{t.appearanceHeaderTitle}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t.appearanceHeaderDesc}
            </p>
          </div>

          {/* বাংলা মন্তব্য: Sidebar থিম পপওভারের সাথে একই শেয়ার্ড কম্পোনেন্ট */}
          <ThemeAppearanceControls variant="full" />
        </div>
      )}

      {/* ============================================================
          SUB-TAB 3: VOICE & 3D HOLOGRAM AVATAR
      ============================================================ */}
      {activeSubTab === 'language-voice' && (
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
                  onClick={() => handlePreviewVoiceSample()}
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
                    <strong className="text-slate-800 dark:text-slate-200">
                      {t[VOICE_TONE_KEYS[voiceName]]}
                    </strong>
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
              <LanguageVoicePanel
                onPreview={onPreviewVoice ? () => handlePreviewVoiceSample() : undefined}
                onChanged={triggerPreviewPulse}
              />

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

            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SUB-TAB 4: ACCOUNT, SECURITY & FEEDBACK
      ============================================================ */}
      {activeSubTab === 'account' && (
        <div className="space-y-6">
          {Boolean(isAdminEligible) && (
            <AdminWorkspaceSwitcher
              currentRole={currentRole}
              onSwitchRole={handleSwitchRole}
              onOpenAdminConsole={onOpenAdminConsole}
            />
          )}
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
