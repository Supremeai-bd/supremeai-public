import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { UserRole } from '../../../types';
import { useI18n } from '../../../utils/i18n';

/**
 * Admin-only workspace switcher, shown inside Settings → Account & Security.
 *
 * বাংলা: শুধু অ্যাডমিন দেখতে পান। এখান থেকে অ্যাডমিন স্টুডিও ↔ সাধারণ ভিউ বদলানো আর
 * অপস কনসোল খোলা যায়।
 */
interface AdminWorkspaceSwitcherProps {
  currentRole: UserRole;
  onSwitchRole: (role: UserRole) => void;
  onOpenAdminConsole?: () => void;
}

export const AdminWorkspaceSwitcher: React.FC<AdminWorkspaceSwitcherProps> = ({
  currentRole,
  onSwitchRole,
  onOpenAdminConsole,
}) => {
  const { t } = useI18n();
  const isAdmin = currentRole === 'admin';

  return (
    <div
      data-testid="admin-workspace-switcher"
      className="p-5 rounded-2xl bg-gradient-to-r from-blue-50/80 to-indigo-50/80 dark:from-slate-900 dark:to-slate-900/90 border border-blue-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            {t.activeWorkspaceLabel}
          </span>
          <span aria-hidden="true" className="text-slate-400">
            ·
          </span>
          <span className="font-semibold text-slate-900 dark:text-white">
            {isAdmin ? t.adminStudio : t.customerWorkspaceLabel}
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {isAdmin ? t.adminModeSummary : t.customerModeSummary}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {isAdmin && onOpenAdminConsole && (
          <button
            type="button"
            onClick={onOpenAdminConsole}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-blue-300 dark:border-blue-700/70 bg-white/80 dark:bg-slate-800 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:border-blue-500 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{t.opsConsoleTitle}</span>
          </button>
        )}
        <button
          type="button"
          data-testid="admin-workspace-switch-btn"
          onClick={() => onSwitchRole(isAdmin ? 'user' : 'admin')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
        >
          <span>{isAdmin ? t.switchToUserViewBtn : t.switchToAdminStudio}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
