/**
 * MorningBriefingCard — proactive personal autonomous executive briefing (Blueprint §3).
 *
 * বাংলা মন্তব্য: ব্যবহারকারীর গ্রাফে সংরক্ষিত আসল মেমোরি ও সাম্প্রতিক টাস্ক থেকে
 * সকালের প্রো-অ্যাক্টিভ ব্রিফিং কার্ড। কোনো ভুয়া তথ্য নেই — যা মেমোরিতে আছে তাই দৃশ্যমান।
 */

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sun, CheckCircle2, Bookmark, Sparkles, X } from 'lucide-react';
import { DEFAULT_GATEWAY_URL } from '../../bridge/desktopBridge';

interface RecentTask {
  value: string;
  lastSeen?: string;
  count?: number;
}

interface TopFact {
  kind: string;
  value: string;
  count?: number;
}

interface BriefingData {
  enabled: boolean;
  greeting?: string;
  language?: string;
  recentTasks?: RecentTask[];
  topFacts?: TopFact[];
  totalFacts?: number;
  hasMemory?: boolean;
}

interface MorningBriefingCardProps {
  visible: boolean;
  userName?: string;
  onSelectTask?: (taskText: string) => void;
}

export const MorningBriefingCard: React.FC<MorningBriefingCardProps> = ({
  visible,
  userName,
  onSelectTask,
}) => {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    async function loadBriefing() {
      try {
        const token =
          localStorage.getItem('supremeai_access_token') ||
          localStorage.getItem('supremeai_token') ||
          '';
        const fromEnv =
          typeof import.meta !== 'undefined'
            ? (import.meta as { env?: Record<string, string | undefined> }).env
                ?.VITE_SUPREMEAI_GATEWAY_URL
            : undefined;
        const base = (fromEnv || DEFAULT_GATEWAY_URL || '').replace(/\/+$/, '');
        const res = await fetch(`${base}/api/memory/briefing`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as BriefingData;
        if (!cancelled && data && data.enabled && (data.hasMemory || (data.recentTasks && data.recentTasks.length > 0))) {
          setBriefing(data);
        }
      } catch {
        // Quiet fallback when offline or memory disabled
      }
    }

    void loadBriefing();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible || dismissed || !briefing || (!briefing.recentTasks?.length && !briefing.topFacts?.length)) {
    return null;
  }

  const greetingText =
    briefing.greeting ||
    (userName ? `Good morning, ${userName}!` : 'Good morning!');

  const handleTaskClick = (task: string) => {
    if (onSelectTask) {
      onSelectTask(task);
    } else {
      window.dispatchEvent(
        new CustomEvent('supremeai-insert-chat-prompt', {
          detail: {
            text: `Let's work on: ${task}`,
            focus: true,
          },
        })
      );
    }
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.4 }}
        data-testid="morning-briefing-card"
        className="w-full max-w-xl mx-auto rounded-2xl border border-amber-500/20 dark:border-amber-400/20 bg-gradient-to-br from-amber-500/5 via-white/80 to-amber-500/10 dark:from-amber-950/20 dark:via-slate-900/60 dark:to-amber-900/20 backdrop-blur-xl shadow-[0_12px_40px_rgba(245,158,11,0.08)] px-4 py-3.5 select-none"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            <Sun className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" aria-hidden="true" />
            <span>{greetingText}</span>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors"
            title="Dismiss briefing"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {briefing.recentTasks && briefing.recentTasks.length > 0 && (
          <div className="mt-2.5">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>Recent Focus & Tasks:</span>
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {briefing.recentTasks.map((task, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleTaskClick(task.value)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/80 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:border-amber-400 dark:hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer transition-all truncate max-w-full"
                >
                  {task.value}
                </button>
              ))}
            </div>
          </div>
        )}

        {briefing.topFacts && briefing.topFacts.length > 0 && (
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
            <Bookmark className="w-3 h-3 text-blue-500 shrink-0" />
            <span className="truncate">
              Remembered preferences: {briefing.topFacts.map((f) => f.value).slice(0, 3).join(', ')}
            </span>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
