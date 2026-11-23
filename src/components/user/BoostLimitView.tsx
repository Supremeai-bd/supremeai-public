import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Shield,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  KeyRound,
  RefreshCw,
  Plus,
  Flame,
  Layers,
  Check,
  X,
} from 'lucide-react';
import { POOL_PROVIDER_MANIFESTS, PoolProviderManifest } from '../../constants/poolProvidersManifest';
import { poolService, UserQuotaResponse } from '../../services/poolService';

interface ContributedKeyItem {
  id: string;
  provider: string;
  keyMasked: string;
  status: 'valid' | 'pending' | 'invalid';
  bonusTokens: number;
  addedAt: string;
}

export const BoostLimitView: React.FC = () => {
  const [manifests, setManifests] = useState<PoolProviderManifest[]>(POOL_PROVIDER_MANIFESTS);
  const [quota, setQuota] = useState<UserQuotaResponse>({
    user_id: '',
    valid_keys_count: 0,
    daily_bonus_tokens: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<PoolProviderManifest | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Local state for recently contributed keys to show table feedback
  const [recentKeys, setRecentKeys] = useState<ContributedKeyItem[]>(() => {
    try {
      const saved = localStorage.getItem('supremeai_contributed_keys_cache');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [provs, q] = await Promise.all([
        poolService.getProviders(),
        poolService.getQuota(),
      ]);
      if (provs && provs.length) setManifests(provs);
      if (q) setQuota(q);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenConnect = (provider: PoolProviderManifest) => {
    setSelectedProvider(provider);
    setInputKey('');
    setSubmitError(null);
    setSubmitSuccess(null);
  };

  const handleCloseModal = () => {
    setSelectedProvider(null);
    setInputKey('');
    setSubmitError(null);
    setSubmitSuccess(null);
  };

  const isKeyFormatValid = useCallback(() => {
    if (!selectedProvider || !inputKey.trim()) return false;
    try {
      const re = new RegExp(selectedProvider.keyPattern);
      return re.test(inputKey.trim());
    } catch {
      return inputKey.trim().length >= 10;
    }
  }, [selectedProvider, inputKey]);

  const handleSubmitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider || !inputKey.trim()) return;

    if (!isKeyFormatValid()) {
      setSubmitError('Key format does not match the expected pattern for this provider.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await poolService.contributeKey(selectedProvider.id, inputKey.trim());
      setSubmitSuccess(`🎉 Success! Key verified and added. You received +${selectedProvider.bonusTokensPerDay.toLocaleString()} daily tokens!`);

      // Add to local recent keys list
      const masked = inputKey.trim().slice(0, 7) + '...' + inputKey.trim().slice(-4);
      const newKeyItem: ContributedKeyItem = {
        id: `key_${Date.now()}`,
        provider: selectedProvider.id,
        keyMasked: masked,
        status: 'valid',
        bonusTokens: selectedProvider.bonusTokensPerDay,
        addedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const updated = [newKeyItem, ...recentKeys.slice(0, 9)];
      setRecentKeys(updated);
      try {
        localStorage.setItem('supremeai_contributed_keys_cache', JSON.stringify(updated));
      } catch {}

      // Update quota state immediately
      setQuota((prev) => ({
        ...prev,
        valid_keys_count: Math.min(10, prev.valid_keys_count + 1),
        daily_bonus_tokens: prev.daily_bonus_tokens + selectedProvider.bonusTokensPerDay,
      }));

      setTimeout(() => {
        handleCloseModal();
      }, 2200);
    } catch (err: any) {
      setSubmitError(err.message || 'Verification failed. Please check that the key is active.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-cyan-500/10 border border-amber-500/20 p-6 md:p-8 backdrop-blur-sm">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-500 text-xs font-semibold tracking-wide">
              <Zap className="w-3.5 h-3.5 animate-pulse" />
              <span>COMMUNITY COMPUTE FLEET & BONUS QUOTA</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Boost Your Limit with AI Keys
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              Donate your free tier AI provider keys to the SupremeAI collective mesh. In exchange,
              unlock <strong className="text-amber-500">+100,000 to +150,000 daily free tokens</strong> for every active key!
            </p>
          </div>

          {/* Live Quota Badge Card */}
          <div className="flex flex-row md:flex-col items-center justify-between p-4 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-lg min-w-[220px]">
            <div className="text-left md:text-center">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Daily Active Bonus
              </span>
              <div className="text-2xl font-black text-amber-500 flex items-center gap-1 md:justify-center">
                <span>+{quota.daily_bonus_tokens.toLocaleString()}</span>
                <span className="text-xs text-slate-400 font-normal">Tokens/Day</span>
              </div>
            </div>
            <div className="mt-0 md:mt-2 pt-0 md:pt-2 border-l md:border-l-0 md:border-t border-slate-200 dark:border-slate-800 pl-4 md:pl-0 flex items-center justify-between w-full text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>Active Keys:</span>
              <span className="font-mono text-emerald-500 font-bold">{quota.valid_keys_count} / 10 Cap</span>
            </div>
          </div>
        </div>
      </div>

      {/* Manifest Provider Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Available Fleet Nodes (1-Click Connect)
            </h2>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {manifests.map((prov) => {
            const isKilo = prov.id === 'kilo';
            return (
              <div
                key={prov.id}
                className={`relative group rounded-xl p-5 transition-all duration-200 flex flex-col justify-between ${
                  isKilo
                    ? 'bg-gradient-to-b from-amber-500/10 to-transparent border-2 border-amber-500/40 shadow-lg shadow-amber-500/5'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs'
                }`}
              >
                {isKilo && (
                  <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[10px] font-bold tracking-wide uppercase shadow-xs flex items-center gap-1">
                    <Flame className="w-3 h-3" />
                    <span>👑 VIP MASTER KEY</span>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl p-2 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                        {prov.logo}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                          {prov.name}
                        </h3>
                        <span className="inline-block text-[10px] font-mono text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/40 px-1.5 py-0.5 rounded">
                          {prov.speedBadge}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed min-h-[36px]">
                    {prov.description}
                  </p>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {prov.badge}
                    </span>
                    <span className="font-bold text-amber-500 font-mono text-xs">
                      +{prov.bonusTokensPerDay.toLocaleString()} / Day
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenConnect(prov)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      isKilo
                        ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm'
                        : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Connect Key</span>
                  </button>

                  <a
                    href={prov.gmailAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open Provider Console"
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Connected Keys Table / Live Feedback */}
      {recentKeys.length > 0 && (
        <div className="space-y-3 pt-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Recently Connected Fleet Nodes
            </h2>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-mono">
                <tr>
                  <th className="py-2.5 px-4">Provider</th>
                  <th className="py-2.5 px-4">Key Preview</th>
                  <th className="py-2.5 px-4">Bonus Tokens</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Added Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {recentKeys.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-bold capitalize text-slate-800 dark:text-slate-200">
                      {item.provider}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">{item.keyMasked}</td>
                    <td className="py-2.5 px-4 text-amber-500 font-bold">
                      +{item.bonusTokens.toLocaleString()} / Day
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Active</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">{item.addedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Connect Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="text-2xl p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  {selectedProvider.logo}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Connect {selectedProvider.name}
                  </h3>
                  <p className="text-xs text-amber-500 font-semibold font-mono">
                    Reward: +{selectedProvider.bonusTokensPerDay.toLocaleString()} Tokens/Day
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Helper Step */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <div className="flex items-center justify-between font-medium">
                <span>1. Open provider console with Gmail:</span>
                <a
                  href={selectedProvider.gmailAuthUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 font-semibold hover:underline"
                >
                  <span>Open Console</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                2. Generate or copy your free API key, then paste it below.
              </p>
            </div>

            <form onSubmit={handleSubmitKey} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>API Key</span>
                  {inputKey && (
                    <span
                      className={`text-[10px] font-mono flex items-center gap-1 ${
                        isKeyFormatValid() ? 'text-emerald-500' : 'text-amber-500'
                      }`}
                    >
                      {isKeyFormatValid() ? (
                        <>
                          <Check className="w-3 h-3" /> Format Valid
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3" /> Checking Format...
                        </>
                      )}
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="Paste your API key here..."
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-xs focus:outline-hidden focus:ring-2 focus:ring-amber-500/50"
                />
              </div>

              {submitError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {submitSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>{submitSuccess}</span>
                </div>
              )}

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !inputKey.trim()}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying Key...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Verify & Earn Bonus</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
