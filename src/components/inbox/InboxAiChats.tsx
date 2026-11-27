import React, { useMemo, useState } from 'react';
import { Bot, Pin, Search } from 'lucide-react';
import { useChatStore } from '../../stores/useChatStore';
import { useI18n } from '../../utils/i18n';
import type { ChatSession } from '../../types';

/**
 * বাংলা মন্তব্য: Universal Inbox → "AI Chats" — SupremeAI-এর নিজের কথোপকথন (useChatStore)।
 * পিন করা আগে, তারপর সর্বশেষ আপডেট। ক্লিক করলে সেই চ্যাট খোলে।
 */

const SNIPPET_MAX = 140;

/** Last non-system message as one plain line (markdown/code noise removed). */
export function chatSnippet(session: ChatSession): string {
  const last = [...session.messages].reverse().find((m) => m.role !== 'system' && m.content);
  if (!last) return '';
  const plain = last.content
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/[#>*_`~|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > SNIPPET_MAX ? `${plain.slice(0, SNIPPET_MAX - 1)}…` : plain;
}

export function sortInboxChats(sessions: ChatSession[]): ChatSession[] {
  return [...sessions]
    .filter((s) => s.messages.some((m) => m.role !== 'system'))
    .sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned) || b.updatedAt - a.updatedAt);
}

function shortTime(ts: number, now: number): string {
  const date = new Date(ts);
  if (now - ts < 86_400_000 && date.getDate() === new Date(now).getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const InboxAiChats: React.FC<{ onOpenChat: (sessionId: string) => void }> = ({
  onOpenChat,
}) => {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const [query, setQuery] = useState('');

  const chats = useMemo(() => {
    const sorted = sortInboxChats(sessions);
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.role !== 'system' && m.content.toLowerCase().includes(q))
    );
  }, [sessions, query]);

  const now = Date.now();

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="inbox-ai-chats">
      <div className="p-3 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="relative max-w-xl">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={t.inboxAiSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
        {chats.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            {query.trim() ? t.inboxAiNoMatch : t.inboxAiEmpty}
          </div>
        ) : (
          chats.map((session) => {
            const count = session.messages.filter((m) => m.role !== 'system').length;
            const active = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onOpenChat(session.id)}
                data-testid={`inbox-ai-chat-${session.id}`}
                className={`w-full p-3 text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--theme-accent)]/10 border-l-2 border-[var(--theme-accent)]'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-500 border-violet-500/20 inline-flex items-center gap-1 shrink-0">
                      <Bot className="w-3 h-3" />
                      SupremeAI
                    </span>
                    {session.isPinned && <Pin className="w-3 h-3 text-amber-500 shrink-0" />}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {shortTime(session.updatedAt, now)}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {session.title || t.inboxAiUntitled}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                  {chatSnippet(session)}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {t.inboxAiMessages.replace('{n}', String(count))}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default InboxAiChats;
