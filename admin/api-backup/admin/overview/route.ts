import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { adminAuditEvents } from "@/db/schema";
import { adminAuthConfigured, hasAdminSession } from "@/lib/admin-security";
import { callMcpTools, mcpHealthEndpoint, STUDIO_URL, type ToolOutcome } from "@/lib/mcp-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown, fallback = "", maxLength = 240): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || fallback;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function status(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (["healthy", "degraded", "unreachable", "unconfigured", "unknown", "stale"].includes(normalized)) {
    return normalized;
  }
  if (["down", "offline", "failed", "error"].includes(normalized)) return "unreachable";
  return "unknown";
}

function valueOf(outcomes: Record<string, ToolOutcome> | null, key: string): unknown {
  const outcome = outcomes?.[key];
  return outcome?.ok ? outcome.value : null;
}

function safeGithubUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function readTowerHealth() {
  try {
    const response = await fetch(mcpHealthEndpoint(), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const raw = record(await response.json());
    const counts = record(raw.services);
    return {
      status: status(raw.status),
      server: text(raw.server, "SupremeAI Control Tower", 80),
      version: text(raw.version, "", 40),
      services: {
        healthy: numeric(counts.healthy),
        degraded: numeric(counts.degraded),
        total: numeric(counts.total),
      },
      lastCompletedSweepAt: text(raw.lastCompletedSweepAt, "", 60) || null,
      stale: typeof raw.stale === "boolean" ? raw.stale : null,
    };
  } catch {
    return null;
  }
}

async function probeStudio() {
  const startedAt = Date.now();
  try {
    const response = await fetch(STUDIO_URL, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const csp = response.headers.get("content-security-policy") || "";
    return {
      url: STUDIO_URL,
      reachable: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      securityHeaders: {
        hsts: Boolean(response.headers.get("strict-transport-security")),
        csp: Boolean(csp),
        cspUnsafeInline: /'unsafe-inline'/i.test(csp),
        cspUnsafeEval: /'unsafe-eval'/i.test(csp),
        frameOptions: Boolean(response.headers.get("x-frame-options")),
        contentTypeOptions: Boolean(response.headers.get("x-content-type-options")),
      },
    };
  } catch {
    return {
      url: STUDIO_URL,
      reachable: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      securityHeaders: { hsts: false, csp: false, cspUnsafeInline: false, cspUnsafeEval: false, frameOptions: false, contentTypeOptions: false },
    };
  }
}

function buildServices(healthValue: unknown, summaryValue: unknown) {
  const health = record(healthValue);
  const summary = record(summaryValue);
  const providerById = new Map<string, { provider: string; role: string }>();
  const byProvider = record(summary.byProvider);

  for (const [providerName, services] of Object.entries(byProvider)) {
    if (!Array.isArray(services)) continue;
    for (const item of services) {
      const service = record(item);
      const id = text(service.id);
      if (id) providerById.set(id, { provider: providerName, role: text(service.role, "service", 80) });
    }
  }

  const rawServices = Array.isArray(health.services) ? health.services : [];
  return rawServices
    .map((item) => {
      const service = record(item);
      const id = text(service.id, "unknown", 100);
      const metadata = providerById.get(id);
      return {
        id,
        displayName: text(service.displayName, id, 120),
        provider: metadata?.provider || id.split("-")[0] || "unknown",
        role: metadata?.role || "service",
        status: status(service.status ?? (service.available === true ? "healthy" : "unknown")),
        latencyMs: numeric(service.latencyMs),
        deployStatus: text(service.deployStatus, "", 50) || null,
        monthlyBuildMinutes: numeric(service.monthlyBuildMinutes),
        freeLimitRemainingMinutes: numeric(service.freeLimitRemainingMinutes),
        freeLimitExhausted: typeof service.freeLimitExhausted === "boolean" ? service.freeLimitExhausted : null,
      };
    })
    .slice(0, 80);
}

function buildAgents(agentValue: unknown) {
  const available = agentValue !== null && agentValue !== undefined;
  const raw = record(agentValue);
  const rawCounts = record(raw.counts);
  const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
  const agents = rawAgents.slice(0, 40).map((item, index) => {
    const agent = record(item);
    const name = text(agent.clientName, `Assistant ${index + 1}`, 100).replace(/\s*\([a-f0-9]{6,}\)\s*$/i, "");
    return {
      name: name || `Assistant ${index + 1}`,
      kind: text(agent.kind, "assistant", 60),
      state: ["online", "stale", "expired", "offline"].includes(String(agent.state)) ? String(agent.state) : "unknown",
      ageSeconds: numeric(agent.ageSeconds),
      updatedAt: text(agent.updatedAt, "", 60) || null,
    };
  });
  const count = (key: string, fallback: number) => numeric(rawCounts[key]) ?? fallback;
  return {
    available,
    total: count("total", agents.length),
    autonomousBuilders: count("autonomousBuilders", 0),
    interactiveAssistants: count("interactiveAssistants", agents.length),
    onlineAutonomous: count("onlineAutonomous", agents.filter((agent) => agent.kind === "autonomous_builder" && agent.state === "online").length),
    onlineInteractive: count("onlineInteractive", agents.filter((agent) => agent.kind !== "autonomous_builder" && agent.state === "online").length),
    agents,
  };
}

function buildBridgeQueue(queueValue: unknown) {
  const available = queueValue !== null && queueValue !== undefined;
  const queue = record(queueValue);
  const rawIssues = Array.isArray(queue.workOrders) ? queue.workOrders : [];
  return {
    available,
    repo: text(queue.repo, "Bridge work queue", 100),
    totalOpen: numeric(queue.totalOpen) ?? numeric(queue.count) ?? 0,
    count: numeric(queue.count) ?? rawIssues.length,
    windowTruncated: queue.windowTruncated === true,
    issues: rawIssues.slice(0, 30).map((item) => {
      const issue = record(item);
      return {
        number: numeric(issue.number),
        title: text(issue.title, "Untitled work order", 240),
        state: text(issue.state, "open", 30),
        updatedAt: text(issue.updatedAt, "", 60) || null,
        createdAt: text(issue.createdAt, "", 60) || null,
        labels: (Array.isArray(issue.labels) ? issue.labels : []).filter((label): label is string => typeof label === "string").slice(0, 8).map((label) => label.slice(0, 64)),
        comments: numeric(issue.comments) ?? 0,
        url: safeGithubUrl(issue.url),
      };
    }),
  };
}

function buildProviderDiagnostics(value: unknown) {
  const outer = record(value);
  const live = record(outer.health_live);
  const snapshots = record(live.snapshots);
  const providers = Object.entries(snapshots).map(([name, rawSnapshot]) => {
    const snapshot = record(rawSnapshot);
    const data = record(snapshot.data);
    const checkedAt = text(snapshot.checkedAt, "", 60) || null;
    const lastCheckMs = numeric(snapshot.lastCheckMs) ?? (checkedAt ? Date.parse(checkedAt) : null);
    const ageSeconds = lastCheckMs === null ? null : Math.max(0, Math.floor((Date.now() - lastCheckMs) / 1000));
    const lastStatus = status(snapshot.status);
    const currentStatus = lastStatus === "healthy" && ageSeconds !== null && ageSeconds > 900 ? "stale" : lastStatus;
    const impactedServices = (Array.isArray(snapshot.impactedServices) ? snapshot.impactedServices : [])
      .filter((service): service is string => typeof service === "string")
      .slice(0, 8)
      .map((service) => service.slice(0, 80));
    const metrics: string[] = [];
    let warning: string | null = null;
    let httpStatus: number | null = null;

    if (name === "redis") {
      const activeAccount = text(data.activePrimary ?? data.account, "unknown", 32);
      const chainStatus = Array.isArray(data.chainStatus) ? data.chainStatus.map(record) : [];
      const primary = chainStatus.find((account) => text(account.label) === "primary");
      metrics.push(`Serving from ${activeAccount}`);
      const primaryUsage = record(primary?.usage);
      const estimatedCommands = numeric(primaryUsage.estimatedCommands);
      const commandLimit = numeric(primaryUsage.limit);
      if (estimatedCommands !== null && commandLimit !== null) {
        metrics.push(`Primary ${estimatedCommands.toLocaleString("en-US")}/${commandLimit.toLocaleString("en-US")} commands`);
      }
      if (numeric(data.chainSize) !== null) metrics.push(`${numeric(data.chainSize)} active chain member(s)`);
      if (primaryUsage.softThresholdHit === true) {
        warning = `Primary account reached its ${numeric(primaryUsage.softThreshold)?.toLocaleString("en-US") || "configured"} command soft threshold; traffic is using ${activeAccount}.`;
      }
    } else if (name === "cloudflare") {
      httpStatus = numeric(data.httpStatus);
      if (httpStatus !== null) metrics.push(`Worker HTTP ${httpStatus}`);
      if (currentStatus === "degraded" || currentStatus === "unreachable") {
        warning = `Provider probe ${currentStatus}${httpStatus === null ? "" : ` · HTTP ${httpStatus}`}${numeric(snapshot.consecutiveFailures) ? ` · ${numeric(snapshot.consecutiveFailures)} consecutive failures` : ""}.`;
      }
    } else if (name === "github") {
      const repository = text(data.repository, "", 100);
      if (repository) metrics.push(repository);
      if (numeric(data.openIssuesCount) !== null) metrics.push(`${numeric(data.openIssuesCount)} open issues`);
      const branch = text(data.defaultBranch, "", 40);
      if (branch) metrics.push(`Default branch ${branch}`);
    } else if (name === "render") {
      const used = numeric(data.monthlyBuildMinutes);
      const remaining = numeric(data.freeLimitRemaining);
      const limit = numeric(data.freeLimitLimit);
      if (used !== null && limit !== null) metrics.push(`${used.toFixed(1)}/${limit.toFixed(1)} build minutes`);
      if (remaining !== null) metrics.push(`${remaining.toFixed(1)} minutes remaining`);
      const deploy = text(data.lastDeployStatus, "", 40);
      if (deploy) metrics.push(`Deploy ${deploy}`);
    } else {
      if (numeric(data.poolSize) !== null) metrics.push(`Pool size ${numeric(data.poolSize)}`);
      if (numeric(data.latestDeployments) !== null) metrics.push(`${numeric(data.latestDeployments)} latest deployment(s)`);
    }

    if (!warning && currentStatus === "stale") {
      warning = `Last reported healthy ${ageSeconds === null ? "" : `${Math.floor(ageSeconds / 60)} minutes ago`}; this provider has not been freshly confirmed.`;
    } else if (!warning && currentStatus === "degraded") {
      warning = `Provider returned a degraded health state${numeric(snapshot.consecutiveFailures) ? ` for ${numeric(snapshot.consecutiveFailures)} consecutive checks` : ""}.`;
    } else if (!warning && currentStatus === "unreachable") {
      warning = "The provider did not respond to the latest recorded probe.";
    }

    return {
      name: name.slice(0, 80),
      status: currentStatus,
      lastStatus,
      latencyMs: numeric(snapshot.latencyMs),
      checkedAt,
      ageSeconds,
      consecutiveFailures: numeric(snapshot.consecutiveFailures) ?? 0,
      impactedServices,
      metrics: metrics.slice(0, 4),
      warning,
      httpStatus,
    };
  });
  const counts = providers.reduce(
    (result, provider) => {
      result[provider.status] = (result[provider.status] || 0) + 1;
      return result;
    },
    { healthy: 0, degraded: 0, unreachable: 0, stale: 0, unconfigured: 0, unknown: 0 } as Record<string, number>,
  );

  return {
    available: value !== null && value !== undefined,
    observedAt: text(live.timestamp, text(outer.timestamp, "", 60), 60) || null,
    durationMs: numeric(live.durationMs),
    incidentCount: Array.isArray(live.incidents) ? live.incidents.length : 0,
    counts,
    total: providers.length,
    providers: providers.slice(0, 60),
  };
}

export async function GET(request: NextRequest) {
  const [tower, studio, outcomes] = await Promise.all([
    readTowerHealth(),
    probeStudio(),
    callMcpTools([
      { key: "health", name: "system_health", arguments: {} },
      { key: "summary", name: "system_summary", arguments: {} },
      { key: "agents", name: "agent_status", arguments: {} },
      { key: "bridge", name: "bridge_work_queue", arguments: { limit: 20 } },
      { key: "healthLive", name: "status", arguments: { scope: "health_live" } },
    ]).catch((): null => null),
  ]);

  const healthValue = valueOf(outcomes, "health");
  const services = buildServices(healthValue, valueOf(outcomes, "summary"));
  const counts = services.reduce(
    (total, service) => {
      total[service.status] = (total[service.status] || 0) + 1;
      return total;
    },
    { healthy: 0, degraded: 0, unreachable: 0, unconfigured: 0, unknown: 0, stale: 0 } as Record<string, number>,
  );

  let auditLog: Array<{
    id: number;
    actor: string;
    action: string;
    target: string;
    outcome: string;
    summary: string;
    createdAt: string;
  }> = [];
  let auditStorageAvailable = true;
  try {
    const rows = await db
      .select({
        id: adminAuditEvents.id,
        actor: adminAuditEvents.actor,
        action: adminAuditEvents.action,
        target: adminAuditEvents.target,
        outcome: adminAuditEvents.outcome,
        summary: adminAuditEvents.summary,
        createdAt: adminAuditEvents.createdAt,
      })
      .from(adminAuditEvents)
      .orderBy(desc(adminAuditEvents.createdAt))
      .limit(24);
    auditLog = (rows as any[]).map((row: any) => ({ ...row, createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString() }));
  } catch {
    auditStorageAvailable = false;
  }

  const health = record(healthValue);
  const response = NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      adminAccessConfigured: adminAuthConfigured(),
      authenticated: hasAdminSession(request),
      mcpConnected: Boolean(outcomes?.health?.ok),
      system: {
        available: Boolean(outcomes?.health?.ok),
        summary: text(health.summary, "Live service health has not been received.", 180),
        checkedAt: text(health.timestamp, "", 60) || null,
        counts,
        total: services.length,
      },
      tower,
      studio,
      services,
      agentFleet: buildAgents(valueOf(outcomes, "agents")),
      providerDiagnostics: buildProviderDiagnostics(valueOf(outcomes, "healthLive")),
      bridge: buildBridgeQueue(valueOf(outcomes, "bridge")), 
      auditLog,
      auditStorageAvailable,
      sources: {
        towerHealth: tower !== null,
        studioHttp: studio.reachable,
        mcpTools: Boolean(outcomes?.health?.ok),
        providerDiagnostics: Boolean(outcomes?.healthLive?.ok),
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
  return response;
}
