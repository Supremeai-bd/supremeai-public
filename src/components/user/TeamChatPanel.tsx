import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare, Send } from 'lucide-react';
import { teamService, type TeamChatMessage, type TeamChatRoom } from '../../services/teamService';
import { useI18n } from '../../utils/i18n';

/**
 * বাংলা মন্তব্য: টিম চ্যাট (রোডম্যাপ 4.4)। নিজের টিম (সদস্য থাকলে) আর যেসব টিমে আমাকে
 * আমন্ত্রণ করা হয়েছে — সবগুলোর জন্য একটা করে রুম। Supabase realtime চালু নেই, তাই
 * ট্যাব খোলা থাকলে প্রতি ৫ সেকেন্ডে শুধু নতুন বার্তা (`after` কার্সর) আনা হয়।
 */

export const TEAM_CHAT_POLL_MS = 5000;
const MAX_CHARS = 4000;

/** Append without duplicates, keeping server order (oldest → newest). */
export function mergeMessages(
  current: TeamChatMessage[],
  incoming: TeamChatMessage[]
): TeamChatMessage[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return current;
  return [...current, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface TeamChatPanelProps {
  /** Changes when the roster changes, so a newly created team room shows up. */
  rosterVersion?: number;
}

export const TeamChatPanel: React.FC<TeamChatPanelProps> = ({ rosterVersion = 0 }) => {
  const { t } = useI18n();
  const [rooms, setRooms] = useState<TeamChatRoom[] | null>(null);
  const [activeOwner, setActiveOwner] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<TeamChatMessage[]>([]);
  messagesRef.current = messages;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeOwner;

  useEffect(() => {
    let cancelled = false;
    teamService
      .fetchChatRooms()
      .then((list) => {
        if (cancelled) return;
        setRooms(list);
        setActiveOwner((prev) =>
          prev && list.some((r) => r.ownerId === prev) ? prev : (list[0]?.ownerId ?? null)
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setRooms([]);
        setError(errorText(err, t.tcLoadError));
      });
    return () => {
      cancelled = true;
    };
  }, [rosterVersion, t.tcLoadError]);

  const pull = useCallback(async (ownerId: string, fresh: boolean) => {
    const current = messagesRef.current;
    const after = fresh ? null : (current[current.length - 1]?.createdAt ?? null);
    const incoming = await teamService.fetchChatMessages(ownerId, after);
    if (activeRef.current !== ownerId) return; // room switched while loading
    setMessages((prev) => (fresh ? incoming : mergeMessages(prev, incoming)));
  }, []);

  useEffect(() => {
    if (!activeOwner) return;
    let cancelled = false;
    setMessages([]);
    messagesRef.current = [];
    setError(null);
    pull(activeOwner, true).catch((err) => {
      if (!cancelled) setError(errorText(err, t.tcLoadError));
    });
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      pull(activeOwner, false).catch(() => {
        /* transient poll failure — next tick retries */
      });
    }, TEAM_CHAT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeOwner, pull, t.tcLoadError]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!activeOwner || !content || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await teamService.postChatMessage(activeOwner, content);
      setMessages((prev) => mergeMessages(prev, [msg]));
      setDraft('');
    } catch (err) {
      setError(errorText(err, t.tcSendError));
    } finally {
      setSending(false);
    }
  };

  const roomLabel = (room: TeamChatRoom) =>
    room.myRole === 'Owner' ? t.tcMyTeam : t.tcTeamOf.replace('{email}', room.ownerEmail);
  const activeRoom = rooms?.find((r) => r.ownerId === activeOwner) ?? null;

  return (
    <section
      aria-label={t.tcTitle}
      className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 shadow-xs overflow-hidden"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <MessagesSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t.tcTitle}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.tcDesc}</p>
          </div>
        </div>
        {rooms && rooms.length > 1 && (
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {rooms.map((room) => (
              <button
                key={room.ownerId}
                type="button"
                role="tab"
                aria-selected={room.ownerId === activeOwner}
                onClick={() => setActiveOwner(room.ownerId)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                  room.ownerId === activeOwner
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {roomLabel(room)}
              </button>
            ))}
          </div>
        )}
      </header>

      {rooms === null ? (
        <p className="px-5 py-8 text-center text-xs text-slate-400">{t.tcLoading}</p>
      ) : rooms.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-400">{error || t.tcEmpty}</p>
      ) : (
        <>
          {activeRoom && (
            <div className="px-5 pt-3 text-[11px] text-slate-400">
              {`${roomLabel(activeRoom)} · ${t.tcMembers.replace('{n}', String(activeRoom.memberCount))}`}
            </div>
          )}
          <div
            ref={listRef}
            data-testid="team-chat-messages"
            className="h-72 overflow-y-auto px-5 py-3 space-y-2.5"
          >
            {messages.length === 0 ? (
              <p className="pt-20 text-center text-xs text-slate-400">{t.tcNoMessages}</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                      m.mine
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm'
                    }`}
                  >
                    <div
                      className={`mb-0.5 text-[10px] font-semibold ${m.mine ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}
                    >
                      {m.mine ? t.tcYou : m.senderEmail || '—'} · {shortTime(m.createdAt)}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2 px-5 py-3 border-t border-slate-200/80 dark:border-slate-800"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={MAX_CHARS}
              rows={1}
              placeholder={t.tcPlaceholder}
              aria-label={t.tcPlaceholder}
              className="flex-1 resize-none px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              aria-label={t.tcSend}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t.tcSend}</span>
            </button>
          </form>
          {error && <p className="px-5 pb-3 -mt-1 text-[11px] text-rose-500">{error}</p>}
        </>
      )}
    </section>
  );
};
