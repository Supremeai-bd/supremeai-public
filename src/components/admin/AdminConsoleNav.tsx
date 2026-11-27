import React from 'react';
import {
  Activity,
  Bot,
  Cpu,
  GitBranch,
  LayoutDashboard,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { ADMIN_SECTIONS, findAdminSection, type AdminSectionId } from '../../config/adminSections';
import { useAdminAutoRefresh, useAdminHealthSummary } from '../../hooks/useAdminHealthSummary';
import { openCommandPalette } from '../../utils/commandPalette';

/**
 * বাংলা মন্তব্য: পরিষ্কার অ্যাডমিন মেনু — ১৯টা ছড়ানো ট্যাবের বদলে ৯টা সেকশন, ৪টা গ্রুপে।
 * কোনো সেকশনে সমস্যা থাকলে পাশে লাল (critical) বা হলুদ (warning) সংখ্যা দেখায়, যাতে অ্যাডমিন
 * সরাসরি সেখানে যেতে পারে। কনসোল খোলা থাকলে প্রতি মিনিটে সব ডেটা নিজে থেকে রিফ্রেশ হয়।
 */

interface AdminConsoleNavProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

const SECTION_ICON: Record<AdminSectionId, React.ReactNode> = {
  overview: <LayoutDashboard className="w-4 h-4 shrink-0" />,
  services: <Activity className="w-4 h-4 shrink-0" />,
  logs: <ScrollText className="w-4 h-4 shrink-0" />,
  users: <Users className="w-4 h-4 shrink-0" />,
  ai: <Cpu className="w-4 h-4 shrink-0" />,
  agents: <Bot className="w-4 h-4 shrink-0" />,
  security: <ShieldCheck className="w-4 h-4 shrink-0" />,
  deploy: <GitBranch className="w-4 h-4 shrink-0" />,
  settings: <Settings2 className="w-4 h-4 shrink-0" />,
};

const GROUP_ORDER = ['Monitor', 'Manage', 'Protect & Ship', 'Configure'] as const;

export const AdminConsoleNav: React.FC<AdminConsoleNavProps> = ({ activeTab, onSelectTab }) => {
  const { t } = useI18n();
  useAdminAutoRefresh();
  const { issuesBySection, overall, counts } = useAdminHealthSummary();
  const activeSection = findAdminSection(activeTab)?.id;

  return (
    <nav
      aria-label="Admin Ops Console Navigation"
      className="hidden lg:flex w-60 shrink-0 flex-col border-r border-white/[0.08] bg-[#111823] text-[#e8edf5] overflow-y-auto p-3 gap-1 text-xs"
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 rounded-xl border border-white/[0.09] bg-white/[0.035]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6e8eff] to-[#4a70e8] flex items-center justify-center text-white font-bold text-sm shrink-0">
          SA
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-[#f5f7fb] truncate">
            {t.opsConsoleTitle}
          </div>
          <div className="text-[10.5px] font-mono text-[#8491a2] truncate">Production</div>
        </div>
      </div>

      <button
        type="button"
        data-testid="admin-nav-search"
        onClick={openCommandPalette}
        className="flex items-center gap-2 px-2.5 py-2 mb-1 rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#8491a2] hover:text-[#e8edf5] hover:bg-white/[0.06] transition-colors cursor-pointer"
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">{t.cpSearchBtn}</span>
        <kbd className="font-mono text-[10px] border border-white/[0.12] rounded px-1.5 py-0.5">
          Ctrl K
        </kbd>
      </button>

      {GROUP_ORDER.map((group) => {
        const sections = ADMIN_SECTIONS.filter((s) => s.group === group);
        return (
          <div key={group} className="space-y-0.5">
            <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6f7b8d]">
              {group}
            </div>
            {sections.map((section) => {
              const isActive = activeSection === section.id;
              const c = issuesBySection[section.id];
              return (
                <button
                  key={section.id}
                  type="button"
                  data-testid={`admin-nav-${section.id}`}
                  onClick={() => onSelectTab(section.tabs[0].id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center justify-between gap-2 pl-3 pr-2 py-2 rounded-lg text-left cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-[#4a70e8]/20 text-[#f1f5ff] ring-1 ring-inset ring-[#89a0fc]/25 font-semibold'
                      : 'text-[#a4b0c0] hover:bg-white/[0.06] hover:text-[#f0f4fb]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className={isActive ? 'text-[#9cb2ff]' : 'text-[#7e8b9d]'}>
                      {SECTION_ICON[section.id]}
                    </span>
                    <span className="truncate text-[12.5px]">{section.label}</span>
                  </span>
                  {c && c.critical > 0 ? (
                    <span
                      title={`${c.critical} critical`}
                      className="shrink-0 min-w-[20px] text-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white"
                    >
                      {c.critical}
                    </span>
                  ) : c && c.warning > 0 ? (
                    <span
                      title={`${c.warning} warnings`}
                      className="shrink-0 min-w-[20px] text-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/90 text-white"
                    >
                      {c.warning}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}

      <div className="mt-auto pt-3">
        <button
          type="button"
          onClick={() => onSelectTab('admin-overview')}
          className="w-full p-3 rounded-xl border border-white/[0.08] bg-[#161f2c] text-left cursor-pointer hover:border-white/20"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#98a5b5] font-medium">Platform status</span>
            <span
              className={`inline-flex items-center gap-1.5 font-semibold ${
                overall === 'critical'
                  ? 'text-rose-300'
                  : overall === 'warning'
                    ? 'text-amber-300'
                    : overall === 'ok'
                      ? 'text-emerald-300'
                      : 'text-slate-400'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  overall === 'critical'
                    ? 'bg-rose-500 animate-pulse'
                    : overall === 'warning'
                      ? 'bg-amber-400'
                      : overall === 'ok'
                        ? 'bg-emerald-400'
                        : 'bg-slate-500'
                }`}
              />
              {overall === 'critical'
                ? `${counts.critical} critical`
                : overall === 'warning'
                  ? `${counts.warning} warnings`
                  : overall === 'ok'
                    ? 'All good'
                    : 'Checking…'}
            </span>
          </div>
        </button>
      </div>
    </nav>
  );
};
