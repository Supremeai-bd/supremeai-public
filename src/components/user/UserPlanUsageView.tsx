import React, { useMemo, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  CreditCard,
  Zap,
  Download,
  CheckCircle,
  PieChart,
  Activity,
  Wallet,
  TrendingUp,
  Sparkles,
} from 'lucide-react';
import { BillingInvoice, ChatSession, PlanTier } from '../../types';
import { SUPREMEAI_MODELS } from '../../data/models';
import { getPlanSpec, TOPUP_PACKAGES } from '../../config/plans';
import {
  usageService,
  WalletData,
  BillingAnalytics,
  DailyUsageMetric,
} from '../../services/usageService';
import { toast } from '../../stores/useToastStore';
import { useI18n } from '../../utils/i18n';

interface UserPlanUsageViewProps {
  planTier: PlanTier;
  invoices: BillingInvoice[];
  currentTokensUsed: number;
  tokensLimit: number;
  sessions: ChatSession[];
  darkMode?: boolean;
  onTopUpTokens: (addedTokens: number, costUsd: number) => void;
}

interface DayActivity {
  date: string;
  dayName: string;
  userMessages: number;
  assistantMessages: number;
  totalMessages: number;
  estimatedTokens: number;
}

export const UserPlanUsageView: React.FC<UserPlanUsageViewProps> = ({
  planTier,
  invoices,
  currentTokensUsed,
  tokensLimit,
  sessions,
  darkMode,
  onTopUpTokens,
}) => {
  const { t, lang } = useI18n();
  const [sectionTab, setSectionTab] = useState<'overview' | 'activity' | 'invoices'>('overview');
  const [metricView, setMetricView] = useState<'stacked' | 'total'>('stacked');
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const defaultTopUpPkg = TOPUP_PACKAGES[1] || TOPUP_PACKAGES[0];
  const [selectedTopUpTier, setSelectedTopUpTier] = useState<{ tokens: number; cost: number }>({
    tokens: defaultTopUpPkg.tokensBonus,
    cost: defaultTopUpPkg.amountUsd,
  });
  const [topUpSuccess, setTopUpSuccess] = useState(false);

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [analytics, setAnalytics] = useState<BillingAnalytics | null>(null);
  const [dbMetrics, setDbMetrics] = useState<DailyUsageMetric[]>([]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      usageService.getWallet(),
      usageService.getAnalytics(),
      usageService.getUsageMetrics(7),
    ]).then(([w, a, m]) => {
      if (!isMounted) return;
      if (w) setWallet(w);
      if (a) setAnalytics(a);
      if (m && m.length > 0) setDbMetrics(m);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const usagePercent = Math.min(
    100,
    Math.round((currentTokensUsed / Math.max(1, tokensLimit)) * 100)
  );

  const activityData: DayActivity[] = useMemo(() => {
    const days: DayActivity[] = [];
    const now = new Date();

    const sessionDayCounts: Record<string, { user: number; assistant: number }> = {};
    sessions.forEach((s) => {
      s.messages.forEach((m) => {
        const dateKey = new Date(m.timestamp).toISOString().slice(0, 10);
        if (!sessionDayCounts[dateKey]) {
          sessionDayCounts[dateKey] = { user: 0, assistant: 0 };
        }
        if (m.role === 'user') sessionDayCounts[dateKey].user++;
        if (m.role === 'assistant') sessionDayCounts[dateKey].assistant++;
      });
    });

    const locale = lang === 'bn' ? 'bn-BD' : 'en-US';
    for (let offset = 6; offset >= 0; offset--) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() - offset);
      const dateKey = targetDate.toISOString().slice(0, 10);
      const dayName = targetDate.toLocaleDateString(locale, { weekday: 'short' });
      const dbMatch = dbMetrics.find((m) => m.metric_date === dateKey);
      const real = sessionDayCounts[dateKey] || { user: 0, assistant: 0 };
      const total = real.user + real.assistant;
      const estimatedFromMessages = sessions.reduce((acc, s) => {
        return (
          acc +
          s.messages
            .filter((m) => new Date(m.timestamp).toISOString().slice(0, 10) === dateKey)
            .reduce((mAcc, m) => mAcc + Math.max(12, Math.ceil((m.content?.length || 0) / 4)), 0)
        );
      }, 0);
      const totalTokens = dbMatch ? dbMatch.total_tokens : estimatedFromMessages;

      days.push({
        date: dateKey,
        dayName,
        userMessages: real.user,
        assistantMessages: real.assistant,
        totalMessages: total,
        estimatedTokens: totalTokens,
      });
    }

    return days;
  }, [sessions, dbMetrics, lang]);

  const modelBreakdown = useMemo(() => {
    const palette = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
    const byModel: Record<string, { modelName: string; tokens: number }> = {};
    sessions.forEach((s) => {
      s.messages.forEach((m) => {
        if (m.role !== 'assistant') return;
        const modelId = m.model || s.model || 'supreme-core';
        const matched = SUPREMEAI_MODELS.find((mod) => mod.id === modelId);
        const displayName = matched ? matched.name : modelId;
        const estTokens = Math.max(20, Math.ceil((m.content?.length || 0) / 4));
        if (!byModel[displayName]) {
          byModel[displayName] = { modelName: displayName, tokens: 0 };
        }
        byModel[displayName].tokens += estTokens;
      });
    });

    const entries = Object.values(byModel).sort((a, b) => b.tokens - a.tokens);
    const total = entries.reduce((sum, e) => sum + e.tokens, 0);
    if (total === 0) return [];
    return entries.map((e, idx) => ({
      model: e.modelName,
      tokens: e.tokens,
      percentage: Math.max(1, Math.round((e.tokens / total) * 100)),
      cost: `$${((e.tokens / 1000000) * 1.2).toFixed(2)}`,
      color: palette[idx % palette.length],
    }));
  }, [sessions]);

  const totalMessages7Days = activityData.reduce((acc, d) => acc + d.totalMessages, 0);
  const totalTokens7Days = activityData.reduce((acc, d) => acc + d.estimatedTokens, 0);
  const avgMessagesPerDay = Math.round(totalMessages7Days / 7);
  const peakDay =
    activityData.length > 0
      ? activityData.reduce(
          (max, cur) => (cur.totalMessages > max.totalMessages ? cur : max),
          activityData[0]
        )
      : undefined;

  const handleTopUpConfirm = () => {
    onTopUpTokens(selectedTopUpTier.tokens, selectedTopUpTier.cost);
    setTopUpSuccess(true);
    setTimeout(() => {
      setTopUpSuccess(false);
      setIsTopUpModalOpen(false);
    }, 1200);
  };

  const handleDownloadReceipt = (inv: BillingInvoice) => {
    const content = `SupremeAI Studio Receipt\nInvoice: ${inv.invoiceNumber}\nItem: ${inv.planName}\nDate: ${inv.date}\nAmount: $${inv.amountUsd.toFixed(2)}\nStatus: ${inv.status}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${inv.invoiceNumber}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t.receiptDownloadedTitle, `${inv.invoiceNumber}.txt`);
  };

  const planSpec = getPlanSpec(planTier);
  const planPriceLabel = `$${planSpec.monthlyPriceUsd.toFixed(2)} ${t.perMonthUnit}`;

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload: DayActivity }>;
  }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as DayActivity;
      return (
        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl text-xs space-y-1.5 font-sans z-50">
          <div className="font-bold text-slate-900 dark:text-white flex items-center justify-between gap-4">
            <span>
              {data.dayName} · {data.date}
            </span>
            <span className="font-mono tabular-nums text-slate-500">
              {data.totalMessages} {t.messagesWord}
            </span>
          </div>
          <div className="pt-1 space-y-1 text-[11px] border-t border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between text-blue-600 dark:text-blue-400">
              <span>{t.filterYou}:</span>
              <span className="font-mono font-semibold tabular-nums">{data.userMessages}</span>
            </div>
            <div className="flex items-center justify-between text-purple-600 dark:text-purple-400">
              <span>{t.filterAi}:</span>
              <span className="font-mono font-semibold tabular-nums">{data.assistantMessages}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
              <span>{t.creditsWord}:</span>
              <span className="font-mono tabular-nums">
                ~{(data.estimatedTokens / 1000).toFixed(1)}k
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 workspace-container space-y-6 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.planUsageStdTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.planUsageStdDesc}</p>
        </div>

        <button
          type="button"
          onClick={() => setIsTopUpModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold theme-btn-primary cursor-pointer shrink-0 whitespace-nowrap"
        >
          <Zap className="w-4 h-4" />
          <span>{t.topUpCreditsBtn}</span>
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl w-fit text-xs border border-slate-200/70 dark:border-slate-700/60">
        {(
          [
            { id: 'overview', label: t.tabOverviewQuota },
            { id: 'activity', label: t.tab7DayActivity },
            { id: 'invoices', label: t.tabInvoicesTopUp },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSectionTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-lg font-medium transition-all cursor-pointer whitespace-nowrap ${
              sectionTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {sectionTab === 'overview' && (
        <div className="space-y-6">
          {/* Plan Card & Token Meter */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold uppercase tracking-wider text-blue-100">
                  {t.currentPlanLabel}
                </span>
                <span className="font-mono text-blue-100">{t.monthlyLabel}</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {planTier} {t.planBadgeSuffix}
                </h2>
                <p className="text-xs text-blue-100 mt-0.5 font-mono">
                  {planPriceLabel} · {t.autoRenewActive}
                </p>
              </div>
              <div className="space-y-1.5 pt-2 border-t border-white/20 text-xs text-blue-50">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{t.planFeatModels}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{t.planFeatTeam}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{t.planFeatResearch}</span>
                </div>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 md:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t.monthlyCreditsTitle}
                  </h3>
                  <p className="text-xs text-slate-400">{t.activeBillingQuota}</p>
                </div>
                <span className="text-xs font-mono tabular-nums font-bold theme-accent-text">
                  {currentTokensUsed.toLocaleString()} / {tokensLimit.toLocaleString()}{' '}
                  {t.creditsWord}
                </span>
              </div>

              <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usagePercent > 85 ? 'bg-amber-500' : 'bg-[var(--theme-accent)]'
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>
                  {usagePercent}% {t.utilizedLabel}
                </span>
                <span>
                  {Math.max(0, tokensLimit - currentTokensUsed).toLocaleString()} {t.creditsWord}{' '}
                  {t.remainingLabel}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  {t.needExtraStd}
                </span>
                <button
                  type="button"
                  onClick={() => setIsTopUpModalOpen(true)}
                  className="theme-accent-text font-semibold hover:underline cursor-pointer"
                >
                  {t.addPayAsYouGo}
                </button>
              </div>
            </div>
          </div>

          {/* Model Breakdown */}
          <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <PieChart className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t.usageByModelTitle}
                </h3>
              </div>
              <span className="text-xs text-slate-400">{t.currentCycleLabel}</span>
            </div>

            <div className="space-y-3.5">
              {modelBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                  {t.noModelUsageYet}
                </p>
              ) : (
                modelBreakdown.map((item) => (
                  <div key={item.model} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        {item.model}
                      </span>
                      <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                        <span className="text-slate-400">
                          {item.tokens.toLocaleString()} {t.creditsWord} ({item.percentage}%)
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {item.cost}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {sectionTab === 'activity' && (
        <div className="space-y-6">
          {/* KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t.accountCreditLabel}
                </span>
                <Wallet className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  ${(wallet?.balanceUsd ?? 0).toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono">
                  {t.allowanceLabel}: ${(wallet?.monthlyAllowanceUsd ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t.usageCostLabel}
                </span>
                <TrendingUp className="w-4 h-4 text-blue-500" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  ${(analytics?.totalSpent ?? 0).toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono">
                  {t.smartSavingsLabel}: +$
                  {(analytics?.totalSaved ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t.messages7DayLabel}
                </span>
                <Sparkles className="w-4 h-4 text-purple-500" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {totalMessages7Days}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {`${t.peakLabel}: ${peakDay?.dayName || '—'} (${peakDay?.totalMessages ?? 0} ${t.messagesWord})`}
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t.dailyAverageLabel}
                </span>
                <Activity className="w-4 h-4 text-cyan-500" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {avgMessagesPerDay}{' '}
                  <span className="text-xs font-normal text-slate-400 font-sans">
                    {t.msgsPerDayUnit}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
                  {totalMessages7Days} {t.totalMessagesLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t.dailyActivityTitle}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.dailyActivityStdDesc}
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setMetricView('stacked')}
                  className={`px-3 py-1 rounded-md font-medium cursor-pointer ${
                    metricView === 'stacked'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  {t.youVsAssistantBtn}
                </button>
                <button
                  type="button"
                  onClick={() => setMetricView('total')}
                  className={`px-3 py-1 rounded-md font-medium cursor-pointer ${
                    metricView === 'total'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  {t.totalBtn}
                </button>
              </div>
            </div>

            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={darkMode ? '#1E293B' : '#F1F5F9'}
                  />
                  <XAxis
                    dataKey="dayName"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: '#94A3B8' }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: '#94A3B8' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {metricView === 'stacked' ? (
                    <>
                      <Bar
                        dataKey="userMessages"
                        name={t.filterYou}
                        stackId="a"
                        fill="#3B82F6"
                        maxBarSize={44}
                      />
                      <Bar
                        dataKey="assistantMessages"
                        name={t.filterAi}
                        stackId="a"
                        fill="#8B5CF6"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={44}
                      />
                    </>
                  ) : (
                    <Bar
                      dataKey="totalMessages"
                      name={t.totalBtn}
                      fill="#3B82F6"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={44}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {sectionTab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-slate-500" />
              <span>{t.invoiceHistoryTitle}</span>
            </h3>
            <span className="text-xs text-slate-400">{t.billingReceiptsLabel}</span>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="px-4 py-3">{t.colInvoice}</th>
                    <th className="px-4 py-3">{t.colBillingItem}</th>
                    <th className="px-4 py-3">{t.colDate}</th>
                    <th className="px-4 py-3">{t.colAmount}</th>
                    <th className="px-4 py-3">{t.colStatus}</th>
                    <th className="px-4 py-3 text-right">{t.colReceipt}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-3.5 font-mono text-slate-900 dark:text-white font-semibold">
                        {inv.invoiceNumber}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {inv.planName}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-400">{inv.date}</td>
                      <td className="px-4 py-3.5 font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        ${inv.amountUsd.toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-emerald-600 dark:text-emerald-400 font-medium capitalize">
                        {inv.status}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDownloadReceipt(inv)}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>{t.receiptBtn}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Top-Up Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-600" />
                <span>{t.topUpModalTitle}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsTopUpModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {topUpSuccess ? (
              <div className="py-6 text-center space-y-2">
                <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t.creditsAddedTitle}
                </h4>
                <p className="text-xs text-slate-500 font-mono">
                  +{selectedTopUpTier.tokens.toLocaleString()} {t.tokensWord} {t.creditsAddedSub}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 dark:text-slate-300">{t.topUpNeverExpire}</p>

                <div className="space-y-2.5">
                  {TOPUP_PACKAGES.map((pkg) => {
                    const label =
                      pkg.badgeKey === 'popular'
                        ? t.topupPkgPopular
                        : pkg.badgeKey === 'bestValue'
                          ? t.topupPkgBestValue
                          : t.topupPkgStandard;
                    return (
                      <div
                        key={pkg.id}
                        onClick={() =>
                          setSelectedTopUpTier({ tokens: pkg.tokensBonus, cost: pkg.amountUsd })
                        }
                        className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          selectedTopUpTier.cost === pkg.amountUsd
                            ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/30'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                            {pkg.tokensBonus.toLocaleString()} {t.tokensWord}
                          </div>
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            {label}
                          </div>
                        </div>
                        <span className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          ${pkg.amountUsd}.00
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsTopUpModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t.cancelBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleTopUpConfirm}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                  >
                    {t.confirmChargeBtn} ${selectedTopUpTier.cost}.00
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
