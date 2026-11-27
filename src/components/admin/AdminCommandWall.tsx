import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, Play, RefreshCw, X } from 'lucide-react';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';
import { useAdminStore } from '../../stores/useAdminStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useControlCenterStore } from '../../stores/useControlCenterStore';
import { usePlatformStore } from '../../stores/usePlatformStore';
import { toast } from '../../stores/useToastStore';
import { adminService } from '../../services/adminService';
import { controlCenterService } from '../../services/controlCenterService';
import type {
  AdminAreaId,
  AdminAreaStatus,
  AdminAreaSummary,
  AdminHealthSummary,
} from '../../utils/adminHealthSummary';
import {
  buildWallNodes,
  describeWallNode,
  sparklinePoints,
  type WallInput,
  type WallNode,
  type WallNodeAction,
} from '../../utils/commandWall';
import type { McpHealthMonitorSnapshot } from '../../types/controlCenter';

/**
 * বাংলা মন্তব্য: Command Wall — L1 এরিয়া → L2 নোড → L3 নোডের বিস্তারিত, একই পেজে।
 * L3 খুললে সার্ভিস নোডের জন্য তাজা হেলথ ডেটা আনা হয় (per-node fetch); প্রতিটা নোডে
 * একটাই নিরাপদ কাজ (আবার চেক / কী টেস্ট / ব্যর্থ জব রিট্রাই) — কোনো ঝুঁকিপূর্ণ কাজ নেই।
 */

export const WALL_STATUS: Record<
  AdminAreaStatus,
  { dot: string; ring: string; text: string; pill: string; label: string }
> = {
  ok: {
    dot: 'bg-emerald-500',
    ring: 'border-emerald-200 dark:border-emerald-500/25 hover:border-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    label: 'Healthy',
  },
  warning: {
    dot: 'bg-amber-500',
    ring: 'border-amber-300 dark:border-amber-500/40 hover:border-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    label: 'Warning',
  },
  critical: {
    dot: 'bg-rose-500',
    ring: 'border-rose-300 dark:border-rose-500/50 hover:border-rose-500',
    text: 'text-rose-700 dark:text-rose-300',
    pill: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    label: 'Critical',
  },
  unknown: {
    dot: 'bg-slate-400',
    ring: 'border-slate-200 dark:border-slate-700 hover:border-slate-400',
    text: 'text-slate-500 dark:text-slate-400',
    pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    label: 'Unknown',
  },
};

const TONE = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
  muted: 'text-slate-900 dark:text-white',
} as const;

const ACTION_LABEL: Record<WallNodeAction, string> = {
  'recheck-services': 'Re-check now',
  'test-provider': 'Test this key',
  'retry-failed-jobs': 'Retry failed jobs',
};

interface AdminCommandWallProps {
  summary: Pick<AdminHealthSummary, 'areas' | 'services' | 'issues'>;
  areaIcon: Record<string, React.ReactNode>;
  onNavigateTab: (tab: string) => void;
}

function useWallInput(summary: AdminCommandWallProps['summary']): WallInput {
  const { providers, deployments, connections } = useAdminHealthStore();
  const { swarmWorkers, queueJobs, securityEvents, schemaTables, customers } = useAdminStore();
  const healthSnapshot = useControlCenterStore((s) => s.healthSnapshot);
  const pendingHitlCount = useControlCenterStore((s) => s.pendingHitlCount);
  const config = usePlatformStore((s) => s.config);
  return useMemo(
    () => ({
      services: summary.services,
      issues: summary.issues,
      healthSnapshot,
      connections: connections ?? null,
      providers: providers ?? null,
      deployments: deployments ?? null,
      workers: swarmWorkers ?? [],
      jobs: queueJobs ?? [],
      securityEvents: securityEvents ?? [],
      schemaTables: schemaTables ?? [],
      customers: customers ?? [],
      pendingHitlCount: pendingHitlCount ?? 0,
      maintenanceMode: Boolean(config?.maintenanceMode),
      allowNewSignups: config?.allowNewSignups !== false,
    }),
    [
      summary.services,
      summary.issues,
      healthSnapshot,
      connections,
      providers,
      deployments,
      swarmWorkers,
      queueJobs,
      securityEvents,
      schemaTables,
      customers,
      pendingHitlCount,
      config,
    ]
  );
}

const NodeDetailPanel: React.FC<{
  node: WallNode;
  input: WallInput;
  onClose: () => void;
  onNavigateTab: (tab: string) => void;
}> = ({ node, input, onClose, onNavigateTab }) => {
  const authUser = useAuthStore((s) => s.authUser);
  const [fresh, setFresh] = useState<McpHealthMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // L3 per-node fetch: service nodes pull a fresh health snapshot when opened.
  useEffect(() => {
    if (node.kind !== 'service') return;
    let cancelled = false;
    setLoading(true);
    controlCenterService
      .fetchServiceHealth(false)
      .then((res) => {
        if (!cancelled && res?.snapshot?.services) setFresh(res.snapshot);
      })
      .catch(() => {
        /* keep the store snapshot */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node.id, node.kind]);

  const detail = useMemo(() => describeWallNode(node, input, fresh), [node, input, fresh]);
  const style = WALL_STATUS[node.status];
  const points = sparklinePoints(detail.latencySeries);

  const runAction = async (action: WallNodeAction) => {
    setBusy(true);
    try {
      if (action === 'recheck-services') {
        await useControlCenterStore.getState().runServiceHealthProbe(authUser?.email);
        const res = await controlCenterService.fetchServiceHealth(false).catch(() => null);
        if (res?.snapshot?.services) setFresh(res.snapshot);
        toast.success('Health check finished');
      } else if (action === 'test-provider') {
        await adminService.probeProvider(node.id.slice('provider:'.length));
        await useAdminHealthStore.getState().refreshAll({ force: true });
        toast.success('Key tested');
      } else {
        await useAdminStore.getState().retryAllDlq();
        toast.success('Failed jobs sent for retry');
      }
    } catch (error) {
      toast.error('Action failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      data-testid="wall-node-detail"
      aria-label={`${node.label} details`}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {node.label}
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 break-words">{node.sublabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading && (
        <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3 animate-spin" /> Loading live data…
        </p>
      )}

      {points && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
            Latency trend
          </div>
          <svg
            data-testid="wall-sparkline"
            viewBox="0 0 240 48"
            className="w-full h-12"
            preserveAspectRatio="none"
          >
            <polyline
              points={points}
              fill="none"
              strokeWidth="2"
              className="stroke-blue-500"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      )}

      {detail.fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {detail.fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{f.label}</dt>
              <dd
                className={`text-xs font-semibold font-mono break-words ${TONE[f.tone ?? 'muted']}`}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {detail.problems.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-rose-500">Problems</div>
          <ul className="space-y-1">
            {detail.problems.map((p, i) => (
              <li
                key={i}
                className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/[0.07] rounded-lg px-2.5 py-1.5 break-words"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.relatedIssues.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Related issues</div>
          {detail.relatedIssues.slice(0, 4).map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => onNavigateTab(i.targetTab)}
              className="w-full text-left text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-400 cursor-pointer"
            >
              <span className="font-semibold">{i.title}</span>
              <span className="text-slate-500"> — {i.actionLabel} →</span>
            </button>
          ))}
        </div>
      )}

      {detail.logs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Recent log</div>
          <pre className="text-[10.5px] leading-relaxed font-mono bg-slate-50 dark:bg-slate-950 rounded-lg p-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
            {detail.logs.join('\n')}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {detail.action && (
          <button
            type="button"
            onClick={() => void runAction(detail.action!)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 cursor-pointer"
          >
            {busy ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {ACTION_LABEL[detail.action]}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigateTab(node.targetTab)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:border-blue-400 cursor-pointer"
        >
          Open page <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
};

export const AdminCommandWall: React.FC<AdminCommandWallProps> = ({
  summary,
  areaIcon,
  onNavigateTab,
}) => {
  const input = useWallInput(summary);
  const [areaId, setAreaId] = useState<AdminAreaId | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);

  const area: AdminAreaSummary | null = summary.areas.find((a) => a.id === areaId) ?? null;
  const nodes = useMemo(() => (areaId ? buildWallNodes(areaId, input) : []), [areaId, input]);
  const node = nodes.find((n) => n.id === nodeId) ?? null;

  const pickArea = (id: AdminAreaId) => {
    setNodeId(null);
    setAreaId((cur) => (cur === id ? null : id));
  };

  return (
    <div className="space-y-3" data-testid="admin-command-wall">
      {/* L1 — areas */}
      <section
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
        aria-label="Platform areas"
      >
        {summary.areas.map((a) => {
          const style = WALL_STATUS[a.status];
          const selected = a.id === areaId;
          return (
            <button
              key={a.id}
              type="button"
              data-testid={`admin-area-${a.id}`}
              data-status={a.status}
              aria-expanded={selected}
              onClick={() => pickArea(a.id)}
              className={`text-left p-4 rounded-2xl border-2 bg-white dark:bg-slate-900 transition-colors cursor-pointer space-y-2.5 ${style.ring} ${
                selected ? 'ring-2 ring-blue-500/60 ring-offset-1 dark:ring-offset-slate-950' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-white">
                  <span className={style.text}>{areaIcon[a.id]}</span>
                  {a.label}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${style.pill}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                  {style.label}
                </span>
              </div>
              <p className={`text-xs font-medium leading-snug ${style.text}`}>{a.headline}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                {a.metrics.map((m) => (
                  <div key={m.label} className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">
                      {m.label}
                    </div>
                    <div
                      className={`text-sm font-bold font-mono tabular-nums ${TONE[m.tone === 'bad' ? 'bad' : m.tone === 'warn' ? 'warn' : m.tone === 'good' ? 'good' : 'muted']}`}
                    >
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </section>

      {/* L2 + L3 */}
      {area && (
        <section
          data-testid="wall-area-panel"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav
              aria-label="Command wall breadcrumb"
              className="flex items-center gap-1 text-xs font-semibold"
            >
              <button
                type="button"
                onClick={() => {
                  setAreaId(null);
                  setNodeId(null);
                }}
                className="text-slate-500 hover:text-blue-600 cursor-pointer"
              >
                Platform
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              <button
                type="button"
                onClick={() => setNodeId(null)}
                className={`cursor-pointer ${node ? 'text-slate-500 hover:text-blue-600' : 'text-slate-900 dark:text-white'}`}
              >
                {area.label}
              </button>
              {node && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-900 dark:text-white truncate max-w-[14rem]">
                    {node.label}
                  </span>
                </>
              )}
            </nav>
            <button
              type="button"
              onClick={() => onNavigateTab(area.targetTab)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Open {area.label} →
            </button>
          </div>

          <div className={`grid gap-3 ${node ? 'lg:grid-cols-3' : ''}`}>
            <ul
              data-testid="wall-node-list"
              className={`grid gap-2 content-start ${
                node ? 'lg:col-span-2 sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'
              }`}
            >
              {nodes.length === 0 ? (
                <li className="text-xs text-slate-500 py-4">Nothing to show here yet.</li>
              ) : (
                nodes.map((n) => {
                  const s = WALL_STATUS[n.status];
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        data-testid={`wall-node-${n.id}`}
                        data-status={n.status}
                        aria-pressed={n.id === nodeId}
                        onClick={() => setNodeId((cur) => (cur === n.id ? null : n.id))}
                        className={`w-full text-left flex items-center gap-2.5 p-3 rounded-xl border bg-white dark:bg-slate-900 cursor-pointer transition-colors ${s.ring} ${
                          n.id === nodeId ? 'ring-2 ring-blue-500/60' : ''
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-slate-900 dark:text-white truncate">
                            {n.label}
                          </span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {n.sublabel}
                          </span>
                        </span>
                        {n.metric && (
                          <span className={`shrink-0 text-[11px] font-mono tabular-nums ${s.text}`}>
                            {n.metric}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            {node && (
              <NodeDetailPanel
                key={node.id}
                node={node}
                input={input}
                onClose={() => setNodeId(null)}
                onNavigateTab={onNavigateTab}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
};
