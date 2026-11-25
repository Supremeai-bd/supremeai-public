import React, { useState } from 'react';
import {
  Plus,
  FolderGit2,
  Puzzle,
  Settings,
  Trash2,
  Edit2,
  Check,
  Users,
  Key,
  Zap,
  BookOpen,
  CreditCard,
  LogOut,
  PanelLeft,
  Pin,
  History,
  Lock,
  LogIn,
  MessageSquare,
  Sparkles,
  X,
  ChevronDown,
  ChevronRight,
  Brain,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ChatSession, RolePersona, AuthUser } from '../types';
import { ThemeControlPopover } from './theme/ThemeControlPopover';
import { PlatformDownloadsCard } from './common/PlatformDownloadsCard';
import { useI18n } from '../utils/i18n';
import { useAuthStore } from '../stores/useAuthStore';
import { clearUserMemory, loadUserMemory } from '../services/intentOrchestrator';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onTogglePinSession?: (id: string) => void;
  onNewSession: () => void;
  activeRole: RolePersona;
  onOpenRoleModal: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSelectTab: (tab: string) => void;
  activeTab: string;
  projectsCount?: number;
  activePluginsCount?: number;
  authUser?: AuthUser | null;
  onSignOut?: () => void;
  developerMode?: boolean;
  enableKnowledgeGrounding?: boolean;
  tokensUsed?: number;
  tokensLimit?: number;
  isGuest?: boolean;
  onRequestAuth?: (reason?: string) => void;
  generatingTitleIds?: string[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
  onNewSession,
  isOpen,
  onToggleOpen,
  onSelectTab,
  activeTab,
  projectsCount = 2,
  activePluginsCount = 4,
  authUser,
  onSignOut,
  developerMode = false,
  enableKnowledgeGrounding = false,
  tokensUsed = 0,
  tokensLimit = 1000000,
  isGuest = false,
  onRequestAuth,
  generatingTitleIds = [],
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [inlineLoginOpen, setInlineLoginOpen] = useState(false);
  const [inlineEmail, setInlineEmail] = useState('');
  const [inlinePassword, setInlinePassword] = useState('');
  const [showInlinePassword, setShowInlinePassword] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [showMoreWorkspace, setShowMoreWorkspace] = useState(false);
  const [memoryTopicsCount, setMemoryTopicsCount] = useState(
    () => loadUserMemory().recentTopics.length
  );
  const authLogin = useAuthStore((s) => s.login);
  const authLoading = useAuthStore((s) => s.isLoading);

  const handleInlineGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError('');
    if (!inlineEmail.trim() || !inlinePassword) {
      setInlineError('Enter both email and password.');
      return;
    }
    const ok = await authLogin(inlineEmail.trim(), inlinePassword);
    if (ok) {
      setInlineLoginOpen(false);
      setInlineEmail('');
      setInlinePassword('');
      setShowInlinePassword(false);
    } else {
      const storeErr = useAuthStore.getState().authError;
      setInlineError(storeErr || 'Invalid credentials. Please check and try again.');
    }
  };

  const { t } = useI18n();

  const pinnedSessions = sessions.filter((s) => s.isPinned);
  const recentSessions = [...sessions]
    .filter((s) => !s.isPinned)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, 18);

  const usagePercent = Math.min(100, Math.round((tokensUsed / Math.max(1, tokensLimit)) * 100));

  const startEditing = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditingTitle(session.title);
  };

  const saveEditing = (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingTitle.trim()) {
      onRenameSession(id, editingTitle.trim());
    }
    setEditingId(null);
  };

  if (!isOpen) return null;

  const renderSessionRow = (session: ChatSession) => {
    const isActive = session.id === activeSessionId && activeTab === 'chat';

    return (
      <div
        key={session.id}
        onClick={() => {
          onSelectSession(session.id);
          onSelectTab('chat');
        }}
        className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
          isActive
            ? 'bg-slate-200/70 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
          <div
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isActive ? 'bg-blue-500' : session.isPinned ? 'bg-amber-400' : 'bg-transparent'
            }`}
          />

          {editingId === session.id ? (
            <form
              onSubmit={(e) => saveEditing(session.id, e)}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 flex items-center gap-1"
            >
              <input
                type="text"
                autoFocus
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => saveEditing(session.id)}
                className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-700 rounded text-xs text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-600 focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Save"
                className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900"
              >
                <Check className="w-3 h-3" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span title={session.title} className="truncate text-xs">
                {session.title}
              </span>
              {generatingTitleIds.includes(session.id) && (
                <Sparkles
                  aria-label="Generating concise title"
                  className="w-3 h-3 text-cyan-500 animate-pulse shrink-0"
                />
              )}
            </div>
          )}
        </div>

        {/* Action buttons: always visible on active session and touch viewports, hover-revealed on desktop */}
        {editingId !== session.id && (
          <div
            className={`flex items-center gap-0.5 transition-opacity shrink-0 ${
              isActive
                ? 'opacity-100'
                : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
          >
            {onTogglePinSession && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePinSession(session.id);
                }}
                aria-label={session.isPinned ? 'Unpin conversation' : 'Pin conversation'}
                title={session.isPinned ? 'Unpin' : 'Pin'}
                className={`p-1 rounded transition-colors ${
                  session.isPinned
                    ? 'text-amber-500 hover:text-amber-600'
                    : 'text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Pin className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => startEditing(session, e)}
              aria-label="Rename"
              className="p-1 hover:text-slate-900 dark:hover:text-slate-100 text-slate-400 rounded"
            >
              <Edit2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(session.id);
              }}
              aria-label="Delete"
              className="p-1 hover:text-rose-600 dark:hover:text-rose-400 text-slate-400 rounded"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile/narrow-preview drawer backdrop */}
      <div
        onClick={onToggleOpen}
        aria-hidden="true"
        className="md:hidden fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-[1px]"
      />
      <aside className="fixed md:static inset-y-0 left-0 z-40 md:z-auto w-64 max-w-[82vw] h-full min-h-0 border-r theme-sidebar-surface flex flex-col shrink-0 transition-all text-slate-800 dark:text-slate-200 select-none overflow-hidden shadow-2xl md:shadow-none">
        {/* Top Studio Brand Header */}
        <div className="px-3.5 pt-3.5 pb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectTab('chat')}
            className="flex items-center gap-2 cursor-pointer group min-w-0"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-5 h-5 shrink-0 transition-transform group-hover:scale-105"
            >
              <path
                d="M12 2C12 7.52285 16.4772 12 22 12C16.4772 12 12 16.4772 12 22C12 16.4772 7.52285 12 2 12C7.52285 12 12 7.52285 12 2Z"
                fill="url(#sidebar-supreme-gradient)"
              />
              <defs>
                <linearGradient
                  id="sidebar-supreme-gradient"
                  x1="2"
                  y1="2"
                  x2="22"
                  y2="22"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#06B6D4" />
                  <stop offset="0.5" stopColor="#3B82F6" />
                  <stop offset="1" stopColor="#8B5CF6" />
                </linearGradient>
              </defs>
            </svg>
            <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
              SupremeAI Studio
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleOpen}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Top Action: "+ New chat" */}
        <div className="p-3 pb-2">
          <button
            type="button"
            onClick={() => {
              onNewSession();
              onSelectTab('chat');
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-full bg-slate-200/80 hover:bg-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-900 dark:text-slate-100 text-xs font-medium transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            <span>{t.newChat}</span>
          </button>
        </div>

        {/* Streamlined Navigation: 3 Core Items + Collapsible More Workspace */}
        <div className="px-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-400 overflow-y-auto max-h-[44vh]">
          <button
            type="button"
            onClick={() => onSelectTab('chat-history')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'chat-history'
                ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <History className="w-4 h-4 text-slate-500" />
              <span>{t.allConversations}</span>
            </div>
            {isGuest ? (
              <Lock className="w-3 h-3 text-slate-400" />
            ) : (
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {sessions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="sidebar-universal-inbox-btn"
            onClick={() => onSelectTab('universal-inbox')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'universal-inbox'
                ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <MessageSquare className="w-4 h-4 text-cyan-500" />
              <span>Universal Inbox</span>
            </div>
            {isGuest && <Lock className="w-3 h-3 text-slate-400" />}
          </button>

          {enableKnowledgeGrounding && (
            <button
              type="button"
              onClick={() => onSelectTab('user-knowledge')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                activeTab === 'user-knowledge'
                  ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <BookOpen className="w-4 h-4 text-purple-500" />
                <span>{t.knowledgeBase}</span>
              </div>
              {isGuest && <Lock className="w-3 h-3 text-slate-400" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => onSelectTab('user-settings')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'user-settings'
                ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <Settings className="w-4 h-4 text-slate-500" />
              <span>{t.settings}</span>
            </div>
            {isGuest && <Lock className="w-3 h-3 text-slate-400" />}
          </button>

          {/* Collapsible secondary workspace tools to prevent option overload */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setMemoryTopicsCount(loadUserMemory().recentTopics.length);
                setShowMoreWorkspace((v) => !v);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
            >
              <span>Workspace</span>
              {showMoreWorkspace ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>

            {showMoreWorkspace && (
              <div className="mt-0.5 space-y-0.5 pl-2">
                <button
                  type="button"
                  onClick={() => onSelectTab('user-billing')}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'user-billing' || activeTab === 'usage'
                      ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{t.planUsage}</span>
                  </div>
                  {isGuest && <Lock className="w-3 h-3 text-slate-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => onSelectTab('user-team')}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'user-team'
                      ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{t.teamMembers}</span>
                  </div>
                  {isGuest && <Lock className="w-3 h-3 text-slate-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => onSelectTab('user-projects')}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        activeTab === 'user-projects'
                          ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <FolderGit2 className="w-3.5 h-3.5 text-slate-500" />
                        <span>{t.myProjects}</span>
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        {projectsCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectTab('user-api-keys')}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        activeTab === 'user-api-keys'
                          ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <Key className="w-3.5 h-3.5 text-blue-500" />
                      <span>{t.apiKeysProviders}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectTab('boost-limit')}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        activeTab === 'boost-limit'
                          ? 'bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-semibold shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Zap className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                        <span>⚡ Boost Limit</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        +150K
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectTab('user-plugins')}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        activeTab === 'user-plugins'
                          ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Puzzle className="w-3.5 h-3.5 text-slate-500" />
                        <span>{t.pluginsTools}</span>
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        {activePluginsCount}
                      </span>
                    </button>

                <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <Brain className="w-3.5 h-3.5 text-cyan-500" />
                    <span>AI Memory ({memoryTopicsCount})</span>
                  </span>
                  {memoryTopicsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearUserMemory();
                        setMemoryTopicsCount(0);
                      }}
                      className="text-[10px] text-slate-400 hover:text-rose-500 underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="my-2 mx-3 border-t border-slate-200/70 dark:border-slate-800/70" />

        {/* Pinned & Recent Chats Lists */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 space-y-3 pb-2">
          {pinnedSessions.length > 0 && (
            <div className="space-y-0.5">
              <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <Pin className="w-3 h-3 text-amber-500" />
                  <span>{t.pinnedChats}</span>
                </span>
                <span className="font-mono tabular-nums">{pinnedSessions.length}</span>
              </div>
              {pinnedSessions.map(renderSessionRow)}
            </div>
          )}

          <div className="space-y-0.5">
            <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3 text-cyan-500" />
                <span>{t.recentChats}</span>
              </span>
              <span className="font-mono tabular-nums">{recentSessions.length}</span>
            </div>

            {recentSessions.length === 0 ? (
              <div className="mx-1 px-3 py-2.5 rounded-xl border border-dashed border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 text-[11px] text-slate-500 dark:text-slate-400">
                <p className="leading-relaxed">{t.emptySidebarHint}</p>
              </div>
            ) : (
              recentSessions.map(renderSessionRow)
            )}
          </div>
        </div>

        {/* Streamlined Profile, Theme & Ops Console Footer */}
        <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800/80 bg-white/40 dark:bg-slate-900/40 space-y-2">
          <PlatformDownloadsCard variant="compact" />
          {isGuest ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setInlineLoginOpen((v) => !v);
                    setInlineError('');
                  }}
                  className="flex items-center gap-1.5 text-left min-w-0 group cursor-pointer"
                  title={t.signInSignUp}
                >
                  <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center text-[11px] font-semibold shrink-0">
                    G
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate group-hover:text-[var(--theme-accent)] transition-colors">
                      {t.guestPreview}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {inlineLoginOpen ? 'Direct Sign In' : 'Click to sign in directly'}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <ThemeControlPopover
                    compact
                    align="left"
                    placement="top"
                    triggerLabel={t.themeShort}
                    onOpenSettings={() => onSelectTab('user-settings')}
                  />
                  {inlineLoginOpen && (
                    <button
                      type="button"
                      onClick={() => setInlineLoginOpen(false)}
                      aria-label="Close direct sign-in"
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {inlineLoginOpen ? (
                <form
                  onSubmit={(e) => void handleInlineGuestLogin(e)}
                  className="p-2 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/85 dark:bg-slate-950/80 space-y-1.5"
                >
                  <input
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    value={inlineEmail}
                    onChange={(e) => setInlineEmail(e.target.value)}
                    placeholder="Email address"
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                  />
                  <div className="relative">
                    <input
                      type={showInlinePassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={inlinePassword}
                      onChange={(e) => setInlinePassword(e.target.value)}
                      placeholder="Password"
                      className="w-full pl-2.5 pr-8 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowInlinePassword((v) => !v)}
                      aria-label={showInlinePassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {showInlinePassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  {inlineError && (
                    <p className="text-[10px] text-rose-500 dark:text-rose-400 px-0.5">
                      {inlineError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-1.5 px-3 rounded-lg theme-btn-primary text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{authLoading ? 'Signing in…' : 'Sign In'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestAuth?.('Create an Account')}
                    className="w-full text-center text-[10px] text-slate-500 dark:text-slate-400 hover:text-[var(--theme-accent)] pt-0.5 cursor-pointer"
                  >
                    Need an account? Sign Up →
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setInlineLoginOpen(true)}
                  className="w-full py-1.5 px-3 rounded-xl theme-btn-primary text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{t.signInSignUp}</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Slim Monthly Quota Mini-Bar */}
              <button
                type="button"
                onClick={() => onSelectTab('user-billing')}
                className="w-full text-left px-1 py-0.5 rounded-md hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer space-y-1"
                title={t.planUsage}
              >
                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                  <span>{t.monthlyCredits}</span>
                  <span className="font-mono tabular-nums">
                    {usagePercent}% {t.usedSuffix}
                  </span>
                </div>
                <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usagePercent > 85 ? 'bg-amber-500' : 'bg-[var(--theme-accent)]'
                    }`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </button>

              {/* Clean Profile + Theme + Sign Out (Role & Language managed in User Settings) */}
              <div className="flex items-center justify-between gap-1.5 pt-0.5">
                <div
                  onClick={() => onSelectTab('user-settings')}
                  className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer group"
                  title={t.settings}
                >
                  <div className="w-7 h-7 rounded-full bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 flex items-center justify-center text-xs font-semibold shrink-0">
                    {authUser?.avatar || authUser?.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-[var(--theme-accent)] transition-colors">
                      {authUser?.name || 'User'}
                    </div>
                    <div className="text-[10px] theme-accent-text font-medium truncate">
                      {authUser?.plan || 'Pro'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <ThemeControlPopover
                    compact
                    align="left"
                    placement="top"
                    triggerLabel={t.themeShort}
                    onOpenSettings={() => onSelectTab('user-settings')}
                  />

                  {onSignOut && (
                    <button
                      type="button"
                      onClick={onSignOut}
                      title={t.signOutBtn}
                      aria-label="Sign out of account"
                      className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
