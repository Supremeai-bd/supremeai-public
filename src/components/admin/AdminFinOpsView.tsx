import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Gauge, Loader2, Users, Wallet } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { adminWriteErrorMessage } from '../../utils/adminWriteError';
import { toast } from '../../stores/useToastStore';
import { SettingSwitch } from '../ui/SettingSwitch';
import {
  adminFinOpsService,
  FINOPS_LIMIT_MAX,
  type FinOpsLimitKey,
  type FinOpsPatch,
  type FinOpsState,
} from '../../services/adminFinOpsService';

/**
 * বাংলা মন্তব্য: Admin → AI & Providers → Usage Limits (FinOps)।
 * আসল, বলবৎ সীমা: core প্রতিটি চ্যাটের আগে যাচাই করে (core/finops/guard.py)।
 * সুইচ = চালু/বন্ধ, সংখ্যা = টাইপ থামালেই অটো-সেভ (কোনো Save বাটন নেই)। ব্যবহার আনুমানিক।
 */

const REFRESH_MS = 60_000;
const SAVE_DELAY_MS = 900;

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

/** Parse a limit field: integer 0..max, or null when invalid. */
export function parseLimit(raw: string, max: number): number | null {
  const trimmed = raw.replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

const LIMIT_KEYS: FinOpsLimitKey[] = ['userRpm', 'userDailyTokens', 'globalDailyTokens'];

export const AdminFinOpsView: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<FinOpsState | null>(null);
  const [drafts, setDrafts] = useState<Record<FinOpsLimitKey, string>>({
    userRpm: '',
    userDailyTokens: '',
    globalDailyTokens: '',
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timers = useRef<Partial<Record<FinOpsLimitKey, number>>>({});
  const dirty = useRef<Set<FinOpsLimitKey>>(new Set());

  const load = useCallback(async () => {
    try {
      const next = await adminFinOpsService.getState();
      setState(next);
      setDrafts((prev) => {
        const out = { ...prev };
        for (const key of LIMIT_KEYS) {
          if (!dirty.current.has(key)) out[key] = String(next.settings[key]);
        }
        return out;
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, t.foLoadError));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const pending = timers.current;
    return () => {
      window.clearInterval(timer);
      Object.values(pending).forEach((id) => window.clearTimeout(id));
    };
  }, [load]);

  const save = useCallback(
    async (patch: FinOpsPatch) => {
      setSaving(true);
      try {
        const settings = await adminFinOpsService.update(patch);
        setState((prev) => (prev ? { ...prev, settings } : prev));
        toast.success(t.foSaved);
      } catch (err) {
        toast.error(adminWriteErrorMessage(err, t.foSaveError));
        void load();
      } finally {
        setSaving(false);
      }
    },
    [load, t]
  );

  const onLimitChange = (key: FinOpsLimitKey, raw: string) => {
    setDrafts((prev) => ({ ...prev, [key]: raw }));
    dirty.current.add(key);
    window.clearTimeout(timers.current[key]);
    const value = parseLimit(raw, FINOPS_LIMIT_MAX[key]);
    if (value === null) return;
    timers.current[key] = window.setTimeout(() => {
      dirty.current.delete(key);
      if (state && state.settings[key] === value) return;
      void save({ [key]: value });
    }, SAVE_DELAY_MS);
  };

  const limitMeta: Record<FinOpsLimitKey, { label: string; hint: string; icon: React.ReactNode }> =
    {
      userRpm: { label: t.foUserRpm, hint: t.foUserRpmHint, icon: <Gauge className="w-4 h-4" /> },
      userDailyTokens: {
        label: t.foUserDaily,
        hint: t.foUserDailyHint,
        icon: <Wallet className="w-4 h-4" />,
      },
      globalDailyTokens: {
        label: t.foGlobalDaily,
        hint: t.foGlobalDailyHint,
        icon: <Activity className="w-4 h-4" />,
      },
    };

  const settings = state?.settings;
  const usage = state?.usage;
  const globalCap = settings?.globalDailyTokens ?? 0;
  const globalPct =
    usage && globalCap > 0 ? Math.min(100, Math.round((usage.globalTokens / globalCap) * 100)) : 0;

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-6 text-slate-800 dark:text-slate-200"
      data-testid="admin-finops"
    >
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.foTitle}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.foSubtitle}</p>
        </div>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-label="saving" />}
      </div>

      {!state && !loadError ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : loadError && !state ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
        >
          {loadError}
        </div>
      ) : settings && usage ? (
        <>
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 p-5 space-y-5">
            <SettingSwitch
              label={t.foEnforce}
              description={settings.enforce ? t.foEnforceOnHint : t.foEnforceOffHint}
              checked={settings.enforce}
              onChange={(enforce) => void save({ enforce })}
              disabled={saving}
              testId="finops-enforce"
            />
            <div className="grid gap-4 md:grid-cols-3">
              {LIMIT_KEYS.map((key) => {
                const invalid = parseLimit(drafts[key], FINOPS_LIMIT_MAX[key]) === null;
                return (
                  <label key={key} className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {limitMeta[key].icon}
                      {limitMeta[key].label}
                    </span>
                    <input
                      inputMode="numeric"
                      value={drafts[key]}
                      onChange={(e) => onLimitChange(key, e.target.value)}
                      disabled={!settings.enforce}
                      aria-invalid={invalid}
                      data-testid={`finops-${key}`}
                      className={`w-full rounded-lg border bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono disabled:opacity-50 ${
                        invalid ? 'border-rose-500' : 'border-slate-200 dark:border-slate-700'
                      }`}
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      {invalid ? t.foInvalid : limitMeta[key].hint}
                    </span>
                  </label>
                );
              })}
            </div>
            {settings.updatedBy && (
              <p className="text-[11px] text-slate-500">
                {t.foUpdatedBy} {settings.updatedBy}
                {settings.updatedAt ? ` · ${new Date(settings.updatedAt).toLocaleString()}` : ''}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                {t.foUsageToday}
              </h2>
              <span className="text-[11px] text-slate-500">{t.foApprox}</span>
            </div>
            {!usage.available ? (
              <p className="text-sm text-slate-500" data-testid="finops-usage-unavailable">
                {t.foUsageUnavailable}
              </p>
            ) : (
              <>
                <div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{t.foPlatformTokens}</span>
                    <span className="font-mono" data-testid="finops-global-tokens">
                      {formatTokens(usage.globalTokens)}
                      {globalCap > 0 ? ` / ${formatTokens(globalCap)}` : ''}
                    </span>
                  </div>
                  {globalCap > 0 && (
                    <div className="mt-2 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${globalPct >= 90 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${globalPct}%` }}
                      />
                    </div>
                  )}
                </div>
                {usage.topUsers.length === 0 ? (
                  <p className="text-sm text-slate-500">{t.foNoUsage}</p>
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    {usage.topUsers.map((u) => (
                      <li key={u.userId} className="flex justify-between py-1.5">
                        <span className="font-mono text-xs truncate">{u.userId}</span>
                        <span className="font-mono">{formatTokens(u.tokens)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};

export default AdminFinOpsView;
