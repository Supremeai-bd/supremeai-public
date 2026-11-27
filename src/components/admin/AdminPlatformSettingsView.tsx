import React, { useEffect, useState } from 'react';
import { Cpu, Lock, Megaphone, Save, UserPlus, Wrench, Zap } from 'lucide-react';
import type { PlanTier } from '../../types';
import { SUPREMEAI_MODELS } from '../../data/models';
import { INITIAL_FEATURE_FLAGS } from '../../data/adminExpansionData';
import { usePlatformStore } from '../../stores/usePlatformStore';
import { useI18n } from '../../utils/i18n';
import { AdminConnectionsCard } from './AdminConnectionsCard';

/**
 * বাংলা মন্তব্য: প্ল্যাটফর্মের সব গুরুত্বপূর্ণ সেটিং এক জায়গায় — মেইনটেন্যান্স লক, ঘোষণা ব্যানার,
 * নতুন সাইনআপ, ফিচার ফ্ল্যাগ আর কোন প্ল্যানে কোন মডেল। আগে এগুলো ওভারভিউয়ের নিচে চাপা ছিল।
 * সব পরিবর্তন সার্ভারে সেভ হয় (usePlatformStore → /api/admin/config)।
 */

interface AdminPlatformSettingsViewProps {
  onNavigateTab: (tab: string) => void;
}

export const AdminPlatformSettingsView: React.FC<AdminPlatformSettingsViewProps> = ({
  onNavigateTab,
}) => {
  const { t } = useI18n();
  const { config, isLoaded, isSaving, updateConfig, updateModelPolicy, toggleFeatureFlag } =
    usePlatformStore();
  const [maintenanceMessage, setMaintenanceMessage] = useState(config.maintenanceMessage);
  const [bannerMessage, setBannerMessage] = useState(config.announcementBanner.message);
  const [bannerLevel, setBannerLevel] = useState<'info' | 'warning' | 'critical'>(
    config.announcementBanner.level
  );

  useEffect(() => {
    setMaintenanceMessage(config.maintenanceMessage);
    setBannerMessage(config.announcementBanner.message);
    setBannerLevel(config.announcementBanner.level);
  }, [
    config.maintenanceMessage,
    config.announcementBanner.message,
    config.announcementBanner.level,
  ]);

  return (
    <div
      data-testid="admin-platform-settings"
      className="flex-1 overflow-y-auto bg-[#f6f8fb] dark:bg-slate-950 px-4 sm:px-6 py-5 text-slate-800 dark:text-slate-200"
    >
      <div className="max-w-7xl mx-auto space-y-6">
        {/* বাংলা মন্তব্য: কোন ইন্টিগ্রেশন সত্যিই সংযুক্ত — আসল ডেটা না এলে কারণ এখানেই দেখা যায় */}
        <AdminConnectionsCard onNavigateTab={onNavigateTab} />

        {/* Platform Governance & Model Access Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Global Platform Policy Controls */}
          <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-cyan-500" />
                  <span>{t.ovPlatformGovernance}</span>
                </h2>
                <p className="text-[11px] text-slate-400">{t.ovServerEnforcedHint}</p>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {isSaving ? 'Saving…' : isLoaded ? 'Synced' : 'Local defaults'}
              </span>
            </div>

            {/* Maintenance Mode */}
            <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t.ovEmergencyLock}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Pauses customer chat & workspace access (HTTP 503) while Admins retain full
                    control.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      maintenanceMode: !config.maintenanceMode,
                      maintenanceMessage,
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    config.maintenanceMode
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {config.maintenanceMode ? 'Active (Unlock)' : 'Enable Lock'}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  placeholder={t.ovMaintenancePlaceholder}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => updateConfig({ maintenanceMessage })}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>{t.commonSave}</span>
                </button>
              </div>
            </div>

            {/* Global System Announcement Banner */}
            <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Megaphone className="w-3.5 h-3.5 text-blue-500" />
                    <span>{t.ovGlobalBanner}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.ovBannerHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      announcementBanner: {
                        active: !config.announcementBanner.active,
                        message: bannerMessage,
                        level: bannerLevel,
                      },
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    config.announcementBanner.active
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {config.announcementBanner.active ? 'Broadcasting' : 'Publish'}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={bannerMessage}
                  onChange={(e) => setBannerMessage(e.target.value)}
                  placeholder={t.ovAnnouncementPlaceholder}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <select
                  value={bannerLevel}
                  onChange={(e) =>
                    setBannerLevel(e.target.value as 'info' | 'warning' | 'critical')
                  }
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
                >
                  <option value="info">{t.ovInfo}</option>
                  <option value="warning">{t.ovWarning}</option>
                  <option value="critical">{t.ovCritical}</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      announcementBanner: {
                        active: config.announcementBanner.active,
                        message: bannerMessage,
                        level: bannerLevel,
                      },
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>{t.commonUpdate}</span>
                </button>
              </div>
            </div>

            {/* Allow New Signups Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{t.ovAllowSignups}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.ovPausedHint}</p>
              </div>
              <button
                type="button"
                onClick={() => updateConfig({ allowNewSignups: !config.allowNewSignups })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                  config.allowNewSignups
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-rose-600 text-white hover:bg-rose-700'
                }`}
              >
                {config.allowNewSignups ? 'Open' : 'Paused'}
              </button>
            </div>

            {/* Feature Flags — বাংলা মন্তব্য: আগে আলাদা feature-flags ট্যাব ছিল।
                এখন কার্যকর (সার্ভারসাইড এনফোর্স) ফ্ল্যাগগুলো এখানেই টগল করা হয়। */}
            <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div className="text-[11px] font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-purple-500" />
                <span>{t.ovFeatureFlags}</span>
              </div>
              {INITIAL_FEATURE_FLAGS.map((flag) => {
                const enabled =
                  typeof config.featureFlags[flag.key] === 'boolean'
                    ? config.featureFlags[flag.key]
                    : flag.enabled;
                return (
                  <div key={flag.key} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {flag.name}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 truncate">
                        {flag.key}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => toggleFeatureFlag(flag.key, !enabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        enabled
                          ? 'bg-cyan-500 shadow-[0_0_12px_rgba(0,240,255,0.4)]'
                          : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ${
                          enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Model Access & Tier Governance */}
          <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-purple-500" />
                  <span>{t.ovModelAccessGovernance}</span>
                </h2>
                <p className="text-[11px] text-slate-400">{t.ovModelGovernanceHint}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('llm-gateway')}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                {t.ovModelMatrix}
              </button>
            </div>

            <div className="space-y-2.5">
              {SUPREMEAI_MODELS.map((model) => {
                const policy = config.modelPolicies[model.id] || { enabled: true, minTier: 'Free' };
                return (
                  <div
                    key={model.id}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {model.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {model.id} · {model.latencyRating}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={policy.minTier}
                        onChange={(e) =>
                          updateModelPolicy(model.id, { minTier: e.target.value as PlanTier })
                        }
                        aria-label={`Minimum tier for ${model.name}`}
                        className="px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                      >
                        <option value="Free">{t.ovFreePlus}</option>
                        <option value="Pro">{t.ovProPlus}</option>
                        <option value="Enterprise">Enterprise</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => updateModelPolicy(model.id, { enabled: !policy.enabled })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          policy.enabled
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {policy.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPlatformSettingsView;
