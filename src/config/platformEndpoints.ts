/**
 * Centralized Platform Endpoints & Repository Single Source of Truth (SSOT)
 *
 * Keeps Web UI, Express Gateway, Cloudflare Edge Functions, Tauri Desktop, and
 * Android APK aligned on the live Render services and GitHub monorepo topology.
 */

export const DEFAULT_MCP_TOWER_ORIGIN = 'https://supremeai-mcp-tower-live.onrender.com';
export const DEFAULT_MCP_AGENT_KEY = 'federated_bridge_agent';
export const DEFAULT_BACKEND_ORIGIN = 'https://supremeai-api-ulw0.onrender.com';
export const DEFAULT_PUBLIC_API_PROXY_URL = 'https://supremeai-studio.pages.dev';
export const DEFAULT_WEB_STUDIO_URL = 'https://supremeai-studio.pages.dev';

export const GITHUB_ORG = 'Supremeai-bd';
export const GITHUB_MONOREPO_SLUG = 'Supremeai-bd/supremeai';
export const GITHUB_PUBLIC_REPO_SLUG = 'Supremeai-bd/supremeai-public';
export const GITHUB_LEGACY_FRONTEND_SLUG = 'Supremeai-bd/supremeai-frontend';

export const KNOWN_RENDER_SERVICE_IDS: Record<string, string> = {
  'supremeai-api': 'srv-dbappass728c7396p580',
};

export function resolveMcpRpcCandidates(
  originOrUrl?: string,
  agentKey: string = DEFAULT_MCP_AGENT_KEY
): string[] {
  const raw = (originOrUrl || DEFAULT_MCP_TOWER_ORIGIN).trim().replace(/\/+$/, '');
  const cleanAgent = (agentKey || DEFAULT_MCP_AGENT_KEY).trim();

  if (/\/agents\/[^/]+\/mcp$/i.test(raw)) {
    const rootOrigin = raw.replace(/\/agents\/[^/]+\/mcp$/i, '');
    return [raw, `${rootOrigin}/mcp`];
  }
  if (/\/mcp$/i.test(raw)) {
    const rootOrigin = raw.replace(/\/mcp$/i, '');
    return [`${rootOrigin}/agents/${cleanAgent}/mcp`, raw];
  }
  return [`${raw}/agents/${cleanAgent}/mcp`, `${raw}/mcp`];
}

export function extractMcpOriginFromUrl(url?: string): string {
  const raw = (url || DEFAULT_MCP_TOWER_ORIGIN).trim().replace(/\/+$/, '');
  return raw.replace(/\/agents\/[^/]+\/mcp$/i, '').replace(/\/mcp$/i, '');
}
