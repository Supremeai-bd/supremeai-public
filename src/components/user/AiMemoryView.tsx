import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { toast } from '../../stores/useToastStore';
import { OptionSelect } from '../ui/OptionSelect';
import {
  IMPORTABLE_MEMORY_SOURCES,
  MEMORY_EXPORT_PROMPT,
  memorySourceFor,
  parseMemoryText,
} from '../../constants/memorySources';
import {
  SAVED_MEMORIES_UPDATED_EVENT,
  type SavedMemory,
  getCachedSavedMemories,
  userMemoryService,
} from '../../services/userMemoryService';
import {
  clearUserMemory,
  forgetUserMemoryTopic,
  loadUserMemory,
  USER_MEMORY_UPDATED_EVENT,
  type UserMemoryProfile,
} from '../../services/intentOrchestrator';

/**
 * বাংলা মন্তব্য: AI Memory — সব AI-এর মেমরি এক জায়গায় দেখা ও সামলানো।
 *
 * ১) "এই ডিভাইসে শেখা" — চ্যাট থেকে নিজে শেখা ভাষা/উত্তরের ধরন/বিষয় (আগের প্যানেল)।
 * ২) সেভ করা মেমরি — ChatGPT/Claude/Gemini… থেকে আনা বা নিজে লেখা; উৎস ধরে ফিল্টার, খোঁজা,
 *    এডিট, মুছে ফেলা। নিশ্চিত মেমরি প্রতিটা চ্যাটে SupremeAI নিজেই ব্যবহার করে।
 * ৩) "অন্য AI থেকে আনুন" — উৎস বাছুন → সরাসরি মেমরি পেজের লিংক + কপি-করার প্রম্পট → পেস্ট →
 *    লাইন ধরে প্রিভিউ → সেভ। কোনো আলাদা "Run" নেই।
 */

interface AiMemoryViewProps {
  isGuest?: boolean;
}

type Filter = 'all' | 'device' | string;

export const AiMemoryView: React.FC<AiMemoryViewProps> = ({ isGuest = false }) => {
  const { t, lang } = useI18n();
  const bn = lang === 'bn';
  const L = (bnText: string, enText: string) => (bn ? bnText : enText);

  // ── এই ডিভাইসে শেখা ─────────────────────────────────────────────
  const [local, setLocal] = useState<UserMemoryProfile>(() => loadUserMemory());
  useEffect(() => {
    const refresh = () => setLocal(loadUserMemory());
    window.addEventListener(USER_MEMORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(USER_MEMORY_UPDATED_EVENT, refresh);
  }, []);
  const localEmpty = local.interactionCount === 0 && local.recentTopics.length === 0;

  // ── সেভ করা মেমরি ───────────────────────────────────────────────
  const [memories, setMemories] = useState<SavedMemory[] | null>(() =>
    isGuest ? [] : getCachedSavedMemories().length ? getCachedSavedMemories() : null
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    if (isGuest) return;
    try {
      setMemories(await userMemoryService.list());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [isGuest]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sync = () => setMemories(getCachedSavedMemories());
    window.addEventListener(SAVED_MEMORIES_UPDATED_EVENT, sync);
    return () => window.removeEventListener(SAVED_MEMORIES_UPDATED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of memories || []) map.set(m.source, (map.get(m.source) || 0) + 1);
    return map;
  }, [memories]);

  const pending = (memories || []).filter((m) => m.status === 'candidate');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (memories || []).filter(
      (m) =>
        m.status === 'confirmed' &&
        (filter === 'all' || m.source === filter) &&
        (!q || m.content.toLowerCase().includes(q))
    );
  }, [memories, filter, query]);
  const totalSaved = memories?.length ?? 0;

  const fail = (title: string, err: unknown) =>
    toast.error(title, err instanceof Error ? err.message : undefined);

  const saveEdit = async (m: SavedMemory) => {
    const content = draft.trim();
    if (!content || content === m.content) {
      setEditingId(null);
      return;
    }
    try {
      await userMemoryService.update(m.id, { content });
      setEditingId(null);
    } catch (err) {
      fail(L('সেভ হয়নি', 'Not saved'), err);
    }
  };

  const remove = async (m: SavedMemory) => {
    try {
      await userMemoryService.remove(m.id);
    } catch (err) {
      fail(L('মুছে ফেলা যায়নি', 'Could not remove'), err);
    }
  };

  const keep = async (m: SavedMemory) => {
    try {
      await userMemoryService.update(m.id, { status: 'confirmed' });
    } catch (err) {
      fail(L('সেভ হয়নি', 'Not saved'), err);
    }
  };

  const clearSource = async (source: string) => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    try {
      const removed = await userMemoryService.clearSource(source);
      toast.success(L('মুছে ফেলা হয়েছে', 'Cleared'), `${memorySourceFor(source).label}: ${removed}`);
      setFilter('all');
    } catch (err) {
      fail(L('মুছে ফেলা যায়নি', 'Could not clear'), err);
    }
  };

  // ── অন্য AI থেকে আনুন ───────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState<string>('chatgpt');
  const [pasted, setPasted] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const parsed = useMemo(() => parseMemoryText(pasted), [pasted]);
  const selected = parsed.filter((_, i) => !excluded.has(i));
  const sourceInfo = memorySourceFor(importSource);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(MEMORY_EXPORT_PROMPT);
      toast.success(
        L('প্রম্পট কপি হয়েছে', 'Prompt copied'),
        L(`${sourceInfo.label}-এ পেস্ট করে পাঠান`, `Paste it into ${sourceInfo.label}`)
      );
    } catch {
      toast.info(L('কপি করুন', 'Copy it'), MEMORY_EXPORT_PROMPT);
    }
  };

  const runImport = async (source: string, items: string[]) => {
    if (!items.length) return;
    setImporting(true);
    try {
      const res = await userMemoryService.importItems(source, items);
      toast.success(
        L(`${res.added}টা মেমরি সেভ হয়েছে`, `${res.added} memories saved`),
        res.skipped
          ? L(`${res.skipped}টা আগেই ছিল — বাদ`, `${res.skipped} already there — skipped`)
          : undefined
      );
      return true;
    } catch (err) {
      fail(L('সেভ হয়নি', 'Not saved'), err);
      return false;
    } finally {
      setImporting(false);
    }
  };

  const [quickAdd, setQuickAdd] = useState('');

  const sourceOptions = IMPORTABLE_MEMORY_SOURCES.map((s) => ({
    value: s.id,
    label: `${s.icon} ${s.label}`,
    description: s.memoryPageUrl ? new URL(s.memoryPageUrl).host : undefined,
  }));

  const chip = (id: Filter, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setFilter(id);
        setConfirmClear(false);
      }}
      aria-pressed={filter === id}
      data-testid={`memory-filter-${id}`}
      className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
        filter === id
          ? 'border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
      }`}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );

  const languageLabel =
    local.preferredLanguage === 'bn'
      ? 'বাংলা'
      : local.preferredLanguage === 'banglish'
        ? 'Banglish'
        : 'English';
  const styleLabel =
    local.preferredResponseStyle === 'concise'
      ? t.memStyleConcise
      : local.preferredResponseStyle === 'detailed'
        ? t.memStyleDetailed
        : t.memStyleAuto;

  return (
    <div data-testid="ai-memory-view" className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-cyan-500" />
            {t.memTitle}
            <span className="text-sm font-medium text-slate-500 tabular-nums">
              ({totalSaved + local.recentTopics.length})
            </span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-xl mt-0.5">
            {L(
              'আপনার সব AI আপনার সম্পর্কে যা জানে — এক জায়গায়। এখানে রাখা মেমরি SupremeAI প্রতিটা চ্যাটে নিজেই কাজে লাগায়।',
              'Everything your AIs know about you — in one place. SupremeAI uses these memories in every chat automatically.'
            )}
          </p>
        </div>
        {!isGuest && !importOpen && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            data-testid="memory-import-open"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {L('অন্য AI থেকে আনুন', 'Import from another AI')}
          </button>
        )}
      </header>

      {/* ── অন্য AI থেকে আনুন ── */}
      {importOpen && !isGuest && (
        <section
          data-testid="memory-import"
          className="rounded-2xl border border-cyan-300/60 dark:border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-500/5 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {L('অন্য AI-এর মেমরি আনুন', "Bring in another AI's memory")}
            </h3>
            <button
              type="button"
              onClick={() => {
                setImportOpen(false);
                setPasted('');
              }}
              aria-label={L('বন্ধ করুন', 'Close')}
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <OptionSelect
            label={L('কোন AI থেকে?', 'From which AI?')}
            value={importSource}
            options={sourceOptions}
            onChange={setImportSource}
            testId="memory-import-source"
          />

          {/* Tips: সরাসরি মেমরি পেজ + ধাপ + প্রম্পট */}
          <div
            data-testid="memory-import-tips"
            className="rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/10 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                {L(`${sourceInfo.label} থেকে কীভাবে`, `How to get it from ${sourceInfo.label}`)}
              </span>
              <div className="flex items-center gap-3">
                {sourceInfo.memoryPageUrl && (
                  <a
                    href={sourceInfo.memoryPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="memory-source-link"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:underline"
                  >
                    {L(`${sourceInfo.label} খুলুন`, `Open ${sourceInfo.label}`)}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void copyPrompt()}
                  data-testid="memory-copy-prompt"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
                >
                  <ClipboardCopy className="w-3 h-3" />
                  {L('প্রম্পট কপি করুন', 'Copy prompt')}
                </button>
              </div>
            </div>
            <ol className="list-decimal pl-5 space-y-0.5 text-xs text-slate-700 dark:text-slate-200">
              {(sourceInfo.steps || []).map((s, i) => (
                <li key={i}>{bn ? s.bn : s.en}</li>
              ))}
            </ol>
          </div>

          <textarea
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setExcluded(new Set());
            }}
            rows={5}
            data-testid="memory-import-text"
            placeholder={L(
              'এখানে পেস্ট করুন — প্রতিটা লাইন একটা আলাদা মেমরি হবে',
              'Paste here — every line becomes its own memory'
            )}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
          />

          {parsed.length > 0 && (
            <div className="space-y-1.5" data-testid="memory-import-preview">
              <div className="text-[11px] text-slate-500">
                {L(
                  `${parsed.length}টা পাওয়া গেছে — যেটা চান না সেটার টিক তুলে দিন`,
                  `Found ${parsed.length} — untick anything you don't want`
                )}
              </div>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {parsed.map((item, i) => (
                  <li key={`${i}-${item}`}>
                    <label className="flex items-start gap-2 px-3 py-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!excluded.has(i)}
                        onChange={() =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className="mt-0.5"
                      />
                      <span className="text-slate-700 dark:text-slate-200">{item}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!selected.length || importing}
              onClick={async () => {
                if (await runImport(importSource, selected)) {
                  setPasted('');
                  setImportOpen(false);
                  setFilter(importSource);
                }
              }}
              data-testid="memory-import-save"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {importing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {L(`${selected.length}টা মেমরি সেভ করুন`, `Save ${selected.length} memories`)}
            </button>
          </div>
        </section>
      )}

      {/* ── রিভিউ বাকি (এজেন্টের প্রস্তাব) ── */}
      {pending.length > 0 && (
        <section
          data-testid="memory-pending"
          className="rounded-2xl border border-violet-300/60 dark:border-violet-500/30 bg-violet-50/50 dark:bg-violet-500/5 p-4 space-y-2"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {L(
              `রিভিউ বাকি (${pending.length}) — AI এগুলো মনে রাখতে চায়`,
              `Needs review (${pending.length}) — your AI wants to remember these`
            )}
          </h3>
          <ul className="space-y-1.5">
            {pending.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-xs">
                <span className="flex-1 text-slate-700 dark:text-slate-200">{m.content}</span>
                <button
                  type="button"
                  onClick={() => void keep(m)}
                  data-testid={`memory-keep-${m.id}`}
                  className="text-emerald-600 hover:underline cursor-pointer"
                >
                  {L('রাখুন', 'Keep')}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(m)}
                  data-testid={`memory-discard-${m.id}`}
                  className="text-rose-600 hover:underline cursor-pointer"
                >
                  {L('বাদ দিন', 'Discard')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── ফিল্টার + খোঁজা ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full">
          {chip('all', L('সব', 'All'), visibleCountAll(memories))}
          {chip('device', L('📱 এই ডিভাইস', '📱 This device'), local.recentTopics.length)}
          {[...counts.entries()].map(([source, n]) => {
            const s = memorySourceFor(source);
            return chip(source, `${s.icon} ${s.label}`, n);
          })}
        </div>
        {filter !== 'device' && totalSaved > 0 && (
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={L('খুঁজুন…', 'Search…')}
              aria-label={L('মেমরি খুঁজুন', 'Search memories')}
              data-testid="memory-search"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
        )}
      </div>

      {/* ── এই ডিভাইসে শেখা ── */}
      {(filter === 'all' || filter === 'device') && (
        <section
          data-testid="memory-device"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 space-y-2 text-xs text-slate-600 dark:text-slate-300"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {L('📱 চ্যাট থেকে নিজে শেখা (এই ডিভাইস)', '📱 Learned from your chats (this device)')}
          </h3>
          {localEmpty ? (
            <p className="text-slate-500">{t.memEmpty}</p>
          ) : (
            <>
              <div className="flex justify-between max-w-xs">
                <span className="text-slate-500">{t.memLanguage}</span>
                <span>{languageLabel}</span>
              </div>
              <div className="flex justify-between max-w-xs">
                <span className="text-slate-500">{t.memStyle}</span>
                <span>{styleLabel}</span>
              </div>
              {local.recentTopics.length > 0 && (
                <div>
                  <div className="text-slate-500 mb-1">{t.memTopics}</div>
                  <ul className="flex flex-wrap gap-1">
                    {local.recentTopics.map((topic) => (
                      <li
                        key={topic}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 pl-2 pr-1 py-0.5"
                      >
                        <span className="max-w-[12rem] truncate">{topic}</span>
                        <button
                          type="button"
                          aria-label={`${t.memForget}: ${topic}`}
                          onClick={() => setLocal(forgetUserMemoryTopic(topic))}
                          className="rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-rose-500 cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  clearUserMemory();
                  setLocal(loadUserMemory());
                }}
                className="text-[11px] text-slate-400 hover:text-rose-500 underline cursor-pointer"
              >
                {t.memReset}
              </button>
            </>
          )}
          <p className="text-[10px] text-slate-400">{t.memLocalNote}</p>
        </section>
      )}

      {/* ── সেভ করা মেমরি ── */}
      {filter !== 'device' && (
        <section data-testid="memory-saved" className="space-y-2">
          {isGuest ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {L(
                'ChatGPT, Claude, Gemini-এর মেমরি এক জায়গায় রাখতে সাইন ইন করুন।',
                'Sign in to keep your ChatGPT, Claude and Gemini memories in one place.'
              )}
            </div>
          ) : memories === null && !loadFailed ? (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {L('লোড হচ্ছে…', 'Loading…')}
            </div>
          ) : loadFailed && memories === null ? (
            <div data-testid="memory-unavailable" className="text-xs text-slate-500">
              {L(
                'মেমরি এখন আনা যায়নি — একটু পরে আবার দেখুন।',
                'Could not load your memories right now — please check back shortly.'
              )}
            </div>
          ) : totalSaved === 0 ? (
            <div
              data-testid="memory-empty"
              className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center space-y-2"
            >
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {L(
                  'ChatGPT বা Claude আপনার সম্পর্কে যা জানে, তা এখানে আনুন — তাহলে SupremeAI-কে আর নতুন করে বলতে হবে না।',
                  'Bring over what ChatGPT or Claude already knows about you — so you never have to explain yourself again.'
                )}
              </p>
              {!importOpen && (
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {L('অন্য AI থেকে আনুন', 'Import from another AI')}
                </button>
              )}
            </div>
          ) : (
            <>
              <ul className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((m) => {
                  const s = memorySourceFor(m.source);
                  return (
                    <li
                      key={m.id}
                      data-testid={`memory-item-${m.id}`}
                      className="px-4 py-2.5 flex items-start gap-3"
                    >
                      <span
                        className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${s.tone}`}
                      >
                        {s.icon} {s.label}
                      </span>
                      {editingId === m.id ? (
                        <form
                          className="flex-1 flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveEdit(m);
                          }}
                        >
                          <input
                            autoFocus
                            value={draft}
                            maxLength={1000}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                            onBlur={() => void saveEdit(m)}
                            aria-label={L('মেমরি এডিট', 'Edit memory')}
                            data-testid={`memory-edit-input-${m.id}`}
                            className="flex-1 rounded-lg border border-cyan-400 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                          />
                        </form>
                      ) : (
                        <span className="flex-1 text-xs text-slate-700 dark:text-slate-200 break-words">
                          {m.content}
                        </span>
                      )}
                      {editingId !== m.id && (
                        <div className="shrink-0 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(m.id);
                              setDraft(m.content);
                            }}
                            aria-label={L('এডিট', 'Edit')}
                            data-testid={`memory-edit-${m.id}`}
                            className="p-1 rounded text-slate-400 hover:text-cyan-600 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(m)}
                            aria-label={L('মুছুন', 'Delete')}
                            data-testid={`memory-delete-${m.id}`}
                            className="p-1 rounded text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
                {visible.length === 0 && (
                  <li className="px-4 py-3 text-xs text-slate-500">
                    {L('কিছু মেলেনি।', 'Nothing matches.')}
                  </li>
                )}
              </ul>
              {filter !== 'all' && (counts.get(filter) || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => void clearSource(filter)}
                  data-testid="memory-clear-source"
                  className={`text-[11px] underline cursor-pointer ${
                    confirmClear
                      ? 'text-rose-600 font-semibold'
                      : 'text-slate-400 hover:text-rose-500'
                  }`}
                >
                  {confirmClear
                    ? L(
                        `নিশ্চিত? ${memorySourceFor(filter).label}-এর সব মুছে যাবে`,
                        `Sure? This removes everything from ${memorySourceFor(filter).label}`
                      )
                    : L(
                        `${memorySourceFor(filter).label}-এর সব মুছুন`,
                        `Remove all from ${memorySourceFor(filter).label}`
                      )}
                </button>
              )}
            </>
          )}

          {/* নিজে একটা মেমরি লিখুন */}
          {!isGuest && memories !== null && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const content = quickAdd.trim();
                if (content && (await runImport('manual', [content]))) setQuickAdd('');
              }}
              className="flex gap-2"
            >
              <input
                value={quickAdd}
                onChange={(e) => setQuickAdd(e.target.value)}
                maxLength={1000}
                placeholder={L(
                  'নিজে লিখুন, যেমন: আমি কুমিল্লায় থাকি, React-এ কাজ করি',
                  'Add one yourself, e.g. I live in Comilla and work with React'
                )}
                aria-label={L('নতুন মেমরি', 'New memory')}
                data-testid="memory-quick-add"
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
              />
              <button
                type="submit"
                disabled={!quickAdd.trim() || importing}
                data-testid="memory-quick-add-save"
                className="inline-flex items-center gap-1 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:border-cyan-400 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {L('যোগ', 'Add')}
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
};

function visibleCountAll(memories: SavedMemory[] | null): number {
  return (memories || []).filter((m) => m.status === 'confirmed').length;
}

export default AiMemoryView;
