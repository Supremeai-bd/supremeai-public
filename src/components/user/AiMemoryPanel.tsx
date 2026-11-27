import React, { useEffect, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { loadUserMemory, USER_MEMORY_UPDATED_EVENT } from '../../services/intentOrchestrator';
import {
  SAVED_MEMORIES_UPDATED_EVENT,
  getCachedSavedMemories,
} from '../../services/userMemoryService';

/**
 * বাংলা মন্তব্য: সাইডবারের "AI Memory (N)" — এখন পুরো AI Memory পেজ খোলে (সব AI-এর মেমরি এক জায়গায়)।
 * N = এই ডিভাইসে শেখা বিষয় + সেভ করা মেমরি (ChatGPT/Claude/Gemini… থেকে আনা)।
 */
interface AiMemoryPanelProps {
  onOpen?: () => void;
  active?: boolean;
}

const countAll = () => loadUserMemory().recentTopics.length + getCachedSavedMemories().length;

export const AiMemoryPanel: React.FC<AiMemoryPanelProps> = ({ onOpen, active = false }) => {
  const { t } = useI18n();
  const [count, setCount] = useState(countAll);

  useEffect(() => {
    const refresh = () => setCount(countAll());
    window.addEventListener(USER_MEMORY_UPDATED_EVENT, refresh);
    window.addEventListener(SAVED_MEMORIES_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(USER_MEMORY_UPDATED_EVENT, refresh);
      window.removeEventListener(SAVED_MEMORIES_UPDATED_EVENT, refresh);
    };
  }, []);

  return (
    <div data-testid="ai-memory">
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] transition-colors cursor-pointer ${
          active
            ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-cyan-500" />
          <span>
            {t.memTitle} ({count})
          </span>
        </span>
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
};

export default AiMemoryPanel;
