import React from 'react';
import { ADMIN_SECTIONS, findAdminSection } from '../../config/adminSections';
import { useAdminHealthSummary } from '../../hooks/useAdminHealthSummary';

/**
 * বাংলা মন্তব্য: প্রতিটা অ্যাডমিন পেজের ওপরে একই ধাঁচের হেডার — সেকশনের নাম, এক লাইনের ব্যাখ্যা,
 * আর সেকশনের সাব-ট্যাব। মোবাইলে (যেখানে বাঁ দিকের মেনু লুকানো) একটা সেকশন ড্রপডাউনও দেখায়।
 */

interface AdminSectionTabsProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

export const AdminSectionTabs: React.FC<AdminSectionTabsProps> = ({ activeTab, onSelectTab }) => {
  const section = findAdminSection(activeTab);
  const { issuesBySection } = useAdminHealthSummary();
  if (!section) return null;
  const counts = issuesBySection[section.id];

  return (
    <div
      data-testid="admin-section-header"
      className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 backdrop-blur px-4 sm:px-6 pt-3"
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {section.label}
              {counts && counts.critical > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white">
                  {counts.critical} critical
                </span>
              )}
              {counts && counts.critical === 0 && counts.warning > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                  {counts.warning} warning{counts.warning === 1 ? '' : 's'}
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {section.description}
            </p>
          </div>
          <select
            value={section.id}
            onChange={(e) => {
              const next = ADMIN_SECTIONS.find((s) => s.id === e.target.value);
              if (next) onSelectTab(next.tabs[0].id);
            }}
            aria-label="Admin section"
            className="lg:hidden px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {ADMIN_SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {issuesBySection[s.id]?.critical
                  ? ' 🔴'
                  : issuesBySection[s.id]?.warning
                    ? ' 🟠'
                    : ''}
              </option>
            ))}
          </select>
        </div>

        {section.tabs.length > 1 ? (
          <div
            role="tablist"
            aria-label={`${section.label} pages`}
            className="flex gap-1 mt-2 overflow-x-auto"
          >
            {section.tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab.id)}
                  className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px cursor-pointer transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="h-3" />
        )}
      </div>
    </div>
  );
};

export default AdminSectionTabs;
