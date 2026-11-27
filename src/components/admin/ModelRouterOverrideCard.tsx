import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Zap } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { OptionSelect, type OptionSelectItem } from '../ui/OptionSelect';
import { SegmentedControl } from '../ui/SegmentedControl';
import { guardAdminAction } from '../../utils/adminGuard';
import { adminWriteErrorMessage } from '../../utils/adminWriteError';
import { toast } from '../../stores/useToastStore';
import { modelRouterService, type ModelRouterState } from '../../services/modelRouterService';

/**
 * বাংলা মন্তব্য: মডেল-রাউটার ওভাররাইড কার্ড — core-এর আসল রাউটিং অবস্থা দেখায় ও বদলায়।
 * নিয়ম মেনে: প্রোভাইডার = ড্রপডাউন, মডেল = তার উপর নির্ভরশীল সাব-ড্রপডাউন, সময় = ৩টা অপশনের
 * segmented বাটন। প্রয়োগ/বন্ধ দুটোই SafetyGate দিয়ে; কোনো ম্যানুয়াল রিফ্রেশ নেই।
 */

const AUTO_MODEL = '__auto__';
type Duration = '10' | '100' | '0';

export const ModelRouterOverrideCard: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<ModelRouterState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState(AUTO_MODEL);
  const [duration, setDuration] = useState<Duration>('10');

  const load = useCallback(async () => {
    try {
      const next = await modelRouterService.getState();
      setState(next);
      setLoadError(null);
      setProvider((current) => current || next.providers[0]?.id || '');
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, t.mrLoadError));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const providerOptions: OptionSelectItem[] = useMemo(
    () =>
      (state?.providers ?? []).map((p) => ({
        value: p.id,
        label: p.id,
        description: `${p.status}${p.latencyMs ? ` · ${Math.round(p.latencyMs)} ms` : ''}`,
        badge: p.status === 'healthy' ? undefined : '!',
      })),
    [state]
  );

  const modelOptions: OptionSelectItem[] = useMemo(() => {
    const models = state?.providers.find((p) => p.id === provider)?.models ?? [];
    return [
      { value: AUTO_MODEL, label: t.mrModelAuto },
      ...models.map((m) => ({ value: m, label: m.slice(provider.length + 1) || m })),
    ];
  }, [state, provider, t]);

  const durationOptions = useMemo(
    () => [
      { value: '10' as const, label: t.mrDuration10 },
      { value: '100' as const, label: t.mrDuration100 },
      { value: '0' as const, label: t.mrUntilOff },
    ],
    [t]
  );

  const changeProvider = (next: string) => {
    setProvider(next);
    setModel(AUTO_MODEL); // sub-choice depends on the parent
  };

  const apply = () => {
    if (!provider) return;
    const chosenModel = model === AUTO_MODEL ? null : model;
    const remaining = Number(duration);
    guardAdminAction({
      title: `সব AI অনুরোধ ${chosenModel || provider}-এ পাঠাবেন`,
      description:
        remaining > 0
          ? `পরের ${remaining}টি অনুরোধ আগে এখানে যাবে, তারপর সিস্টেম নিজে থেকে স্বয়ংক্রিয়ে ফিরবে।`
          : 'বন্ধ না করা পর্যন্ত সব অনুরোধ আগে এখানে যাবে। ব্যর্থ হলে বাকি চেইন ব্যাকআপ থাকে।',
      impactSummary: `provider=${provider}\nmodel=${chosenModel || '(auto)'}\nrequests=${remaining || 'until off'}`,
      riskLevel: 'critical',
      run: async () => {
        try {
          await modelRouterService.setOverride(provider, chosenModel, remaining);
          toast.success(t.mrTitle, `${chosenModel || provider}`);
        } catch (err) {
          toast.error(t.mrTitle, adminWriteErrorMessage(err, 'Override failed.'));
        }
        await load();
      },
    });
  };

  const turnOff = () => {
    guardAdminAction({
      title: 'মডেল ওভাররাইড বন্ধ করবেন',
      description: 'সিস্টেম আবার নিজেই সেরা মডেল বাছবে।',
      impactSummary: `override=${state?.override?.model || state?.override?.provider || '-'}`,
      riskLevel: 'medium',
      run: async () => {
        try {
          await modelRouterService.clearOverride();
          toast.info(t.mrTitle, t.mrAutoState);
        } catch (err) {
          toast.error(t.mrTitle, adminWriteErrorMessage(err, 'Could not turn off.'));
        }
        await load();
      },
    });
  };

  const override = state?.override;

  return (
    <section
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-4"
      data-testid="model-router-override"
    >
      <div className="flex items-start gap-2">
        <Route className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t.mrTitle}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.mrSubtitle}</p>
        </div>
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {loadError}
        </p>
      ) : !state ? (
        <p className="text-xs text-slate-400">…</p>
      ) : (
        <>
          {override ? (
            <div
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
              data-testid="model-router-active"
            >
              <div className="text-xs text-amber-800 dark:text-amber-300">
                <div className="font-semibold flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  {t.mrActiveState}: {override.model || override.provider}
                </div>
                <div className="mt-0.5">
                  {override.remainingRequests > 0
                    ? `${override.remainingRequests} ${t.mrRequestsLeft}`
                    : t.mrUntilOff}
                  {override.setBy ? ` · ${t.mrSetBy} ${override.setBy}` : ''}
                  {override.setAt ? ` · ${new Date(override.setAt).toLocaleString()}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={turnOff}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shrink-0"
              >
                {t.mrTurnOff}
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {t.mrAutoState}
            </div>
          )}

          {providerOptions.length === 0 ? (
            <p className="text-xs text-slate-500">{state.providersError || t.mrNoProviders}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
              <OptionSelect
                label={t.mrProviderLabel}
                value={provider}
                options={providerOptions}
                onChange={changeProvider}
                testId="model-router-provider"
              />
              <OptionSelect
                label={t.mrModelLabel}
                value={model}
                options={modelOptions}
                onChange={setModel}
                testId="model-router-model"
              />
              <SegmentedControl
                label={t.mrDurationLabel}
                value={duration}
                options={durationOptions}
                onChange={setDuration}
                size="sm"
                testId="model-router-duration"
              />
              <button
                type="button"
                onClick={apply}
                disabled={!provider}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                {t.mrApply}
              </button>
            </div>
          )}

          {state.fallbackChain.length > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words">
              <span className="font-medium">{t.mrCurrentOrder}:</span>{' '}
              {state.fallbackChain.slice(0, 6).join(' → ')}
              {state.fallbackChain.length > 6 ? ' → …' : ''}
            </p>
          )}
          <p className="text-[11px] text-slate-400">{t.mrRestartNote}</p>
        </>
      )}
    </section>
  );
};

export default ModelRouterOverrideCard;
