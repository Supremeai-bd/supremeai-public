import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  History,
  MessageSquare,
  Pin,
  Plus,
} from 'lucide-react';
import type { ChatSession, UserProject } from '../../types';
import { useI18n } from '../../utils/i18n';

export interface ChatBreadcrumbProps {
  sessions: ChatSession[];
  currentSession?: ChatSession;
  projects?: UserProject[];
  generatingTitleIds?: string[];
  onSelectSession: (sessionId: string) => void;
  onOpenHistory: () => void;
  onNewSession?: () => void;
}

/**
 * Resolves the ancestor chain for branched conversations (`parentSessionId`)
 * with cycle protection so the breadcrumb renders `Root Parent > ... > Current`.
 */
export function buildSessionAncestry(
  sessions: readonly ChatSession[],
  currentSession?: ChatSession,
  maxDepth: number = 4
): ChatSession[] {
  if (!currentSession) return [];
  const byId = new Map<string, ChatSession>();
  for (const s of sessions) {
    byId.set(s.id, s);
  }

  const chain: ChatSession[] = [currentSession];
  const visited = new Set<string>([currentSession.id]);
  let cursor: ChatSession | undefined = currentSession;

  while (cursor?.parentSessionId && chain.length < maxDepth) {
    if (visited.has(cursor.parentSessionId)) break;
    const parent = byId.get(cursor.parentSessionId);
    if (!parent) break;
    visited.add(parent.id);
    chain.unshift(parent);
    cursor = parent;
  }

  return chain;
}

/**
 * Returns the most recent sessions (active session + recent history sorted by `updatedAt`)
 * so users in long threads can orient and switch conversations from the breadcrumb.
 */
export function getRecentSessionTrail(
  sessions: readonly ChatSession[],
  currentSessionId?: string,
  limit: number = 6
): ChatSession[] {
  return [...sessions]
    .sort((a, b) => {
      if (a.id === currentSessionId && b.id !== currentSessionId) return -1;
      if (b.id === currentSessionId && a.id !== currentSessionId) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    })
    .slice(0, Math.max(1, limit));
}

export const ChatBreadcrumb: React.FC<ChatBreadcrumbProps> = ({
  sessions,
  currentSession,
  projects = [],
  generatingTitleIds = [],
  onSelectSession,
  onOpenHistory,
  onNewSession,
}) => {
  const { t } = useI18n();
  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const ancestry = useMemo(
    () => buildSessionAncestry(sessions, currentSession),
    [sessions, currentSession]
  );

  const recentTrail = useMemo(
    () => getRecentSessionTrail(sessions, currentSession?.id, 6),
    [sessions, currentSession?.id]
  );

  const linkedProject = useMemo(
    () =>
      currentSession?.projectId
        ? projects.find((project) => project.id === currentSession.projectId)
        : undefined,
    [projects, currentSession?.projectId]
  );

  useEffect(() => {
    if (!isRecentOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsRecentOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRecentOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRecentOpen]);

  const currentId = currentSession?.id || '';
  const isGeneratingTitle = Boolean(currentId && generatingTitleIds.includes(currentId));
  const rawTitle = currentSession?.title?.trim() || '';
  const currentTitle =
    !rawTitle || rawTitle === 'New chat' ? t.untitledThread : rawTitle;
  const messageCount = currentSession?.messages?.length || 0;
  const parentAncestors = ancestry.length > 1 ? ancestry.slice(0, -1) : [];

  return (
    <div ref={containerRef} className="relative pointer-events-auto min-w-0 max-w-full">
      <nav
        aria-label={t.chatBreadcrumbLabel}
        data-testid="chat-breadcrumb"
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-2.5 py-1.5 text-xs shadow-xs max-w-full min-w-0"
      >
        {/* Root: Chat History */}
        <button
          type="button"
          onClick={onOpenHistory}
          title={t.allConversations}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors cursor-pointer shrink-0"
        >
          <History className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline font-medium">{t.navHistory}</span>
        </button>

        {/* Optional linked project */}
        {linkedProject && (
          <>
            <ChevronRight
              className="w-3 h-3 text-slate-400/80 shrink-0"
              aria-hidden="true"
            />
            <span
              className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 text-slate-600 dark:text-slate-300 font-medium max-w-[120px] truncate"
              title={linkedProject.name}
            >
              <FolderGit2 className="w-3 h-3 text-cyan-500 shrink-0" aria-hidden="true" />
              <span className="truncate">{linkedProject.name}</span>
            </span>
          </>
        )}

        {/* Branched parent session ancestors */}
        {parentAncestors.map((ancestor) => (
          <React.Fragment key={ancestor.id}>
            <ChevronRight
              className="w-3 h-3 text-slate-400/80 shrink-0"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => onSelectSession(ancestor.id)}
              title={ancestor.title || t.untitledThread}
              className="hidden sm:inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors cursor-pointer max-w-[130px] truncate"
            >
              <GitBranch className="w-3 h-3 text-violet-500 shrink-0" aria-hidden="true" />
              <span className="truncate">{ancestor.title || t.untitledThread}</span>
            </button>
          </React.Fragment>
        ))}

        {/* Current active thread + recent session path dropdown trigger */}
        <ChevronRight className="w-3 h-3 text-slate-400/80 shrink-0" aria-hidden="true" />

        <button
          type="button"
          aria-current="page"
          aria-expanded={isRecentOpen}
          aria-haspopup="menu"
          onClick={() => setIsRecentOpen((prev) => !prev)}
          title={t.switchSessionHint}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-slate-800 dark:text-slate-100 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors cursor-pointer min-w-0"
        >
          {currentSession?.isPinned && (
            <Pin className="w-3 h-3 text-amber-500 shrink-0" aria-hidden="true" />
          )}
          <span
            className={`font-semibold truncate max-w-[130px] sm:max-w-[200px] md:max-w-[280px] ${
              isGeneratingTitle ? 'animate-pulse text-[var(--theme-accent)]' : ''
            }`}
          >
            {isGeneratingTitle ? t.generatingTitleLabel : currentTitle}
          </span>
          {messageCount > 0 && (
            <span className="hidden lg:inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
              {messageCount} {t.messagesShortSuffix}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
              isRecentOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>
      </nav>

      {/* Recent Sessions Quick-Switch Menu */}
      {isRecentOpen && (
        <div
          role="menu"
          aria-label={t.recentPathHint}
          className="absolute left-0 top-full mt-1.5 w-72 sm:w-80 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-2xl z-40 p-1.5 text-xs"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 mb-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t.recentChats}
            </span>
            {onNewSession && (
              <button
                type="button"
                onClick={() => {
                  onNewSession();
                  setIsRecentOpen(false);
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-[var(--theme-accent)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                <span>{t.newChat}</span>
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {recentTrail.map((session) => {
              const isActive = session.id === currentId;
              const title =
                !session.title?.trim() || session.title.trim() === 'New chat'
                  ? t.untitledThread
                  : session.title.trim();
              const count = session.messages?.length || 0;

              return (
                <button
                  key={session.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectSession(session.id);
                    setIsRecentOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {session.parentSessionId ? (
                      <GitBranch
                        className="w-3.5 h-3.5 text-violet-500 shrink-0"
                        aria-hidden="true"
                      />
                    ) : session.isPinned ? (
                      <Pin
                        className="w-3.5 h-3.5 text-amber-500 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <MessageSquare
                        className="w-3.5 h-3.5 text-slate-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{title}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      {count}
                    </span>
                    {isActive && (
                      <Check
                        className="w-3.5 h-3.5 text-[var(--theme-accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsRecentOpen(false);
                onOpenHistory();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-xl text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{t.allConversations}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
