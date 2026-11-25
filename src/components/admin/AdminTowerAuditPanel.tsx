import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  ShieldAlert,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  buildTowerAuditMarkdown,
  towerAuditMeta,
  towerDomainScores,
  towerFindings,
  towerGuardrails,
  towerPhases,
  towerQuickWins,
  towerReleaseMatrix,
  type TowerSeverity,
} from '../../data/towerAuditV1Data';
import { ArchitectureMap, AuditRadarChart } from './ArchitectureMap';
import { InteractiveMeshGraph } from './InteractiveMeshGraph';
import { toast } from '../../stores/useToastStore';

interface LiveProbe {
  id: string;
  label: string;
  url: string;
  state: 'idle' | 'loading' | 'ok' | 'warn';
  detail: string;
}

const REVIEW_STORAGE_KEY = 'supremeai-tower-audit-v1-reviewed';

export const AdminTowerAuditPanel: React.FC = () => {
  const [severityFilter, setSeverityFilter] = useState<'All' | TowerSeverity>('All');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>('SA-01');
  const [probing, setProbing] = useState(false);
  const [probes, setProbes] = useState<LiveProbe[]>([
    { id: 'health', label: 'Studio /api/health', url: '/api/health', state: 'idle', detail: 'Click Probe Live to check' },
    { id: 'models', label: 'Studio /api/models', url: '/api/models', state: 'idle', detail: 'Click Probe Live to check' },
    { id: 'releases', label: 'Studio /api/releases/latest', url: '/api/releases/latest', state: 'idle', detail: 'Click Probe Live to check' },
  ]);

  const [reviewedIds, setReviewedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const toggleReviewed = (id: string) => {
    setReviewedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  const runLiveProbes = useCallback(async () => {
    setProbing(true);
    setProbes((prev) => prev.map((p) => ({ ...p, state: 'loading', detail: 'Probing…' })));

    const results = await Promise.all(
      [
        { id: 'health', label: 'Studio /api/health', url: '/api/health' },
        { id: 'models', label: 'Studio /api/models', url: '/api/models' },
        { id: 'releases', label: 'Studio /api/releases/latest', url: '/api/releases/latest' },
      ].map(async (target): Promise<LiveProbe> => {
        const started = performance.now();
        try {
          const res = await fetch(target.url, { cache: 'no-store' });
          const ms = Math.round(performance.now() - started);
          let detail = `HTTP ${res.status} · ${ms} ms`;
          try {
            const json = (await res.json()) as Record<string, unknown>;
            if (target.id === 'health') {
              detail = `HTTP ${res.status} · v${String(json.version ?? '?')} · modelsCount ${String(json.modelsCount ?? '?')} · ${ms} ms`;
            } else if (target.id === 'models') {
              const models = json.models as Record<string, unknown> | undefined;
              detail = `HTTP ${res.status} · ${models ? Object.keys(models).length : '?'} models · ${ms} ms`;
            } else if (target.id === 'releases') {
              detail = `HTTP ${res.status} · version ${String(json.version ?? '?')} · ${ms} ms`;
            }
          } catch {
            // non-JSON response
          }
          return { ...target, state: res.ok ? 'ok' : 'warn', detail };
        } catch {
          return { ...target, state: 'warn', detail: 'Endpoint unreachable in current environment' };
        }
      })
    );

    setProbes(results);
    setProbing(false);
    toast.success('Live contract probes completed');
  }, []);

  // বাংলা মন্তব্য: প্যানেল খোলার সাথে সাথেই লাইভ কন্ট্র্যাক্ট প্রোব স্বয়ংক্রিয়ভাবে চলবে।
  useEffect(() => {
    void runLiveProbes();
  }, [runLiveProbes]);

  const exportMarkdown = () => {
    const md = buildTowerAuditMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'supremeai-tower-audit-v1.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Tower Audit v1.0 Markdown exported');
  };

  const filteredFindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return towerFindings.filter((f) => {
      const sevOk = severityFilter === 'All' || f.severity === severityFilter;
      const textOk =
        !q ||
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.area.toLowerCase().includes(q) ||
        f.oneLiner.toLowerCase().includes(q);
      return sevOk && textOk;
    });
  }, [severityFilter, search]);

  const counts = useMemo(
    () => ({
      P0: towerFindings.filter((f) => f.severity === 'P0').length,
      P1: towerFindings.filter((f) => f.severity === 'P1').length,
      P2: towerFindings.filter((f) => f.severity === 'P2').length,
    }),
    []
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl border border-cyan-200/80 dark:border-cyan-900/60 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950 text-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-cyan-300">
              <span>{towerAuditMeta.auditedAt} · {towerAuditMeta.auditedTime}</span>
              <span>•</span>
              <span>{towerAuditMeta.scope}</span>
            </div>
            <h2 className="text-xl font-bold mt-1">
              Tower Audit v{towerAuditMeta.version} — Ecosystem Score: {towerAuditMeta.overall}/100 ({towerAuditMeta.grade})
            </h2>
            <p className="text-xs text-slate-300 mt-1">{towerAuditMeta.gradeLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runLiveProbes}
              disabled={probing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
              <span>{probing ? 'Probing…' : 'Probe Live Contracts'}</span>
            </button>
            <button
              type="button"
              onClick={exportMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Audit MD</span>
            </button>
          </div>
        </div>

        {/* Live Contract Probes Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mt-4">
          {probes.map((p) => (
            <div
              key={p.id}
              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-2 text-xs"
            >
              <span className="font-medium text-slate-200 truncate">{p.label}</span>
              <span
                className={`font-mono text-[10px] truncate ${
                  p.state === 'ok'
                    ? 'text-emerald-300'
                    : p.state === 'warn'
                      ? 'text-amber-300'
                      : 'text-slate-400'
                }`}
              >
                {p.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 8 Domain Scores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {towerDomainScores.map((s) => (
          <div
            key={s.id}
            className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60"
          >
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium truncate">{s.label}</span>
              <span className="font-mono text-[10px]">w:{s.weight}%</span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span
                className={`text-xl font-bold font-mono ${
                  s.tone === 'good'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : s.tone === 'warn'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {s.value}
              </span>
              <span className="text-[10px] font-mono text-slate-400">/ {s.target}</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{s.summary}</p>
          </div>
        ))}
      </div>

      {/* Interactive Planetary Graph + Telemetry Console (Combined v1 + v2) */}
      <InteractiveMeshGraph />

      {/* Visual Mesh Topology & Radar Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Observed Topology & Live Mesh Interconnect
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Clients · Edge Gateway · Runtime Fleet · State & Storage Plane
                </p>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Live Mesh v2.5
              </span>
            </div>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/80 bg-slate-950 p-2 overflow-hidden shadow-inner">
              <ArchitectureMap />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Telemetry: Zero-Auth local state · Control plane active on MCP Tower</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Multi-Domain Score Radar
              </h3>
              <span className="text-[10px] font-mono text-cyan-500 font-semibold">
                68/100 (B-)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
              Weighted cross-domain heuristic profile:
            </p>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/80 bg-slate-950/40 p-2 flex items-center justify-center">
              <AuditRadarChart
                data={towerDomainScores.map((s) => ({
                  label: s.label.split(' ')[0],
                  value: Math.round((s.value / s.target) * 100),
                }))}
              />
            </div>
          </div>
          <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500 text-center">
            Evaluates release alignment, security boundaries, and runtime parity.
          </p>
        </div>
      </div>

      {/* Release Matrix + Quick Wins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            Release Artifact Matrix (v2.5.0 vs Published)
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {towerReleaseMatrix.map((row) => (
              <div key={row.target} className="py-2 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-200">{row.target}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">{row.actual}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      row.status === 'pass'
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : row.status === 'warn'
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {row.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>8 High-Leverage Quick Wins</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {towerQuickWins.map((q) => (
              <div key={q.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                <div className="flex items-center justify-between gap-1 font-semibold text-slate-800 dark:text-slate-200">
                  <span className="truncate">{q.id}: {q.title}</span>
                  <span className="font-mono text-[10px] text-cyan-600 dark:text-cyan-400 shrink-0">{q.effort}</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{q.gain}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Findings Filter & Accordion */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-100/70 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['All', 'P0', 'P1', 'P2'] as const).map((sev) => {
              const count = sev === 'All' ? towerFindings.length : counts[sev];
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    severityFilter === sev
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {sev} ({count})
                </button>
              );
            })}
            <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              Reviewed: {reviewedIds.length}/{towerFindings.length}
            </span>
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter SA-01..SA-17 by area or keyword..."
            className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 sm:w-64"
          />
        </div>

        <div className="space-y-2.5">
          {filteredFindings.map((f) => {
            const expanded = expandedId === f.id;
            const reviewed = reviewedIds.includes(f.id);
            return (
              <div
                key={f.id}
                className={`rounded-2xl border transition-all ${
                  reviewed
                    ? 'border-slate-200/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-900/30 opacity-75'
                    : f.severity === 'P0'
                      ? 'border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900/80'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60'
                }`}
              >
                <div
                  onClick={() => setExpandedId(expanded ? null : f.id)}
                  className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                      {f.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        f.severity === 'P0'
                          ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300'
                          : f.severity === 'P1'
                            ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300'
                            : 'bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300'
                      }`}
                    >
                      {f.severity}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{f.area}</span>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">{f.title}</h4>
                    {reviewed && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> Reviewed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleReviewed(f.id);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {reviewed ? 'Reviewed ✓' : 'Mark Reviewed'}
                    </button>
                    {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {expanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-3 text-xs">
                    <p className="text-slate-700 dark:text-slate-300">{f.oneLiner}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/70 dark:border-slate-800">
                        <span className="font-bold text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1 mb-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Evidence
                        </span>
                        <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                          {f.evidence.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60">
                        <span className="font-bold text-[11px] text-blue-900 dark:text-blue-300 flex items-center gap-1 mb-1">
                          <Wrench className="w-3.5 h-3.5" /> Recommended Fix
                        </span>
                        <ul className="list-disc pl-4 space-y-1 text-[11px] text-blue-800 dark:text-blue-200">
                          {f.fix.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>Owner: {f.owner}</span>
                      <span>•</span>
                      <span>Effort: {f.effort}</span>
                      <span>•</span>
                      <span>Gate: {f.gate}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 90-Day Remediation & CI Guardrails */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {towerPhases.map((phase) => (
          <div key={phase.id} className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
              <span>{phase.label}</span>
              <span>{phase.window}</span>
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{phase.theme}</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{phase.summary}</p>
            <div className="space-y-1.5 pt-1">
              {phase.workstreams.map((ws) => (
                <div key={ws.title} className="text-[11px]">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{ws.title}: </span>
                  <span className="text-slate-500 dark:text-slate-400">{ws.items.join('; ')}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              Exit: {phase.exit.join(' · ')}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          <ShieldAlert className="w-3.5 h-3.5 text-cyan-500" />
          <span>6 CI Guardrails to Prevent Regression</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {towerGuardrails.map((g) => (
            <div key={g.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{g.id}: {g.title}</div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{g.detail}</p>
              <code className="block mt-2 px-2 py-1 rounded bg-slate-900 text-cyan-300 font-mono text-[10px] truncate">
                {g.snippet}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
