import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Zap,
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  RefreshCw,
  Eye,
  EyeOff,
  ClipboardPaste,
  Trash2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  POOL_PROVIDER_MANIFESTS,
  PoolProviderManifest,
} from '../../constants/poolProvidersManifest';
import {
  ContributedKey,
  MAX_ACTIVE_POOL_KEYS,
  UserQuotaResponse,
  detectPoolProvider,
  isKeyFormatValid,
  maskPoolKey,
  poolService,
} from '../../services/poolService';
import { toast } from '../../stores/useToastStore';
import { useI18n } from '../../utils/i18n';

interface BoostLimitViewProps {
  isGuest?: boolean;
}

const formatTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}K`
      : `${n}`;

/**
 * বাংলা মন্তব্য: "লিমিট বাড়ান" — নিজের Gmail দিয়ে বানানো ফ্রি AI কী যোগ করার ট্যাব (#65-এর ফিচার,
 * নতুন ডিজাইনে ফেরত)। ইউজারকে প্রোভাইডার বাছতে হয় না: কী পেস্ট করলেই ফরম্যাট দেখে নিজে চিনে নেয়,
 * সার্ভার যাচাই করে, তারপর দৈনিক বোনাস যোগ হয়। কাঁচা কী ব্রাউজারে কোথাও জমা থাকে না।
 */
export const BoostLimitView: React.FC<BoostLimitViewProps> = ({ isGuest = false }) => {
  const { lang } = useI18n();
  const bn = lang === 'bn';
  const L = (bnText: string, enText: string) => (bn ? bnText : enText);

  const [manifests, setManifests] = useState<PoolProviderManifest[]>(POOL_PROVIDER_MANIFESTS);
  const [quota, setQuota] = useState<UserQuotaResponse | null>(null);
  const [myKeys, setMyKeys] = useState<ContributedKey[] | null>(null);
  const [loading, setLoading] = useState(true);

  const [rawKey, setRawKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [manualProviderId, setManualProviderId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [provs, q, keys] = await Promise.all([
      poolService.getProviders(),
      poolService.getQuota(),
      poolService.listMyKeys(),
    ]);
    setManifests(provs);
    setQuota(q);
    setMyKeys(keys);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isGuest) void loadData();
  }, [isGuest, loadData]);

  const detected = useMemo(() => detectPoolProvider(rawKey, manifests), [rawKey, manifests]);
  const manualProvider = manifests.find((m) => m.id === manualProviderId) || null;
  const targetProvider = detected || manualProvider;
  const trimmed = rawKey.trim();
  const formatOk = targetProvider ? isKeyFormatValid(trimmed, targetProvider) : false;
  const canSubmit = Boolean(targetProvider && formatOk && !submitting);

  const contributedProviders = useMemo(
    () => new Set((myKeys || []).filter((k) => k.status === 'valid').map((k) => k.provider)),
    [myKeys]
  );
  const activeCount =
    quota?.valid_keys_count ?? (myKeys || []).filter((k) => k.status === 'valid').length;
  const dailyBonus = quota?.daily_bonus_tokens ?? 0;
  const progressPct = Math.min(100, Math.round((activeCount / MAX_ACTIVE_POOL_KEYS) * 100));

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRawKey(text.trim());
        setSubmitError(null);
      }
    } catch {
      toast.info(
        L('পেস্ট করুন', 'Paste manually'),
        L('Ctrl+V দিয়ে কী পেস্ট করুন।', 'Use Ctrl+V to paste the key.')
      );
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!targetProvider || !formatOk) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await poolService.contributeKey(targetProvider.id, trimmed);
      toast.success(
        L('কী যোগ হয়েছে', 'Key added'),
        L(
          `${targetProvider.name} — প্রতিদিন +${formatTokens(res.bonus_earned || targetProvider.bonusTokensPerDay)} টোকেন বোনাস`,
          `${targetProvider.name} — +${formatTokens(res.bonus_earned || targetProvider.bonusTokensPerDay)} bonus tokens / day`
        )
      );
      setRawKey('');
      setManualProviderId(null);
      setShowKey(false);
      await loadData();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : L('কী যোগ করা যায়নি', 'Could not add key')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (key: ContributedKey) => {
    setRemovingId(key.id);
    try {
      await poolService.removeKey(key.id);
      toast.success(L('কী সরানো হয়েছে', 'Key removed'));
      await loadData();
    } catch (err: unknown) {
      toast.error(
        L('সরানো যায়নি', 'Could not remove'),
        err instanceof Error ? err.message : undefined
      );
    } finally {
      setRemovingId(null);
    }
  };

  if (isGuest) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center text-sm text-slate-600 dark:text-slate-300">
        {L('লিমিট বাড়াতে আগে সাইন ইন করুন।', 'Sign in to boost your limit.')}
      </div>
    );
  }

  return (
    <div data-testid="boost-limit-view" className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      {/* ১. হিরো: আজকের বোনাস ও সক্রিয় কী */}
      <section className="rounded-2xl border border-amber-200/70 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 via-white to-cyan-50 dark:from-amber-500/10 dark:via-slate-900 dark:to-cyan-500/10 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              {L('লিমিট বাড়ান', 'Boost your limit')}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md">
              {L(
                'নিজের Gmail দিয়ে ফ্রি AI কী বানান, এখানে পেস্ট করুন। প্রতিটি বৈধ কী-তে প্রতিদিন বোনাস টোকেন যোগ হয়।',
                'Create free AI keys with your own Gmail and paste them here. Every valid key adds bonus tokens every day.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {L('দৈনিক বোনাস', 'Daily bonus')}
              </div>
              <div
                data-testid="boost-daily-bonus"
                className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400"
              >
                {quota === null && !loading ? '—' : `+${formatTokens(dailyBonus)}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              aria-label={L('রিফ্রেশ', 'Refresh')}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            <span>{L('সক্রিয় কী', 'Active keys')}</span>
            <span className="tabular-nums">
              {activeCount}/{MAX_ACTIVE_POOL_KEYS}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-cyan-400 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </section>

      {/* ২. একটাই বক্স: কী পেস্ট করুন — প্রোভাইডার নিজে থেকেই চেনা হবে */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 sm:p-5 space-y-3"
      >
        <label
          htmlFor="boost-key-input"
          className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2"
        >
          <KeyRound className="w-4 h-4 text-cyan-500" />
          {L('আপনার কী পেস্ট করুন', 'Paste your key')}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id="boost-key-input"
              data-testid="boost-key-input"
              type={showKey ? 'text' : 'password'}
              value={rawKey}
              onChange={(e) => {
                setRawKey(e.target.value);
                setSubmitError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder={L('যেমন: AIzaSy… বা gsk_…', 'e.g. AIzaSy… or gsk_…')}
              className="w-full pl-3 pr-10 py-2.5 text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? L('লুকান', 'Hide') : L('দেখান', 'Show')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handlePaste()}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:border-cyan-400 cursor-pointer"
          >
            <ClipboardPaste className="w-4 h-4" />
            {L('পেস্ট', 'Paste')}
          </button>
          <button
            type="submit"
            data-testid="boost-submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {L('যোগ করুন', 'Add')}
          </button>
        </div>

        {/* লাইভ ফিডব্যাক */}
        {trimmed.length > 0 && (
          <div data-testid="boost-detect-status" className="text-xs">
            {detected ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {L(`চেনা গেছে: ${detected.name}`, `Detected: ${detected.name}`)} ·{' '}
                {maskPoolKey(trimmed)} · +{formatTokens(detected.bonusTokensPerDay)}/
                {L('দিন', 'day')}
              </span>
            ) : manualProvider ? (
              formatOk ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {manualProvider.name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {L(
                    `এটা ${manualProvider.name}-এর কী মনে হচ্ছে না`,
                    `This doesn't look like a ${manualProvider.name} key`
                  )}
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                {L(
                  'কী চেনা যায়নি — নিচ থেকে প্রোভাইডার বেছে নিন।',
                  'Key not recognised — pick the provider below.'
                )}
              </span>
            )}
          </div>
        )}
        {submitError && (
          <div
            role="alert"
            className="text-xs rounded-lg px-3 py-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30"
          >
            {submitError}
          </div>
        )}
        <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          {L(
            'কী সার্ভারে যাচাই করে এনক্রিপ্ট করে রাখা হয়। ব্রাউজারে কোথাও জমা থাকে না, কেউ দেখতে পায় না।',
            'Keys are verified and encrypted on the server. Never stored in your browser or shown to anyone.'
          )}
        </p>
      </form>

      {/* ৩. ফ্রি কী কোথায় পাবেন */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" />
          {L('ফ্রি কী কোথায় পাবেন', 'Where to get free keys')}
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {L(
            '"কী নিন" চাপুন → নিজের Gmail দিয়ে লগইন → কী কপি করে উপরে পেস্ট করুন।',
            'Tap "Get key" → sign in with your Gmail → copy the key and paste it above.'
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {manifests.map((m) => {
            const added = contributedProviders.has(m.id);
            const selected = targetProvider?.id === m.id;
            return (
              <div
                key={m.id}
                data-testid={`boost-provider-${m.id}`}
                className={`rounded-xl border p-3 flex flex-col gap-2 transition-colors ${
                  selected
                    ? 'border-cyan-400 bg-cyan-50/60 dark:bg-cyan-500/10'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl leading-none" aria-hidden="true">
                      {m.logo}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {m.name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {m.badge}
                      </div>
                    </div>
                  </div>
                  {added ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      {L('যোগ হয়েছে', 'Added')}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 tabular-nums">
                      +{formatTokens(m.bonusTokensPerDay)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-auto">
                  {m.gmailAuthUrl && (
                    <a
                      href={m.gmailAuthUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90"
                    >
                      {L('কী নিন', 'Get key')}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {!detected && trimmed.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setManualProviderId(m.id)}
                      className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                    >
                      {L('এটাই', 'This one')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ৪. আমার যোগ করা কী */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {L('আমার যোগ করা কী', 'My added keys')}
        </h3>
        {loading && myKeys === null ? (
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {L('লোড হচ্ছে…', 'Loading…')}
          </div>
        ) : myKeys === null ? (
          <div
            data-testid="boost-keys-unavailable"
            className="text-xs text-slate-500 dark:text-slate-400"
          >
            {L(
              'তালিকা এখন আনা যায়নি — সার্ভার সংযোগ ঠিক হলে নিজেই দেখাবে।',
              'Could not load the list right now — it will appear once the server is reachable.'
            )}
          </div>
        ) : myKeys.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {L('এখনো কোনো কী যোগ করেননি।', 'No keys added yet.')}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {myKeys.map((k) => {
              const m = manifests.find((x) => x.id === k.provider);
              const ok = k.status === 'valid';
              return (
                <li key={k.id} className="py-2 flex items-center gap-3 text-xs">
                  <span aria-hidden="true">{m?.logo || '🔑'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 dark:text-white truncate">
                      {m?.name || k.provider}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {k.key_hint || '••••'} · {new Date(k.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      ok
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {ok ? `+${formatTokens(k.bonus_weight)}` : L('অকার্যকর', 'Invalid')}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRemove(k)}
                    disabled={removingId === k.id}
                    aria-label={L('কী সরান', 'Remove key')}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 cursor-pointer"
                  >
                    {removingId === k.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
