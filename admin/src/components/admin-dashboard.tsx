"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

type PageId =
  | "overview"
  | "services"
  | "agents"
  | "bridge"
  | "integrations"
  | "web-audit"
  | "security"
  | "audit-log";

type ServiceItem = {
  id: string;
  displayName: string;
  provider: string;
  role: string;
  status: string;
  latencyMs: number | null;
  deployStatus: string | null;
  monthlyBuildMinutes: number | null;
  freeLimitRemainingMinutes: number | null;
  freeLimitExhausted: boolean | null;
};

type StudioData = {
  url: string;
  reachable: boolean;
  status: number | null;
  latencyMs: number | null;
  securityHeaders: {
    hsts: boolean;
    csp: boolean;
    cspUnsafeInline: boolean;
    cspUnsafeEval: boolean;
    frameOptions: boolean;
    contentTypeOptions: boolean;
  };
};

type Agent = {
  name: string;
  kind: string;
  state: string;
  ageSeconds: number | null;
  updatedAt: string | null;
};

type WorkOrder = {
  number: number | null;
  title: string;
  state: string;
  updatedAt: string | null;
  createdAt: string | null;
  labels: string[];
  comments: number;
  url: string | null;
};

type AuditEvent = {
  id: number;
  actor: string;
  action: string;
  target: string;
  outcome: string;
  summary: string;
  createdAt: string;
};

type TowerData = {
  status: string;
  server: string;
  version: string;
  services: { healthy: number | null; degraded: number | null; total: number | null };
  lastCompletedSweepAt: string | null;
  stale: boolean | null;
} | null;

type ProviderProbe = {
  name: string;
  status: string;
  lastStatus: string;
  latencyMs: number | null;
  checkedAt: string | null;
  ageSeconds: number | null;
  consecutiveFailures: number;
  impactedServices: string[];
  metrics: string[];
  warning: string | null;
  httpStatus: number | null;
};

type ProviderDiagnostics = {
  available: boolean;
  observedAt: string | null;
  durationMs: number | null;
  incidentCount: number;
  counts: Record<string, number>;
  total: number;
  providers: ProviderProbe[];
};

type OverviewData = {
  generatedAt: string;
  adminAccessConfigured: boolean;
  authenticated: boolean;
  mcpConnected: boolean;
  system: {
    available: boolean;
    summary: string;
    checkedAt: string | null;
    counts: Record<string, number>;
    total: number;
  };
  tower: TowerData;
  providerDiagnostics: ProviderDiagnostics;
  studio: StudioData;
  services: ServiceItem[];
  agentFleet: {
    available: boolean;
    total: number;
    autonomousBuilders: number;
    interactiveAssistants: number;
    onlineAutonomous: number;
    onlineInteractive: number;
    agents: Agent[];
  };
  bridge: { available: boolean; repo: string; totalOpen: number; count: number; windowTruncated: boolean; issues: WorkOrder[] };
  auditLog: AuditEvent[];
  auditStorageAvailable: boolean;
  sources: { towerHealth: boolean; studioHttp: boolean; mcpTools: boolean; providerDiagnostics: boolean };
};

type ProbeReport = {
  available?: boolean;
  ok?: boolean;
  degraded?: boolean;
  mode?: string | null;
  status?: number;
  latencyMs?: number;
  verdict?: string | null;
  summary?: string | null;
  reason?: string | null;
  hint?: string | null;
  securityHeaders?: {
    strictTransportSecurity?: boolean;
    contentSecurityPolicy?: boolean;
    xFrameOptions?: boolean;
    xContentTypeOptions?: boolean;
  };
};

type AuditReport = {
  target: string;
  checkedAt: string;
  http: ProbeReport;
  performance: ProbeReport;
  console: ProbeReport;
  network: ProbeReport;
};

type SessionInfo = { configured: boolean; authenticated: boolean };
type ChartPoint = { at: number; latencyMs: number | null; healthPct: number | null };
type Notice = { title: string; detail: string; tone: "success" | "warning" | "error" };

type IconName =
  | "grid"
  | "server"
  | "bot"
  | "clipboard"
  | "network"
  | "eye"
  | "shield"
  | "activity"
  | "spark"
  | "refresh"
  | "menu"
  | "clock"
  | "alert"
  | "external"
  | "check"
  | "lock"
  | "key"
  | "logout"
  | "search"
  | "close"
  | "chevron"
  | "arrow"
  | "database"
  | "globe"
  | "monitor"
  | "filter"
  | "plus"
  | "info"
  | "pulse"
  | "shieldCheck";

const ICON_PATHS: Record<IconName, string[]> = {
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  server: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01", "M12 7h4", "M12 17h4"],
  bot: ["M12 8V4H8", "M4 12a8 8 0 1 0 16 0", "M8 13h.01", "M16 13h.01", "M9 17h6", "M4 12H2", "M22 12h-2"],
  clipboard: ["M9 4h6", "M9 2h6v4H9z", "M7 4H5v18h14V4h-2", "M9 12h6", "M9 16h6"],
  network: ["M12 8V4", "M8 12H4", "M16 12h4", "M12 16v4", "M12 4a2 2 0 1 0 0 .01", "M4 12a2 2 0 1 0 0 .01", "M20 12a2 2 0 1 0 0 .01", "M12 20a2 2 0 1 0 0 .01", "M12 12a4 4 0 1 0 0 .01"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  shield: ["M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"],
  activity: ["M3 12h4l3-8 4 16 3-8h4"],
  spark: ["m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z", "m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"],
  refresh: ["M20 7v5h-5", "M4 17v-5h5", "M5.6 9a7 7 0 0 1 11.6-2L20 12", "M4 12l2.8 5a7 7 0 0 0 11.6-2"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  clock: ["M12 8v4l3 2", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z"],
  alert: ["m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
  external: ["M14 3h7v7", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  check: ["m5 12 4 4L19 6"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 1 1 8 0v4", "M12 15v2"],
  key: ["M21 2 19 4", "M7 14a5 5 0 1 1 3.5-1.5L21 23l-4-4-2 2-3-3", "M7 9h.01"],
  logout: ["M10 17l5-5-5-5", "M15 12H3", "M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  close: ["m18 6-12 12", "m6 6 12 12"],
  chevron: ["m9 18 6-6-6-6"],
  arrow: ["M7 17 17 7", "M7 7h10v10"],
  database: ["M4 5c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2z", "M4 5v7c0 1.1 3.6 2 8 2s8-.9 8-2V5", "M4 12v7c0 1.1 3.6 2 8 2s8-.9 8-2v-7"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"],
  monitor: ["M3 4h18v13H3z", "M8 21h8", "M12 17v4"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  plus: ["M12 5v14", "M5 12h14"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 11v5", "M12 7h.01"],
  pulse: ["M2 12h4l3-8 5 16 3-8h5"],
  shieldCheck: ["M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z", "m9 12 2 2 4-4"],
};

const PAGE_META: Record<PageId, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "CONTROL ROOM",
    title: "Overview",
    description: "A live view of the services, agents, and work moving through SupremeAI.",
  },
  services: {
    eyebrow: "PLATFORM OPERATIONS",
    title: "Service health",
    description: "Provider health, deploy state, and the latest latency samples from the control tower.",
  },
  agents: {
    eyebrow: "RUNTIME OPERATIONS",
    title: "Agent fleet",
    description: "Live MCP client heartbeats, derived from the tower’s online and stale windows.",
  },
  bridge: {
    eyebrow: "ENGINEERING OPERATIONS",
    title: "Bridge work queue",
    description: "Public work orders reported by the connected Bridge service, with owner-gated claiming.",
  },
  integrations: {
    eyebrow: "PLATFORM MAP",
    title: "Integrations",
    description: "Connected infrastructure providers and their observed health—not a secret or credential viewer.",
  },
  "web-audit": {
    eyebrow: "QUALITY & RELIABILITY",
    title: "Studio web audit",
    description: "HTTP security headers and browser diagnostics for the live SupremeAI Studio frontend.",
  },
  security: {
    eyebrow: "GOVERNANCE",
    title: "Security & access",
    description: "Owner-session posture, frontend transport headers, and the actions currently exposed by MCP.",
  },
  "audit-log": {
    eyebrow: "GOVERNANCE",
    title: "Admin audit trail",
    description: "Durable records of privileged actions dispatched by this dashboard.",
  },
};

const NAV_GROUPS: { label: string; items: { id: PageId; title: string; icon: IconName }[] }[] = [
  {
    label: "OPERATIONS",
    items: [
      { id: "overview", title: "Overview", icon: "grid" },
      { id: "services", title: "Service health", icon: "server" },
      { id: "agents", title: "Agent fleet", icon: "bot" },
      { id: "bridge", title: "Bridge queue", icon: "clipboard" },
    ],
  },
  {
    label: "PLATFORM",
    items: [
      { id: "integrations", title: "Integrations", icon: "network" },
      { id: "web-audit", title: "Web audit", icon: "eye" },
    ],
  },
  {
    label: "GOVERNANCE",
    items: [
      { id: "security", title: "Security & access", icon: "shield" },
      { id: "audit-log", title: "Audit trail", icon: "activity" },
    ],
  },
];

function Icon({ name, size = 18, strokeWidth = 1.7, className = "" }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className}`}
    >
      {ICON_PATHS[name].map((path, index) => (
        <path d={path} key={`${name}-${index}`} />
      ))}
    </svg>
  );
}

function safeStatus(status: string): string {
  if (status === "healthy" || status === "online") return "healthy";
  if (status === "degraded" || status === "stale") return status;
  if (status === "unreachable" || status === "offline" || status === "expired") return "unreachable";
  if (status === "unconfigured") return "unconfigured";
  return "unknown";
}

function statusLabel(status: string): string {
  const normalized = safeStatus(status);
  if (normalized === "healthy") return status === "online" ? "Online" : "Healthy";
  if (normalized === "degraded") return "Degraded";
  if (normalized === "unreachable") return status === "expired" ? "Expired" : "Unreachable";
  if (normalized === "unconfigured") return "Not configured";
  if (normalized === "stale") return "Stale";
  return "Unknown";
}

function StatusBadge({ status, small = false }: { status: string; small?: boolean }) {
  const normalized = safeStatus(status);
  return (
    <span className={`status-badge status-${normalized}${small ? " status-small" : ""}`}>
      <span className="status-dot" />
      {statusLabel(status)}
    </span>
  );
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return "Not reported";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Not reported";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatMs(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${Math.round(value)} ms`;
}

function formatMinutes(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(1)} min`;
}

function serviceCounts(services: ServiceItem[]) {
  return services.reduce(
    (result, service) => {
      const key = safeStatus(service.status);
      result[key] = (result[key] || 0) + 1;
      result.total += 1;
      return result;
    },
    { healthy: 0, degraded: 0, unreachable: 0, unconfigured: 0, stale: 0, unknown: 0, total: 0 } as Record<string, number>,
  );
}

function IconButton({
  name,
  label,
  onClick,
  disabled = false,
  className = "",
}: {
  name: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={name} />
    </button>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        <div className="eyebrow"><span className="eyebrow-mark" />{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="page-heading-actions">{children}</div> : null}
    </div>
  );
}

function PanelHeading({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="panel-heading">
      <div className="panel-title-wrap">
        {icon ? <span className="panel-heading-icon"><Icon name={icon} size={16} /></span> : null}
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="panel-heading-action">{action}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = "cyan",
  detail,
}: {
  label: string;
  value: string;
  helper: string;
  icon: IconName;
  tone?: "cyan" | "green" | "amber" | "rose" | "blue";
  detail?: string;
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
        <span className="metric-icon"><Icon name={icon} size={17} /></span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-bottom"><span>{helper}</span>{detail ? <span className="metric-detail">{detail}</span> : null}</div>
    </article>
  );
}

function HealthRing({ percent, label }: { percent: number; label: string }) {
  const circumference = 2 * Math.PI * 39;
  const bounded = Math.min(100, Math.max(0, percent));
  return (
    <div className="health-ring-wrap" aria-label={`${bounded}% ${label}`}>
      <svg className="health-ring" viewBox="0 0 100 100" role="img" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r="39" />
        <circle
          className="ring-value"
          cx="50"
          cy="50"
          r="39"
          style={{ strokeDasharray: `${(circumference * bounded) / 100} ${circumference}` }}
        />
      </svg>
      <div className="ring-center"><strong>{bounded}%</strong><span>{label}</span></div>
    </div>
  );
}

function LatencyChart({ points }: { points: ChartPoint[] }) {
  const valid = points.filter((point) => point.latencyMs !== null);
  const width = 720;
  const height = 190;
  const padX = 22;
  const padY = 20;
  const values = valid.map((point) => point.latencyMs as number);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const span = Math.max(50, maximum - minimum);
  const coordinates = valid.map((point, index) => {
    const x = valid.length <= 1 ? width / 2 : padX + (index / (valid.length - 1)) * (width - padX * 2);
    const y = height - padY - (((point.latencyMs as number) - minimum) / span) * (height - padY * 2);
    return { x, y, point };
  });
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="chart-wrap">
      <div className="chart-key"><span className="chart-key-dot" />Observed average service latency</div>
      <svg className="latency-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Observed latency samples collected during this dashboard session">
        {[0, 1, 2].map((line) => {
          const y = padY + (line * (height - padY * 2)) / 2;
          return <line key={line} x1={padX} x2={width - padX} y1={y} y2={y} className="chart-gridline" />;
        })}
        {coordinates.length > 1 ? <polyline points={polyline} className="chart-line" /> : null}
        {coordinates.map((point, index) => (
          <circle key={`${point.point.at}-${index}`} cx={point.x} cy={point.y} r="4" className="chart-point" />
        ))}
        {coordinates.length === 0 ? <text x={width / 2} y={height / 2} textAnchor="middle" className="chart-empty-label">Waiting for live samples</text> : null}
      </svg>
      <div className="chart-axis-labels">
        <span>{valid.length ? `${Math.round(minimum)} ms min` : "No latency sample"}</span>
        <span>{valid.length > 1 ? `${valid.length} live samples · this session` : "Trend builds as new samples arrive"}</span>
        <span>{valid.length ? `${Math.round(maximum)} ms max` : "No stored history"}</span>
      </div>
    </div>
  );
}

function SecurityHeaderRow({ label, detail, present, warning = false }: { label: string; detail: string; present: boolean; warning?: boolean }) {
  const visualState = !present ? "missing" : warning ? "warning" : "present";
  return (
    <div className="security-header-row">
      <span className={`security-check ${visualState}`}><Icon name={present && !warning ? "check" : "alert"} size={14} /></span>
      <div className="security-header-copy"><strong>{label}</strong><span>{detail}</span></div>
      <span className={`security-header-state ${present && !warning ? "good" : "warning"}`}>{!present ? "Missing" : warning ? "Review" : "Present"}</span>
    </div>
  );
}

function IssueLine({ issue, compact = false, onClaim }: { issue: WorkOrder; compact?: boolean; onClaim?: (issue: WorkOrder) => void }) {
  return (
    <div className={`issue-line${compact ? " issue-line-compact" : ""}`}>
      <div className="issue-line-main">
        <div className="issue-number">{issue.number ? `#${issue.number}` : "Work order"}</div>
        {issue.url ? (
          <a href={issue.url} target="_blank" rel="noreferrer" className="issue-title">{issue.title}<Icon name="external" size={13} /></a>
        ) : <span className="issue-title">{issue.title}</span>}
        <div className="issue-meta">
          <span><Icon name="clock" size={13} /> Updated {formatRelative(issue.updatedAt)}</span>
          <span>{issue.comments} comments</span>
          {issue.labels.slice(0, 3).map((label) => <span className="label-chip" key={label}>{label}</span>)}
        </div>
      </div>
      {onClaim && issue.number ? (
        <button type="button" className="button button-secondary issue-claim" onClick={() => onClaim(issue)}>
          <Icon name="plus" size={15} />Claim
        </button>
      ) : null}
    </div>
  );
}

function ProviderProbeCard({ probe }: { probe: ProviderProbe }) {
  return (
    <article className="provider-probe-card">
      <div className="provider-probe-top">
        <div className="provider-probe-name"><span className={`provider-probe-mark mark-${safeStatus(probe.status)}`}><Icon name={probe.name === "redis" ? "database" : probe.name.includes("render") ? "server" : "network"} size={14} /></span><strong>{probe.name.replace(/[-_]/g, " ")}</strong></div>
        <StatusBadge status={probe.status} small />
      </div>
      {probe.warning ? <p className="provider-probe-warning">{probe.warning}</p> : null}
      {probe.metrics.length ? <div className="provider-probe-metrics">{probe.metrics.map((metric) => <span key={metric}>{metric}</span>)}</div> : null}
      <div className="provider-probe-footer"><span>{formatMs(probe.latencyMs)}</span><span>Checked {formatRelative(probe.checkedAt)}</span>{probe.consecutiveFailures > 0 ? <span className="probe-failure-count">{probe.consecutiveFailures} failures</span> : null}</div>
      {probe.impactedServices.length ? <div className="provider-impact-list">Impacts {probe.impactedServices.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div> : null}
    </article>
  );
}

function ProviderProbeSection({ data, onNavigate }: { data: OverviewData; onNavigate: (page: PageId) => void }) {
  const probes = data.providerDiagnostics.providers;
  const notable = probes.filter((probe) => probe.status !== "healthy" || probe.warning).slice(0, 4);
  const shown = notable.length ? notable : probes.slice(0, 4);
  const counts = data.providerDiagnostics.counts;
  return (
    <section className="panel provider-signals-panel">
      <PanelHeading
        title="Direct provider diagnostics"
        subtitle={`${data.providerDiagnostics.total} snapshots from the MCP health_live scope · ${data.providerDiagnostics.observedAt ? `observed ${formatRelative(data.providerDiagnostics.observedAt)}` : "no probe timestamp"}`}
        icon="network"
        action={<button type="button" className="text-action" onClick={() => onNavigate("integrations")}>All provider probes <Icon name="chevron" size={13} /></button>}
      />
      <div className="provider-signal-summary"><span className="signal-good">{counts.healthy || 0} healthy</span><span className="signal-warn">{counts.degraded || 0} degraded</span><span className="signal-stale">{counts.stale || 0} stale</span><span className="signal-down">{counts.unreachable || 0} unreachable</span>{data.providerDiagnostics.incidentCount ? <span className="signal-incidents">{data.providerDiagnostics.incidentCount} incidents</span> : null}</div>
      {shown.length ? <div className="provider-probe-grid provider-probe-grid-compact">{shown.map((probe) => <ProviderProbeCard key={probe.name} probe={probe} />)}</div> : <div className="inline-empty"><span className="empty-check"><Icon name="info" size={17} /></span><div><strong>No direct provider snapshots</strong><span>The live health_live scope has not returned provider diagnostics yet.</span></div></div>}
      <div className="table-footnote"><Icon name="info" size={14} /> Probe ages are evaluated independently; old green snapshots are shown as stale rather than current health.</div>
    </section>
  );
}

function OverviewPage({
  data,
  points,
  onNavigate,
  onSelectService,
  onRunAudit,
  onClaim,
  onOpenAccess,
}: {
  data: OverviewData;
  points: ChartPoint[];
  onNavigate: (page: PageId) => void;
  onSelectService: (service: ServiceItem) => void;
  onRunAudit: () => void;
  onClaim?: (issue: WorkOrder) => void;
  onOpenAccess: () => void;
}) {
  const counts = serviceCounts(data.services);
  const percentage = counts.total ? Math.round((counts.healthy / counts.total) * 100) : 0;
  const latencies = data.services.map((service) => service.latencyMs).filter((value): value is number => value !== null);
  const averageLatency = latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : null;
  const agentsOnline = data.agentFleet.onlineInteractive + data.agentFleet.onlineAutonomous;
  const needingAttention = data.services.filter((service) => !["healthy"].includes(service.status));
  const studioHeaderCount = Object.values(data.studio.securityHeaders).filter(Boolean).length;
  const towerCounts = data.tower?.services;
  const overallStatus = !data.mcpConnected ? "unreachable" : counts.degraded + counts.unreachable > 0 || data.tower?.status === "degraded" ? "degraded" : "healthy";

  return (
    <div className="page-stack">
      <div className="overview-hero panel">
        <div className="hero-glow" />
        <div className="overview-hero-copy">
          <div className="hero-live-label"><span className="pulse-dot" /> SUPREMEAI CONTROL TOWER <span className="hero-divider">/</span> LIVE SYSTEM VIEW</div>
          <h1>One command center.<br /><span>Every signal in view.</span></h1>
          <p>Monitor the federation, catch issues early, and operate only through owner-authorized, auditable controls.</p>
          <div className="hero-status-line">
            <StatusBadge status={overallStatus} />
            <span className="hero-status-summary">{counts.healthy} of {counts.total} provider checks healthy</span>
            <button type="button" className="inline-link" onClick={() => onNavigate("services")}>View service health <Icon name="chevron" size={14} /></button>
          </div>
        </div>
        <div className="overview-hero-visual">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <HealthRing percent={percentage} label="healthy" />
          <div className="hero-visual-caption"><span className="pulse-dot" /> Live provider telemetry</div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard
          label="Provider health"
          value={`${counts.healthy}/${counts.total || "—"}`}
          helper={`${counts.degraded} degraded · ${counts.unreachable} unreachable`}
          icon="pulse"
          tone={counts.unreachable > 0 ? "rose" : counts.degraded > 0 ? "amber" : "green"}
          detail="MCP system_health"
        />
        <MetricCard
          label="Tower checks"
          value={towerCounts?.healthy === null || towerCounts?.healthy === undefined ? "—" : `${towerCounts.healthy}/${towerCounts.total ?? "—"}`}
          helper={data.tower ? `${towerCounts?.degraded ?? 0} degraded · ${data.tower.stale ? "sweep stale" : "latest sweep"}` : "Tower health endpoint unavailable"}
          icon="monitor"
          tone={data.tower?.status === "healthy" ? "green" : data.tower ? "amber" : "rose"}
          detail={data.tower?.lastCompletedSweepAt ? `Sweep ${formatRelative(data.tower.lastCompletedSweepAt)}` : "26-check tower probe"}
        />
        <MetricCard
          label="Online assistants"
          value={`${agentsOnline}`}
          helper={`${data.agentFleet.onlineAutonomous} builders · ${data.agentFleet.onlineInteractive} interactive`}
          icon="bot"
          tone="blue"
          detail={`${data.agentFleet.total} registered clients`}
        />
        <MetricCard
          label="Open work orders"
          value={`${data.bridge.totalOpen}`}
          helper={data.bridge.repo || "Bridge queue"}
          icon="clipboard"
          tone="cyan"
          detail="Live public queue"
        />
      </div>

      <div className="overview-grid overview-grid-top">
        <section className="panel chart-panel">
          <PanelHeading
            title="Service latency"
            subtitle="Observed response time across services with a live latency sample."
            icon="activity"
            action={<span className="session-only"><span className="pulse-dot" /> CURRENT SESSION</span>}
          />
          <div className="chart-summary-row">
            <div><span className="chart-summary-value">{averageLatency === null ? "—" : `${averageLatency} ms`}</span><span className="chart-summary-label">mean reported latency</span></div>
            <span className="chart-source">{latencies.length} services reporting latency</span>
          </div>
          <LatencyChart points={points} />
        </section>

        <section className="panel studio-panel">
          <PanelHeading title="Studio frontend" subtitle="Public production URL · sampled live" icon="globe" action={<StatusBadge status={data.studio.reachable ? "healthy" : "unreachable"} small />} />
          <div className="studio-url-row">
            <div className="studio-monogram"><Icon name="spark" size={20} /></div>
            <div className="studio-url-copy"><strong>SupremeAI Studio</strong><a href={data.studio.url} target="_blank" rel="noreferrer">supremeai-studio.pages.dev <Icon name="external" size={12} /></a></div>
            <span className="latency-chip">{formatMs(data.studio.latencyMs)}</span>
          </div>
          <div className="frontend-security-strip">
            <div className={`security-alert-card ${data.studio.securityHeaders.hsts ? "security-all-good" : "security-needs-attention"}`}>
              <span className="security-alert-icon"><Icon name={data.studio.securityHeaders.hsts ? "shieldCheck" : "alert"} size={16} /></span>
              <div><strong>{data.studio.securityHeaders.hsts ? "Transport policy present" : "HSTS header missing"}</strong><span>{studioHeaderCount}/4 response security headers detected</span></div>
              <button type="button" className="text-action" onClick={onRunAudit}>Audit <Icon name="chevron" size={13} /></button>
            </div>
            <div className="header-mini-grid">
              <HeaderMini label="CSP" present={data.studio.securityHeaders.csp} warning={data.studio.securityHeaders.cspUnsafeInline || data.studio.securityHeaders.cspUnsafeEval} />
              <HeaderMini label="Frame guard" present={data.studio.securityHeaders.frameOptions} />
              <HeaderMini label="MIME guard" present={data.studio.securityHeaders.contentTypeOptions} />
            </div>
          </div>
          <div className="panel-footnote"><Icon name="info" size={14} /> Browser-level checks run only when the tower has a headless browser available.</div>
        </section>
      </div>

      <div className="overview-grid overview-grid-bottom">
        <section className="panel attention-panel">
          <PanelHeading
            title="Needs attention"
            subtitle="Exceptions from the latest provider health probe."
            icon="alert"
            action={<button type="button" className="text-action" onClick={() => onNavigate("services")}>All services <Icon name="chevron" size={13} /></button>}
          />
          <div className="service-quick-list">
            {needingAttention.length ? needingAttention.slice(0, 5).map((service) => (
              <button type="button" className="service-quick-row" key={service.id} onClick={() => onSelectService(service)}>
                <span className={`service-status-mark mark-${safeStatus(service.status)}`}><Icon name={service.status === "unreachable" ? "alert" : "server"} size={15} /></span>
                <span className="service-quick-copy"><strong>{service.displayName}</strong><span>{service.provider} · {service.role}</span></span>
                <span className="service-quick-latency">{formatMs(service.latencyMs)}</span>
                <StatusBadge status={service.status} small />
                <Icon name="chevron" size={16} />
              </button>
            )) : <div className="inline-empty"><span className="empty-check"><Icon name="check" size={17} /></span><div><strong>No provider exceptions reported</strong><span>The latest tool response contains no degraded or unreachable services.</span></div></div>}
            {!data.studio.securityHeaders.hsts ? (
              <button type="button" className="service-quick-row web-warning-row" onClick={() => onNavigate("web-audit")}>
                <span className="service-status-mark mark-degraded"><Icon name="shield" size={15} /></span>
                <span className="service-quick-copy"><strong>Studio response security</strong><span>Strict-Transport-Security was not detected.</span></span>
                <span className="service-quick-latency">HTTP {data.studio.status ?? "—"}</span>
                <StatusBadge status="degraded" small />
                <Icon name="chevron" size={16} />
              </button>
            ) : null}
          </div>
        </section>

        <section className="panel work-preview-panel">
          <PanelHeading
            title="Bridge queue"
            subtitle={`${data.bridge.totalOpen} open work orders · ${data.bridge.repo || "connected repository"}`}
            icon="clipboard"
            action={<button type="button" className="text-action" onClick={() => onNavigate("bridge")}>Open queue <Icon name="chevron" size={13} /></button>}
          />
          {data.bridge.issues.length ? (
            <div className="work-preview-list">{data.bridge.issues.slice(0, 4).map((issue) => <IssueLine key={`${issue.number}-${issue.title}`} issue={issue} compact onClaim={onClaim} />)}</div>
          ) : <div className="inline-empty"><span className="empty-check"><Icon name="info" size={17} /></span><div><strong>Queue data unavailable</strong><span>Bridge work orders will appear here when the MCP source responds.</span></div></div>}
          <div className="queue-caveat"><Icon name="lock" size={13} />{onClaim ? "Claiming requires an owner session and a durable audit record." : "Owner sign-in is required before this queue can be claimed."}{!onClaim ? <button type="button" className="text-action" onClick={onOpenAccess}>Owner access <Icon name="chevron" size={12} /></button> : null}</div>
        </section>
      </div>
      <ProviderProbeSection data={data} onNavigate={onNavigate} />
    </div>
  );
}

function HeaderMini({ label, present, warning = false }: { label: string; present: boolean; warning?: boolean }) {
  const stateClass = !present ? "mini-missing" : warning ? "mini-warning" : "mini-good";
  const title = warning ? "CSP contains unsafe-inline or unsafe-eval" : present ? "Response header detected" : "Response header missing";
  return <span title={title} className={`header-mini ${stateClass}`}><i />{warning ? `${label} · review` : label}</span>;
}

function ServicesPage({ services, onSelect }: { services: ServiceItem[]; onSelect: (service: ServiceItem) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const counts = serviceCounts(services);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...services]
      .filter((service) => {
        const matchesQuery = !normalized || `${service.displayName} ${service.id} ${service.provider} ${service.role}`.toLowerCase().includes(normalized);
        const matchesStatus = filter === "all" || (filter === "attention" ? service.status !== "healthy" : service.status === filter);
        return matchesQuery && matchesStatus;
      })
      .sort((left, right) => {
        const priority: Record<string, number> = { unreachable: 0, degraded: 1, unknown: 2, unconfigured: 3, healthy: 4 };
        return (priority[safeStatus(left.status)] ?? 2) - (priority[safeStatus(right.status)] ?? 2) || left.displayName.localeCompare(right.displayName);
      });
  }, [services, query, filter]);

  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META.services}>
        <span className="refresh-copy"><span className="pulse-dot" /> Polling every 60 seconds</span>
      </PageHeading>
      <div className="metric-grid metric-grid-compact">
        <MetricCard label="Tracked services" value={`${counts.total}`} helper="Current MCP health response" icon="server" tone="blue" />
        <MetricCard label="Healthy" value={`${counts.healthy}`} helper="Recent health probe passed" icon="shieldCheck" tone="green" />
        <MetricCard label="Degraded" value={`${counts.degraded}`} helper="Probe returned a degraded state" icon="activity" tone="amber" />
        <MetricCard label="Unreachable" value={`${counts.unreachable}`} helper="Probe did not confirm availability" icon="alert" tone="rose" />
      </div>
      <section className="panel service-table-panel">
        <PanelHeading title="Provider health map" subtitle="Health is sourced from the live MCP system_health tool. A missing response is shown as unknown, never zero." icon="network" />
        <div className="table-toolbar">
          <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services, providers, roles" aria-label="Search services" /><kbd>⌘ K</kbd></label>
          <label className="filter-select-wrap"><Icon name="filter" size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter services"><option value="all">All statuses</option><option value="attention">Needs attention</option><option value="healthy">Healthy</option><option value="degraded">Degraded</option><option value="unreachable">Unreachable</option></select></label>
          <span className="table-result-count">{filtered.length} of {services.length}</span>
        </div>
        {filtered.length ? (
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Service</th><th>Provider / role</th><th>Status</th><th>Latency</th><th>Deploy</th><th>Build minutes</th><th /></tr></thead>
            <tbody>{filtered.map((service) => (
              <tr key={service.id} onClick={() => onSelect(service)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(service); }}>
                <td><div className="table-service-name"><span className={`service-status-mark mark-${safeStatus(service.status)}`}><Icon name="server" size={15} /></span><div><strong>{service.displayName}</strong><code>{service.id}</code></div></div></td>
                <td><div className="provider-cell"><strong>{service.provider}</strong><span>{service.role}</span></div></td>
                <td><StatusBadge status={service.status} /></td>
                <td className="mono-cell">{formatMs(service.latencyMs)}</td>
                <td>{service.deployStatus ? <span className={`deploy-state ${service.deployStatus === "live" ? "deploy-live" : ""}`}><i />{service.deployStatus}</span> : <span className="muted-dash">—</span>}</td>
                <td className="mono-cell">{service.monthlyBuildMinutes === null ? "—" : <span>{formatMinutes(service.monthlyBuildMinutes)}<small className="table-subline">{service.freeLimitRemainingMinutes === null ? "" : `${formatMinutes(service.freeLimitRemainingMinutes)} remaining`}</small></span>}</td>
                <td><Icon name="chevron" size={16} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty-state"><Icon name="search" size={22} /><strong>No matching services</strong><span>Try a broader search or a different status filter.</span></div>}
        <div className="table-footnote"><Icon name="info" size={14} /> Provider capabilities shown by the source system are informational. This MCP connection exposes health and work-queue operations—not deploy, restart, environment-variable, billing, or tenant mutation APIs.</div>
      </section>
    </div>
  );
}

function AgentsPage({ data }: { data: OverviewData }) {
  const fleet = data.agentFleet;
  const online = fleet.onlineInteractive + fleet.onlineAutonomous;
  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META.agents}><span className="refresh-copy"><span className="pulse-dot" /> Heartbeats are live</span></PageHeading>
      <div className="metric-grid metric-grid-compact">
        <MetricCard label="Live clients" value={`${online}`} helper="Heartbeat within the online window" icon="bot" tone="green" />
        <MetricCard label="Interactive assistants" value={`${fleet.onlineInteractive}/${fleet.interactiveAssistants}`} helper="Online interactive sessions" icon="spark" tone="blue" />
        <MetricCard label="Autonomous builders" value={`${fleet.onlineAutonomous}/${fleet.autonomousBuilders}`} helper="Agent-slot heartbeats" icon="activity" tone="cyan" />
        <MetricCard label="Registered" value={`${fleet.total}`} helper="Visible in current registry window" icon="network" tone="amber" />
      </div>
      <section className="panel agents-panel">
        <PanelHeading title="Heartbeat registry" subtitle="Only display names and heartbeat freshness are shown. Tenant IDs, client IDs, and credential fingerprints are intentionally omitted." icon="pulse" />
        {fleet.agents.length ? (
          <div className="agent-grid">{fleet.agents.map((agent, index) => (
            <article className="agent-card" key={`${agent.name}-${index}`}>
              <div className="agent-card-top"><div className="agent-avatar">{agent.kind === "autonomous_builder" ? <Icon name="bot" size={18} /> : <Icon name="spark" size={17} />}</div><StatusBadge status={agent.state} small /></div>
              <div className="agent-card-name">{agent.name}</div>
              <div className="agent-kind">{agent.kind.replaceAll("_", " ")}</div>
              <div className="agent-card-meta"><span><Icon name="clock" size={13} /> {agent.ageSeconds === null ? "Age unavailable" : agent.ageSeconds < 60 ? `${agent.ageSeconds}s heartbeat age` : `${Math.floor(agent.ageSeconds / 60)}m heartbeat age`}</span><span>{formatRelative(agent.updatedAt)}</span></div>
            </article>
          ))}</div>
        ) : <div className="empty-state"><Icon name="bot" size={24} /><strong>No agent heartbeats in the current response</strong><span>Agent activity is not inferred when telemetry is unavailable.</span></div>}
        <div className="table-footnote"><Icon name="info" size={14} /> Online/stale/expired windows are computed by the MCP tower. The dashboard does not emit agent heartbeats on behalf of a worker.</div>
      </section>
    </div>
  );
}

function BridgePage({
  data,
  authenticated,
  onClaim,
  onOpenAccess,
}: {
  data: OverviewData;
  authenticated: boolean;
  onClaim: (issue: WorkOrder) => void;
  onOpenAccess: () => void;
}) {
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const labels = Array.from(new Set(data.bridge.issues.flatMap((issue) => issue.labels))).sort();
  const filtered = data.bridge.issues.filter((issue) => {
    const matchesQuery = !query.trim() || `${issue.title} ${issue.number ?? ""} ${issue.labels.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesLabel = labelFilter === "all" || issue.labels.includes(labelFilter);
    return matchesQuery && matchesLabel;
  });

  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META.bridge}>
        <a className="button button-secondary" href="https://github.com/Supremeai-bd/supremeai-public" target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Frontend repository</a>
      </PageHeading>
      <div className="bridge-summary-strip">
        <div><span className="bridge-number">{data.bridge.totalOpen}</span><span className="bridge-number-label">open work orders</span></div>
        <div className="bridge-strip-divider" />
        <div><strong>{data.bridge.repo || "Bridge source"}</strong><span className="bridge-number-label">reported by the MCP Bridge</span></div>
        <div className="bridge-summary-right"><span className="source-live"><i /> Live queue</span><span>{data.bridge.windowTruncated ? "Visible window truncated" : `${data.bridge.count} in current result`}</span></div>
      </div>
      <div className="owner-action-note">
        <span className="owner-action-icon"><Icon name="shieldCheck" size={17} /></span>
        <div><strong>Claiming is the only write action enabled here.</strong><span>Each claim requires owner sign-in, an explicit confirmation, and a PostgreSQL audit entry before it is sent to MCP.</span></div>
        {!authenticated ? <button type="button" className="button button-secondary" onClick={onOpenAccess}><Icon name="lock" size={14} /> Owner access</button> : <span className="owner-session-pill"><Icon name="check" size={13} /> Owner session</span>}
      </div>
      <section className="panel bridge-panel">
        <PanelHeading title="Open work orders" subtitle={`Tasks from ${data.bridge.repo || "the MCP Bridge queue"}`} icon="clipboard" action={<span className="table-result-count">{filtered.length} shown</span>} />
        <div className="table-toolbar">
          <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, issue numbers, labels" aria-label="Search work orders" /></label>
          <label className="filter-select-wrap"><Icon name="filter" size={15} /><select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)} aria-label="Filter work orders by label"><option value="all">All labels</option>{labels.map((label) => <option value={label} key={label}>{label}</option>)}</select></label>
        </div>
        <div className="issue-list">{filtered.map((issue, index) => (
          <div className="issue-list-row" key={`${issue.number}-${index}`}>
            <IssueLine issue={issue} onClaim={authenticated ? onClaim : undefined} />
            {!authenticated && issue.number ? <button type="button" className="button button-quiet issue-locked" onClick={onOpenAccess}><Icon name="lock" size={14} /> Sign in to claim</button> : null}
          </div>
        ))}</div>
        {!filtered.length ? <div className="empty-state"><Icon name="clipboard" size={24} /><strong>No work orders match</strong><span>Check the label filter or search term.</span></div> : null}
        {data.bridge.windowTruncated ? <div className="table-footnote"><Icon name="info" size={14} /> The MCP source reports a truncated window. Open the Bridge queue for the full current result.</div> : null}
      </section>
    </div>
  );
}

function IntegrationsPage({ data }: { data: OverviewData }) {
  const grouped = data.services.reduce<Record<string, ServiceItem[]>>((result, service) => {
    const key = service.provider || "other";
    result[key] = result[key] || [];
    result[key].push(service);
    return result;
  }, {});
  const groups = Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));
  const providerProbes = [...data.providerDiagnostics.providers].sort((left, right) => {
    const priority: Record<string, number> = { unreachable: 0, degraded: 1, stale: 2, unknown: 3, healthy: 4 };
    return (priority[left.status] ?? 3) - (priority[right.status] ?? 3) || left.name.localeCompare(right.name);
  });

  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META.integrations} />
      <div className="integration-intro panel"><div className="integration-intro-icon"><Icon name="network" size={21} /></div><div><strong>{groups.length} provider groups · {data.services.length} health checks</strong><p>Provider credentials are never requested or displayed here. Health data is reduced server-side to names, status, latency, and safe capacity fields.</p></div><StatusBadge status={data.mcpConnected ? "healthy" : "unreachable"} /></div>
      <section className="panel provider-live-panel">
        <PanelHeading title="Direct provider probe inventory" subtitle={`${data.providerDiagnostics.total} health_live snapshots · ${data.providerDiagnostics.durationMs ?? "—"} ms probe duration · statuses retain their individual check age.`} icon="pulse" action={<span className="session-only"><span className="pulse-dot" /> MCP STATUS</span>} />
        {providerProbes.length ? <div className="provider-probe-grid provider-probe-grid-full">{providerProbes.map((probe) => <ProviderProbeCard key={probe.name} probe={probe} />)}</div> : <div className="empty-state"><Icon name="network" size={23} /><strong>Provider probe snapshots unavailable</strong><span>The MCP status health_live scope has not returned provider-level diagnostics.</span></div>}
      </section>
      <div className="integration-grid">{groups.map(([provider, services]) => {
        const health = serviceCounts(services);
        const providerIcon: IconName = provider === "supabase" ? "database" : provider === "cloudflare" ? "globe" : provider === "github" ? "clipboard" : provider === "render" ? "server" : "network";
        return (
          <section className="panel integration-card" key={provider}>
            <div className="integration-card-heading"><span className="integration-provider-icon"><Icon name={providerIcon} size={19} /></span><div><h2>{provider}</h2><span>{services.length} monitored {services.length === 1 ? "service" : "services"}</span></div><StatusBadge status={health.unreachable > 0 ? "unreachable" : health.degraded > 0 ? "degraded" : "healthy"} small /></div>
            <div className="integration-provider-stats"><span><i className="dot-green" />{health.healthy} healthy</span><span><i className="dot-amber" />{health.degraded} degraded</span>{health.unreachable > 0 ? <span><i className="dot-rose" />{health.unreachable} unreachable</span> : null}</div>
            <div className="integration-services">{services.map((service) => <div className="integration-service" key={service.id}><div><strong>{service.displayName}</strong><span>{service.role}</span></div><span className="integration-latency">{formatMs(service.latencyMs)}</span><StatusBadge status={service.status} small /></div>)}</div>
          </section>
        );
      })}</div>
      <div className="capability-note"><Icon name="info" size={15} /><span>Monitoring connections are not equivalent to management permissions. Restart, deploy, secret editing, customer, tenant, and billing writes are not exposed by the MCP tool catalog connected to this dashboard.</span></div>
    </div>
  );
}

function BrowserProbeCard({ title, icon, report, emptyText }: { title: string; icon: IconName; report?: ProbeReport; emptyText: string }) {
  const available = report?.available !== false && report !== undefined;
  return (
    <article className={`browser-probe-card${available ? "" : " probe-unavailable"}`}>
      <div className="browser-probe-icon"><Icon name={icon} size={18} /></div>
      <div className="browser-probe-content"><div className="browser-probe-heading"><strong>{title}</strong><span className={`probe-state ${available ? "probe-ready" : "probe-unknown"}`}>{available ? "Reported" : "Not verified"}</span></div><p>{report?.summary || report?.reason || emptyText}</p>{report?.hint ? <span className="probe-hint">{report.hint}</span> : null}</div>
    </article>
  );
}

function WebAuditPage({ data, audit, auditing, onRun }: { data: OverviewData; audit: AuditReport | null; auditing: boolean; onRun: () => void }) {
  const httpReport = audit?.http;
  const securityHeaders = httpReport?.securityHeaders;
  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META["web-audit"]}>
        <button type="button" className="button button-primary" onClick={onRun} disabled={auditing}><Icon className={auditing ? "spin" : ""} name={auditing ? "refresh" : "eye"} size={16} />{auditing ? "Running checks…" : "Run full web audit"}</button>
      </PageHeading>
      <div className="audit-target-card panel">
        <div className="audit-target-icon"><Icon name="globe" size={20} /></div><div className="audit-target-copy"><span className="eyebrow">LIVE PRODUCTION TARGET</span><strong>SupremeAI Studio</strong><a href={data.studio.url} target="_blank" rel="noreferrer">{data.studio.url} <Icon name="external" size={12} /></a></div><div className="audit-target-stats"><StatusBadge status={data.studio.reachable ? "healthy" : "unreachable"} /><strong>{data.studio.status ?? "—"}</strong><span>HTTP response · {formatMs(data.studio.latencyMs)}</span></div>
      </div>
      <div className="audit-layout-grid">
        <section className="panel security-headers-panel">
          <PanelHeading title="Response security headers" subtitle={audit?.checkedAt ? `Last browser-tool run ${formatRelative(audit.checkedAt)}` : "Current headers sampled from the live site response."} icon="shield" />
          <div className="security-header-list">
            <SecurityHeaderRow label="Strict-Transport-Security" detail="HSTS was not returned by the live Cloudflare Pages response." present={securityHeaders?.strictTransportSecurity ?? data.studio.securityHeaders.hsts} />
            <SecurityHeaderRow label="Content-Security-Policy" detail="A CSP header was detected on the Studio document." present={securityHeaders?.contentSecurityPolicy ?? data.studio.securityHeaders.csp} />
            <SecurityHeaderRow label="X-Frame-Options" detail="Clickjacking response protection was detected." present={securityHeaders?.xFrameOptions ?? data.studio.securityHeaders.frameOptions} />
            <SecurityHeaderRow label="X-Content-Type-Options" detail="MIME-sniffing protection was detected." present={securityHeaders?.xContentTypeOptions ?? data.studio.securityHeaders.contentTypeOptions} />
          </div>
          {!data.studio.securityHeaders.hsts ? <div className="audit-recommendation"><span className="recommendation-mark"><Icon name="alert" size={15} /></span><div><strong>Recommendation: enable HSTS</strong><span>The current site response lacks Strict-Transport-Security. Verify all subdomains are HTTPS-ready before enabling includeSubDomains or preload.</span></div></div> : null}
        </section>
        <section className="panel audit-verdict-panel">
          <PanelHeading title="Audit verdict" subtitle="HTTP checks are separate from headless-browser checks." icon="activity" />
          <div className={`audit-verdict ${httpReport?.verdict === "PASS" ? "verdict-pass" : data.studio.reachable ? "verdict-warn" : "verdict-fail"}`}>
            <span className="verdict-icon"><Icon name={data.studio.reachable ? "alert" : "close"} size={22} /></span>
            <div><strong>{httpReport?.verdict || (data.studio.reachable ? "HTTP reachable · review required" : "Site unreachable")}</strong><span>{httpReport?.summary || `${data.studio.status ?? "No response"} · ${formatMs(data.studio.latencyMs)} from the server probe`}</span></div>
          </div>
          <div className="audit-run-meta"><span>Target response</span><strong>{data.studio.status ? `HTTP ${data.studio.status}` : "No HTTP status"}</strong></div>
          <div className="audit-run-meta"><span>Tool mode</span><strong>{httpReport?.mode || "Server-side HTTP header probe"}</strong></div>
          <div className="audit-run-meta"><span>Last checked</span><strong>{audit?.checkedAt ? formatDate(audit.checkedAt) : formatDate(data.generatedAt)}</strong></div>
        </section>
      </div>
      <section className="panel browser-diagnostics-panel">
        <PanelHeading title="Browser diagnostics" subtitle="The MCP tower currently reports headless Chrome unavailable; these results are not a pass." icon="monitor" action={<span className="unverified-chip"><Icon name="info" size={13} /> Browser not verified</span>} />
        <div className="browser-probe-grid">
          <BrowserProbeCard title="Performance trace" icon="activity" report={audit?.performance} emptyText="Run a full web audit to request a performance trace." />
          <BrowserProbeCard title="Console errors" icon="clipboard" report={audit?.console} emptyText="Run a full web audit to request a browser console sweep." />
          <BrowserProbeCard title="Network failures" icon="network" report={audit?.network} emptyText="Run a full web audit to request a network-failure sweep." />
        </div>
        {audit?.performance?.reason ? <div className="browser-blocker"><Icon name="alert" size={15} /><span>{audit.performance.reason}</span></div> : null}
      </section>
    </div>
  );
}

function SecurityPage({ data, session, onOpenAccess, onSignOut }: { data: OverviewData; session: SessionInfo; onOpenAccess: () => void; onSignOut: () => void }) {
  const supportedOperations = [
    { name: "Read health and service availability", access: "Live" },
    { name: "Read agent heartbeats", access: "Live" },
    { name: "Browse public Bridge work orders", access: "Live" },
    { name: "Claim a Bridge work order", access: session.authenticated ? "Owner-gated" : "Locked" },
    { name: "Restart or deploy a service", access: "Not exposed" },
    { name: "Edit provider secrets or environment", access: "Not exposed" },
    { name: "Manage tenants, customers, or billing", access: "Not exposed" },
  ];
  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META.security}>
        {session.authenticated ? <button type="button" className="button button-secondary" onClick={onSignOut}><Icon name="logout" size={15} /> End owner session</button> : <button type="button" className="button button-primary" onClick={onOpenAccess}><Icon name="key" size={15} /> Owner access</button>}
      </PageHeading>
      <div className="security-overview-grid">
        <section className="panel security-session-card">
          <div className="security-card-banner"><div className={`security-large-icon ${session.authenticated ? "security-icon-good" : "security-icon-locked"}`}><Icon name={session.authenticated ? "shieldCheck" : "lock"} size={23} /></div><div><span className="eyebrow">DASHBOARD SESSION</span><h2>{session.authenticated ? "Owner session active" : session.configured ? "Owner sign-in required" : "Read-only mode"}</h2><p>{session.authenticated ? "An eight-hour, signed HttpOnly cookie protects owner-gated bridge actions." : session.configured ? "Live telemetry is available. Sign in to perform the one supported write action." : "No owner secret is configured. Mutating actions stay locked while live monitoring remains available."}</p></div></div>
          <div className="session-guard-list"><span><Icon name="check" size={14} /> Token is server-side only</span><span><Icon name="check" size={14} /> Signed, expiring session cookie</span><span><Icon name="check" size={14} /> SameSite=Strict · HttpOnly</span><span><Icon name="check" size={14} /> Owner actions audited in PostgreSQL</span></div>
          {!session.configured ? <div className="env-setup-box"><div className="env-setup-heading"><Icon name="key" size={15} /><strong>Enable owner actions</strong></div><p>Add a random secret of at least 32 characters to the server environment. The dashboard will never ask the browser to retain it.</p><code>ADMIN_ACCESS_TOKEN=your-long-random-secret</code><span>Alternative: SUPREMEAI_ADMIN_TOKEN</span></div> : null}
        </section>
        <section className="panel security-posture-card">
          <PanelHeading title="Frontend response posture" subtitle="Latest direct HTTP response from Studio." icon="globe" />
          <div className="security-header-list security-header-list-compact">
            <SecurityHeaderRow label="HSTS" detail="Strict-Transport-Security" present={data.studio.securityHeaders.hsts} />
            <SecurityHeaderRow label="CSP" detail="Content-Security-Policy" present={data.studio.securityHeaders.csp} />
            <SecurityHeaderRow label="Frame guard" detail="X-Frame-Options" present={data.studio.securityHeaders.frameOptions} />
            <SecurityHeaderRow label="MIME guard" detail="X-Content-Type-Options" present={data.studio.securityHeaders.contentTypeOptions} />
          </div>
          <div className="security-posture-footer"><span>HTTP response</span><strong>{data.studio.status ? `${data.studio.status} · ${formatMs(data.studio.latencyMs)}` : "Unavailable"}</strong></div>
        </section>
      </div>
      <section className="panel permissions-panel">
        <PanelHeading title="Connected action boundary" subtitle="The dashboard exposes only the operations the connected MCP server actually supports." icon="shieldCheck" />
        <div className="permission-list">{supportedOperations.map((operation) => (
          <div className="permission-row" key={operation.name}><span className="permission-name"><span className={`permission-dot ${operation.access === "Live" ? "permission-live" : operation.access === "Owner-gated" ? "permission-gated" : "permission-off"}`} />{operation.name}</span><span className={`permission-state ${operation.access === "Live" ? "state-live" : operation.access === "Owner-gated" ? "state-gated" : "state-off"}`}>{operation.access}</span></div>
        ))}</div>
        <div className="capability-note"><Icon name="info" size={15} /><span>This app intentionally does not invent restart, deploy, customer CRUD, user impersonation, billing, shell, or secret-edit endpoints. The existing Studio admin contract also keeps tenant administration disabled until owner-controlled provisioning and role-scoped server actions are implemented.</span></div>
      </section>
    </div>
  );
}

function AuditLogPage({ data }: { data: OverviewData }) {
  return (
    <div className="page-stack">
      <PageHeading {...PAGE_META["audit-log"]}><span className={`audit-store-chip ${data.auditStorageAvailable ? "store-online" : "store-offline"}`}><i /> PostgreSQL {data.auditStorageAvailable ? "connected" : "unavailable"}</span></PageHeading>
      {!data.auditStorageAvailable ? <div className="notice-banner notice-error"><Icon name="alert" size={17} /><span>Audit storage is unavailable. Privileged writes fail closed until the audit database is reachable.</span></div> : null}
      <section className="panel audit-log-panel">
        <PanelHeading title="Recent privileged actions" subtitle="Owner-gated actions are recorded before dispatch and updated with the verified result." icon="activity" action={<span className="table-result-count">{data.auditLog.length} events</span>} />
        {data.auditLog.length ? (
          <div className="table-scroll"><table className="data-table audit-data-table"><thead><tr><th>Action</th><th>Target</th><th>Actor</th><th>Outcome</th><th>Recorded</th><th>Summary</th></tr></thead><tbody>{data.auditLog.map((event) => (
            <tr key={event.id}><td><span className="audit-action-cell"><Icon name="shieldCheck" size={15} />{event.action}</span></td><td className="mono-cell">{event.target}</td><td>{event.actor}</td><td><span className={`audit-outcome outcome-${event.outcome}`}>{event.outcome}</span></td><td>{formatDate(event.createdAt)}</td><td className="audit-summary-cell">{event.summary}</td></tr>
          ))}</tbody></table></div>
        ) : <div className="empty-state audit-empty"><span className="empty-audit-icon"><Icon name="activity" size={21} /></span><strong>No privileged actions recorded</strong><span>Owner-confirmed Bridge actions will appear here with their target, result, and timestamp.</span></div>}
        <div className="table-footnote"><Icon name="info" size={14} /> Live health reads are not stored as administrative actions. No credential, request token, or raw MCP payload is written to this table.</div>
      </section>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return <div className="loading-state"><span className="loading-mark"><Icon name="spark" size={22} /></span><span className="loading-spinner" /><strong>Connecting to the control tower</strong><p>{message}</p><div className="loading-skeletons"><i /><i /><i /><i /></div></div>;
}

function AccessModal({
  session,
  token,
  setToken,
  error,
  busy,
  onSubmit,
  onClose,
  onSignOut,
}: {
  session: SessionInfo;
  token: string;
  setToken: (token: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal access-modal" role="dialog" aria-modal="true" aria-labelledby="access-title">
        <div className="modal-heading"><div className="modal-icon"><Icon name="shieldCheck" size={21} /></div><button type="button" className="icon-button" aria-label="Close owner access dialog" onClick={onClose}><Icon name="close" /></button></div>
        {session.authenticated ? (
          <>
            <span className="eyebrow">OWNER ACCESS</span><h2 id="access-title">Owner session active</h2><p className="modal-description">Your signed session is held in an HttpOnly cookie and expires after eight hours.</p>
            <div className="session-detail-box"><span className="pulse-dot" /><div><strong>Authenticated owner</strong><span>Bridge work-order claims are available and audited.</span></div></div>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Close</button><button type="button" className="button button-danger" onClick={onSignOut}><Icon name="logout" size={15} /> Sign out</button></div>
          </>
        ) : session.configured ? (
          <>
            <span className="eyebrow">OWNER ACCESS</span><h2 id="access-title">Sign in to operate</h2><p className="modal-description">Enter the server-configured owner token. It is verified once and is never stored in local or session storage.</p>
            <form onSubmit={onSubmit} className="access-form"><label htmlFor="owner-token">Owner access token</label><div className="token-input-wrap"><Icon name="key" size={16} /><input id="owner-token" name="owner-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Enter server-configured token" autoFocus /></div>{error ? <div className="form-error"><Icon name="alert" size={14} />{error}</div> : null}<button type="submit" className="button button-primary button-full" disabled={busy || !token.trim()}>{busy ? <><span className="button-spinner" /> Verifying…</> : <><Icon name="lock" size={15} /> Verify owner token</>}</button></form>
            <div className="modal-security-note"><Icon name="shield" size={14} /> Session is signed server-side · expires in 8 hours</div>
          </>
        ) : (
          <>
            <span className="eyebrow">READ-ONLY MODE</span><h2 id="access-title">Owner actions are locked</h2><p className="modal-description">Live service telemetry remains available. To enable the owner-gated Bridge claim, configure a server-only secret and redeploy.</p>
            <div className="env-setup-box modal-env-box"><div className="env-setup-heading"><Icon name="key" size={15} /><strong>Required server environment</strong></div><code>ADMIN_ACCESS_TOKEN</code><span>Use a random value with at least 32 characters. SUPREMEAI_ADMIN_TOKEN is also accepted.</span></div>
            <div className="modal-actions"><button type="button" className="button button-primary" onClick={onClose}>Understood</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function ServiceModal({ service, onClose }: { service: ServiceItem; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="service-modal-title">
        <div className="modal-heading"><div className="modal-icon"><Icon name="server" size={20} /></div><button type="button" className="icon-button" aria-label="Close service details" onClick={onClose}><Icon name="close" /></button></div>
        <span className="eyebrow">SERVICE DETAIL · {service.provider}</span><h2 id="service-modal-title">{service.displayName}</h2><p className="modal-description">{service.role} · <code>{service.id}</code></p>
        <div className="service-detail-status"><StatusBadge status={service.status} /><span>Latest latency <strong>{formatMs(service.latencyMs)}</strong></span></div>
        <div className="service-detail-grid"><div><span>Provider</span><strong>{service.provider}</strong></div><div><span>Deploy state</span><strong>{service.deployStatus || "Not reported"}</strong></div><div><span>Monthly build usage</span><strong>{formatMinutes(service.monthlyBuildMinutes)}</strong></div><div><span>Free allowance remaining</span><strong>{formatMinutes(service.freeLimitRemainingMinutes)}</strong></div></div>
        <div className="service-action-boundary"><Icon name="lock" size={15} /><span>The connected MCP surface reports health for this service but does not expose an authorized restart, deploy, or environment-edit action.</span></div>
        <div className="modal-actions"><button type="button" className="button button-primary" onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}

function ClaimModal({
  issue,
  busy,
  onConfirm,
  onClose,
}: {
  issue: WorkOrder;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal claim-modal" role="dialog" aria-modal="true" aria-labelledby="claim-title">
        <div className="modal-heading"><div className="modal-icon modal-icon-amber"><Icon name="clipboard" size={20} /></div><button type="button" className="icon-button" aria-label="Close claim confirmation" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
        <span className="eyebrow">BRIDGE · EXPLICIT CONFIRMATION</span><h2 id="claim-title">Claim work order #{issue.number}</h2><p className="modal-description">{issue.title}</p>
        <div className="claim-warning"><Icon name="alert" size={17} /><span>This action changes the public work-order state and starts the Bridge’s 30-minute claim lease. The dashboard records a pending audit event before sending it.</span></div>
        <div className="modal-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>{busy ? <><span className="button-spinner" /> Sending…</> : <><Icon name="check" size={15} /> Confirm claim</>}</button></div>
      </section>
    </div>
  );
}

export function AdminDashboard() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [clock, setClock] = useState<Date | null>(null);
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [session, setSession] = useState<SessionInfo>({ configured: false, authenticated: false });
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [pendingIssue, setPendingIssue] = useState<WorkOrder | null>(null);
  const [claimingIssue, setClaimingIssue] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) throw new Error(`Dashboard request returned ${response.status}`);
      const nextData = (await response.json()) as OverviewData;
      setData(nextData);
      setSession({ configured: nextData.adminAccessConfigured, authenticated: nextData.authenticated });
      setLastUpdated(new Date());
      setLoadError(null);
      const liveServices = Array.isArray(nextData.services) ? nextData.services : [];
      const latencies = liveServices.map((service) => service.latencyMs).filter((value): value is number => value !== null);
      const counts = serviceCounts(liveServices);
      setPoints((current) => [
        ...current,
        {
          at: Date.now(),
          latencyMs: latencies.length ? latencies.reduce((total, value) => total + value, 0) / latencies.length : null,
          healthPct: counts.total ? (counts.healthy / counts.total) * 100 : null,
        },
      ].slice(-24));
    } catch {
      setLoadError("Live telemetry could not be refreshed. The last successful snapshot, if any, is still shown.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/session", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { configured?: boolean; authenticated?: boolean };
      setSession({ configured: payload.configured === true, authenticated: payload.authenticated === true });
    } catch {
      // The read-only dashboard remains available when session introspection is offline.
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadSession();
    setClock(new Date());
    const pollTimer = window.setInterval(() => void refresh(true), 60_000);
    const clockTimer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => {
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
    };
  }, [refresh, loadSession]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectedService = data?.services.find((service) => service.id === selectedServiceId) || null;
  const pageMeta = PAGE_META[activePage];
  const authenticated = session.authenticated || data?.authenticated === true;

  const navigate = (page: PageId) => {
    setActivePage(page);
    setMobileNavOpen(false);
  };

  const runAudit = async () => {
    if (auditing) return;
    setAuditing(true);
    try {
      const response = await fetch("/api/admin/audit", { method: "POST", cache: "no-store" });
      const report = (await response.json()) as AuditReport & { error?: string };
      if (!response.ok) throw new Error(report.error || "Audit request failed");
      setAuditReport(report);
      setNotice({
        tone: report.http?.verdict === "PASS" ? "success" : "warning",
        title: "Web audit complete",
        detail: report.http?.summary || "HTTP response checked; browser diagnostics may be unavailable.",
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Audit unavailable", detail: error instanceof Error ? error.message : "The audit could not run." });
    } finally {
      setAuditing(false);
    }
  };

  const submitAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccessError(null);
    setAccessBusy(true);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: accessToken }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; authenticated?: boolean };
      if (!response.ok) throw new Error(payload.error || "Owner sign-in failed.");
      setSession({ configured: true, authenticated: true });
      setAccessToken("");
      setShowAccessModal(false);
      setNotice({ tone: "success", title: "Owner session active", detail: "Owner-gated Bridge claims are available for this session." });
      await refresh(true);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Owner sign-in failed.");
    } finally {
      setAccessBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await fetch("/api/admin/session", { method: "DELETE", cache: "no-store" });
      setSession((current) => ({ ...current, authenticated: false }));
      setData((current) => current ? { ...current, authenticated: false } : current);
      setShowAccessModal(false);
      setNotice({ tone: "success", title: "Signed out", detail: "The owner session cookie has been cleared." });
      await refresh(true);
    } catch {
      setNotice({ tone: "error", title: "Sign-out failed", detail: "Refresh the dashboard and try again." });
    }
  };

  const confirmClaim = async () => {
    if (!pendingIssue?.number || claimingIssue !== null) return;
    const issueNumber = pendingIssue.number;
    setClaimingIssue(issueNumber);
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim-work-order", issueNumber, confirmed: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string; auditWarning?: boolean };
      if (!response.ok) {
        if (response.status === 401) {
          setSession((current) => ({ ...current, authenticated: false }));
          setShowAccessModal(true);
        }
        throw new Error(payload.error || "The Bridge could not complete this claim.");
      }
      setPendingIssue(null);
      setNotice({
        tone: payload.auditWarning ? "warning" : "success",
        title: payload.auditWarning ? "Claim sent · audit update pending" : "Claim accepted",
        detail: payload.message || `Work order #${issueNumber} was accepted by the Bridge.`,
      });
      await refresh(true);
    } catch (error) {
      setNotice({ tone: "error", title: "Claim not completed", detail: error instanceof Error ? error.message : "The Bridge could not complete this claim." });
    } finally {
      setClaimingIssue(null);
    }
  };

  const overallStatus = useMemo(() => {
    if (!data?.mcpConnected) return "unreachable";
    const counts = serviceCounts(data.services);
    return counts.unreachable > 0 || counts.degraded > 0 || data.tower?.status === "degraded" ? "degraded" : "healthy";
  }, [data]);

  const renderPage = () => {
    if (!data) return null;
    switch (activePage) {
      case "overview":
        return <OverviewPage data={data} points={points} onNavigate={navigate} onSelectService={(service) => setSelectedServiceId(service.id)} onRunAudit={() => void runAudit()} onClaim={authenticated ? (issue) => setPendingIssue(issue) : undefined} onOpenAccess={() => setShowAccessModal(true)} />;
      case "services":
        return <ServicesPage services={data.services} onSelect={(service) => setSelectedServiceId(service.id)} />;
      case "agents":
        return <AgentsPage data={data} />;
      case "bridge":
        return <BridgePage data={data} authenticated={authenticated} onClaim={(issue) => setPendingIssue(issue)} onOpenAccess={() => setShowAccessModal(true)} />;
      case "integrations":
        return <IntegrationsPage data={data} />;
      case "web-audit":
        return <WebAuditPage data={data} audit={auditReport} auditing={auditing} onRun={() => void runAudit()} />;
      case "security":
        return <SecurityPage data={data} session={{ configured: session.configured || data.adminAccessConfigured, authenticated }} onOpenAccess={() => setShowAccessModal(true)} onSignOut={() => void signOut()} />;
      case "audit-log":
        return <AuditLogPage data={data} />;
      default:
        return null;
    }
  };

  return (
    <div className="dashboard-shell">
      <aside className={`sidebar${mobileNavOpen ? " sidebar-open" : ""}`} aria-label="Admin navigation">
        <div className="brand-lockup">
          <div className="brand-mark"><span>S</span><i /></div>
          <div className="brand-wordmark"><strong>SUPREME<span>AI</span></strong><small>STUDIO / CONTROL</small></div>
          <span className="brand-edition">ADMIN</span>
        </div>
        <div className="sidebar-environment"><span className="environment-indicator" /><span>PRODUCTION CONTROL</span><span className="environment-live">LIVE</span></div>
        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const isActive = activePage === item.id;
                const badge = item.id === "services" && data ? (data.system.counts.degraded || 0) + (data.system.counts.unreachable || 0) : item.id === "bridge" && data ? data.bridge.totalOpen : null;
                return (
                  <button type="button" key={item.id} className={`nav-item${isActive ? " nav-item-active" : ""}`} onClick={() => navigate(item.id)} aria-current={isActive ? "page" : undefined}>
                    <span className="nav-icon"><Icon name={item.icon} size={17} /></span><span className="nav-title">{item.title}</span>{badge ? <span className={`nav-badge${item.id === "services" ? " nav-badge-alert" : ""}`}>{badge > 99 ? "99+" : badge}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status-card">
          <div className="sidebar-status-top"><span className={`sidebar-status-indicator indicator-${safeStatus(overallStatus)}`} /><span>Control tower</span><StatusBadge status={overallStatus} small /></div>
          <span className="sidebar-status-caption">{data?.mcpConnected ? `${data.services.length} provider checks · updated ${formatRelative(data.system.checkedAt)}` : "Waiting for live telemetry"}</span>
          <button type="button" className="sidebar-status-link" onClick={() => navigate("services")}>System diagnostics <Icon name="arrow" size={13} /></button>
        </div>
        <button type="button" className={`sidebar-owner-button${authenticated ? " owner-active" : ""}`} onClick={() => { setAccessError(null); setShowAccessModal(true); }}>
          <span className="owner-avatar"><Icon name={authenticated ? "shieldCheck" : "lock"} size={16} /></span><span className="owner-button-copy"><strong>{authenticated ? "Owner session" : "Owner access"}</strong><small>{authenticated ? "Authenticated · 8h session" : session.configured || data?.adminAccessConfigured ? "Sign in to operate" : "Read-only controls"}</small></span><Icon name="chevron" size={15} />
        </button>
        <div className="sidebar-bottom-meta"><span>SUPREMEAI CONTROL PLANE</span><span>v1.0.0 · live MCP</span></div>
      </aside>

      {mobileNavOpen ? <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-leading">
            <IconButton name="menu" label="Open navigation" className="mobile-menu-button" onClick={() => setMobileNavOpen((open) => !open)} />
            <div className="breadcrumb"><span>SupremeAI</span><Icon name="chevron" size={13} /><strong>{pageMeta.title}</strong></div>
          </div>
          <div className="topbar-actions">
            <span className={`topbar-live ${data?.mcpConnected ? "" : "topbar-live-offline"}`}><i />{data?.mcpConnected ? "LIVE TELEMETRY" : "SOURCE OFFLINE"}</span>
            <span className="topbar-clock"><Icon name="clock" size={14} />{clock ? clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
            <span className="topbar-last-updated">{lastUpdated ? `Updated ${formatRelative(lastUpdated.toISOString())}` : "Waiting for sync"}</span>
            <IconButton name="refresh" label="Refresh live telemetry" className={refreshing ? "refresh-active" : ""} onClick={() => void refresh(true)} disabled={refreshing} />
            <button type="button" className="button button-top-audit" onClick={() => { navigate("web-audit"); void runAudit(); }} disabled={auditing}><Icon name="eye" size={15} />{auditing ? "Auditing…" : "Run audit"}</button>
            <button type="button" className={`topbar-owner-button${authenticated ? " topbar-owner-active" : ""}`} onClick={() => { setAccessError(null); setShowAccessModal(true); }}><Icon name={authenticated ? "shieldCheck" : "lock"} size={15} /><span>{authenticated ? "Owner" : "Access"}</span></button>
          </div>
        </header>
        <main className="content-area">
          {loadError && data ? <div className="notice-banner notice-warning"><Icon name="alert" size={16} /><span>{loadError}</span><button type="button" onClick={() => void refresh(true)}>Retry</button></div> : null}
          {data ? renderPage() : loading ? <LoadingState message="Checking the MCP tower, public Studio frontend, and PostgreSQL audit store." /> : <div className="load-failed panel"><span className="load-failed-icon"><Icon name="alert" size={22} /></span><h1>Control tower unavailable</h1><p>{loadError || "The live dashboard could not start."}</p><button type="button" className="button button-primary" onClick={() => void refresh(false)}><Icon name="refresh" size={15} /> Try again</button></div>}
        </main>
        <footer className="main-footer"><span><span className="footer-pulse" /> Control plane telemetry · refreshes every 60 seconds</span><span>{data?.system.checkedAt ? `Source timestamp ${formatDate(data.system.checkedAt)}` : "No source timestamp"}</span></footer>
      </div>

      {showAccessModal ? <AccessModal session={{ configured: session.configured || data?.adminAccessConfigured === true, authenticated }} token={accessToken} setToken={setAccessToken} error={accessError} busy={accessBusy} onSubmit={(event) => void submitAccess(event)} onClose={() => { setShowAccessModal(false); setAccessError(null); setAccessToken(""); }} onSignOut={() => void signOut()} /> : null}
      {selectedService ? <ServiceModal service={selectedService} onClose={() => setSelectedServiceId(null)} /> : null}
      {pendingIssue ? <ClaimModal issue={pendingIssue} busy={claimingIssue === pendingIssue.number} onConfirm={() => void confirmClaim()} onClose={() => setPendingIssue(null)} /> : null}
      {notice ? <div className={`toast toast-${notice.tone}`} role="status"><span className="toast-icon"><Icon name={notice.tone === "success" ? "check" : notice.tone === "warning" ? "alert" : "close"} size={16} /></span><div><strong>{notice.title}</strong><span>{notice.detail}</span></div><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" size={14} /></button></div> : null}
    </div>
  );
}
