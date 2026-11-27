import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Eye,
  Terminal,
  Globe,
  Clock,
  Code2,
  GitGraph,
  X,
  GripVertical,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  FlaskConical,
} from 'lucide-react';
import { useWorkspaceStore, WorkspaceTab } from '../../stores/useWorkspaceStore';
import { WorkspacePreviewTab } from './WorkspacePreviewTab';
import { WorkspaceSandboxTab } from './WorkspaceSandboxTab';
import { WorkspaceTerminalTab } from './WorkspaceTerminalTab';
import { WorkspaceBrowserTab } from './WorkspaceBrowserTab';
import { WorkspaceScheduleTab } from './WorkspaceScheduleTab';
import { WorkspaceCodeTab } from './WorkspaceCodeTab';
import { WorkspaceGraphTab } from './WorkspaceGraphTab';
import { useI18n } from '../../utils/i18n';

interface WorkspaceDockProps {
  isGuest?: boolean;
}

export const WorkspaceDock: React.FC<WorkspaceDockProps> = ({ isGuest = false }) => {
  const {
    isDockOpen,
    dockWidthPercent,
    activeDockTab,
    isArtifactStreaming,
    setDockOpen,
    setDockWidthPercent,
    setActiveDockTab,
  } = useWorkspaceStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(ev.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const handleEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [moreMenuOpen]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const parentRect = dockRef.current?.parentElement?.getBoundingClientRect();
      const totalWidth = parentRect?.width || window.innerWidth;
      const rightEdge = parentRect?.right || window.innerWidth;
      const newWidthPx = rightEdge - e.clientX;
      const newPct = (newWidthPx / totalWidth) * 100;
      setDockWidthPercent(newPct);
    },
    [isDragging, setDockWidthPercent]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (!isDockOpen) return null;

  const primaryTabs: {
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = isGuest
    ? [
        { id: 'preview', label: t.dockPreview, icon: Eye },
        { id: 'code', label: t.dockCode, icon: Code2 },
      ]
    : [
        { id: 'preview', label: t.dockPreview, icon: Eye },
        { id: 'code', label: t.dockCode, icon: Code2 },
        { id: 'browser', label: t.dockBrowser, icon: Globe },
        { id: 'schedule', label: t.dockSchedule, icon: Clock },
      ];

  const secondaryTabs: {
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] =
    // বাংলা মন্তব্য: Developer Mode নেই — সাইন-ইন করা সবার জন্য Sandbox/Terminal/Graph খোলা।
    !isGuest
      ? [
          { id: 'sandbox', label: t.dockSandbox, icon: FlaskConical },
          { id: 'terminal', label: t.dockTerminal, icon: Terminal },
          { id: 'graph', label: t.dockGraph, icon: GitGraph },
        ]
      : [];

  const allAllowedTabs = [...primaryTabs, ...secondaryTabs];
  const effectiveTab: WorkspaceTab = allAllowedTabs.some((item) => item.id === activeDockTab)
    ? activeDockTab
    : 'preview';

  const activeSecondaryTab = secondaryTabs.find((item) => item.id === effectiveTab) || null;

  return (
    <aside
      ref={dockRef}
      style={
        (isMaximized
          ? { width: '100%' }
          : { '--dock-w': `${dockWidthPercent}%` }) as React.CSSProperties
      }
      className={`${
        isMaximized
          ? 'absolute inset-0 z-40 flex'
          : 'absolute inset-y-0 right-0 z-40 w-[88%] max-w-[440px] md:static md:inset-auto md:w-[var(--dock-w)] md:min-w-[280px] md:max-w-[62%] flex'
      } flex-col h-full border-l border-slate-200 dark:border-cyan-500/20 bg-white/95 dark:bg-[#090d16]/95 backdrop-blur-xl shadow-2xl shrink-0 transition-[box-shadow]`}
    >
      {/* Left Resizable Divider Handle */}
      {!isMaximized && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          title="Drag to resize Workspace Dock"
          className={`absolute -left-1.5 top-0 bottom-0 w-3 z-30 cursor-col-resize flex items-center justify-center group ${
            isDragging ? 'bg-cyan-500/20' : 'hover:bg-cyan-500/10'
          }`}
        >
          <div className="w-1 h-12 rounded-full bg-slate-300 dark:bg-slate-700 group-hover:bg-cyan-400 transition-colors flex items-center justify-center">
            <GripVertical className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100" />
          </div>
        </div>
      )}

      {/* Dragging overlay so iframes don't steal mouse events */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}

      {/* Top Dock Navigation Bar (AI Studio Unified Header) */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800/90 flex items-center justify-between gap-2 bg-slate-50/90 dark:bg-[#0b101b] shrink-0 min-w-0">
        {/* Clean Primary Segmented Tabs + Compact More Tools Menu (Dev Only) */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-200/70 dark:bg-slate-900 border border-slate-300/60 dark:border-slate-800 overflow-x-auto no-scrollbar min-w-0">
            {primaryTabs.map((tab) => {
              const Icon = tab.icon;
              const active = effectiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`dock-tab-${tab.id}`}
                  onClick={() => {
                    setActiveDockTab(tab.id);
                    setMoreMenuOpen(false);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {secondaryTabs.length > 0 && (
            <div ref={moreMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMoreMenuOpen((v) => !v)}
                aria-expanded={moreMenuOpen}
                title={t.dockMoreTools}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  activeSecondaryTab
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300 font-semibold'
                    : 'bg-slate-200/50 dark:bg-slate-900 border-slate-300/60 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <MoreHorizontal className="w-3.5 h-3.5 shrink-0" />
                {activeSecondaryTab && (
                  <span className="hidden sm:inline">{activeSecondaryTab.label}</span>
                )}
              </button>

              {moreMenuOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-44 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#0d1422] shadow-xl p-1 z-50">
                  {secondaryTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = effectiveTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        data-testid={`dock-tab-${tab.id}`}
                        onClick={() => {
                          setActiveDockTab(tab.id);
                          setMoreMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 font-semibold'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {isArtifactStreaming && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-medium text-cyan-600 dark:text-cyan-300 animate-pulse whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="hidden sm:inline">{t.wsLiveSyncStreaming}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? t.dockRestoreSplit : t.dockMaximize}
            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsMaximized(false);
              setDockOpen(false);
            }}
            title={t.dockClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Active Workspace Tab Content */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        {effectiveTab === 'preview' && <WorkspacePreviewTab />}
        {effectiveTab === 'code' && <WorkspaceCodeTab />}
        {effectiveTab === 'browser' && !isGuest && <WorkspaceBrowserTab />}
        {effectiveTab === 'schedule' && !isGuest && <WorkspaceScheduleTab />}
        {effectiveTab === 'sandbox' && !isGuest && <WorkspaceSandboxTab />}
        {effectiveTab === 'terminal' && !isGuest && <WorkspaceTerminalTab />}
        {effectiveTab === 'graph' && !isGuest && <WorkspaceGraphTab />}
      </div>
    </aside>
  );
};
