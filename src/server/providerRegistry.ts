/**
 * Provider Health & Failover Registry for the Express server (server-managed +
 * Infisical Vault synced secrets): key masking, env-var map, real upstream
 * probes and the seed data for the admin Provider Mesh / Vault views.
 *
 * Moved verbatim out of `server.ts` (see docs/SERVER_TS_SPLIT_PLAN.md). The only
 * inputs are `process.env` and `isProduction`; `server.ts` keeps the mutable
 * `providerMesh` / `infisicalExtraVaultKeys` arrays and passes them to the admin
 * routes through a ctx getter/setter exactly as before.
 *
 * বাংলা: server.ts ভাগ করার অংশ — শুধু ডেটা + হেল্পার, কোনো রুট নেই।
 */

export const maskServerSecret = (val: string) => {
  if (!val || val === 'MY_GEMINI_API_KEY') return 'Not configured in server environment';
  if (val.length <= 10) return '••••••••••••';
  return `${val.slice(0, 6)}••••••••••••••••${val.slice(-4)}`;
};

// Map each provider to the server-side env var that holds its real API key.
export const PROVIDER_KEY_ENV: Record<string, string> = {
  google_ai_studio: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

// Lightweight, real upstream health probes. Each provider has a documented
// models endpoint that validates the key without incurring token cost.
export const probeProviderUpstream = async (
  provider: string,
  key: string
): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  message: string;
}> => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const headers: Record<string, string> = {};
  let url: string;

  switch (provider) {
    case 'openai':
      url = 'https://api.openai.com/v1/models';
      headers.Authorization = `Bearer ${key}`;
      break;
    case 'groq':
      url = 'https://api.groq.com/openai/v1/models';
      headers.Authorization = `Bearer ${key}`;
      break;
    case 'deepseek':
      url = 'https://api.deepseek.com/v1/models';
      headers.Authorization = `Bearer ${key}`;
      break;
    case 'mistral':
      url = 'https://api.mistral.ai/v1/models';
      headers.Authorization = `Bearer ${key}`;
      break;
    case 'anthropic':
      url = 'https://api.anthropic.com/v1/models';
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      break;
    default:
      clearTimeout(timer);
      return {
        status: 'unhealthy',
        latencyMs: 0,
        message: `No real probe implemented for provider "${provider}".`,
      };
  }

  try {
    const upstream = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    clearTimeout(timer);
    if (upstream.ok) {
      return {
        status: 'healthy',
        latencyMs,
        message: `${provider} models endpoint responded HTTP ${upstream.status}`,
      };
    }
    // 401/403 => dead/invalid key. Other 4xx => key accepted but request rejected.
    const dead = upstream.status === 401 || upstream.status === 403;
    return {
      status: dead ? 'unhealthy' : 'degraded',
      latencyMs,
      message: `${provider} upstream returned HTTP ${upstream.status}`,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: 'unhealthy',
      latencyMs: Math.max(1, Date.now() - startedAt),
      message: aborted
        ? `${provider} probe timed out after 6s`
        : err instanceof Error
          ? err.message
          : 'Probe failed',
    };
  }
};

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  supremeai: 'SupremeAI Gateway Mesh',
  google_ai_studio: 'Google AI Studio (Gemini)',
  vertex_ai: 'Google Cloud Vertex AI',
  openai: 'OpenAI Platform',
  anthropic: 'Anthropic Claude',
  groq: 'Groq LPU Broker',
  deepseek: 'DeepSeek R1',
  mistral: 'Mistral Codestral',
};

export type ProviderMeshEntry = {
  id: string;
  provider: string;
  displayName: string;
  maskedKey: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'untested';
  latencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  priority: number;
  lastChecked: string;
  rateLimitTpm: string;
  infisicalPath: string;
  infisicalEnv: 'prod' | 'staging' | 'dev';
  vaultVersion: number;
  region: string;
};

/** Fresh provider-mesh seed built from the current env (one mutable copy per server). */
export const createProviderMesh = (): ProviderMeshEntry[] => [
  {
    id: 'prov_google_ai',
    provider: 'google_ai_studio',
    displayName: 'Google AI Studio (Gemini Global Direct)',
    maskedKey: process.env.GEMINI_API_KEY?.trim()
      ? maskServerSecret(process.env.GEMINI_API_KEY.trim())
      : 'not-configured',
    status: process.env.GEMINI_API_KEY?.trim() ? 'healthy' : 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 1,
    lastChecked: process.env.GEMINI_API_KEY?.trim()
      ? 'Configured (pending probe)'
      : 'Not configured (no API key)',
    rateLimitTpm: '4,000,000 TPM',
    infisicalPath: '/ai-providers/GEMINI_API_KEY',
    infisicalEnv: 'prod',
    vaultVersion: 7,
    region: 'global-edge',
  },
  {
    id: 'prov_vertex_ai',
    provider: 'vertex_ai',
    displayName: 'Google Cloud Vertex AI (asia-northeast1)',
    maskedKey: process.env.VERTEX_PROJECT_ID
      ? `projects/${process.env.VERTEX_PROJECT_ID}/locations/asia-northeast1`
      : 'not-configured',
    status: 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 2,
    lastChecked: process.env.VERTEX_PROJECT_ID ? 'Configured (pending probe)' : 'Not configured',
    rateLimitTpm: '10,000,000 TPM',
    infisicalPath: '/ai-providers/VERTEX_ADC_CREDENTIALS',
    infisicalEnv: 'prod',
    vaultVersion: 4,
    region: 'asia-northeast1',
  },
  {
    id: 'prov_groq',
    provider: 'groq',
    displayName: 'Groq LPU Inference Broker (Llama-3-70b)',
    maskedKey: process.env.GROQ_API_KEY?.trim()
      ? maskServerSecret(process.env.GROQ_API_KEY.trim())
      : 'not-configured',
    status: 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 3,
    lastChecked: process.env.GROQ_API_KEY?.trim()
      ? 'Configured (pending probe)'
      : 'Not configured (no API key)',
    rateLimitTpm: '2,500,000 TPM',
    infisicalPath: '/ai-providers/GROQ_API_KEY',
    infisicalEnv: 'prod',
    vaultVersion: 3,
    region: 'us-east-lpu',
  },
  {
    id: 'prov_openai',
    provider: 'openai',
    displayName: 'OpenAI Platform (GPT-4o / o3-mini)',
    maskedKey: process.env.OPENAI_API_KEY?.trim()
      ? maskServerSecret(process.env.OPENAI_API_KEY.trim())
      : 'not-configured',
    status: 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 4,
    lastChecked: process.env.OPENAI_API_KEY?.trim()
      ? 'Configured (pending probe)'
      : 'Not configured (no API key)',
    rateLimitTpm: '2,000,000 TPM',
    infisicalPath: '/ai-providers/OPENAI_API_KEY',
    infisicalEnv: 'prod',
    vaultVersion: 5,
    region: 'us-east-1',
  },
  {
    id: 'prov_anthropic',
    provider: 'anthropic',
    displayName: 'Anthropic Claude 3.7 Sonnet',
    maskedKey: process.env.ANTHROPIC_API_KEY?.trim()
      ? maskServerSecret(process.env.ANTHROPIC_API_KEY.trim())
      : 'not-configured',
    status: 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 5,
    lastChecked: process.env.ANTHROPIC_API_KEY?.trim()
      ? 'Configured (pending probe)'
      : 'Not configured (no API key)',
    rateLimitTpm: '1,000,000 TPM',
    infisicalPath: '/ai-providers/ANTHROPIC_API_KEY',
    infisicalEnv: 'prod',
    vaultVersion: 2,
    region: 'us-west-2',
  },
  {
    id: 'prov_deepseek',
    provider: 'deepseek',
    displayName: 'DeepSeek R1 Reasoning Cluster',
    maskedKey: process.env.DEEPSEEK_API_KEY?.trim()
      ? maskServerSecret(process.env.DEEPSEEK_API_KEY.trim())
      : 'not-configured',
    status: 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 6,
    lastChecked: process.env.DEEPSEEK_API_KEY?.trim()
      ? 'Configured (pending probe)'
      : 'Not configured (no API key)',
    rateLimitTpm: '1,500,000 TPM',
    infisicalPath: '/ai-providers/DEEPSEEK_API_KEY',
    infisicalEnv: 'prod',
    vaultVersion: 2,
    region: 'ap-southeast-1',
  },
  {
    id: 'prov_mistral',
    provider: 'mistral',
    displayName: 'Mistral Codestral Enterprise',
    maskedKey: process.env.MISTRAL_API_KEY?.trim()
      ? maskServerSecret(process.env.MISTRAL_API_KEY.trim())
      : 'not-configured',
    status: 'untested',
    latencyMs: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    priority: 7,
    lastChecked: process.env.MISTRAL_API_KEY?.trim()
      ? 'Configured (pending probe)'
      : 'Not configured (no API key)',
    rateLimitTpm: '1,000,000 TPM',
    infisicalPath: '/ai-providers/MISTRAL_API_KEY',
    infisicalEnv: 'staging',
    vaultVersion: 1,
    region: 'eu-west-1',
  },
];

export type InfisicalVaultKeyEntry = {
  id: string;
  secretName: string;
  infisicalPath: string;
  environment: 'prod' | 'staging' | 'dev';
  provider: string;
  providerDisplayName: string;
  maskedKey: string;
  version: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'untested';
  latencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastChecked: string;
  lastSyncedAt: string;
};

/** Dev/preview-only extra vault rows (empty in production). */
export const createInfisicalExtraVaultKeys = (isProduction: boolean): InfisicalVaultKeyEntry[] =>
  isProduction
    ? []
    : [
        {
          id: 'vault_infisical_gateway_master',
          secretName: 'SUPREMEAI_GATEWAY_SIGNING_KEY',
          infisicalPath: '/core/SUPREMEAI_GATEWAY_SIGNING_KEY',
          environment: 'prod' as const,
          provider: 'supremeai',
          providerDisplayName: 'SupremeAI Gateway Mesh',
          maskedKey: 'sk-supreme-••••••••••••••••not-configured',
          version: 9,
          status: 'healthy' as const,
          latencyMs: 12,
          avgLatencyMs: 15,
          p95LatencyMs: 24,
          lastChecked: 'Just now (HTTP 200)',
          lastSyncedAt: new Date().toISOString(),
        },
        {
          id: 'vault_infisical_gemini_staging',
          secretName: 'GEMINI_API_KEY_STAGING',
          infisicalPath: '/staging/ai-providers/GEMINI_API_KEY',
          environment: 'staging' as const,
          provider: 'google_ai_studio',
          providerDisplayName: 'Google AI Studio (Staging)',
          maskedKey: 'gsk-••••••••••••••••not-configured',
          version: 3,
          status: 'healthy' as const,
          latencyMs: 31,
          avgLatencyMs: 34,
          p95LatencyMs: 56,
          lastChecked: '5m ago (HTTP 200)',
          lastSyncedAt: new Date().toISOString(),
        },
        {
          id: 'vault_infisical_openai_dev',
          secretName: 'OPENAI_API_KEY_DEV',
          infisicalPath: '/dev/ai-providers/OPENAI_API_KEY',
          environment: 'dev' as const,
          provider: 'openai',
          providerDisplayName: 'OpenAI Platform (Dev Sandbox)',
          maskedKey: 'sk-proj-••••••••••••••••not-configured',
          version: 2,
          status: 'healthy' as const,
          latencyMs: 152,
          avgLatencyMs: 158,
          p95LatencyMs: 262,
          lastChecked: '18m ago (HTTP 200)',
          lastSyncedAt: new Date().toISOString(),
        },
      ];

export const buildInfisicalVaultKeys = (
  providerMesh: ProviderMeshEntry[],
  infisicalExtraVaultKeys: InfisicalVaultKeyEntry[]
): InfisicalVaultKeyEntry[] => {
  const nowIso = new Date().toISOString();
  const mappedProviders = providerMesh.map((p) => {
    const secretName = p.infisicalPath.split('/').pop() || `${p.provider.toUpperCase()}_API_KEY`;
    return {
      id: `vault_${p.id}`,
      secretName,
      infisicalPath: p.infisicalPath,
      environment: p.infisicalEnv,
      provider: p.provider,
      providerDisplayName: p.displayName,
      maskedKey: p.maskedKey,
      version: p.vaultVersion || 1,
      status: p.status,
      latencyMs: p.latencyMs,
      avgLatencyMs: p.avgLatencyMs ?? p.latencyMs,
      p95LatencyMs: p.p95LatencyMs ?? Math.round(p.latencyMs * 1.45),
      lastChecked: p.lastChecked,
      lastSyncedAt: nowIso,
    };
  });
  return [...mappedProviders, ...infisicalExtraVaultKeys];
};
