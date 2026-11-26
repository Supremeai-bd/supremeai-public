import React, { useMemo, useState } from 'react';
import {
  Cpu,
  ShieldCheck,
  Users,
  Activity,
  Radio,
  Key,
  Database,
  FileCheck2,
  Bot,
  Rocket,
  GitBranch,
  Brain,
  Globe,
  Wallet,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Pin,
  Search,
} from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { logger } from '../../utils/logger';

interface AdminConsoleNavProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  customersCount?: number;
  mcpAlertCount?: number;
  healthAlertCount?: number;
}

interface AdminNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  badgeAlert?: boolean;
}

const PINNED_ADMIN_STORAGE_KEY = 'supremeai_pinned_admin_tools';
const DEFAULT_PINNED_ADMIN_TOOLS = ['mcp-tower', 'system-audit'];

export const AdminConsoleNav: React.FC<AdminConsoleNavProps> = ({
  activeTab,
  onSelectTab,
  customersCount = 0,
  mcpAlertCount = 0,
  healthAlertCount = 0,
}) => {
  const { t } = useI18n();
  const [showAdvancedAdmin, setShowAdvancedAdmin] = useState(false);
  const [toolFilter, setToolFilter] = useState('');
  const [pinnedAdminToolIds, setPinnedAdminToolIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(PINNED_ADMIN_STORAGE_KEY);
      if (saved === null) return DEFAULT_PINNED_ADMIN_TOOLS;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch (error) {
      logger.debug('AdminConsoleNav: suppressed non-fatal error', error);
    }
    return DEFAULT_PINNED_ADMIN_TOOLS;
  });

  const togglePinAdminTool = (toolId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedAdminToolIds((prev) => {
      const next = prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId];
      try {
        localStorage.setItem(PINNED_ADMIN_STORAGE_KEY, JSON.stringify(next));
      } catch (error) {
        logger.debug('AdminConsoleNav: suppressed non-fatal error', error);
      }
      return next;
    });
  };

  const adminHubs: Array<{ title: string; items: AdminNavItem[] }> = [
    {
      title: 'Live Health & Ops',
      items: [
        {
          id: 'admin-overview',
          label: 'Command Center',
          icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'health-monitor',
          label: 'CPU, Mem & Latency',
          icon: <Cpu className="w-4 h-4 shrink-0" />,
          badge: healthAlertCount > 0 ? `${healthAlertCount}` : undefined,
          badgeAlert: healthAlertCount > 0,
        },
        {
          id: 'task-queue',
          label: 'Task Queue',
          icon: <Activity className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'mcp-tower',
          label: 'MCP Tower',
          icon: <Radio className="w-4 h-4 shrink-0" />,
          badge: mcpAlertCount > 0 ? `${mcpAlertCount}` : undefined,
          badgeAlert: mcpAlertCount > 0,
        },
      ],
    },
    {
      title: 'AI & Compute',
      items: [
        {
          id: 'llm-gateway',
          label: 'LLM Gateway',
          icon: <Cpu className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'compute-fleet',
          label: 'GPU Fleet',
          icon: <Globe className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'agent-swarm',
          label: 'Agent Swarm',
          icon: <Bot className="w-4 h-4 shrink-0" />,
        },
      ],
    },
    {
      title: 'Users & Safety',
      items: [
        {
          id: 'customers',
          label: 'Customers',
          icon: <Users className="w-4 h-4 shrink-0" />,
          badge: String(customersCount),
        },
        {
          id: 'security',
          label: 'Security & Abuse',
          icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'hitl-policies',
          label: 'HITL & Policies',
          icon: <ShieldAlert className="w-4 h-4 shrink-0" />,
        },
      ],
    },
    {
      title: 'Releases & Data',
      items: [
        {
          id: 'github-pipeline',
          label: 'GitHub Pipeline',
          icon: <GitBranch className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'release-gate',
          label: 'Release Gate',
          icon: <Rocket className="w-4 h-4 shrink-0" />,
        },
        {
          id: 'schema-parity',
          label: 'Schema Parity',
          icon: <Database className="w-4 h-4 shrink-0" />,
        },
      ],
    },
  ];

  const advancedAdminItems: AdminNavItem[] = [
    {
      id: 'architecture-map',
      label: 'Architecture Map',
      icon: <Activity className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'memory-graph',
      label: 'Memory & Qdrant',
      icon: <Brain className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'system-audit',
      label: 'System Audit Log',
      icon: <FileCheck2 className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'provider-keys',
      label: 'Provider API Keys',
      icon: <Key className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'finops-omnichannel',
      label: 'FinOps & Telegram',
      icon: <Wallet className="w-3.5 h-3.5 shrink-0" />,
    },
    {
      id: 'external-agents',
      label: 'External Agents',
      icon: <GitBranch className="w-3.5 h-3.5 shrink-0" />,
    },
  ];

  const allAdminItems = [...adminHubs.flatMap((h) => h.items), ...advancedAdminItems];
  const adminItemById = new Map(allAdminItems.map((item) => [item.id, item]));
  const pinnedAdminItems = pinnedAdminToolIds
    .map((id) => adminItemById.get(id))
    .filter((item): item is AdminNavItem => Boolean(item));

  const normalizedQuery = toolFilter.trim().toLowerCase();
  const matchingItems = useMemo(() => {
    if (!normalizedQuery) return [];
    return allAdminItems.filter(
      (item) =>
        item.label.toLowerCase().includes(normalizedQuery) ||
        item.id.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, allAdminItems]);

  const totalAlerts = Math.max(mcpAlertCount, healthAlertCount);

  const renderAdminNavRow = (
    item: AdminNavItem,
    opts: { compact?: boolean; inPinnedSection?: boolean } = {}
  ) => {
    const isActive = activeTab === item.id;
    const isPinned = pinnedAdminToolIds.includes(item.id);
    const { compact = false, inPinnedSection = false } = opts;

    return (
      <div
        key={`${inPinnedSection ? 'pinned-' : ''}${item.id}`}
        className={`group flex items-center gap-1 rounded-lg transition-colors ${
          isActive
            ? 'bg-[#4a70e8]/20 text-[#f1f5ff] ring-1 ring-inset ring-[#89a0fc]/25 font-semibold'
            : 'text-[#a4b0c0] hover:bg-white/[0.06] hover:text-[#f0f4fb]'
        }`}
      >
        <button
          type="button"
          onClick={() => onSelectTab(item.id)}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 ${
            compact ? 'pl-2.5 pr-1 py-1.5' : 'pl-3 pr-1 py-2'
          } text-left cursor-pointer`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={isActive ? 'text-[#9cb2ff]' : 'text-[#7e8b9d] group-hover:text-[#c1cfff]'}
            >
              {item.icon}
            </span>
            <span className="truncate text-[12.5px]">{item.label}</span>
          </div>
          {item.badge && (
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums font-semibold ${
                item.badgeAlert
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-white/[0.08] text-[#b4c0d2]'
              }`}
            >
              {item.badge}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => togglePinAdminTool(item.id, e)}
          aria-label={isPinned ? `${t.unpinTool} ${item.label}` : `${t.pinTool} ${item.label}`}
          title={isPinned ? t.unpinTool : t.pinTool}
          className={`p-1 mr-1 rounded transition-opacity cursor-pointer shrink-0 ${
            isPinned
              ? 'text-amber-400 hover:text-amber-300 opacity-100'
              : 'text-[#6f7b8d] hover:text-amber-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <Pin className="w-3 h-3" />
        </button>
      </div>
    );
  };

  return (
    <nav
      aria-label="Admin Ops Console Navigation"
      className="hidden lg:flex w-64 shrink-0 flex-col border-r border-white/[0.08] bg-[#111823] text-[#e8edf5] overflow-y-auto p-3 space-y-2 text-xs"
    >
      {/* Workspace Header */}
      <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-white/[0.09] bg-white/[0.035]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6e8eff] to-[#4a70e8] flex items-center justify-center text-white font-bold text-sm shrink-0">
          SA
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-[#f5f7fb] truncate">
            {t.opsConsoleTitle}
          </div>
          <div className="text-[10.5px] font-mono text-[#8491a2] truncate">
            Production · Control Tower
          </div>
        </div>
      </div>

      {/* Quick Filter */}
      <label className="flex items-center gap-2 px-2.5 h-8 rounded-lg border border-white/[0.09] bg-[#161f2c] text-[#8491a2] focus-within:border-[#7b96ff]/60 focus-within:text-[#e8edf5] transition-colors">
        <Search className="w-3.5 h-3.5 shrink-0" />
        <input
          type="text"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          placeholder="Filter admin tools..."
          aria-label="Filter admin tools"
          className="w-full min-w-0 bg-transparent text-[12px] text-[#e8edf5] placeholder-[#6f7b8d] focus:outline-none"
        />
      </label>

      {normalizedQuery ? (
        <div className="space-y-1 pt-1">
          <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#6f7b8d]">
            Matches ({matchingItems.length})
          </div>
          {matchingItems.length > 0 ? (
            matchingItems.map((item) => renderAdminNavRow(item, { compact: true }))
          ) : (
            <div className="px-2.5 py-4 text-[11.5px] text-[#7e8b9d]">No matching admin tools</div>
          )}
        </div>
      ) : (
        <>
          {pinnedAdminItems.length > 0 && (
            <div className="pb-2 border-b border-white/[0.08] space-y-0.5">
              <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
                <span className="inline-flex items-center gap-1.5">
                  <Pin className="w-3 h-3" />
                  <span>{t.pinnedAdminTools}</span>
                </span>
                <span className="font-mono tabular-nums">{pinnedAdminItems.length}</span>
              </div>
              {pinnedAdminItems.map((item) =>
                renderAdminNavRow(item, { compact: true, inPinnedSection: true })
              )}
            </div>
          )}

          {adminHubs.map((hub, idx) => (
            <div key={hub.title} className="space-y-0.5">
              <div
                className={`px-2.5 ${
                  idx === 0 ? 'pt-0.5' : 'pt-2'
                } pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6f7b8d]`}
              >
                {hub.title}
              </div>
              {hub.items.map((item) => renderAdminNavRow(item, { compact: true }))}
            </div>
          ))}

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvancedAdmin((v) => !v)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[10.5px] font-semibold uppercase tracking-wider text-[#8491a2] hover:text-[#f0f4fb] hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <span>More Admin Tools</span>
              {showAdvancedAdmin ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {showAdvancedAdmin && (
              <div className="space-y-0.5 pt-1 pl-1.5 border-l border-white/[0.09] ml-2.5">
                {advancedAdminItems.map((item) => renderAdminNavRow(item, { compact: true }))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Bottom System Health Summary Card */}
      <div className="mt-auto pt-3">
        <div className="p-3 rounded-xl border border-white/[0.08] bg-[#161f2c] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#98a5b5] font-medium">Cluster Posture</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                totalAlerts > 0 ? 'text-amber-300' : 'text-emerald-300'
              }`}
            >
              {totalAlerts > 0 ? `${totalAlerts} alert${totalAlerts > 1 ? 's' : ''}` : 'Nominal'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab('health-monitor')}
            className="text-[11px] font-semibold text-[#9bb4ff] hover:text-white transition-colors cursor-pointer"
          >
            Inspect live diagnostics →
          </button>
        </div>
      </div>
    </nav>
  );
};
