import React, { useEffect, useState, useMemo } from 'react';
import {
  FileCheck2,
  GitBranch,
  GitCommit,
  ExternalLink,
  Search,
  Download,
  ShieldAlert,
  FileText,
  CheckCircle2,
  Filter,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { SystemAuditRecord } from '../../types';
import { buildAuditCsvContent, buildAuditCsvFilename } from '../../utils/auditCsv';
import { toast } from '../../stores/useToastStore';
import { useI18n } from '../../utils/i18n';
import { useControlCenterStore } from '../../stores/useControlCenterStore';
import { adminService } from '../../services/adminService';
import { EXTERNAL_URLS } from '../../config/externalUrls';
import { federationFindings, buildMarkdownAuditReport, surfaces } from '../../data/mcpAuditData';
import { DataSourceBadge } from '../common/DataSourceBadge';
import { useAdminCollectionSource } from '../../hooks/useAdminCollectionSource';
import { AdminTowerAuditPanel } from './AdminTowerAuditPanel';

interface AdminSystemAuditViewProps {
  auditRecords: SystemAuditRecord[];
}

export const AdminSystemAuditView: React.FC<AdminSystemAuditViewProps> = ({ auditRecords }) => {
  const { t } = useI18n();

  // বাংলা মন্তব্য: অডিট ট্রেল লাইভ সার্ভার থেকে এসেছে কি না — ব্যাজ সত্য বলে।
  // Federation সাব-ট্যাব স্ট্যাটিক (src/data/mcpAuditData) — রিজনে সেটাও উল্লেখ থাকে।
  const dataSource = useAdminCollectionSource(
    'audit',
    'অডিট রেকর্ড এখনো লাইভ সিঙ্ক হয়নি — localStorage ক্যাশ দেখানো হচ্ছে; Federation সাব-ট্যাব স্ট্যাটিক ডেমো (src/data/mcpAuditData)।'
  );
  const [activeTab, setActiveTab] = useState<'trail' | 'federation' | 'tower-audit'>('trail');
  const [searchTerm, setSearchTerm] = useState('');
  const latestGithubCommit = useControlCenterStore((s) => s.latestGithubCommit);
  const loadOverview = useControlCenterStore((s) => s.loadOverview);
  const [backendCiStatus, setBackendCiStatus] = useState<string>('Checking...');
  const [frontendCiStatus, setFrontendCiStatus] = useState<string>('Checking...');
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; label: string }>({
    ok: true,
    label: 'Probing /api/health...',
  });

  // Federation Audit states
  const [findingPriority, setFindingPriority] = useState<string>('All');
  const [findingSurface, setFindingSurface] = useState<string>('All');
  const [findingSearch, setFindingSearch] = useState<string>('');
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>('MCP-01');
  const [reviewedFindings, setReviewedFindings] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('supremeai-audit-reviewed-v1') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    let active = true;
    loadOverview().catch(() => {});

    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!active) return;
        setHealthStatus({
          ok: true,
          label: `200 OK (${data?.status || 'healthy'})`,
        });
      })
      .catch(() => {
        if (!active) return;
        setHealthStatus({ ok: false, label: 'Health endpoint unreachable' });
      });

    adminService
      .fetchGitHubRuns('Supremeai-bd/supremeai')
      .then((res) => {
        if (!active) return;
        const latest = res?.runs?.[0];
        if (latest) {
          setBackendCiStatus(latest.conclusion || latest.status || 'Active');
        } else {
          setBackendCiStatus(res?.tokenConfigured ? 'No recent runs' : 'Token unconfigured');
        }
      })
      .catch(() => {
        if (active) setBackendCiStatus('Unavailable');
      });

    adminService
      .fetchGitHubRuns('Supremeai-bd/supremeai-public')
      .then((res) => {
        if (!active) return;
        const latest = res?.runs?.[0];
        if (latest) {
          setFrontendCiStatus(latest.conclusion || latest.status || 'Active');
        } else {
          setFrontendCiStatus(res?.tokenConfigured ? 'No recent runs' : 'Token unconfigured');
        }
      })
      .catch(() => {
        if (active) setFrontendCiStatus('Unavailable');
      });

    return () => {
      active = false;
    };
  }, [loadOverview]);

  const filteredRecords = auditRecords.filter((rec) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      rec.actor.toLowerCase().includes(q) ||
      rec.action.toLowerCase().includes(q) ||
      rec.resource.toLowerCase().includes(q) ||
      rec.details.toLowerCase().includes(q) ||
      rec.ipAddress.toLowerCase().includes(q)
    );
  });

  const toggleReviewed = (id: string) => {
    setReviewedFindings((prev) => {
      const updated = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      try {
        localStorage.setItem('supremeai-audit-reviewed-v1', JSON.stringify(updated));
      } catch {
        // Ignore localStorage quota errors
      }
      return updated;
    });
  };

  const filteredFindings = useMemo(() => {
    return federationFindings.filter((f) => {
      const matchPriority = findingPriority === 'All' || f.priority === findingPriority;
      const matchSurface = findingSurface === 'All' || f.surface === findingSurface;
      const q = findingSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.summary.toLowerCase().includes(q) ||
        f.recommendation.toLowerCase().includes(q);
      return matchPriority && matchSurface && matchSearch;
    });
  }, [findingPriority, findingSurface, findingSearch]);

  const highFindingsCount = federationFindings.filter((f) => f.priority === 'High').length;
  const mediumFindingsCount = federationFindings.filter((f) => f.priority === 'Medium').length;

  const handleExportCsv = () => {
    if (filteredRecords.length === 0) return;
    const csvContent = buildAuditCsvContent(filteredRecords);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = buildAuditCsvFilename(new Date(), searchTerm.trim().length > 0);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(
      t.auditExportedTitle,
      `${filteredRecords.length} record${filteredRecords.length === 1 ? '' : 's'} saved to ${filename}`
    );
  };

  const handleExportMarkdown = () => {
    const mdContent = buildMarkdownAuditReport(reviewedFindings);
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `SupremeAI-Federation-Audit-Report-${new Date().toISOString().slice(0, 10)}.md`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(
      'Audit Report Exported',
      `Full Markdown security report downloaded as ${filename}`
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-8 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t.systemAuditTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
              {t.immutableAuditBadge}
            </span>
            <DataSourceBadge
              source={dataSource.source}
              reason={dataSource.reason}
              ageMs={dataSource.ageMs}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Track administrative actions, verify GitHub release parity, and monitor MCP Federation &amp;
            Security audit findings.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/80 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors shadow-xs cursor-pointer"
            title="Download full Markdown report of MCP & Federation Audit"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Export MD Report</span>
          </button>

          <a
            href={EXTERNAL_URLS.githubOrgBase}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
          >
            <span>GitHub Organization</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* GitHub Release & CI Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Supremeai Repo */}
        <div className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400">
                <GitBranch className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Supremeai-bd / supremeai
                </h3>
                <p className="text-[11px] text-slate-400">{t.coreEngineSubtitle}</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
              {backendCiStatus}
            </span>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1 font-mono text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400 shrink-0">Latest Commit:</span>
              <span className="text-slate-800 dark:text-slate-200 truncate">
                {latestGithubCommit
                  ? `#${latestGithubCommit.sha}: ${latestGithubCommit.message}`
                  : 'Syncing repository head...'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400 shrink-0">Repository:</span>
              <a
                href={EXTERNAL_URLS.githubBackendRepo}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline truncate"
              >
                Supremeai-bd/supremeai
              </a>
            </div>
          </div>
        </div>

        {/* Supremeai-frontend Repo */}
        <div className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-slate-800 text-purple-600 dark:text-purple-400">
                <GitCommit className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Supremeai-bd / supremeai-public
                </h3>
                <p className="text-[11px] text-slate-400">{t.studioFrontendSubtitle}</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
              {frontendCiStatus}
            </span>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1 font-mono text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400 shrink-0">Repository:</span>
              <a
                href={EXTERNAL_URLS.githubFrontendRepo}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline truncate"
              >
                Supremeai-bd/supremeai-public
              </a>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400 shrink-0">Live Health:</span>
              <span
                className={
                  healthStatus.ok ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold'
                }
              >
                {healthStatus.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('trail')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'trail'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          <span>Action Audit Trail ({auditRecords.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('federation')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'federation'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          <span>MCP Federation & Security Audit</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300">
            {federationFindings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tower-audit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'tower-audit'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-cyan-500" />
          <span>Tower Audit v1.0</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-300">
            17
          </span>
        </button>
      </div>

      {/* TAB 3: Tower Audit v1.0 (25 Nov 2026) */}
      {activeTab === 'tower-audit' && <AdminTowerAuditPanel />}

      {/* TAB 1: Admin Audit Trail */}
      {activeTab === 'trail' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-blue-600" />
              Administrative Action Audit Trail
            </h2>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 sm:flex-initial sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search audit trail..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredRecords.length === 0}
                title={
                  filteredRecords.length === 0
                    ? t.auditEmptyMsg
                    : `${t.exportCsvBtn} (${filteredRecords.length})`
                }
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.exportCsvBtn}</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Target Resource</th>
                    <th className="px-4 py-3">Event Details</th>
                    <th className="px-4 py-3">IP Origin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        {t.auditEmptyMsg}
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((rec) => (
                      <tr
                        key={rec.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3.5 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                          {rec.timestamp}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-slate-800 dark:text-slate-200">
                          {rec.actor}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {rec.action}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-900 dark:text-white">
                          {rec.resource}
                        </td>
                        <td className="px-4 py-3.5 max-w-sm truncate text-slate-600 dark:text-slate-400">
                          {rec.details}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                          {rec.ipAddress}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Federation & Security Audit */}
      {activeTab === 'federation' && (
        <div className="space-y-6">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 shadow-xs">
              <span className="text-[11px] font-medium text-slate-400">Total Findings</span>
              <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                {federationFindings.length}
              </div>
              <span className="text-[10px] text-slate-500">6 Architectural Surfaces</span>
            </div>

            <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 shadow-xs">
              <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                High Priority
              </span>
              <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
                {highFindingsCount}
              </div>
              <span className="text-[10px] text-rose-500/80">Immediate attention recommended</span>
            </div>

            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 shadow-xs">
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Medium Priority
              </span>
              <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
                {mediumFindingsCount}
              </div>
              <span className="text-[10px] text-amber-500/80">System & config alignment</span>
            </div>

            <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 shadow-xs">
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                Reviewed Status
              </span>
              <div className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                {reviewedFindings.length} / {federationFindings.length}
              </div>
              <span className="text-[10px] text-blue-500/80">Locally marked reviewed</span>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-100/70 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mr-1">
                <Filter className="w-3.5 h-3.5" />
                <span>Filters:</span>
              </div>

              {/* Priority Filter */}
              <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                {['All', 'High', 'Medium', 'Low'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFindingPriority(p)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                      findingPriority === p
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Surface Filter */}
              <select
                value={findingSurface}
                onChange={(e) => setFindingSurface(e.target.value)}
                aria-label="Filter by Surface"
                className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-lg px-2.5 py-1 focus:outline-hidden"
              >
                <option value="All">All Surfaces</option>
                {surfaces.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Box */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2 text-slate-400" />
              <input
                type="text"
                value={findingSearch}
                onChange={(e) => setFindingSearch(e.target.value)}
                placeholder="Search findings or recommendations..."
                className="w-full pl-8 pr-3 py-1 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Findings List */}
          <div className="space-y-3">
            {filteredFindings.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                No findings match the selected filters.
              </div>
            ) : (
              filteredFindings.map((finding) => {
                const isExpanded = expandedFindingId === finding.id;
                const isReviewed = reviewedFindings.includes(finding.id);

                return (
                  <div
                    key={finding.id}
                    className={`rounded-2xl border transition-all ${
                      isReviewed
                        ? 'border-slate-200/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-900/30 opacity-75'
                        : finding.priority === 'High'
                          ? 'border-rose-200/90 dark:border-rose-900/60 bg-white dark:bg-slate-900/80 shadow-xs'
                          : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs'
                    }`}
                  >
                    {/* Header bar of finding */}
                    <div
                      className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
                      onClick={() => setExpandedFindingId(isExpanded ? null : finding.id)}
                    >
                      <div className="flex items-center gap-2.5 flex-wrap flex-1">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                          {finding.id}
                        </span>

                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            finding.priority === 'High'
                              ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                              : finding.priority === 'Medium'
                                ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                : 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                          }`}
                        >
                          {finding.priority}
                        </span>

                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {finding.surface}
                        </span>

                        <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                          {finding.title}
                        </h3>

                        {isReviewed && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Reviewed
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleReviewed(finding.id);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors cursor-pointer ${
                            isReviewed
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {isReviewed ? 'Reviewed ✓' : 'Mark Reviewed'}
                        </button>

                        <div className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Body */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800/80 space-y-3.5 text-xs">
                        <div>
                          <span className="font-semibold text-slate-500 dark:text-slate-400 text-[11px]">
                            Observation Summary:
                          </span>
                          <p className="mt-0.5 text-slate-700 dark:text-slate-300 leading-relaxed">
                            {finding.summary}
                          </p>
                        </div>

                        <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60">
                          <span className="font-bold text-blue-900 dark:text-blue-300 text-[11px] block">
                            Recommended Remediation:
                          </span>
                          <p className="mt-0.5 text-blue-800 dark:text-blue-200 leading-relaxed text-[11px]">
                            {finding.recommendation}
                          </p>
                        </div>

                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/70 dark:border-slate-800">
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-[11px] block">
                            Validation Method:
                          </span>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400 text-[11px] font-mono leading-relaxed">
                            {finding.validation}
                          </p>
                        </div>

                        <div>
                          <span className="font-semibold text-slate-500 dark:text-slate-400 text-[11px] block mb-1">
                            Primary Sources & Evidence:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {finding.sources.map((src) => (
                              <a
                                key={`${src.href}-${src.label}`}
                                href={src.href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:underline text-[11px]"
                              >
                                <span>{src.label}</span>
                                {src.detail && (
                                  <span className="text-slate-400">({src.detail})</span>
                                )}
                                <ExternalLink className="w-3 h-3 text-slate-400" />
                              </a>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
