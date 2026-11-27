import React from 'react';
import { CheckCircle2, CircleAlert, CircleSlash, PlugZap, RefreshCw } from 'lucide-react';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';
import type { AdminConnectionStatus } from '../../utils/adminHealthSummary';

/**
 * বাংলা মন্তব্য: "সংযোগ" কার্ড — কোন ইন্টিগ্রেশন সত্যিই কাজ করছে (Infisical, Supabase, GitHub,
 * Cloudflare, Render API, MCP Tower, Key pool) তা edge-এর লাইভ চেক থেকে দেখায়। কোনোটা না থাকলে ঠিক
 * কোন env ভ্যারিয়েবল লাগবে সেটা লেখা থাকে, আর এক ক্লিকে সংশ্লিষ্ট পেজে যাওয়া যায়।
 */

interface AdminConnectionsCardProps {
  onNavigateTab?: (tab: string) => void;
}

const STATUS_STYLE: Record<AdminConnectionStatus['status'], { label: string; cls: string }> = {
  connected: {
    label: 'Connected',
    cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  },
  missing: {
    label: 'Not set up',
    cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  error: {
    label: 'Error',
    cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  },
};

export const AdminConnectionsCard: React.FC<AdminConnectionsCardProps> = ({ onNavigateTab }) => {
  const connections = useAdminHealthStore((s) => s.connections);
  const isRefreshing = useAdminHealthStore((s) => s.isRefreshing);
  const refreshAll = useAdminHealthStore((s) => s.refreshAll);

  const okCount = (connections ?? []).filter((c) => c.status === 'connected').length;

  return (
    <section
      data-testid="admin-connections-card"
      className="p-5 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-cyan-500" />
            <span>Connections</span>
          </h2>
          <p className="text-[11px] text-slate-400">
            Live check of every service the admin console reads real data from.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connections && (
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {okCount}/{connections.length} connected
            </span>
          )}
          <button
            type="button"
            onClick={() => void refreshAll({ force: true })}
            aria-label="Re-check connections"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {connections === null ? (
        <p data-testid="admin-connections-unknown" className="text-xs text-slate-500">
          Connection status is unavailable (the admin edge did not answer).
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {connections.map((c) => {
            const style = STATUS_STYLE[c.status];
            const Icon =
              c.status === 'connected'
                ? CheckCircle2
                : c.status === 'missing'
                  ? CircleSlash
                  : CircleAlert;
            return (
              <li
                key={c.id}
                data-testid={`admin-connection-${c.id}`}
                className="p-3 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-800/40 flex items-start gap-2.5"
              >
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    c.status === 'connected'
                      ? 'text-emerald-500'
                      : c.status === 'missing'
                        ? 'text-amber-500'
                        : 'text-rose-500'
                  }`}
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {c.name}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${style.cls}`}
                    >
                      {style.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{c.detail}</p>
                  {c.missingEnv.length > 0 && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      Add in Cloudflare Pages env:{' '}
                      {c.missingEnv.map((k) => (
                        <code
                          key={k}
                          className="mr-1 px-1 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 font-mono text-[10px]"
                        >
                          {k}
                        </code>
                      ))}
                    </p>
                  )}
                  {onNavigateTab && c.status !== 'connected' && (
                    <button
                      type="button"
                      onClick={() => onNavigateTab(c.targetTab)}
                      className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                    >
                      Open related page →
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default AdminConnectionsCard;
