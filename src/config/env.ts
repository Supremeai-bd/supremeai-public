/**
 * SupremeAI Environment Configuration & Standardizer
 * Validates and provides typed access to environment variables,
 * with seamless Mock-to-Real API adapter switching.
 */

import { version } from '../../package.json';

export interface AppEnvConfig {
  isMockEnabled: boolean;
  apiBaseUrl: string;
  wsBaseUrl: string;
  mockBaseUrl: string;
  supabaseUrl: string;
  gatewayUrl: string;
  mcpTowerUrl: string;
  version: string;
}

// বাংলা মন্তব্য: Vite ও Edge (node types) উভয় পরিবেশেই import.meta.env নিরাপদে পড়ার হেল্পার।
const getMetaEnv = (): Record<string, string | boolean | undefined> | undefined => {
  if (typeof import.meta === 'undefined') return undefined;
  return (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env;
};

const isProdEnvironment = (): boolean => {
  const metaEnv = getMetaEnv();
  if (metaEnv?.PROD !== undefined) {
    return Boolean(metaEnv.PROD);
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV === 'production';
  }
  return false;
};

const getEnvBool = (key: string, defaultValue: boolean): boolean => {
  const metaEnv = getMetaEnv();
  const val = metaEnv?.[key] ?? (typeof process !== 'undefined' ? process.env?.[key] : undefined);
  if (val === undefined || val === null || val === '') return defaultValue;
  return val === true || val === 'true' || val === '1';
};

const getEnvString = (key: string, defaultValue: string): string => {
  const metaEnv = getMetaEnv();
  const raw =
    metaEnv?.[key] ??
    (typeof process !== 'undefined' ? process.env?.[key] : undefined);
  return typeof raw === 'string' ? raw : defaultValue;
};

// Check for runtime local override if developer switches mock mode in UI (ONLY in dev mode!)
const getRuntimeMockOverride = (): boolean | null => {
  if (isProdEnvironment()) return false;
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('supremeai_mock_override');
      if (saved !== null) return saved === 'true';
    }
  } catch {}
  return null;
};

export const env: AppEnvConfig = {
  isMockEnabled: isProdEnvironment()
    ? false
    : (getRuntimeMockOverride() ?? getEnvBool('VITE_USE_MOCK', false)),
  // Same-origin by default (routed via Vite/Express in preview and Cloudflare Pages Functions `/api/*` in prod)
  // to avoid cross-domain CORS preflights and ad-blocker false positives. Set VITE_API_BASE_URL to override.
  apiBaseUrl: getEnvString('VITE_API_BASE_URL', ''),
  wsBaseUrl: getEnvString('VITE_WS_BASE_URL', isProdEnvironment() ? '' : 'ws://localhost:3000'),
  mockBaseUrl: getEnvString('VITE_MOCK_BASE_URL', '/api/mock'),
  supabaseUrl: getEnvString('VITE_SUPABASE_URL', ''),
  gatewayUrl: getEnvString('VITE_GATEWAY_URL', '/v1'),
  mcpTowerUrl: getEnvString('VITE_MCP_TOWER_URL', '/api/mcp-tower'),
  version: `v${version}`,
};

/**
 * Toggle between local Mock mode and live Backend API proxy mode at runtime.
 */
export const setRuntimeMockMode = (enabled: boolean): void => {
  localStorage.setItem('supremeai_mock_override', String(enabled));
  env.isMockEnabled = enabled;
  window.dispatchEvent(new CustomEvent('supremeai-mock-mode-changed', { detail: { enabled } }));
};
