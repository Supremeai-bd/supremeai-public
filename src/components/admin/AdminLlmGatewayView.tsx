import React, { useEffect, useState } from 'react';
import { Route, ToggleLeft, ToggleRight, Cpu } from 'lucide-react';
import { LlmGatewayRoute, GatewayProviderLatency, ModelDetail } from '../../types';
import { apiKeyService } from '../../services/apiKeyService';
import { useI18n } from '../../utils/i18n';
import { DataSourceBadge } from '../common/DataSourceBadge';
import { useAdminCollectionSource } from '../../hooks/useAdminCollectionSource';
import { ModelMatrix } from '../ModelMatrix';
import { ModelRouterOverrideCard } from './ModelRouterOverrideCard';

interface AdminLlmGatewayViewProps {
  routes: LlmGatewayRoute[];
  onToggleFailover: (routeId: string) => void;
  onUpdatePrice: (routeId: string, newPrice: number) => void;
  activeModel: ModelDetail;
  onSelectModel: (model: ModelDetail) => void;
  onNavigateToChat: () => void;
}

export const AdminLlmGatewayView: React.FC<AdminLlmGatewayViewProps> = ({
  routes,
  onToggleFailover,
  onUpdatePrice,
  activeModel,
  onSelectModel,
  onNavigateToChat,
}) => {
  const { t } = useI18n();
  // বাংলা মন্তব্য: আগে আলাদা models ট্যাবে থাকা ModelMatrix এখন এই গেটওয়ে ভিউর
  // একটি সাব-ট্যাব হিসেবে মেরামত করা হয়েছে — Routes ও Model Matrix এর মধ্যে স্বচ্ছ স্বিচ্ছায় চলা যায়।
  const [subview, setSubview] = useState<'routes' | 'matrix'>('routes');
  // বাংলা মন্তব্য: আগে onUpdatePrice প্রপ পাওয়া গেছে কিন্তু UI-তে ব্যবহার হয়নি।
  // এখন রিটেইল প্রাইস ভেতরে সরাসরি edit করার সুবিধা যুক্ত করা হচ্ছে —
  // বাটন ক্লিক করলেই PATCH /api/admin/llm-gateway/:id/price endpoint-তে পাঠানো হবে।
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<string>('');

  const startPriceEdit = (routeId: string, currentPrice: number) => {
    setEditingPriceId(routeId);
    setPriceDraft(String(currentPrice));
  };

  const savePrice = (routeId: string) => {
    const parsed = Number(priceDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEditingPriceId(null);
      return;
    }
    onUpdatePrice(routeId, parsed);
    setEditingPriceId(null);
  };

  // বাংলা মন্তব্য: গেটওয়ে রাউট লাইভ সার্ভার থেকে এসেছে কি না — ব্যাজ সত্য বলে।
  const dataSource = useAdminCollectionSource(
    'gateway',
    'LLM গেটওয়ে রাউট এখনো লাইভ সিঙ্ক হয়নি — localStorage ক্যাশ/ফলব্যাক ডেটা দেখানো হচ্ছে।'
  );
  const [providerLatencies, setProviderLatencies] = useState<GatewayProviderLatency[]>([]);

  useEffect(() => {
    let active = true;
    apiKeyService
      .fetchGatewayProviderLatencies()
      .then((res) => {
        if (active && Array.isArray(res?.list)) {
          setProviderLatencies(res.list);
        }
      })
      .catch(() => {
        if (active) setProviderLatencies([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const totalRpm = routes.reduce((acc, r) => acc + r.requestsPerMin, 0);
  const failoverArmedCount = routes.filter((r) => r.autoFailoverActive).length;

  // বাংলা মন্তব্য: costPer1MIn/costPer1MOut অনুপস্থিত থাকলে NaN এড়াতে Number() ফলব্যাক ব্যবহার করা হয়েছে।
  const avgMargin =
    routes.length > 0
      ? (
          routes.reduce((acc, r) => {
            const price = Number(r.customerPricePer1M) || 0;
            if (price <= 0) return acc;
            const avgCost = ((Number(r.costPer1MIn) || 0) + (Number(r.costPer1MOut) || 0)) / 2;
            return acc + ((price - avgCost) / price) * 100;
          }, 0) / routes.length
        ).toFixed(1)
      : '0.0';

  const avgSuccessRate =
    providerLatencies.length > 0
      ? (
          providerLatencies.reduce((acc, p) => acc + (Number(p.successRate) || 0), 0) /
          providerLatencies.length
        ).toFixed(2)
      : routes.length > 0
        ? (
            100 -
            routes.reduce((acc, r) => acc + (Number(r.errorRatePercent) || 0), 0) / routes.length
          ).toFixed(2)
        : '0.00';

  const avgLatencyMs =
    providerLatencies.length > 0
      ? Math.round(
          providerLatencies.reduce((acc, p) => acc + (Number(p.avgLatencyMs) || 0), 0) /
            providerLatencies.length
        )
      : null;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-8 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t.llmGatewayTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
              {t.llmGatewayBadge}
            </span>
            <DataSourceBadge
              source={dataSource.source}
              reason={dataSource.reason}
              ageMs={dataSource.ageMs}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.llmGatewaySubtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
            {t.currentGatewayTraffic} {totalRpm} RPM
          </span>
        </div>
      </div>

      <ModelRouterOverrideCard />

      {/* Sub-tab switcher: Routes & Pricing | Model Matrix & Ping Benchmark */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setSubview('routes')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
            subview === 'routes'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {t.llmGatewayTabRoutes}
        </button>
        <button
          type="button"
          onClick={() => setSubview('matrix')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
            subview === 'matrix'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {t.llmGatewayTabMatrix}
        </button>
      </div>

      {subview === 'routes' && (
      <>
      {/* Gateway Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.gatewayHealthScore}</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {routes.length > 0 || providerLatencies.length > 0 ? `${avgSuccessRate}%` : '—'}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {providerLatencies.length > 0
              ? `${providerLatencies.length} telemetry providers`
              : `${routes.length} configured routes`}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.avgGatewayLatency}</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {avgLatencyMs !== null ? `${avgLatencyMs} ms` : '—'}
          </div>
          <div className="text-[10px] text-emerald-500 mt-1">
            {providerLatencies.length > 0
              ? `${providerLatencies[0]?.displayName || 'Gateway'}`
              : 'Awaiting live probes'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.autoFailoverCircuit}</div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
            {failoverArmedCount} / {routes.length}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">503 / High Demand Guard</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.blendedGrossMargin}</div>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">
            {routes.length > 0 ? `${avgMargin}%` : '—'}
          </div>
          <div className="text-[10px] text-purple-500 mt-1">Wholesale vs Retail</div>
        </div>
      </div>

      {/* Model Routes List */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Route className="w-4 h-4 text-blue-600" />
          {t.activeRoutingPolicies}
        </h2>

        {routes.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            {t.noGatewayRoutesMsg}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.map((route) => {
              const costIn = Number(route.costPer1MIn) || 0;
              const costOut = Number(route.costPer1MOut) || 0;
              const retailPrice = Number(route.customerPricePer1M) || 0;
              const margin =
                retailPrice > 0
                  ? Math.round(((retailPrice - (costIn + costOut) / 2) / retailPrice) * 100)
                  : 0;

              return (
                <div
                  key={route.id}
                  className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-blue-600" />
                        {route.displayName || route.modelId}
                      </h3>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400 mt-1">
                        <span>ID: {route.modelId}</span>
                        <span>·</span>
                        <span>{route.requestsPerMin} req/min</span>
                      </div>
                    </div>

                    {/* Failover switch */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-slate-400">
                        {t.autoFailoverLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleFailover(route.id)}
                        className="cursor-pointer text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        {route.autoFailoverActive ? (
                          <ToggleRight className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <ToggleLeft className="w-6 h-6" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Routing Pathway */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">{t.primaryEndpointLabel}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
                        {route.primaryProvider}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">{t.backupFailoverLabel}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
                        {route.fallbackProvider}
                      </span>
                    </div>
                  </div>

                  {/* Cost Guard & Margins */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                      <div className="text-[10px] text-slate-400">{t.inOutCostLabel}</div>
                      <div className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                        ${costIn}/${costOut}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                      <div className="text-[10px] text-slate-400">{t.retailRateLabel}</div>
                      {editingPriceId === route.id ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') savePrice(route.id);
                              if (e.key === 'Escape') setEditingPriceId(null);
                            }}
                            className="w-16 px-1.5 py-1 rounded text-xs font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-blue-400 outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <button
                            type="button"
                            onClick={() => savePrice(route.id)}
                            className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                          >
                            {t.gatewaySavePrice}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            ${retailPrice.toFixed(2)}/1M
                          </span>
                          <button
                            type="button"
                            onClick={() => startPriceEdit(route.id, retailPrice)}
                            className="text-[10px] font-semibold text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                          >
                            {t.gatewayEditPrice}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                      <div className="text-[10px] text-slate-400">{t.grossMarginLabel}</div>
                      <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {margin >= 0 ? `+${margin}%` : `${margin}%`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {subview === 'matrix' && (
        <ModelMatrix
          activeModel={activeModel}
          onSelectModel={onSelectModel}
          onNavigateToChat={onNavigateToChat}
          hideHeader
        />
      )}
    </div>
  );
};
