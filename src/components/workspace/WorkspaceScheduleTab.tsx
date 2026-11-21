import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Globe,
  Play,
  Pause,
  Trash2,
  Plus,
  Search,
  Check,
  ShieldCheck,
  MessageSquarePlus,
} from 'lucide-react';
import {
  BrowserScheduledTask,
  BrowserVaultEntry,
  ScheduleCadence,
  buildScheduledAutomationPrompt,
  deleteScheduledTask,
  executeScheduledTaskOnce,
  extractVaultDomain,
  getDefaultCronForCadence,
  loadScheduledTasks,
  loadVaultEntries,
  saveScheduledTask,
  toggleScheduledTask,
} from '../../services/browserVaultService';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { toast } from '../../stores/useToastStore';
import { useI18n } from '../../utils/i18n';

export const WorkspaceScheduleTab: React.FC = () => {
  const { browserUrl, setActiveDockTab, navigateBrowser } = useWorkspaceStore();
  const { t } = useI18n();

  const [tasks, setTasks] = useState<BrowserScheduledTask[]>(() => loadScheduledTasks());
  const [vaultEntries, setVaultEntries] = useState<BrowserVaultEntry[]>(() => loadVaultEntries());
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(() => loadScheduledTasks().length === 0);

  // Create form fields
  const [titleInput, setTitleInput] = useState('');
  const [urlInput, setUrlInput] = useState(browserUrl || '');
  const [selectedVaultId, setSelectedVaultId] = useState<string>('auto');
  const [cadence, setCadence] = useState<ScheduleCadence>('daily');
  const [cronInput, setCronInput] = useState(getDefaultCronForCadence('daily'));
  const [instructionInput, setInstructionInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (browserUrl && !urlInput) {
      setUrlInput(browserUrl);
    }
  }, [browserUrl, urlInput]);

  useEffect(() => {
    const syncLists = () => {
      setTasks(loadScheduledTasks());
      setVaultEntries(loadVaultEntries());
    };
    window.addEventListener('supremeai-schedules-updated', syncLists);
    window.addEventListener('supremeai-vault-updated', syncLists);
    return () => {
      window.removeEventListener('supremeai-schedules-updated', syncLists);
      window.removeEventListener('supremeai-vault-updated', syncLists);
    };
  }, []);

  const sessionAndCredEntries = useMemo(() => {
    const targetDomain = extractVaultDomain(urlInput || browserUrl || '');
    if (!targetDomain) return vaultEntries;
    const matched = vaultEntries.filter((e) => e.domain === targetDomain);
    const others = vaultEntries.filter((e) => e.domain !== targetDomain);
    return [...matched, ...others];
  }, [vaultEntries, urlInput, browserUrl]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(q) ||
        task.domain.toLowerCase().includes(q) ||
        task.instruction.toLowerCase().includes(q)
    );
  }, [tasks, searchQuery]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUrl = (urlInput || browserUrl || '').trim();
    if (!targetUrl) {
      toast.info(t.wsScheduleSaveBtn, t.wsVaultNoUrlHint);
      return;
    }
    const chosenEntry =
      selectedVaultId === 'public'
        ? null
        : selectedVaultId === 'auto'
          ? undefined
          : vaultEntries.find((entry) => entry.id === selectedVaultId) || null;

    setBusy(true);
    try {
      const { tasks: next, created } = await saveScheduledTask({
        title: titleInput,
        targetUrl,
        entry: chosenEntry,
        cadence,
        cronExpression: cronInput,
        instruction: instructionInput,
      });
      setTasks(next);
      setTitleInput('');
      setInstructionInput('');
      setShowCreateForm(false);
      toast.success(t.wsScheduleActiveTitle, `${created.title} (${created.cronExpression})`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunNow = async (task: BrowserScheduledTask) => {
    setRunningId(task.id);
    try {
      const result = await executeScheduledTaskOnce(task);
      setTasks(result.tasks);
      if (result.ok) {
        toast.success(t.wsScheduleRunNow, result.summary);
      } else {
        toast.error(t.wsScheduleRunNow, result.summary);
      }
    } finally {
      setRunningId(null);
    }
  };

  const handleToggle = async (id: string) => {
    const next = await toggleScheduledTask(id);
    setTasks(next);
  };

  const handleDelete = async (id: string) => {
    const next = await deleteScheduledTask(id);
    setTasks(next);
  };

  const handleOpenInBrowser = (task: BrowserScheduledTask) => {
    setActiveDockTab('browser');
    void navigateBrowser(task.targetUrl);
  };

  const handleSendToChat = (task: BrowserScheduledTask) => {
    const entry = vaultEntries.find((v) => v.id === task.vaultEntryId) || null;
    const prompt = buildScheduledAutomationPrompt({
      url: task.targetUrl,
      scheduleInstruction: task.instruction,
      entry,
    });
    window.dispatchEvent(
      new CustomEvent('supremeai-insert-chat-prompt', {
        detail: { text: prompt, focus: true },
      })
    );
    toast.success(t.wsScheduleTabTitle, `${task.domain} -> Chat`);
  };

  return (
    <div
      data-testid="workspace-schedule-tab"
      className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-[#070a12]"
    >
      {/* Top Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0b101b] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {t.wsScheduleTabTitle}
            </h3>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {tasks.length}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {t.wsScheduleTabSubtitle} ·{' '}
            <span className="font-mono text-emerald-600 dark:text-emerald-400">
              {t.wsScheduleAutoActive}
            </span>
          </p>
        </div>

        <button
          type="button"
          data-testid="schedule-toggle-create-btn"
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          <span>{t.wsScheduleSaveBtn}</span>
        </button>
      </div>

      {/* Collapsible Create Form */}
      {showCreateForm && (
        <form
          data-testid="schedule-create-form"
          onSubmit={handleCreateSchedule}
          className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-[#090e18] space-y-2.5 shrink-0"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.wsScheduleUrlLabel}
              </label>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://github.com/trending"
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.wsScheduleTitleLabel}
              </label>
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder={t.wsScheduleTitlePlaceholder}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.wsScheduleCadenceLabel}
              </label>
              <select
                value={cadence}
                onChange={(e) => {
                  const next = e.target.value as ScheduleCadence;
                  setCadence(next);
                  if (next !== 'custom') {
                    setCronInput(getDefaultCronForCadence(next));
                  }
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="hourly">{t.wsScheduleCadenceHourly}</option>
                <option value="daily">{t.wsScheduleCadenceDaily}</option>
                <option value="weekly">{t.wsScheduleCadenceWeekly}</option>
                <option value="custom">{t.wsScheduleCadenceCustom}</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Cron
              </label>
              <input
                type="text"
                value={cronInput}
                onChange={(e) => {
                  setCronInput(e.target.value);
                  setCadence('custom');
                }}
                placeholder="0 8 * * *"
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.wsScheduleSessionLabel}
              </label>
              <select
                value={selectedVaultId}
                onChange={(e) => setSelectedVaultId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="auto">Auto (Vault if saved)</option>
                <option value="public">{t.wsSchedulePublicSession}</option>
                {sessionAndCredEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.domain} · {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            rows={2}
            value={instructionInput}
            onChange={(e) => setInstructionInput(e.target.value)}
            placeholder={t.wsVaultSchedulePromptPlaceholder}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
          />

          <div className="flex items-center justify-end gap-2">
            {tasks.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium whitespace-nowrap cursor-pointer"
              >
                {t.wsBrowserCancel}
              </button>
            )}
            <button
              type="submit"
              data-testid="schedule-submit-btn"
              disabled={busy || !(urlInput || browserUrl).trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>{t.wsScheduleSaveBtn}</span>
            </button>
          </div>
        </form>
      )}

      {/* Search & Jobs List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tasks.length > 0 && (
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.wsScheduleSearchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
            />
          </div>
        )}

        {filteredTasks.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 text-center space-y-2">
            <Clock className="w-6 h-6 text-slate-400 mx-auto" />
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
              {t.wsScheduleEmpty}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {t.wsScheduleTabSubtitle}
            </p>
          </div>
        ) : (
          <div data-testid="schedule-jobs-list" className="space-y-2">
            {filteredTasks.map((task) => {
              const isRunning = runningId === task.id;
              return (
                <div
                  key={task.id}
                  className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span
                          className={`text-xs font-semibold truncate ${
                            task.enabled
                              ? 'text-slate-900 dark:text-slate-100'
                              : 'text-slate-400 line-through'
                          }`}
                        >
                          {task.title}
                        </span>
                        <span className="font-mono text-[10px] text-cyan-600 dark:text-cyan-400 truncate">
                          {task.domain}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                          {task.cronExpression}
                        </span>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                            task.enabled
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {task.enabled ? t.wsScheduleStatusActive : t.wsScheduleStatusPaused}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                        {task.instruction}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRunNow(task)}
                        disabled={isRunning}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 text-[10px] font-semibold whitespace-nowrap cursor-pointer disabled:opacity-50"
                      >
                        <Play className="w-3 h-3 shrink-0" />
                        <span>{t.wsScheduleRunNow}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(task.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-amber-500 text-[10px] font-medium whitespace-nowrap cursor-pointer"
                      >
                        {task.enabled ? (
                          <>
                            <Pause className="w-3 h-3 shrink-0" />
                            <span>{t.wsSchedulePause}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 shrink-0" />
                            <span>{t.wsScheduleResume}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenInBrowser(task)}
                        title={t.wsScheduleOpenBrowser}
                        className="p-1 rounded-md text-slate-400 hover:text-cyan-500 hover:bg-cyan-500/10 cursor-pointer"
                      >
                        <Globe className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendToChat(task)}
                        title="Send to Chat"
                        className="p-1 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"
                      >
                        <MessageSquarePlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        title={t.wsBrowserRemoveBookmark}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-slate-400 border-t border-slate-100 dark:border-slate-800/80 pt-1.5">
                    <span>
                      {t.wsScheduleLastRun}:{' '}
                      {task.lastRunAt
                        ? `${new Date(task.lastRunAt).toLocaleTimeString()} (${task.lastRunStatus})`
                        : t.wsScheduleNeverRun}
                      {task.lastRunSummary ? ` · ${task.lastRunSummary}` : ''}
                    </span>
                    {task.vaultEntryId !== 'public' && (
                      <span className="inline-flex items-center gap-1 text-emerald-500">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Vault</span>
                      </span>
                    )}
                  </div>

                  {task.lastRunAiReport && (
                    <div
                      data-testid="schedule-ai-report"
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-2.5 py-2 text-[11px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto"
                    >
                      {task.lastRunAiReport}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
