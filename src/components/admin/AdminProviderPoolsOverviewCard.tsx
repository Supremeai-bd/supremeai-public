import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  Layers,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  calculateAccountRunway,
  getDaysUntilReset,
  useProviderAccountsStore,
} from '../../stores/useProviderAccountsStore';
import { useAuthStore } from '../../stores/useAuthStore';

export const AdminProviderPoolsOverviewCard: React.FC = () => {
  const actor = useAuthStore((s) => s.authUser?.email || 'admin');
  const { accounts, policies, triggerPoolFailover, autoRebalanceAllPools } =
    useProviderAccountsStore();

  const overview = useMemo(() => {
    const byProvider = new Map<string, typeof accounts>();
    for (const acc of accounts) {
      const list = byProvider.get(acc.providerId) || [];
      list.push(acc);
      byProvider.set(acc.providerId, list);
    }

    const pools = Array.from(byProvider.entries()).map(([providerId, list]) => {
      const sorted = [...list].sort((a, b) => a.priority - b.priority);
      const primary = sorted[0];
      const standby = sorted.find(
        (a) => a.id !== primary.id && a.status !== 'paused' && a.status !== 'exhausted'
      );
      const primaryRunway = calculateAccountRunway(primary);
      const total429 = list.reduce((s, a) => s + a.errors24h.http429, 0);
      const total402 = list.reduce((s, a) => s + a.errors24h.http402, 0);
      const resetDays = getDaysUntilReset(primary.resetDayOfMonth);
      return {
        providerId: primary.providerId,
        providerLabel: primary.providerLabel,
        accountCount: list.length,
        primary,
        standby,
        primaryRunway,
        total429,
        total402,
        resetDays,
        autoFailover: policies[primary.providerId]?.autoFailoverEnabled ?? true,
      };
    });

    const riskRank = { critical: 0, warning: 1, nominal: 2 };
    pools.sort((a, b) => {
      if (riskRank[a.primaryRunway.severity] !== riskRank[b.primaryRunway.severity]) {
        return riskRank[a.primaryRunway.severity] - riskRank[b.primaryRunway.severity];
      }
      return b.primaryRunway.usagePct - a.primaryRunway.usagePct;
    });

    const atRiskPools = pools.filter((p) => p.primaryRunway.severity !== 'nominal').length;

    return {
      pools,
      totalAccounts: accounts.length,
      atRiskPools,
    };
  }, [accounts, policies]);

  return (
    <section
      aria-label="Multi-Account Provider Pools Watch"
      className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="w-4 h-4 text-[#4a70e8] shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Multi-Account Provider Pools & Quota Runway Watch
            </h2>
            {overview.atRiskPools > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                {overview.atRiskPools} pool{overview.atRiskPools > 1 ? 's' : ''} near limit
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                All pools nominal
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
            {overview.totalAccounts} accounts across {overview.pools.length} providers · Zero-login
            runway, 429/402 watch & 1-click failover
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {overview.atRiskPools > 0 && (
            <button
              type="button"
              onClick={() => autoRebalanceAllPools(actor)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Auto-Rebalance</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {overview.pools.slice(0, 4).map((pool) => (
          <div
            key={pool.providerId}
            className={`p-3.5 rounded-xl border space-y-2.5 flex flex-col justify-between ${
              pool.primaryRunway.severity === 'critical'
                ? 'border-rose-300/90 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20'
                : pool.primaryRunway.severity === 'warning'
                  ? 'border-amber-300/90 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/20'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {pool.providerLabel}
                </span>
                <span className="text-[10.5px] font-mono text-slate-400 shrink-0">
                  {pool.accountCount} accts
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">
                Primary: <strong>{pool.primary.accountAlias}</strong>
              </div>
              <div className="text-[10.5px] font-mono text-slate-400 truncate">
                {pool.primary.ownerEmail}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span
                  className={`font-bold ${
                    pool.primaryRunway.severity === 'critical'
                      ? 'text-rose-600 dark:text-rose-400'
                      : pool.primaryRunway.severity === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {pool.primaryRunway.usagePct}% · {pool.primaryRunway.label}
                </span>
                <span className="inline-flex items-center gap-0.5 text-slate-400">
                  <CalendarClock className="w-3 h-3" />
                  {pool.resetDays}d
                </span>
              </div>

              <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(4, pool.primaryRunway.usagePct)}%`,
                    backgroundColor:
                      pool.primaryRunway.severity === 'critical'
                        ? '#e11d48'
                        : pool.primaryRunway.severity === 'warning'
                          ? '#d97706'
                          : '#16a34a',
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[10.5px] font-mono pt-0.5">
                <span
                  className={
                    pool.total429 + pool.total402 > 0
                      ? 'text-rose-600 dark:text-rose-400 font-semibold'
                      : 'text-slate-400'
                  }
                >
                  429:{pool.total429} · 402:{pool.total402}
                </span>

                {pool.standby && pool.primaryRunway.severity !== 'nominal' ? (
                  <button
                    type="button"
                    onClick={() => triggerPoolFailover(pool.providerId, actor)}
                    className="inline-flex items-center gap-1 text-[#4a70e8] dark:text-[#8aa4ff] font-semibold hover:underline cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    <span>Failover</span>
                  </button>
                ) : (
                  <span className="text-slate-400 truncate max-w-[110px]">
                    {pool.standby ? `Next: ${pool.standby.accountAlias}` : 'Single acct'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
