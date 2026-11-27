import React, { useState } from 'react';
import { Bot, Play, Pause, Terminal, Minus, Plus } from 'lucide-react';
import { SwarmWorker } from '../../types';
import { toast } from '../../stores/useToastStore';
import { useI18n } from '../../utils/i18n';
import { DataSourceBadge } from '../common/DataSourceBadge';
import { useAdminCollectionSource } from '../../hooks/useAdminCollectionSource';
import { guardAdminAction } from '../../utils/adminGuard';

interface AdminAgentSwarmViewProps {
  workers: SwarmWorker[];
  onToggleWorkerStatus: (id: string) => void;
  onScaleConcurrency: (workerId: string, delta: number) => void;
}

export const AdminAgentSwarmView: React.FC<AdminAgentSwarmViewProps> = ({
  workers,
  onToggleWorkerStatus,
  onScaleConcurrency,
}) => {
  const { t } = useI18n();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(workers[0]?.id ?? null);

  // বাংলা মন্তব্য: আগে এখানে লোকাল `isSwarmRunning` useState(true) ফেইক টগল ছিল।
  // এখন সোয়ার্মের আসল অবস্থা কেবল ওয়ার্কার status থেকেই ডেরিভ করা হচ্ছে —
  // সবগুলো ওয়ার্কার active থাকলেই সোয়ার্ম চলছে, এলেই paused।
  const activeCount = workers.filter((w) => w.status === 'active').length;
  const isSwarmRunning = workers.length > 0 && activeCount === workers.length;

  // বাংলা মন্তব্য: Clear Buffer আগে শুধু toast দিয়ে ফেইক ছিল — লগ খালিই হত না।
  // এখন নির্দিষ্ট ওয়ার্কারের জন্য স্থানীয় লগ buffer প্রকৃতভাবে পরিষ্কার করা হচ্ছে।
  const [clearedLogs, setClearedLogs] = useState<Record<string, boolean>>({});

  // বাংলা মন্তব্য: সোয়ার্ম ডেটা লাইভ সার্ভার থেকে এসেছে নাকি localStorage fallback —
  // আগে এটা জানার কোনো উপায় ছিল না; এখন ব্যাজ সত্য বলে (fetchAdminSync সফল হলেই LIVE)।
  const dataSource = useAdminCollectionSource(
    'swarm',
    'সোয়ার্ম ওয়ার্কার তালিকা এখনো লাইভ সিঙ্ক হয়নি — localStorage ক্যাশ খালি বা পুরনো।'
  );

  const selectedWorker = workers.find((w) => w.id === selectedWorkerId) || workers[0] || null;
  const displayedLogs =
    selectedWorker && !clearedLogs[selectedWorker.id] ? selectedWorker.logs : [];

  const totalProcessed = workers.reduce((acc, w) => acc + (Number(w.processedCount) || 0), 0);
  const meanVerificationRate =
    workers.length > 0
      ? (
          workers.reduce((acc, w) => acc + (Number(w.successRate) || 0), 0) / workers.length
        ).toFixed(1)
      : '0.0';
  const avgCpu =
    workers.length > 0
      ? (workers.reduce((acc, w) => acc + (Number(w.cpuPercent) || 0), 0) / workers.length).toFixed(
          1
        )
      : '0.0';
  const totalMemoryMb = workers.reduce((acc, w) => acc + (Number(w.memoryMb) || 0), 0);

  // বাংলা মন্তব্য: গ্লোবাল Pause/Resume আগে ফেইক ছিল — এখন সব ওয়ার্কারের আসল
  // toggle endpoint (POST /api/admin/swarm/:id/toggle) ডাকে সবাই একসাথে প্রতিক্রিয় করা হচ্ছে।
  const handleGlobalToggle = () => {
    if (workers.length === 0) {
      toast.info(t.swarmTitle, 'সোয়ার্মে কোনো ওয়ার্কার নেই।');
      return;
    }
    guardAdminAction({
      title: isSwarmRunning ? t.pauseSwarmBtn : t.resumeSwarmBtn,
      description: isSwarmRunning
        ? `সব ${workers.length}টি ওয়ার্কার pause হবে — চলমান কাজ থেমে যাবে।`
        : `সব ${workers.length}টি ওয়ার্কার আবার চালু হবে।`,
      impactSummary: `workers=${workers.length}`,
      riskLevel: isSwarmRunning ? 'critical' : 'medium',
      run: () => workers.forEach((w) => onToggleWorkerStatus(w.id)),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-8 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t.swarmTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-900">
              continuous_agent_loop.py
            </span>
            <DataSourceBadge
              source={dataSource.source}
              reason={dataSource.reason}
              ageMs={dataSource.ageMs}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Orchestrate background autonomous agents: solver daemon, AST code verifier, ecosystem
            scout, and adversarial test suites.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGlobalToggle}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer ${
              isSwarmRunning
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {isSwarmRunning ? (
              <>
                <Pause className="w-4 h-4" />
                <span>{t.pauseSwarmBtn}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>{t.resumeSwarmBtn}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.activeDaemonsLabel}</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {activeCount} / {workers.length} Online
          </div>
          <div className="text-[10px] text-emerald-500 font-medium mt-1">
            ● {isSwarmRunning ? 'Loop Active' : 'Swarm Paused'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.totalHandledLabel}</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {totalProcessed.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Aggregated across {workers.length} daemons
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.meanVerificationLabel}</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {workers.length > 0 ? `${meanVerificationRate}%` : '—'}
          </div>
          <div className="text-[10px] text-emerald-500 mt-1">Live worker success average</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="text-xs text-slate-400 font-medium">{t.aggregatedComputeLabel}</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {workers.length > 0 ? `${avgCpu}% CPU` : '—'}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {totalMemoryMb.toLocaleString()} MB allocated
          </div>
        </div>
      </div>

      {/* Workers Grid & Inspector */}
      {workers.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
          No swarm worker daemons registered yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Workers List (2 cols) */}
          <div className="lg:col-span-2 space-y-3.5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-600" />
              {t.specializedDaemonPool}
            </h2>

            <div className="space-y-3">
              {workers.map((worker) => {
                const isSelected = selectedWorker?.id === worker.id;
                const isActive = worker.status === 'active';

                return (
                  <div
                    key={worker.id}
                    onClick={() => setSelectedWorkerId(worker.id)}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer shadow-xs space-y-3 ${
                      isSelected
                        ? 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/20 ring-1 ring-purple-500/20'
                        : 'border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                          <Bot className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                              {worker.name}
                            </h3>
                            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              {worker.type}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Uptime: {worker.uptime}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isActive
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {String(worker.status || 'unknown').toUpperCase()}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWorkerStatus(worker.id);
                          }}
                          className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700 cursor-pointer"
                        >
                          {isActive ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Active In-Flight Task
                      </div>
                      <div className="text-slate-800 dark:text-slate-200 font-mono text-[11px] truncate">
                        {worker.currentTask}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 font-mono text-[11px] pt-1">
                      <span>Target: {worker.currentIssueOrPr}</span>
                      <span>
                        Success: {worker.successRate}% ({worker.processedCount} done)
                      </span>
                    </div>

                    {/* বাংলা মন্তব্য: কনকারেন্সি scale বাটন — আগে onScaleConcurrency প্রপ পাওয়া গেছে
                        কিন্তু ভেতরে কোথাও ব্যবহার হয়নি। এখন সত্যিকার POST
                        /api/admin/swarm/:id/scale endpoint ডাকে ওয়ার্কারের কানকারেন্সি বাড়ানো/কমানো হচ্ছে। */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onScaleConcurrency(worker.id, -1);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                        <span>{t.swarmScaleDown}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onScaleConcurrency(worker.id, 1);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/70 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{t.swarmScaleUp}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Worker Telemetry & Logs Drawer (1 col) */}
          {selectedWorker && (
            <div className="p-6 rounded-2xl bg-slate-950 text-white border border-slate-800 shadow-md space-y-4 flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold font-mono text-purple-300 uppercase tracking-wider">
                    Telemetry: {selectedWorker.name}
                  </h3>
                </div>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-slate-400 text-[10px]">CPU Utilization</div>
                  <div className="text-base font-bold text-white mt-0.5">
                    {selectedWorker.cpuPercent}%
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-slate-400 text-[10px]">Memory Heap</div>
                  <div className="text-base font-bold text-white mt-0.5">
                    {selectedWorker.memoryMb} MB
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  Recent Execution Stream
                </span>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300 space-y-2 max-h-64 overflow-y-auto leading-relaxed">
                  {displayedLogs.length === 0 ? (
                    <div className="text-slate-500">Buffer cleared — no logs to show.</div>
                  ) : (
                    displayedLogs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-purple-400 select-none">&gt;</span>
                        <span>{log}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Daemon ID: {selectedWorker.id}</span>
                <button
                  type="button"
                  onClick={() => {
                    // বাংলা মন্তব্য: আগে শুধু toast দেখানো হত — এখন আসল লগ buffer পরিষ্কার করা হচ্ছে।
                    setClearedLogs((prev) => ({ ...prev, [selectedWorker.id]: true }));
                    toast.info(
                      t.swarmClearBuffer,
                      `${selectedWorker.name} এর এক্সিকিউশন buffer পরিষ্কার করা হয়েছে।`
                    );
                  }}
                  className="text-purple-400 hover:underline cursor-pointer"
                >
                  {t.swarmClearBuffer}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
