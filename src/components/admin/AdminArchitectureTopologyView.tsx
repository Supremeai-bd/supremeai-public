import React, { useEffect, useState, useMemo } from 'react';
import { env } from '../../config/env';
import { useI18n } from '../../utils/i18n';
import { DataSourceBadge } from '../common/DataSourceBadge';
import { useDataSource } from '../../hooks/useDataSource';
import { VisualQueueConveyor } from './VisualQueueConveyor';
import { ProviderRadar } from './ProviderRadar';
import {
  Server,
  FolderGit2,
  Network,
  AlertOctagon,
  RefreshCw,
  Layers,
  FileCode2,
  X,
} from 'lucide-react';

export type TopologyViewMode = 'render-mesh' | 'full-ecosystem' | 'codebase-matrix';

export interface ServiceNodeDef {
  id: string;
  name: string;
  platform:
    | 'Render'
    | 'Supabase'
    | 'Upstash'
    | 'Kaggle'
    | 'Cloudflare'
    | 'Infisical'
    | 'Telegram'
    | 'GitHub';
  renderName?: string;
  role: string;
  codebasePath: string;
  port: number | string;
  healthPath: string;
  category: 'render' | 'storage' | 'compute' | 'ai' | 'security' | 'edge' | 'telemetry';
  icon: string;
  x: number;
  y: number;
  blastRadius: string;
}

export interface NodeHealth {
  id: string;
  name: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  message?: string;
  response_time_ms?: number;
  lastChecked?: number;
  statusCode?: number;
}

// 7 Render Microservices SSOT (from config/service_registry.yaml & render.yaml)
export const RENDER_7_SERVICES: ServiceNodeDef[] = [
  {
    id: 'render-api',
    name: 'supremeai-api',
    platform: 'Render',
    renderName: 'supremeai-api',
    role: 'Public API Gateway, Auth Shield & Multi-LLM Arbiter',
    codebasePath: 'gateway/',
    port: 8787,
    healthPath: '/healthz',
    category: 'render',
    icon: '🛡️',
    x: 350,
    y: 70,
    blastRadius: 'Tier 0 — Entire external API traffic stops',
  },
  {
    id: 'render-browser',
    name: 'supremeai-browser',
    platform: 'Render',
    renderName: 'supremeai-browser',
    role: 'Headless Scraper & Priority-1 Stealth Webhook Relay',
    codebasePath: 'browser/',
    port: 8000,
    healthPath: '/health',
    category: 'render',
    icon: '🤖',
    x: 90,
    y: 190,
    blastRadius: 'Tier 2 — Web scraping & external DOM automation fails',
  },
  {
    id: 'render-mcp',
    name: 'supremeai-mcp-tower',
    platform: 'Render',
    renderName: 'supremeai-mcp-tower',
    role: 'MCP Control Tower & Agent Federation Hub',
    codebasePath: 'infrastructure/mcp-control-plane/',
    port: 8000,
    healthPath: '/health',
    category: 'render',
    icon: '🗼',
    x: 610,
    y: 190,
    blastRadius: 'Tier 1 — Tool discovery & multi-agent MCP sync fails',
  },
  {
    id: 'render-core',
    name: 'supremeai-core',
    platform: 'Render',
    renderName: 'supremeai-primary-node-5xso',
    role: 'Primary Decision Runtime, Consensus & Scheduling',
    codebasePath: 'core/',
    port: 8080,
    healthPath: '/health',
    category: 'render',
    icon: '🧠',
    x: 350,
    y: 210,
    blastRadius: 'Tier 0 — Autonomous loop decisions & task delegation halts',
  },
  {
    id: 'render-worker',
    name: 'supremeai-worker',
    platform: 'Render',
    renderName: 'supremeai-worker-node',
    role: 'Async Worker Queue Daemon & Background Job Dispatch',
    codebasePath: 'core/services/worker/',
    port: 8080,
    healthPath: '/health',
    category: 'render',
    icon: '⚙️',
    x: 140,
    y: 350,
    blastRadius: 'Tier 1 — Background queues & Kaggle dispatches stall',
  },
  {
    id: 'render-brain',
    name: 'supremeai-brain',
    platform: 'Render',
    renderName: 'supremeai-brain',
    role: 'Context Compiler, 3-Tier Memory Store & Model Arbiter',
    codebasePath: 'core/brain/',
    port: 8080,
    healthPath: '/health',
    category: 'render',
    icon: '🧩',
    x: 560,
    y: 350,
    blastRadius: 'Tier 2 — Long-term recall falls back to stateless mode',
  },
  {
    id: 'render-runner',
    name: 'supremeai-runner',
    platform: 'Render',
    renderName: 'supremeai-runner',
    role: 'Sandboxed Code Evaluator & CI Canary Runner',
    codebasePath: 'infrastructure/',
    port: 8000,
    healthPath: '/health',
    category: 'render',
    icon: '🏗️',
    x: 350,
    y: 430,
    blastRadius: 'Tier 2 — Sandbox code execution reverts to local mock',
  },
];

export const RENDER_EDGES: [string, string][] = [
  ['render-api', 'render-browser'],
  ['render-api', 'render-core'],
  ['render-api', 'render-mcp'],
  ['render-core', 'render-worker'],
  ['render-core', 'render-brain'],
  ['render-core', 'render-runner'],
  ['render-mcp', 'render-core'],
  ['render-mcp', 'render-api'],
];

// Full Ecosystem Nodes: Render, Database (Supabase), Redis (Upstash), Kaggle GPU, Infisical, Cloudflare, AI Squad, Telegram
export const ECOSYSTEM_NODES: ServiceNodeDef[] = [
  // Tier 1: Client Edge & Ingestion
  {
    id: 'eco-studio',
    name: 'Studio UI',
    platform: 'Cloudflare',
    role: 'Zero-Admin Web Workspace, 3D Avatar & AI Studio Cockpit',
    codebasePath: 'src/ (Monorepo SSOT · supremeai-public)',
    port: 'HTTPS Edge',
    healthPath: '/',
    category: 'edge',
    icon: '🌐',
    x: 80,
    y: 40,
    blastRadius: 'Tier 0 — Web user interface unavailable',
  },
  {
    id: 'eco-telegram',
    name: 'Telegram Bot',
    platform: 'Telegram',
    role: 'Omnichannel Incident Alerts, HITL Approval & Remote Commands',
    codebasePath: 'gateway/service/telegram_webhook.py',
    port: 'Webhook SSL',
    healthPath: '/api/admin/control-plane/telegram-dispatch',
    category: 'telemetry',
    icon: '📱',
    x: 420,
    y: 40,
    blastRadius: 'Tier 3 — Mobile push notifications & remote telegram HITL fails',
  },
  {
    id: 'eco-github',
    name: 'GitHub CI/CD',
    platform: 'GitHub',
    role: 'Unified CI/CD Pipeline, Canary Preflights & Multi-Service Gates',
    codebasePath: '.github/workflows/',
    port: 'Actions Runner',
    healthPath: '/api/admin/control-plane/release-gate',
    category: 'telemetry',
    icon: '🐙',
    x: 760,
    y: 40,
    blastRadius: 'Tier 2 — Automated test suites & auto-deploy blocked',
  },

  // Tier 2: Gateways & Control Plane
  {
    id: 'eco-gateway',
    name: 'API Gateway',
    platform: 'Render',
    renderName: 'supremeai-api',
    role: 'Public Edge Gateway, Passkey Auth, Rate Limiting & Multi-LLM Arbiter',
    codebasePath: 'gateway/',
    port: 8787,
    healthPath: '/healthz',
    category: 'render',
    icon: '🛡️',
    x: 240,
    y: 155,
    blastRadius: 'Tier 0 — Entire external system communication drops',
  },
  {
    id: 'eco-mcp',
    name: 'MCP Tower',
    platform: 'Render',
    renderName: 'supremeai-mcp-tower',
    role: 'MCP Server Federation, Tool Orchestration & Dynamic Sandboxing',
    codebasePath: 'infrastructure/mcp-control-plane/',
    port: 8000,
    healthPath: '/api/mcp-tower/services',
    category: 'render',
    icon: '🗼',
    x: 600,
    y: 155,
    blastRadius: 'Tier 1 — MCP tools, browser automation tools & agents disconnect',
  },

  // Tier 3: Core Decision Engine & Worker Mesh
  {
    id: 'eco-browser',
    name: 'Playwright Scraper',
    platform: 'Render',
    renderName: 'supremeai-browser',
    role: 'Headless Chrome Cluster & Priority-1 Stealth Webhook Relay',
    codebasePath: 'browser/',
    port: 8000,
    healthPath: '/health',
    category: 'render',
    icon: '🤖',
    x: 50,
    y: 275,
    blastRadius: 'Tier 2 — Web scraping, live web browsing & DOM testing offline',
  },
  {
    id: 'eco-core',
    name: 'Decision Core',
    platform: 'Render',
    renderName: 'supremeai-primary-node-5xso',
    role: 'Primary Decision Runtime, Multi-Agent Consensus & Task Execution',
    codebasePath: 'core/',
    port: 8080,
    healthPath: '/health',
    category: 'render',
    icon: '🧠',
    x: 280,
    y: 275,
    blastRadius: 'Tier 0 — Autonomous loop halts; agents stop taking actions',
  },
  {
    id: 'eco-worker',
    name: 'Worker Node',
    platform: 'Render',
    renderName: 'supremeai-worker-node',
    role: 'Async Worker Daemon, Background Queue & Kaggle Dispatcher',
    codebasePath: 'core/services/worker/',
    port: 8080,
    healthPath: '/health',
    category: 'render',
    icon: '⚙️',
    x: 510,
    y: 275,
    blastRadius: 'Tier 1 — Background jobs, batch compute & queue tasks queue up',
  },
  {
    id: 'eco-brain',
    name: 'Context Brain',
    platform: 'Render',
    renderName: 'supremeai-brain',
    role: 'Context Compiler, 3-Tier Episodic Memory & Semantic Search',
    codebasePath: 'core/brain/',
    port: 8080,
    healthPath: '/health',
    category: 'render',
    icon: '🧩',
    x: 740,
    y: 275,
    blastRadius: 'Tier 2 — Cognitive long-term memory degraded to stateless mode',
  },

  // Tier 4: Compute Acceleration & AI Model Squad
  {
    id: 'eco-kaggle',
    name: 'Kaggle GPU Cluster',
    platform: 'Kaggle',
    role: 'Heavy Compute Offloading: 6 Accounts, 180 hrs/wk T4/P100 GPUs (LoRA, Batch, Embeddings)',
    codebasePath: 'core/kaggle_orchestrator.py',
    port: 'Kaggle API',
    healthPath: '/api/admin/control-plane/kaggle-dispatch',
    category: 'compute',
    icon: '⚡',
    x: 110,
    y: 395,
    blastRadius: 'Tier 2 — Heavy GPU tasks fall back to local CPU or cloud APIs',
  },
  {
    id: 'eco-runner',
    name: 'Sandboxed Runner',
    platform: 'Render',
    renderName: 'supremeai-runner',
    role: 'Isolated Code Execution, Preflight Checks & Ephemeral Sandboxes',
    codebasePath: 'infrastructure/',
    port: 8000,
    healthPath: '/health',
    category: 'render',
    icon: '🏗️',
    x: 420,
    y: 395,
    blastRadius: 'Tier 2 — Sandboxed untrusted code execution blocked',
  },
  {
    id: 'eco-providers',
    name: 'Multi-Key AI Squad',
    platform: 'Render',
    role: 'Adaptive Multi-LLM Arbiter: Gemini 2.5, OpenAI GPT-4o, Claude 3.7, Groq LPU, DeepSeek',
    codebasePath: 'gateway/service/providers/',
    port: 'Multi-Cloud',
    healthPath: '/api/platform/config',
    category: 'ai',
    icon: '🔮',
    x: 730,
    y: 395,
    blastRadius: 'Tier 0 — AI inference unavailable if all provider keys fail',
  },

  // Tier 5: Persistence, Cache & Zero-Trust Secrets
  {
    id: 'eco-redis',
    name: 'Upstash Redis Cluster',
    platform: 'Upstash',
    role: '5-Account Tiered Distributed REST Cache, Token Bucket Rate Limiting & Queue State',
    codebasePath: 'infrastructure/redis/',
    port: 'REST 6379',
    healthPath: '/health',
    category: 'storage',
    icon: '⚡',
    x: 110,
    y: 515,
    blastRadius: 'Tier 1 — Rate limiting & fast caching falls back to in-memory store',
  },
  {
    id: 'eco-supabase',
    name: 'Supabase Postgres & pgvector',
    platform: 'Supabase',
    role: 'Primary Persistent Database, RLS Security Policies, Vector Embeddings & Migrations',
    codebasePath: 'core/database/',
    port: 'Postgres 5432',
    healthPath: '/health',
    category: 'storage',
    icon: '🗄️',
    x: 420,
    y: 515,
    blastRadius: 'Tier 0 — Persistent data reads, writes, auth & vector search fail',
  },
  {
    id: 'eco-infisical',
    name: 'Infisical Secret Vault',
    platform: 'Infisical',
    role: 'Zero-Trust E2EE Project Secrets, Auto-Sync & Dynamic Token Rotation',
    codebasePath: 'config/infisical/',
    port: 'E2EE Vault',
    healthPath: '/api/admin/infisical/sync',
    category: 'security',
    icon: '🔐',
    x: 730,
    y: 515,
    blastRadius: 'Tier 1 — Dynamic secret hydration fails; uses cached env tokens',
  },
];

export const ECOSYSTEM_EDGES: [string, string][] = [
  // Edge tier to Gateway
  ['eco-studio', 'eco-gateway'],
  ['eco-telegram', 'eco-gateway'],
  ['eco-github', 'eco-runner'],

  // Gateway to Hub & Core
  ['eco-gateway', 'eco-mcp'],
  ['eco-gateway', 'eco-core'],
  ['eco-gateway', 'eco-redis'],
  ['eco-gateway', 'eco-providers'],

  // MCP Tower Federation
  ['eco-mcp', 'eco-core'],
  ['eco-mcp', 'eco-supabase'],

  // Core Decision Mesh
  ['eco-core', 'eco-browser'],
  ['eco-core', 'eco-worker'],
  ['eco-core', 'eco-brain'],
  ['eco-core', 'eco-supabase'],

  // Worker & Compute Offloading (Kaggle & Runner)
  ['eco-worker', 'eco-kaggle'],
  ['eco-worker', 'eco-runner'],

  // Memory & Cache Wiring
  ['eco-brain', 'eco-redis'],
  ['eco-brain', 'eco-supabase'],

  // Secret Hydration
  ['eco-gateway', 'eco-infisical'],
  ['eco-core', 'eco-infisical'],
];

const STATUS_COLOR: Record<string, string> = {
  healthy: '#22c55e',
  warning: '#eab308',
  error: '#ef4444',
  unknown: '#64748b',
};

export const AdminArchitectureTopologyView: React.FC = () => {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<TopologyViewMode>('full-ecosystem');
  const [healthMap, setHealthMap] = useState<Record<string, NodeHealth>>({});
  // বাংলা মন্তব্য: প্রোব-ফলাফলের সারসংক্ষেপ — ব্যাজ এটাই দেখায় (মিথ্যা "Live" নয়)।
  const [probeMeta, setProbeMeta] = useState<{ at?: number; error?: string; okCount?: number }>(
    {}
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [lastProbeTime, setLastProbeTime] = useState<number>(Date.now());
  const [simulatedFailureIds, setSimulatedFailureIds] = useState<Set<string>>(new Set());

  // বাংলা মন্তব্য: টপোলজির হেলথ আসলে রিয়েল প্রোব (gateway /api/health + MCP endpoint)
  // থেকে আসে — তাই ব্যাজও প্রোব-ফলাফলের উপর ভিত্তি করে, লেবেল থেকে নয়।
  const dataSource = useDataSource({
    loaded: Boolean(probeMeta.at),
    lastUpdatedMs: probeMeta.at,
    error: probeMeta.error ?? null,
    demoReason: 'টপোলজি প্রোব এখনো চলেনি।',
  });

  const probeAllServices = async () => {
    setIsProbing(true);
    const now = Date.now();
    setLastProbeTime(now);
    const next: Record<string, NodeHealth> = {};
    const base = env.apiBaseUrl || '';

    const token =
      typeof window !== 'undefined' ? localStorage.getItem('supremeai_access_token') : null;
    const adminToken =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem('supremeai_admin_token')
        : null;
    const authHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}`, 'X-SupremeAI-Key': token } : {}),
      ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
    };

    const safeFetchJson = async (path: string) => {
      const t0 = performance.now();
      const res = await fetch(`${base}${path}`, {
        headers: authHeaders,
        credentials: 'same-origin',
      }).catch(() => fetch(path, { headers: authHeaders, credentials: 'same-origin' }));
      const ms = Math.round(performance.now() - t0);
      const body = res?.ok ? await res.json().catch(() => null) : null;
      return { res, ms, body };
    };

    // 1. Probe Gateway / API self
    try {
      const { res, ms } = await safeFetchJson('/api/health');
      const isOk = Boolean(res && res.ok);
      next['render-api'] = {
        id: 'render-api',
        name: 'supremeai-api',
        status: isOk ? 'healthy' : 'error',
        message: isOk
          ? '200 OK — Gateway & Auth Shield Active'
          : `HTTP ${res?.status || 500} Error`,
        response_time_ms: ms,
        statusCode: res?.status || 500,
        lastChecked: now,
      };
      next['eco-gateway'] = next['render-api'];
    } catch (err: unknown) {
      next['render-api'] = {
        id: 'render-api',
        name: 'supremeai-api',
        status: 'error',
        message: err instanceof Error ? err.message : 'Connection refused to gateway',
        statusCode: 0,
        lastChecked: now,
      };
      next['eco-gateway'] = next['render-api'];
    }

    // 2. Probe MCP Tower Services endpoint
    try {
      const { res, ms, body } = await safeFetchJson('/api/mcp-tower/services');
      const isOk = Boolean(res && res.ok);
      next['render-mcp'] = {
        id: 'render-mcp',
        name: 'supremeai-mcp-tower',
        status: isOk ? 'healthy' : 'error',
        message: isOk
          ? `200 OK — ${Array.isArray(body?.services) ? body.services.length : 0} MCP services reported`
          : `HTTP ${res?.status || 500}`,
        response_time_ms: ms,
        statusCode: res?.status || 500,
        lastChecked: now,
      };
      next['eco-mcp'] = next['render-mcp'];

      if (isOk && Array.isArray(body?.services)) {
        for (const svc of body.services) {
          const svcId = String(svc?.id || svc?.name || '').toLowerCase();
          const mappedStatus: NodeHealth['status'] =
            svc?.status === 'healthy'
              ? 'healthy'
              : svc?.status === 'degraded' || svc?.status === 'rebooting'
                ? 'warning'
                : svc?.status === 'unhealthy'
                  ? 'error'
                  : 'unknown';
          const entry: NodeHealth = {
            id: svcId,
            name: String(svc?.displayName || svc?.name || svcId),
            status: mappedStatus,
            message: `MCP Tower status: ${svc?.status || 'unknown'}`,
            response_time_ms: typeof svc?.latencyMs === 'number' ? svc.latencyMs : undefined,
            lastChecked: now,
          };
          if (svcId.includes('browser')) {
            next['render-browser'] = entry;
            next['eco-browser'] = entry;
          } else if (svcId.includes('core') || svcId.includes('primary')) {
            next['render-core'] = entry;
            next['eco-core'] = entry;
          } else if (svcId.includes('worker')) {
            next['render-worker'] = entry;
            next['eco-worker'] = entry;
          } else if (svcId.includes('brain')) {
            next['render-brain'] = entry;
            next['eco-brain'] = entry;
          } else if (svcId.includes('runner')) {
            next['render-runner'] = entry;
            next['eco-runner'] = entry;
          }
        }
      }
    } catch (err: unknown) {
      next['render-mcp'] = {
        id: 'render-mcp',
        name: 'supremeai-mcp-tower',
        status: 'error',
        message: err instanceof Error ? err.message : 'MCP Tower unreachable',
        statusCode: 0,
        lastChecked: now,
      };
      next['eco-mcp'] = next['render-mcp'];
    }

    // 3. Probe Multi-Key AI Providers
    try {
      const { res, ms } = await safeFetchJson('/api/platform/config');
      const isOk = Boolean(res && res.ok);
      next['eco-providers'] = {
        id: 'eco-providers',
        name: 'AI Provider Squad',
        status: isOk ? 'healthy' : 'error',
        message: isOk
          ? '200 OK — Model policy & provider config active'
          : `HTTP ${res?.status || 500}`,
        response_time_ms: ms,
        statusCode: res?.status || 500,
        lastChecked: now,
      };
    } catch (err: unknown) {
      next['eco-providers'] = {
        id: 'eco-providers',
        name: 'AI Provider Squad',
        status: 'unknown',
        message: err instanceof Error ? err.message : 'Provider config probe unavailable',
        lastChecked: now,
      };
    }

    // 4. Probe Control-Plane Service Health Collector for downstream nodes
    try {
      const { res, body } = await safeFetchJson('/api/admin/control-plane/service-health');
      const liveServices: Array<{
        id?: string;
        name?: string;
        status?: string;
        latencyMs?: number;
      }> = Array.isArray(body?.snapshot?.services) ? body.snapshot.services : [];
      if (res?.ok && liveServices.length > 0) {
        for (const s of liveServices) {
          const key = String(s?.id || s?.name || '').toLowerCase();
          const st: NodeHealth['status'] =
            s?.status === 'healthy'
              ? 'healthy'
              : s?.status === 'degraded'
                ? 'warning'
                : s?.status === 'down'
                  ? 'error'
                  : 'unknown';
          const h: NodeHealth = {
            id: key,
            name: String(s?.name || key),
            status: st,
            message: s?.status ? `Live collector: ${s.status}` : 'Live collector active',
            response_time_ms: typeof s?.latencyMs === 'number' ? s.latencyMs : undefined,
            lastChecked: now,
          };
          if (key.includes('supabase')) next['eco-supabase'] = h;
          if (key.includes('redis') || key.includes('upstash')) next['eco-redis'] = h;
          if (key.includes('kaggle')) next['eco-kaggle'] = h;
          if (key.includes('telegram')) next['eco-telegram'] = h;
          if (key.includes('github')) next['eco-github'] = h;
          if (key.includes('browser') && !next['render-browser']) {
            next['render-browser'] = h;
            next['eco-browser'] = h;
          }
          if (key.includes('core') && !next['render-core']) {
            next['render-core'] = h;
            next['eco-core'] = h;
          }
          if (key.includes('worker') && !next['render-worker']) {
            next['render-worker'] = h;
            next['eco-worker'] = h;
          }
          if (key.includes('brain') && !next['render-brain']) {
            next['render-brain'] = h;
            next['eco-brain'] = h;
          }
          if (key.includes('runner') && !next['render-runner']) {
            next['render-runner'] = h;
            next['eco-runner'] = h;
          }
        }
      }
    } catch {
      // Leave unprobed nodes as unknown rather than fabricating healthy metrics
    }

    // 5. Probe Infisical Secret Vault
    try {
      const { res, ms, body } = await safeFetchJson('/api/admin/infisical/vault-keys');
      if (res?.ok) {
        next['eco-infisical'] = {
          id: 'eco-infisical',
          name: 'Infisical Secret Vault',
          status:
            (body?.healthyCount ?? 0) > 0 || (body?.totalKeys ?? 0) === 0 ? 'healthy' : 'warning',
          message: `${body?.healthyCount ?? 0}/${body?.totalKeys ?? 0} vault keys healthy`,
          response_time_ms:
            typeof body?.avgVaultLatencyMs === 'number' ? body.avgVaultLatencyMs : ms,
          statusCode: res.status,
          lastChecked: now,
        };
      }
    } catch {
      // Unprobed stays unknown
    }

    // 6. Studio UI client runtime (self)
    next['eco-studio'] = {
      id: 'eco-studio',
      name: 'Studio UI',
      status: 'healthy',
      message: 'Browser SPA Active',
      lastChecked: now,
    };

    // Ensure every defined node has an explicit honest state (unknown if no live collector reported it)
    for (const def of [...RENDER_7_SERVICES, ...ECOSYSTEM_NODES]) {
      if (!next[def.id]) {
        next[def.id] = {
          id: def.id,
          name: def.name,
          status: 'unknown',
          message: 'No direct health probe reported for this satellite yet.',
          lastChecked: now,
        };
      }
    }

    // Apply simulated fault overrides if user toggled test mode
    simulatedFailureIds.forEach((id) => {
      if (next[id]) {
        next[id] = {
          ...next[id],
          status: 'error',
          statusCode: 503,
          message: 'CRITICAL FAILURE: Simulated outage active',
        };
      }
    });

    setHealthMap(next);
    // বাংলা মন্তব্য: কয়টি নোড সত্যিই প্রোব সফল হয়েছে — সব ব্যর্থ হলে ব্যাজ DEGRADED।
    const okCount = Object.values(next).filter((h) => h.status === 'healthy').length;
    setProbeMeta({
      at: now,
      okCount,
      error: okCount === 0 ? 'সব প্রোব ব্যর্থ — কোনো নোডে পৌঁছানো যায়নি।' : undefined,
    });
    setIsProbing(false);
  };

  useEffect(() => {
    probeAllServices();
    const interval = setInterval(probeAllServices, 30000);
    return () => clearInterval(interval);
  }, [simulatedFailureIds]);

  const toggleSimulateFailure = (nodeId: string) => {
    setSimulatedFailureIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const activeNodes = useMemo(() => {
    return viewMode === 'render-mesh' ? RENDER_7_SERVICES : ECOSYSTEM_NODES;
  }, [viewMode]);

  const activeEdges = useMemo(() => {
    return viewMode === 'render-mesh' ? RENDER_EDGES : ECOSYSTEM_EDGES;
  }, [viewMode]);

  // Broken / Error Nodes Counter
  const brokenNodes = useMemo(() => {
    return Object.values(healthMap).filter(
      (h) => h.status === 'error' || (h.statusCode && h.statusCode >= 400)
    );
  }, [healthMap]);

  const warningNodes = useMemo(() => {
    return Object.values(healthMap).filter((h) => h.status === 'warning');
  }, [healthMap]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return (
      RENDER_7_SERVICES.find((n) => n.id === selectedNodeId) ||
      ECOSYSTEM_NODES.find((n) => n.id === selectedNodeId) ||
      null
    );
  }, [selectedNodeId]);

  const selectedHealth = selectedNodeId ? healthMap[selectedNodeId] : null;

  return (
    <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 text-slate-100 shadow-2xl space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Network className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              {t.topologyTitle}
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono font-normal">
                {typeof probeMeta.okCount === 'number'
                  ? `${probeMeta.okCount} probes OK`
                  : 'Live Probes'}
              </span>
              <DataSourceBadge
                source={dataSource.source}
                reason={dataSource.reason}
                ageMs={dataSource.ageMs}
              />
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Interactive dependency mapping across Render services, Supabase PostgreSQL, Upstash
            Redis, compute cluster, Infisical, and AI Squad.
          </p>
        </div>

        {/* View Switcher Tabs & Live Health Badge */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setViewMode('full-ecosystem')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'full-ecosystem'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Full Ecosystem</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('render-mesh')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'render-mesh'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>7 Render Mesh</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('codebase-matrix')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'codebase-matrix'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>Codebase Map</span>
            </button>
          </div>

          {/* Dynamic Status Counter Badge */}
          {brokenNodes.length > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 font-bold text-xs animate-pulse shadow-lg shadow-red-950/50">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              <span>🔴 {brokenNodes.length} Broken Services in Map</span>
            </div>
          ) : warningNodes.length > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-300 font-semibold text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>🟡 {warningNodes.length} Degraded</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-semibold text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span>🟢 All Systems Healthy</span>
            </div>
          )}

          <button
            type="button"
            onClick={probeAllServices}
            disabled={isProbing}
            className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-cyan-400 hover:border-slate-700 transition-colors cursor-pointer"
            title={t.liveProbeBtn}
          >
            <RefreshCw className={`w-4 h-4 ${isProbing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area: SVG Graph or Codebase Matrix */}
      {viewMode === 'codebase-matrix' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/80 text-slate-400 font-mono uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Service Name</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Codebase Domain</th>
                <th className="px-4 py-3">Port / Protocol</th>
                <th className="px-4 py-3">Blast Radius</th>
                <th className="px-4 py-3">Live Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {ECOSYSTEM_NODES.map((svc) => {
                const h = healthMap[svc.id];
                const isErr = h?.status === 'error';
                return (
                  <tr
                    key={svc.id}
                    onClick={() => setSelectedNodeId(svc.id)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-semibold text-white flex items-center gap-2 font-sans">
                      <span>{svc.icon}</span>
                      <span>{svc.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-sans text-[11px]">
                        {svc.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-cyan-400 flex items-center gap-1.5">
                      <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>{svc.codebasePath}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{svc.port}</td>
                    <td className="px-4 py-3 text-slate-400 font-sans text-[11px]">
                      {svc.blastRadius}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isErr
                            ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                            : h?.status === 'unknown' || !h?.status
                              ? 'bg-slate-800 text-slate-400 border border-slate-700'
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isErr
                              ? 'bg-red-500 animate-pulse'
                              : h?.status === 'unknown' || !h?.status
                                ? 'bg-slate-500'
                                : 'bg-emerald-400'
                          }`}
                        />
                        {h?.status || 'unknown'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative rounded-xl border border-slate-800/80 bg-slate-900/60 overflow-hidden">
          <svg
            viewBox={viewMode === 'render-mesh' ? '0 0 760 520' : '0 0 980 620'}
            className="w-full h-auto max-h-[620px] select-none block"
            style={{ background: 'radial-gradient(ellipse at center, #0d1527 0%, #080d1a 100%)' }}
          >
            {/* Background Grid Pattern */}
            <defs>
              <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" opacity="0.6" />

            {/* Connecting Dependency Edges */}
            {activeEdges.map(([sourceId, targetId], idx) => {
              const srcNode = activeNodes.find((n) => n.id === sourceId);
              const tgtNode = activeNodes.find((n) => n.id === targetId);
              if (!srcNode || !tgtNode) return null;

              const srcHealth = healthMap[sourceId];
              const tgtHealth = healthMap[targetId];
              const isBrokenEdge = srcHealth?.status === 'error' || tgtHealth?.status === 'error';

              const edgeColor = isBrokenEdge ? '#ef4444' : '#334155';
              const strokeWidth = isBrokenEdge ? 2.5 : 1.5;

              const xOffset = viewMode === 'render-mesh' ? 65 : 70;
              const yOffset = viewMode === 'render-mesh' ? 30 : 31;

              return (
                <g key={`edge-${idx}`}>
                  <line
                    x1={srcNode.x + xOffset}
                    y1={srcNode.y + yOffset}
                    x2={tgtNode.x + xOffset}
                    y2={tgtNode.y + yOffset}
                    stroke={edgeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={isBrokenEdge ? '4 3' : '6 4'}
                    opacity={isBrokenEdge ? 0.95 : 0.6}
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to={isBrokenEdge ? '-14' : '-20'}
                      dur={isBrokenEdge ? '0.7s' : '1.8s'}
                      repeatCount="indefinite"
                    />
                  </line>
                </g>
              );
            })}

            {/* Service Nodes */}
            {activeNodes.map((node) => {
              const h = healthMap[node.id];
              const status = h?.status || 'unknown';
              const isError = status === 'error';
              const isSelected = selectedNodeId === node.id;
              const color = STATUS_COLOR[status];

              const cardWidth = viewMode === 'render-mesh' ? 130 : 140;
              const cardHeight = viewMode === 'render-mesh' ? 60 : 62;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="cursor-pointer transition-transform hover:scale-[1.03]"
                >
                  {/* Glowing Pulse Ring when Broken / Error */}
                  {isError && (
                    <rect
                      x="-6"
                      y="-6"
                      width={cardWidth + 12}
                      height={cardHeight + 12}
                      rx="14"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="2.5"
                      opacity="0.6"
                      className="animate-ping"
                    />
                  )}

                  {/* Main Node Card */}
                  <rect
                    width={cardWidth}
                    height={cardHeight}
                    rx="10"
                    fill="#0f172a"
                    stroke={isSelected ? '#38bdf8' : color}
                    strokeWidth={isSelected ? 2.5 : isError ? 2.5 : 1.5}
                    style={{
                      filter: isError
                        ? 'drop-shadow(0 0 14px rgba(239, 68, 68, 0.8))'
                        : isSelected
                          ? 'drop-shadow(0 0 12px rgba(56, 189, 248, 0.5))'
                          : 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))',
                    }}
                  />

                  {/* Service Icon */}
                  <text x="14" y="24" fontSize="16">
                    {node.icon}
                  </text>

                  {/* Live Status Circle */}
                  <circle
                    cx={cardWidth - 14}
                    cy="14"
                    r="4.5"
                    fill={color}
                    className={isError ? 'animate-pulse' : ''}
                  />

                  {/* Service Title */}
                  <text
                    x="36"
                    y="24"
                    fontSize="11"
                    fontWeight="700"
                    fill="#f8fafc"
                    fontFamily="system-ui, sans-serif"
                  >
                    {node.name.length > 14 ? node.name.slice(0, 13) + '..' : node.name}
                  </text>

                  {/* Platform Tag */}
                  <text
                    x="14"
                    y="42"
                    fontSize="8.5"
                    fontFamily="monospace"
                    fill="#38bdf8"
                    fontWeight="600"
                  >
                    [{node.platform}]
                  </text>

                  {/* Codebase Folder / Port badge */}
                  <text
                    x="14"
                    y="54"
                    fontSize="9"
                    fontFamily="monospace"
                    fill={isError ? '#fca5a5' : '#94a3b8'}
                  >
                    {node.codebasePath.length > 19
                      ? node.codebasePath.slice(0, 17) + '..'
                      : node.codebasePath}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Quick Legend at bottom */}
          <div className="absolute bottom-2 left-3 flex flex-wrap items-center gap-4 text-[10px] text-slate-400 font-mono bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800/80">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Healthy (200 OK)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Degraded / Warning
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Broken
              (Offline/Error)
            </span>
            <span className="text-slate-500 hidden sm:inline">|</span>
            <span className="text-cyan-400">
              Click any service for deep diagnostic & fault simulation
            </span>
          </div>
        </div>
      )}

      {/* Slide-out Diagnostic Drawer when Node Selected */}
      {selectedNode && (
        <div className="fixed inset-y-0 right-0 w-84 sm:w-96 bg-slate-900 border-l border-slate-800 p-6 shadow-2xl z-50 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-5">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{selectedNode.icon}</span>
                <div>
                  <h3 className="font-bold text-base text-white">{selectedNode.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono border border-cyan-800/50">
                      {selectedNode.platform}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {selectedNode.renderName || selectedNode.id}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Health Status Banner */}
            <div
              className={`p-3 rounded-xl border flex items-center justify-between ${
                selectedHealth?.status === 'error'
                  ? 'bg-red-950/60 border-red-500/50 text-red-200'
                  : selectedHealth?.status === 'warning'
                    ? 'bg-amber-950/60 border-amber-500/50 text-amber-200'
                    : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
              }`}
            >
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider block opacity-75">
                  Live Probe State
                </span>
                <span className="text-sm font-bold capitalize flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      selectedHealth?.status === 'error'
                        ? 'bg-red-500 animate-ping'
                        : 'bg-emerald-400'
                    }`}
                  />
                  {selectedHealth?.status || 'unknown'}
                </span>
              </div>
              <span className="font-mono text-xs font-semibold px-2 py-1 rounded bg-black/40">
                {selectedHealth?.response_time_ms !== undefined
                  ? `${selectedHealth.response_time_ms}ms`
                  : '—'}
              </span>
            </div>

            {/* Details Table */}
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 font-mono uppercase text-[10px] block">
                  Service Role
                </span>
                <p className="text-slate-300 mt-0.5 leading-relaxed">{selectedNode.role}</p>
              </div>

              <div>
                <span className="text-slate-500 font-mono uppercase text-[10px] block">
                  Owning Codebase Domain
                </span>
                <p className="text-cyan-400 font-mono mt-0.5 flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5" />
                  <span>{selectedNode.codebasePath}</span>
                </p>
              </div>

              <div>
                <span className="text-slate-500 font-mono uppercase text-[10px] block">
                  Failure Blast Radius
                </span>
                <p className="text-amber-300/90 font-sans mt-0.5 text-[11px] bg-slate-950 p-2 rounded-lg border border-slate-800">
                  {selectedNode.blastRadius}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Port / Protocol</span>
                  <span className="font-mono text-white font-semibold">{selectedNode.port}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Health Path</span>
                  <span className="font-mono text-white font-semibold truncate block">
                    {selectedNode.healthPath}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-mono uppercase text-[10px] block">
                  Last Diagnostic Message
                </span>
                <p
                  className={`font-mono text-[11px] p-2 rounded-lg border mt-1 break-all ${
                    selectedHealth?.status === 'error'
                      ? 'bg-red-950/40 border-red-900/50 text-red-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  {selectedHealth?.message || 'Awaiting initial probe...'}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-2">
            <button
              type="button"
              onClick={probeAllServices}
              disabled={isProbing}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-950/50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
              <span>Probe This Service Again</span>
            </button>

            {/* Test Simulation Button */}
            <button
              type="button"
              onClick={() => toggleSimulateFailure(selectedNode.id)}
              className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                simulatedFailureIds.has(selectedNode.id)
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/60'
                  : 'bg-red-950/40 border-red-500/30 text-red-300 hover:bg-red-950/70'
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>
                {simulatedFailureIds.has(selectedNode.id)
                  ? 'Restore Service to Normal'
                  : 'Simulate Service Outage (Test Red Alert)'}
              </span>
            </button>

            <div className="text-[10px] text-slate-500 text-center font-mono">
              Auto-refreshes every 30s · Live Ecosystem Monitored
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 font-mono pt-1 gap-2">
        <span>Last probe: {new Date(lastProbeTime).toLocaleTimeString()}</span>
        <span>
          7 Render Services + Supabase, Upstash, Kaggle, Infisical, AI Squad, Telegram & GitHub
        </span>
      </div>

      {/* বাংলা মন্তব্য: আগে visual-cockpit ট্যাবে থাকা VisualQueueConveyor ও ProviderRadar
          এখন এখানে মেরামত করা হয়েছে — আলাদা ট্যাবের দরকার নেই */}
      <VisualQueueConveyor />
      <ProviderRadar />
    </div>
  );
};

export default AdminArchitectureTopologyView;
