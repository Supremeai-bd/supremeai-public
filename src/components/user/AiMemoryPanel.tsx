import React, { useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import {
  clearUserMemory,
  forgetUserMemoryTopic,
  loadUserMemory,
  USER_MEMORY_UPDATED_EVENT,
  type UserMemoryProfile,
} from '../../services/intentOrchestrator';

/**
 * বাংলা মন্তব্য: সাইডবারের "AI Memory" — আগে শুধু লেবেল ছিল (ক্লিক হতো না)। এখন ক্লিক করলে
 * দেখায় AI কী মনে রেখেছে (ভাষা, উত্তরের ধরন, সাম্প্রতিক বিষয়), একটা বিষয় বা সব মুছে ফেলা যায়।
 * সব কিছু শুধু এই ডিভাইসে (localStorage) থাকে।
 */
export const AiMemoryPanel: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [memory, setMemory] = useState<UserMemoryProfile>(() => loadUserMemory());

  useEffect(() => {
    const refresh = () => setMemory(loadUserMemory());
    window.addEventListener(USER_MEMORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(USER_MEMORY_UPDATED_EVENT, refresh);
  }, []);

  const languageLabel =
    memory.preferredLanguage === 'bn'
      ? 'বাংলা'
      : memory.preferredLanguage === 'banglish'
        ? 'Banglish'
        : 'English';
  const styleLabel =
    memory.preferredResponseStyle === 'concise'
      ? t.memStyleConcise
      : memory.preferredResponseStyle === 'detailed'
        ? t.memStyleDetailed
        : t.memStyleAuto;
  const isEmpty = memory.interactionCount === 0 && memory.recentTopics.length === 0;

  return (
    <div data-testid="ai-memory">
      <button
        type="button"
        onClick={() => {
          setMemory(loadUserMemory());
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
      >
        <span className="inline-flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-cyan-500" />
          <span>
            {t.memTitle} ({memory.recentTopics.length})
          </span>
        </span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mx-2 mt-1 mb-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 p-2.5 space-y-2 text-[11px] text-slate-600 dark:text-slate-300">
          {isEmpty ? (
            <p className="text-slate-500">{t.memEmpty}</p>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.memLanguage}</span>
                <span>{languageLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.memStyle}</span>
                <span>{styleLabel}</span>
              </div>
              {memory.recentTopics.length > 0 && (
                <div>
                  <div className="text-slate-500 mb-1">{t.memTopics}</div>
                  <ul className="flex flex-wrap gap-1">
                    {memory.recentTopics.map((topic) => (
                      <li
                        key={topic}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 pl-2 pr-1 py-0.5"
                      >
                        <span className="max-w-[9rem] truncate">{topic}</span>
                        <button
                          type="button"
                          aria-label={`${t.memForget}: ${topic}`}
                          onClick={() => setMemory(forgetUserMemoryTopic(topic))}
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
                  setMemory(loadUserMemory());
                }}
                className="text-[10px] text-slate-400 hover:text-rose-500 underline cursor-pointer"
              >
                {t.memReset}
              </button>
            </>
          )}
          <p className="text-[10px] text-slate-400">{t.memLocalNote}</p>
        </div>
      )}
    </div>
  );
};

export default AiMemoryPanel;
