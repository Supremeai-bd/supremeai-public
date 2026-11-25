import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import 'd3-transition';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Flame,
  KeyRound,
  Layers,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  calculateAccountRunway,
  formatCompactQuota,
  getDaysUntilReset,
  useProviderAccountsStore,
  type PoolRoutingStrategy,
  type ProviderAccountRecord,
  type ProviderCategory,
  type ProviderPoolId,
} from '../../stores/useProviderAccountsStore';
import { useAuthStore } from '../../stores/useAuthStore';

type HubSubTab = 'pools' | 'runway' | 'heatmap' | 'audit';

const PROVIDER_OPTIONS: Array<{
  id: ProviderPoolId;
  label: string;
  category: ProviderCategory;
  defaultMetric: string;
  defaultConsole: string;
}> = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    category: 'ai',
    defaultMetric: 'Tokens / mo',
    defaultConsole: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'groq',
    label: 'Groq Cloud',
    category: 'ai',
    defaultMetric: 'Req / day',
    defaultConsole: 'https://console.groq.com/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'ai',
    defaultMetric: 'Credit USD',
    defaultConsole: 'https://platform.openai.com/settings/organization/billing/overview',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    category: 'ai',
    defaultMetric: 'Credit USD',
    defaultConsole: 'https://console.anthropic.com/settings/billing',
  },
  {
    id: 'render',
    label: 'Render Cloud',
    category: 'compute',
    defaultMetric: 'Build Mins / mo',
    defaultConsole: 'https://dashboard.render.com/billing',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Edge',
    category: 'edge',
    defaultMetric: 'Worker Req / day',
    defaultConsole: 'https://dash.cloudflare.com/',
  },
  {
    id: 'supabase',
    label: 'Supabase Postgres',
    category: 'data',
    defaultMetric: 'DB Storage MB',
    defaultConsole: 'https://supabase.com/dashboard/projects',
  },
  {
    id: 'upstash',
    label: 'Upstash Redis',
    category: 'data',
    defaultMetric: 'Cmds / mo',
    defaultConsole: 'https://console.upstash.com/',
  },
  {
    id: 'qdrant',
    label: 'Qdrant Cloud',
    category: 'data',
    defaultMetric: 'Vectors',
    defaultConsole: 'https://cloud.qdrant.io/',
  },
  {
    id: 'github',
    label: 'GitHub Actions',
    category: 'compute',
    defaultMetric: 'Action Mins / mo',
    defaultConsole: 'https://github.com/settings/billing',
  },
];

function useBoxWidth(ref: React.RefObject<HTMLDivElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return width;
}

function maskNewSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2) || 'key'}••••`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export const AdminMultiAccountProviderHub: React.FC = () => {
  const authUser = useAuthStore((s) => s.authUser);
  const actor = authUser?.email || 'admin';

  const {
    accounts,
    policies,
    auditLog,
    isProbingAll,
    probingAccountId,
    lastGlobalSweepAt,
    setPrimaryAccount,
    triggerPoolFailover,
    autoRebalanceAllPools,
    toggleAccountPause,
    rotateAccountKey,
    updatePoolPolicy,
    addAccount,
    updateAccount,
    deleteAccount,
    probeAccount,
    probeAllAccounts,
  } = useProviderAccountsStore();

  const [activeTab, setActiveTab] = useState<HubSubTab>('pools');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ProviderCategory>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | 'at-risk' | 'active' | 'standby'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [banner, setBanner] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  // Add / Edit Account Modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ProviderAccountRecord | null>(null);
  const [formProviderId, setFormProviderId] = useState<ProviderPoolId>('gemini');
  const [formAlias, setFormAlias] = useState('');
  const [formOwnerEmail, setFormOwnerEmail] = useState('');
  const [formEnv, setFormEnv] = useState<'prod' | 'staging' | 'backup'>('prod');
  const [formPlan, setFormPlan] = useState<'free' | 'paid' | 'credits'>('free');
  const [formQuotaMetric, setFormQuotaMetric] = useState('Tokens / mo');
  const [formQuotaUsed, setFormQuotaUsed] = useState('0');
  const [formQuotaLimit, setFormQuotaLimit] = useState('10000000');
  const [formDailyBurn, setFormDailyBurn] = useState('250000');
  const [formSpend, setFormSpend] = useState('0');
  const [formBudget, setFormBudget] = useState('0');
  const [formResetDay, setFormResetDay] = useState('1');
  const [formRegion, setFormRegion] = useState('global-edge');
  const [formKeyMask, setFormKeyMask] = useState('');
  const [formInfisicalPath, setFormInfisicalPath] = useState('');
  const [formLinkedServices, setFormLinkedServices] = useState('Chat Gateway');
  const [formConsoleUrl, setFormConsoleUrl] = useState('https://aistudio.google.com/apikey');

  // Rotate Key Modal
  const [rotatingAccount, setRotatingAccount] = useState<ProviderAccountRecord | null>(null);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newVaultPathInput, setNewVaultPathInput] = useState('');

  // D3 Heatmap Hover
  const [hoveredHeatCell, setHoveredHeatCell] = useState<{
    accountAlias: string;
    providerLabel: string;
    bucketLabel: string;
    errorCount: number;
    http429: number;
    http402: number;
  } | null>(null);

  const showToastBanner = (tone: 'success' | 'warning', text: string) => {
    setBanner({ tone, text });
    window.setTimeout(() => {
      setBanner((curr) => (curr?.text === text ? null : curr));
    }, 4500);
  };

  // Enriched accounts with runway & reset countdown
  const enrichedAccounts = useMemo(() => {
    return accounts.map((acc) => ({
      acc,
      runway: calculateAccountRunway(acc),
      daysUntilReset: getDaysUntilReset(acc.resetDayOfMonth),
      totalErrors24h:
        acc.errors24h.http429 +
        acc.errors24h.http402 +
        acc.errors24h.http401 +
        acc.errors24h.http5xx,
    }));
  }, [accounts]);

  // Global KPI stats
  const summaryStats = useMemo(() => {
    const uniquePools = new Set(accounts.map((a) => a.providerId)).size;
    const atRisk = enrichedAccounts.filter((item) => item.runway.severity !== 'nominal');
    const critical = enrichedAccounts.filter((item) => item.runway.severity === 'critical');
    const total429 = accounts.reduce((sum, a) => sum + a.errors24h.http429, 0);
    const total402 = accounts.reduce((sum, a) => sum + a.errors24h.http402, 0);
    const totalSpend = accounts.reduce((sum, a) => sum + (a.monthlySpendUsd || 0), 0);
    const totalBudget = accounts.reduce((sum, a) => sum + (a.monthlyBudgetUsd || 0), 0);

    const shortestRunway = [...enrichedAccounts]
      .filter((item) => item.acc.status !== 'paused')
      .sort((a, b) => {
        const da = a.runway.daysLeft ?? 9999;
        const db = b.runway.daysLeft ?? 9999;
        if (da !== db) return da - db;
        return b.runway.usagePct - a.runway.usagePct;
      })[0];

    const autoFailoverPools = Object.values(policies).filter((p) => p.autoFailoverEnabled).length;

    return {
      totalAccounts: accounts.length,
      uniquePools,
      atRiskCount: atRisk.length,
      criticalCount: critical.length,
      total429,
      total402,
      totalSpend,
      totalBudget,
      shortestRunway,
      autoFailoverPools,
    };
  }, [accounts, enrichedAccounts, policies]);

  // Filtered accounts grouped by provider pool
  const groupedPools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = enrichedAccounts.filter(({ acc, runway }) => {
      if (categoryFilter !== 'all' && acc.category !== categoryFilter) return false;
      if (healthFilter === 'at-risk' && runway.severity === 'nominal') return false;
      if (healthFilter === 'active' && acc.status !== 'active') return false;
      if (healthFilter === 'standby' && acc.status !== 'standby') return false;
      if (
        q &&
        !acc.accountAlias.toLowerCase().includes(q) &&
        !acc.providerLabel.toLowerCase().includes(q) &&
        !acc.ownerEmail.toLowerCase().includes(q) &&
        !acc.linkedServices.some((s) => s.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });

    const map = new Map<
      ProviderPoolId,
      {
        providerId: ProviderPoolId;
        providerLabel: string;
        category: ProviderCategory;
        items: typeof filtered;
      }
    >();

    for (const item of filtered) {
      const existing = map.get(item.acc.providerId);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(item.acc.providerId, {
          providerId: item.acc.providerId,
          providerLabel: item.acc.providerLabel,
          category: item.acc.category,
          items: [item],
        });
      }
    }

    return Array.from(map.values())
      .map((pool) => ({
        ...pool,
        items: [...pool.items].sort((a, b) => a.acc.priority - b.acc.priority),
      }))
      .sort((a, b) => {
        const aRisk = a.items.some((i) => i.runway.severity === 'critical')
          ? 0
          : a.items.some((i) => i.runway.severity === 'warning')
            ? 1
            : 2;
        const bRisk = b.items.some((i) => i.runway.severity === 'critical')
          ? 0
          : b.items.some((i) => i.runway.severity === 'warning')
            ? 1
            : 2;
        if (aRisk !== bRisk) return aRisk - bRisk;
        return a.providerLabel.localeCompare(b.providerLabel);
      });
  }, [enrichedAccounts, categoryFilter, healthFilter, searchQuery]);

  // Reset Calendar groups
  const resetCalendarGroups = useMemo(() => {
    const sorted = [...enrichedAccounts].sort((a, b) => a.daysUntilReset - b.daysUntilReset);
    return {
      soon: sorted.filter((i) => i.daysUntilReset <= 3),
      mid: sorted.filter((i) => i.daysUntilReset > 3 && i.daysUntilReset <= 10),
      later: sorted.filter((i) => i.daysUntilReset > 10),
    };
  }, [enrichedAccounts]);

  // ─── D3 Runway Chart Ref & Renderer ───
  const runwayChartContainerRef = useRef<HTMLDivElement | null>(null);
  const runwaySvgRef = useRef<SVGSVGElement | null>(null);
  const runwayChartWidth = useBoxWidth(runwayChartContainerRef, 640);

  useEffect(() => {
    if (activeTab !== 'runway') return;
    const svgEl = runwaySvgRef.current;
    if (!svgEl || runwayChartWidth <= 0) return;

    const rows = [...enrichedAccounts].sort((a, b) => b.runway.usagePct - a.runway.usagePct);
    const rowH = 34;
    const margin = { top: 24, right: 92, bottom: 16, left: 168 };
    const width = runwayChartWidth;
    const height = Math.max(180, rows.length * rowH + margin.top + margin.bottom);
    const innerW = Math.max(120, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x = d3.scaleLinear().domain([0, 100]).range([0, innerW]);

    // 70% Warning & 90% Critical dashed threshold guides
    [
      { pct: 70, color: '#d97706', label: '70% Warn' },
      { pct: 90, color: '#e11d48', label: '90% Crit' },
    ].forEach((guide) => {
      g.append('line')
        .attr('x1', x(guide.pct))
        .attr('x2', x(guide.pct))
        .attr('y1', -6)
        .attr('y2', innerH)
        .attr('stroke', guide.color)
        .attr('stroke-opacity', 0.55)
        .attr('stroke-dasharray', '4 3');

      g.append('text')
        .attr('x', x(guide.pct))
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', guide.color)
        .attr('font-size', 9.5)
        .attr('font-weight', 700)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(guide.label);
    });

    rows.forEach((item, idx) => {
      const yPos = idx * rowH;
      const barColor =
        item.runway.severity === 'critical'
          ? '#e11d48'
          : item.runway.severity === 'warning'
            ? '#d97706'
            : '#16a34a';

      const name =
        item.acc.accountAlias.length > 22
          ? `${item.acc.accountAlias.slice(0, 21)}…`
          : item.acc.accountAlias;

      g.append('text')
        .attr('x', -10)
        .attr('y', yPos + 15)
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .attr('font-size', 11)
        .attr('font-weight', item.runway.severity !== 'nominal' ? 700 : 500)
        .text(name);

      g.append('rect')
        .attr('x', 0)
        .attr('y', yPos + 5)
        .attr('width', innerW)
        .attr('height', 12)
        .attr('rx', 6)
        .attr('fill', 'currentColor')
        .attr('fill-opacity', 0.08);

      const rect = g
        .append('rect')
        .attr('x', 0)
        .attr('y', yPos + 5)
        .attr('height', 12)
        .attr('rx', 6)
        .attr('fill', barColor);

      const targetWidth = Math.max(4, x(item.runway.usagePct));
      if (typeof (rect as any).transition === 'function') {
        (rect as any).attr('width', 0).transition().duration(360).attr('width', targetWidth);
      } else {
        rect.attr('width', targetWidth);
      }

      g.append('text')
        .attr('x', innerW + 8)
        .attr('y', yPos + 15)
        .attr('fill', item.runway.severity !== 'nominal' ? barColor : 'currentColor')
        .attr('font-size', 10.5)
        .attr('font-weight', 700)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${item.runway.usagePct}% · ${item.runway.label}`);
    });
  }, [activeTab, enrichedAccounts, runwayChartWidth]);

  // ─── D3 Error & Rate-Limit Heatmap Ref & Renderer ───
  const heatmapContainerRef = useRef<HTMLDivElement | null>(null);
  const heatmapSvgRef = useRef<SVGSVGElement | null>(null);
  const heatmapWidth = useBoxWidth(heatmapContainerRef, 680);

  useEffect(() => {
    if (activeTab !== 'heatmap') return;
    const svgEl = heatmapSvgRef.current;
    if (!svgEl || heatmapWidth <= 0) return;

    const rows = [...enrichedAccounts].sort((a, b) => b.totalErrors24h - a.totalErrors24h);
    const cols = 12;
    const bucketLabels = Array.from({ length: cols }, (_, i) => `-${(cols - i) * 2}h`);
    const rowH = 30;
    const margin = { top: 28, right: 64, bottom: 14, left: 170 };
    const width = heatmapWidth;
    const height = Math.max(180, rows.length * rowH + margin.top + margin.bottom);
    const innerW = Math.max(160, width - margin.left - margin.right);
    const cellW = Math.max(12, innerW / cols - 4);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Column headers
    bucketLabels.forEach((lbl, cIdx) => {
      g.append('text')
        .attr('x', cIdx * (cellW + 4) + cellW / 2)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .attr('opacity', 0.55)
        .attr('font-size', 9.5)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(lbl);
    });

    const colorForErrors = (count: number) => {
      if (count <= 0) return '#10b981';
      if (count === 1) return '#f59e0b';
      if (count <= 2) return '#f97316';
      return '#e11d48';
    };

    rows.forEach((item, rIdx) => {
      const yPos = rIdx * rowH;
      const shortName =
        item.acc.accountAlias.length > 22
          ? `${item.acc.accountAlias.slice(0, 21)}…`
          : item.acc.accountAlias;

      g.append('text')
        .attr('x', -10)
        .attr('y', yPos + 15)
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .attr('font-size', 11)
        .attr('font-weight', item.totalErrors24h > 0 ? 700 : 400)
        .text(shortName);

      const buckets = item.acc.hourlyErrorBuckets || Array(12).fill(0);
      buckets.slice(0, cols).forEach((val, cIdx) => {
        g.append('rect')
          .attr('x', cIdx * (cellW + 4))
          .attr('y', yPos + 2)
          .attr('width', cellW)
          .attr('height', rowH - 8)
          .attr('rx', 4)
          .attr('fill', colorForErrors(val))
          .attr('fill-opacity', val === 0 ? 0.14 : Math.min(0.95, 0.45 + val * 0.16))
          .style('cursor', 'pointer')
          .on('mouseenter', () =>
            setHoveredHeatCell({
              accountAlias: item.acc.accountAlias,
              providerLabel: item.acc.providerLabel,
              bucketLabel: bucketLabels[cIdx],
              errorCount: val,
              http429: item.acc.errors24h.http429,
              http402: item.acc.errors24h.http402,
            })
          )
          .on('mouseleave', () => setHoveredHeatCell(null));
      });

      g.append('text')
        .attr('x', cols * (cellW + 4) + 6)
        .attr('y', yPos + 15)
        .attr('fill', item.totalErrors24h > 0 ? '#e11d48' : 'currentColor')
        .attr('opacity', item.totalErrors24h > 0 ? 0.95 : 0.45)
        .attr('font-size', 10.5)
        .attr('font-weight', 700)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${item.totalErrors24h} err`);
    });
  }, [activeTab, enrichedAccounts, heatmapWidth]);

  // Modal helpers
  const openCreateModal = (presetProviderId?: ProviderPoolId) => {
    const pid = presetProviderId || 'gemini';
    const meta = PROVIDER_OPTIONS.find((p) => p.id === pid) || PROVIDER_OPTIONS[0];
    setEditingAccount(null);
    setFormProviderId(pid);
    setFormAlias('');
    setFormOwnerEmail('');
    setFormEnv('prod');
    setFormPlan('free');
    setFormQuotaMetric(meta.defaultMetric);
    setFormQuotaUsed('0');
    setFormQuotaLimit('1000000');
    setFormDailyBurn('50000');
    setFormSpend('0');
    setFormBudget('0');
    setFormResetDay('1');
    setFormRegion('global-edge');
    setFormKeyMask('');
    setFormInfisicalPath(`/${meta.category}/${String(pid || '').toUpperCase()}_ACC_NEW`);
    setFormLinkedServices('Chat Gateway');
    setFormConsoleUrl(meta.defaultConsole);
    setIsAccountModalOpen(true);
  };

  const openEditModal = (acc: ProviderAccountRecord) => {
    setEditingAccount(acc);
    setFormProviderId(acc.providerId);
    setFormAlias(acc.accountAlias);
    setFormOwnerEmail(acc.ownerEmail);
    setFormEnv(acc.environment);
    setFormPlan(acc.planTier);
    setFormQuotaMetric(acc.quotaMetricLabel);
    setFormQuotaUsed(String(acc.quotaUsed));
    setFormQuotaLimit(String(acc.quotaLimit));
    setFormDailyBurn(String(acc.dailyBurnRate));
    setFormSpend(String(acc.monthlySpendUsd));
    setFormBudget(String(acc.monthlyBudgetUsd));
    setFormResetDay(String(acc.resetDayOfMonth));
    setFormRegion(acc.region);
    setFormKeyMask(acc.keyMask);
    setFormInfisicalPath(acc.infisicalPath);
    setFormLinkedServices(acc.linkedServices.join(', '));
    setFormConsoleUrl(acc.consoleUrl);
    setIsAccountModalOpen(true);
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const meta = PROVIDER_OPTIONS.find((p) => p.id === formProviderId) || PROVIDER_OPTIONS[0];
    const alias = formAlias.trim() || `${meta.label} Account`;
    const linked = formLinkedServices
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const quotaUsed = Math.max(0, Number(formQuotaUsed) || 0);
    const quotaLimit = Math.max(1, Number(formQuotaLimit) || 1);

    if (editingAccount) {
      updateAccount(
        editingAccount.id,
        {
          providerId: formProviderId,
          providerLabel: meta.label,
          category: meta.category,
          accountAlias: alias,
          ownerEmail: formOwnerEmail.trim() || 'ops@supremeai.dev',
          environment: formEnv,
          planTier: formPlan,
          quotaMetricLabel: formQuotaMetric.trim() || meta.defaultMetric,
          quotaUsed,
          quotaLimit,
          dailyBurnRate: Math.max(0, Number(formDailyBurn) || 0),
          monthlySpendUsd: Math.max(0, Number(formSpend) || 0),
          monthlyBudgetUsd: Math.max(0, Number(formBudget) || 0),
          resetDayOfMonth: Math.min(28, Math.max(1, Number(formResetDay) || 1)),
          region: formRegion.trim() || 'global-edge',
          keyMask: formKeyMask.trim() || editingAccount.keyMask,
          infisicalPath: formInfisicalPath.trim() || editingAccount.infisicalPath,
          linkedServices: linked.length > 0 ? linked : ['Core Platform'],
          consoleUrl: formConsoleUrl.trim() || meta.defaultConsole,
        },
        actor
      );
      showToastBanner('success', `Updated ${alias} configuration and guardrails.`);
    } else {
      const samePoolCount = accounts.filter((a) => a.providerId === formProviderId).length;
      addAccount(
        {
          providerId: formProviderId,
          providerLabel: meta.label,
          category: meta.category,
          accountAlias: alias,
          ownerEmail: formOwnerEmail.trim() || 'ops@supremeai.dev',
          environment: formEnv,
          planTier: formPlan,
          status: samePoolCount === 0 ? 'active' : 'standby',
          priority: samePoolCount + 1,
          trafficWeight: samePoolCount === 0 ? 100 : 0,
          quotaMetricLabel: formQuotaMetric.trim() || meta.defaultMetric,
          quotaUsed,
          quotaLimit,
          dailyBurnRate: Math.max(0, Number(formDailyBurn) || 0),
          monthlySpendUsd: Math.max(0, Number(formSpend) || 0),
          monthlyBudgetUsd: Math.max(0, Number(formBudget) || 0),
          resetDayOfMonth: Math.min(28, Math.max(1, Number(formResetDay) || 1)),
          region: formRegion.trim() || 'global-edge',
          keyMask: formKeyMask.trim() ? maskNewSecret(formKeyMask) : 'key_••••new1',
          infisicalPath:
            formInfisicalPath.trim() || `/${meta.category}/${String(formProviderId || '').toUpperCase()}`,
          latencyMs: 140,
          linkedServices: linked.length > 0 ? linked : ['Core Platform'],
          consoleUrl: formConsoleUrl.trim() || meta.defaultConsole,
        },
        actor
      );
      showToastBanner('success', `Added ${alias} to ${meta.label} pool.`);
    }

    setIsAccountModalOpen(false);
  };

  const handleConfirmRotate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotatingAccount || !newKeyInput.trim()) return;
    rotateAccountKey(
      rotatingAccount.id,
      maskNewSecret(newKeyInput),
      newVaultPathInput.trim() || rotatingAccount.infisicalPath,
      actor
    );
    showToastBanner(
      'success',
      `Rotated key for ${rotatingAccount.accountAlias} and synced vault reference.`
    );
    setRotatingAccount(null);
    setNewKeyInput('');
    setNewVaultPathInput('');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fb] dark:bg-slate-950 px-6 py-7 text-slate-800 dark:text-slate-200">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Deep-Navy Executive Header */}
        <section className="relative overflow-hidden rounded-2xl border border-[#233758] bg-gradient-to-br from-[#162238] via-[#1b2942] to-[#22375d] px-7 py-6 text-white">
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 max-w-2xl">
              <div className="text-[11px] font-mono font-semibold tracking-wider text-[#b5c7e6] uppercase">
                Zero-Login Multi-Account Control Plane
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f8faff]">
                Unified Multi-Account Provider Hub
              </h1>
              <p className="text-[13px] text-[#c2cfe5] leading-relaxed">
                Manage multiple accounts per provider in one view — monitor free-tier &amp; paid quota
                runways, 429/402 rate-limit heatmaps, reset dates, key rotations, and instant
                auto-failover without switching dashboards.
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs font-mono text-[#a7b8d4] tabular-nums">
                <span>
                  Pools: <strong className="text-white">{summaryStats.uniquePools}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Accounts: <strong className="text-white">{summaryStats.totalAccounts}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Last Sweep: <strong className="text-white">{lastGlobalSweepAt}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Auto-Failover:{' '}
                  <strong className="text-emerald-300">
                    {summaryStats.autoFailoverPools} pools armed
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void probeAllAccounts(actor)}
                disabled={isProbingAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/20 bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white cursor-pointer transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProbingAll ? 'animate-spin' : ''}`} />
                <span>{isProbingAll ? 'Sweeping...' : 'Probe All Accounts'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const count = autoRebalanceAllPools(actor);
                  showToastBanner(
                    count > 0 ? 'success' : 'warning',
                    count > 0
                      ? `Auto-rebalanced ${count} pressured provider pool${count > 1 ? 's' : ''} onto healthy standby accounts.`
                      : 'All auto-failover pools are already routed to their optimal accounts.'
                  );
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0c1a14] text-xs font-bold cursor-pointer transition-colors"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Auto-Rebalance Pools</span>
              </button>

              <button
                type="button"
                onClick={() => openCreateModal()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-[#162544] hover:bg-[#eef3ff] text-xs font-semibold cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Account</span>
              </button>
            </div>
          </div>
        </section>

        {banner && (
          <div
            role="status"
            className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
              banner.tone === 'success'
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
            }`}
          >
            <span>{banner.text}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Executive KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Accounts at Risk</span>
              <AlertTriangle
                className={`w-4 h-4 ${
                  summaryStats.criticalCount > 0
                    ? 'text-rose-500'
                    : summaryStats.atRiskCount > 0
                      ? 'text-amber-500'
                      : 'text-emerald-500'
                }`}
              />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.atRiskCount}{' '}
              <span className="text-xs font-normal text-slate-400">
                / {summaryStats.totalAccounts}
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                {summaryStats.criticalCount} critical
              </span>{' '}
              · {summaryStats.atRiskCount - summaryStats.criticalCount} warning
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Shortest Runway</span>
              <CalendarClock className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.shortestRunway?.runway.label || 'Nominal'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
              {summaryStats.shortestRunway
                ? `${summaryStats.shortestRunway.acc.accountAlias} (${summaryStats.shortestRunway.runway.usagePct}%)`
                : 'All accounts healthy'}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>24h Rate-Limit / Quota Hits</span>
              <Flame className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.total429 + summaryStats.total402}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {summaryStats.total429} HTTP 429 · {summaryStats.total402} HTTP 402
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Cross-Account Spend</span>
              <Sparkles className="w-4 h-4 text-[#4a70e8]" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              ${summaryStats.totalSpend.toFixed(0)}{' '}
              <span className="text-xs font-normal text-slate-400">
                / ${summaryStats.totalBudget.toFixed(0)} cap
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {accounts.filter((a) => a.planTier === 'free').length} free-tier accounts pooled
            </div>
          </div>
        </div>

        {/* Sub-Tab Navigation & Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit">
            {(
              [
                { id: 'pools', label: 'Pool Matrix & Failover' },
                { id: 'runway', label: 'Runway & Reset Calendar' },
                { id: 'heatmap', label: '429 / 402 Error Heatmap' },
                { id: 'audit', label: `Audit Trail (${auditLog.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-[#162238] dark:bg-white text-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'pools' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search account, email, service..."
                  className="pl-8 pr-3 py-1.5 w-60 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-[#4a70e8]"
                />
              </div>

              <div className="inline-flex items-center gap-1 text-xs">
                {(['all', 'at-risk', 'active', 'standby'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setHealthFilter(st)}
                    className={`px-2.5 py-1.5 rounded-lg capitalize font-medium cursor-pointer transition-colors ${
                      healthFilter === st
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {st === 'at-risk' ? 'At Risk' : st}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center gap-1 text-xs">
                <Layers className="w-3.5 h-3.5 text-slate-400 mr-0.5" />
                {(['all', 'ai', 'compute', 'data', 'edge'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2 py-1 rounded text-[11px] font-mono uppercase cursor-pointer transition-colors ${
                      categoryFilter === cat
                        ? 'bg-[#4a70e8]/15 text-[#4a70e8] dark:text-[#8aa4ff] font-bold'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── TAB 1: MULTI-ACCOUNT PROVIDER POOL MATRIX ─── */}
        {activeTab === 'pools' && (
          <div className="space-y-4">
            {groupedPools.length === 0 ? (
              <div className="p-10 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-xs text-slate-500">
                No provider accounts match the selected filter.
              </div>
            ) : (
              groupedPools.map((pool) => {
                const policy = policies[pool.providerId];
                const primaryItem = pool.items[0];
                const hasRisk = pool.items.some((i) => i.runway.severity !== 'nominal');
                const canFailover = pool.items.length >= 2;

                return (
                  <section
                    key={pool.providerId}
                    className={`rounded-xl bg-white dark:bg-slate-900 border overflow-hidden ${
                      pool.items.some((i) => i.runway.severity === 'critical')
                        ? 'border-rose-300/90 dark:border-rose-800/80'
                        : hasRisk
                          ? 'border-amber-300/90 dark:border-amber-800/80'
                          : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {/* Pool Header + Failover Controls */}
                    <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {pool.providerLabel}
                        </span>
                        <span className="text-[11px] font-mono uppercase text-slate-400">
                          {pool.category} · {pool.items.length} accounts
                        </span>
                        {primaryItem && (
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
                            Active Primary:{' '}
                            <strong className="text-slate-900 dark:text-white">
                              {primaryItem.acc.accountAlias}
                            </strong>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {/* Routing Strategy */}
                        <select
                          aria-label={`${pool.providerLabel} routing strategy`}
                          value={policy?.routingStrategy || 'priority-failover'}
                          onChange={(e) =>
                            updatePoolPolicy(
                              pool.providerId,
                              { routingStrategy: e.target.value as PoolRoutingStrategy },
                              actor
                            )
                          }
                          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <option value="priority-failover">Priority Failover</option>
                          <option value="weighted-balance">Weighted Balance</option>
                          <option value="tier-split">Tier Split (Free / Paid)</option>
                        </select>

                        {/* Auto-Failover Toggle */}
                        <button
                          type="button"
                          onClick={() =>
                            updatePoolPolicy(
                              pool.providerId,
                              { autoFailoverEnabled: !policy?.autoFailoverEnabled },
                              actor
                            )
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-colors ${
                            policy?.autoFailoverEnabled
                              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>
                            Auto-Failover{' '}
                            {policy?.autoFailoverEnabled
                              ? `@ ${policy.switchThresholdPct}%`
                              : 'OFF'}
                          </span>
                        </button>

                        {/* 1-Click Failover */}
                        {canFailover && (
                          <button
                            type="button"
                            onClick={() => {
                              const res = triggerPoolFailover(pool.providerId, actor);
                              showToastBanner(res.switched ? 'success' : 'warning', res.message);
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                              hasRisk
                                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90'
                            }`}
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            <span>Failover Now</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openCreateModal(pool.providerId)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </button>
                      </div>
                    </div>

                    {/* Account Rows inside Pool */}
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {pool.items.map(({ acc, runway, daysUntilReset }) => {
                        const isProbing = probingAccountId === acc.id;
                        const isPrimary = acc.priority === 1;
                        return (
                          <div
                            key={acc.id}
                            className="px-5 py-3.5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            {/* Identity & Owner (4 cols) */}
                            <div className="lg:col-span-4 min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`font-mono text-[11px] font-bold ${
                                    isPrimary
                                      ? 'text-[#4a70e8] dark:text-[#8aa4ff]'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  #{acc.priority}
                                </span>
                                <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                  {acc.accountAlias}
                                </span>
                                <span
                                  className={`text-[10.5px] font-mono font-bold uppercase ${
                                    acc.status === 'active'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : acc.status === 'standby'
                                        ? 'text-slate-500 dark:text-slate-400'
                                        : acc.status === 'paused'
                                          ? 'text-slate-400'
                                          : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {acc.status}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                <span className="truncate">{acc.ownerEmail}</span>
                                <span aria-hidden="true">·</span>
                                <span className="uppercase">{acc.planTier}</span>
                                <span aria-hidden="true">·</span>
                                <span className="uppercase">{acc.environment}</span>
                                <span aria-hidden="true">·</span>
                                <span>{acc.keyMask}</span>
                              </div>

                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                Services:{' '}
                                <span className="text-slate-700 dark:text-slate-300 font-medium">
                                  {acc.linkedServices.join(', ')}
                                </span>
                              </div>
                            </div>

                            {/* Quota & Burn Runway (3 cols) */}
                            <div className="lg:col-span-3 space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                                <span className="text-slate-600 dark:text-slate-300">
                                  {formatCompactQuota(acc.quotaUsed)} /{' '}
                                  {formatCompactQuota(acc.quotaLimit)} {acc.quotaMetricLabel}
                                </span>
                                <span
                                  className={`font-bold ${
                                    runway.severity === 'critical'
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : runway.severity === 'warning'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-emerald-600 dark:text-emerald-400'
                                  }`}
                                >
                                  {runway.usagePct}%
                                </span>
                              </div>

                              <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{
                                    width: `${Math.max(3, runway.usagePct)}%`,
                                    backgroundColor:
                                      runway.severity === 'critical'
                                        ? '#e11d48'
                                        : runway.severity === 'warning'
                                          ? '#d97706'
                                          : '#16a34a',
                                  }}
                                />
                              </div>

                              <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                <span
                                  className={runway.severity !== 'nominal' ? 'font-semibold' : ''}
                                >
                                  Runway: {runway.label}
                                </span>
                                <span>Resets in {daysUntilReset}d</span>
                              </div>
                            </div>

                            {/* Health, 429/402 & Latency (2 cols) */}
                            <div className="lg:col-span-2 text-[11px] font-mono tabular-nums space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Latency</span>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {acc.latencyMs}ms
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">429 / 402</span>
                                <span
                                  className={
                                    acc.errors24h.http429 + acc.errors24h.http402 > 0
                                      ? 'text-rose-600 dark:text-rose-400 font-bold'
                                      : 'text-emerald-600 dark:text-emerald-400'
                                  }
                                >
                                  {acc.errors24h.http429} / {acc.errors24h.http402}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">Verified</span>
                                <span className="text-slate-500 dark:text-slate-400">
                                  {acc.lastVerifiedAt}
                                </span>
                              </div>
                            </div>

                            {/* 1-Click Actions (3 cols) */}
                            <div className="lg:col-span-3 flex flex-wrap items-center justify-start lg:justify-end gap-1.5">
                              {!isPrimary && acc.status !== 'paused' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPrimaryAccount(acc.id, actor);
                                    showToastBanner(
                                      'success',
                                      `Promoted ${acc.accountAlias} to Primary.`
                                    );
                                  }}
                                  className="px-2.5 py-1 rounded-md bg-[#4a70e8]/12 hover:bg-[#4a70e8]/20 text-[#4a70e8] dark:text-[#8aa4ff] text-[11px] font-semibold cursor-pointer"
                                >
                                  Make Primary
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => void probeAccount(acc.id, actor)}
                                disabled={isProbing}
                                title="Verify account key & latency"
                                className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                              >
                                {isProbing ? '...' : 'Test'}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setRotatingAccount(acc);
                                  setNewKeyInput('');
                                  setNewVaultPathInput(acc.infisicalPath);
                                }}
                                title="Rotate API key / token"
                                className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleAccountPause(acc.id, actor)}
                                title={acc.status === 'paused' ? 'Resume account' : 'Pause account'}
                                className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                {acc.status === 'paused' ? (
                                  <Play className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Pause className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => openEditModal(acc)}
                                title="Edit account settings"
                                className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              <a
                                href={acc.consoleUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Open ${acc.providerLabel} Console`}
                                className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>

                              <button
                                type="button"
                                onClick={() => {
                                  deleteAccount(acc.id, actor);
                                  showToastBanner('warning', `Removed ${acc.accountAlias}.`);
                                }}
                                title="Remove account"
                                className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-rose-300 hover:text-rose-600 text-slate-400 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        )}

        {/* ─── TAB 2: UNIFIED RUNWAY & QUOTA RESET CALENDAR ─── */}
        {activeTab === 'runway' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <div
              ref={runwayChartContainerRef}
              className="xl:col-span-7 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  All Accounts — Quota Burn & Days-to-Exhaustion Ranking (D3)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Sorted by utilization urgency. Dashed vertical thresholds mark 70% warning and 90%
                  auto-failover triggers.
                </p>
              </div>
              <svg
                ref={runwaySvgRef}
                className="w-full block text-slate-700 dark:text-slate-300"
                role="img"
                aria-label="D3 horizontal quota utilization and runway chart across all provider accounts"
              />
            </div>

            <div className="xl:col-span-5 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-[#4a70e8]" />
                  <span>Quota & Free-Tier Reset Calendar</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Know exactly when each account replenishes without logging into provider billing
                  portals.
                </p>
              </div>

              {(
                [
                  {
                    title: 'Resetting in ≤ 3 Days',
                    items: resetCalendarGroups.soon,
                    tone: 'text-emerald-600 dark:text-emerald-400',
                  },
                  {
                    title: 'Resetting in 4–10 Days',
                    items: resetCalendarGroups.mid,
                    tone: 'text-[#4a70e8] dark:text-[#8aa4ff]',
                  },
                  {
                    title: 'Resetting Later This Cycle',
                    items: resetCalendarGroups.later,
                    tone: 'text-slate-500 dark:text-slate-400',
                  },
                ] as const
              ).map((group) => (
                <div key={group.title} className="space-y-2">
                  <div className={`text-xs font-mono font-bold uppercase ${group.tone}`}>
                    {group.title} ({group.items.length})
                  </div>
                  {group.items.length === 0 ? (
                    <div className="text-xs text-slate-400">No accounts in this window.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {group.items.map(({ acc, runway, daysUntilReset }) => (
                        <div
                          key={acc.id}
                          className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-white truncate">
                              {acc.accountAlias}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 truncate">
                              {acc.providerLabel} · Day {acc.resetDayOfMonth} · {acc.ownerEmail}
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="font-bold text-slate-900 dark:text-white">
                              in {daysUntilReset}d
                            </div>
                            <div
                              className={`text-[10.5px] ${
                                runway.severity === 'critical'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : runway.severity === 'warning'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-slate-400'
                              }`}
                            >
                              {runway.usagePct}% used
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── TAB 3: LIVE 429 / 402 ERROR HEATMAP ─── */}
        {activeTab === 'heatmap' && (
          <div className="space-y-4">
            <div
              ref={heatmapContainerRef}
              className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Per-Account 429 Rate-Limit & 402 Billing Error Heatmap (24h D3 Matrix)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Pinpoint which specific sub-account is hitting rate limits or credit walls.
                  </p>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {hoveredHeatCell
                    ? `${hoveredHeatCell.accountAlias} (${hoveredHeatCell.bucketLabel}): ${hoveredHeatCell.errorCount} err · 24h 429=${hoveredHeatCell.http429}, 402=${hoveredHeatCell.http402}`
                    : 'Hover any cell to inspect error burst'}
                </div>
              </div>

              <svg
                ref={heatmapSvgRef}
                className="w-full block text-slate-700 dark:text-slate-300"
                role="img"
                aria-label="D3 per-account 429 and 402 error heatmap"
              />
            </div>

            {/* Actionable Hot Accounts Strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {enrichedAccounts
                .filter((i) => i.totalErrors24h > 0)
                .sort((a, b) => b.totalErrors24h - a.totalErrors24h)
                .map(({ acc, runway }) => (
                  <div
                    key={acc.id}
                    className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/70 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {acc.accountAlias}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-rose-600 dark:text-rose-400">
                        {acc.errors24h.http429}×429 · {acc.errors24h.http402}×402
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {acc.providerLabel} · {acc.ownerEmail} · {runway.usagePct}% quota
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const res = triggerPoolFailover(acc.providerId, actor);
                          showToastBanner(res.switched ? 'success' : 'warning', res.message);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>Failover Pool</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRotatingAccount(acc);
                          setNewKeyInput('');
                          setNewVaultPathInput(acc.infisicalPath);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Rotate Key
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ─── TAB 4: AUDIT TRAIL ─── */}
        {activeTab === 'audit' && (
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            {auditLog.map((entry) => (
              <div
                key={entry.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#4a70e8] shrink-0" />
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {entry.accountAlias}
                    </span>
                    <span className="font-mono uppercase text-[10.5px] text-slate-400">
                      {entry.action}
                    </span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">{entry.summary}</div>
                </div>
                <div className="font-mono text-[11px] text-slate-400 shrink-0">
                  {entry.actor} · {entry.timestamp}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Add / Edit Provider Account Modal ─── */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAccount}
            className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingAccount
                  ? `Edit ${editingAccount.accountAlias}`
                  : 'Add Provider Account to Pool'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Provider</span>
                <select
                  value={formProviderId}
                  onChange={(e) => {
                    const pid = e.target.value as ProviderPoolId;
                    setFormProviderId(pid);
                    const meta = PROVIDER_OPTIONS.find((p) => p.id === pid);
                    if (meta && !editingAccount) {
                      setFormQuotaMetric(meta.defaultMetric);
                      setFormConsoleUrl(meta.defaultConsole);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Account Alias
                </span>
                <input
                  required
                  value={formAlias}
                  onChange={(e) => setFormAlias(e.target.value)}
                  placeholder="e.g. Gemini-Free-Pool-C"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Owner Email (Login Identifier)
                </span>
                <input
                  required
                  type="email"
                  value={formOwnerEmail}
                  onChange={(e) => setFormOwnerEmail(e.target.value)}
                  placeholder="account-owner@gmail.com"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Plan</span>
                  <select
                    value={formPlan}
                    onChange={(e) => setFormPlan(e.target.value as 'free' | 'paid' | 'credits')}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  >
                    <option value="free">Free Tier</option>
                    <option value="credits">Credits</option>
                    <option value="paid">Paid</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Env</span>
                  <select
                    value={formEnv}
                    onChange={(e) => setFormEnv(e.target.value as 'prod' | 'staging' | 'backup')}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  >
                    <option value="prod">Prod</option>
                    <option value="staging">Staging</option>
                    <option value="backup">Backup</option>
                  </select>
                </label>
              </div>

              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Quota Used / Limit ({formQuotaMetric})
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0"
                    value={formQuotaUsed}
                    onChange={(e) => setFormQuotaUsed(e.target.value)}
                    placeholder="Used"
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    min="1"
                    value={formQuotaLimit}
                    onChange={(e) => setFormQuotaLimit(e.target.value)}
                    placeholder="Limit"
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                  />
                </div>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    Daily Burn
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={formDailyBurn}
                    onChange={(e) => setFormDailyBurn(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    Reset Day (1-28)
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={formResetDay}
                    onChange={(e) => setFormResetDay(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Infisical Vault Path
                </span>
                <input
                  value={formInfisicalPath}
                  onChange={(e) => setFormInfisicalPath(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Key Reference (Stored Masked)
                </span>
                <input
                  value={formKeyMask}
                  onChange={(e) => setFormKeyMask(e.target.value)}
                  placeholder="AIza••••xxxx"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                />
              </label>

              <label className="sm:col-span-2 space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Linked Services (comma-separated)
                </span>
                <input
                  value={formLinkedServices}
                  onChange={(e) => setFormLinkedServices(e.target.value)}
                  placeholder="Chat Gateway, Deep Research, MCP Tower"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#162238] dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
              >
                {editingAccount ? 'Save Changes' : 'Add to Pool'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── One-Click Rotate Key Modal ─── */}
      {rotatingAccount && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmRotate}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#4a70e8]" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Rotate Credential — {rotatingAccount.accountAlias}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRotatingAccount(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400">
              Owner:{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {rotatingAccount.ownerEmail}
              </strong>{' '}
              · Current: <span className="font-mono">{rotatingAccount.keyMask}</span>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  New Credential / Reference Token
                </span>
                <input
                  required
                  type="password"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder="Paste rotated key (masked immediately)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Infisical Sync Path
                </span>
                <input
                  value={newVaultPathInput}
                  onChange={(e) => setNewVaultPathInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-slate-900 dark:text-white"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setRotatingAccount(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#4a70e8] hover:bg-[#3b5fd4] text-white text-xs font-semibold cursor-pointer"
              >
                Verify & Rotate
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
