/**
 * SupremeAI Environment Configuration & Standardizer
 * Validates and provides typed access to environment variables,
 * with seamless Mock-to-Real API adapter switching.
 */

import { version } from '../../package.json';
import {
  DEFAULT_BACKEND_ORIGIN,
  DEFAULT_PUBLIC_API_PROXY_URL,
} from './platformEndpoints';

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

// বাংলা মন্তব্য: Desktop (Tauri), Mobile (Android APK/iOS), এবং VS Code Webview-এ লোকাল `/api` না থাকায় স্বয়ংক্রিয়ভাবে ক্যানোনিকাল ক্লাউড এন্ডপয়েন্ট ব্যবহৃত হবে
export function isEmbeddedAppOrigin(loc?: { protocol?: string; hostname?: string } | null): boolean {
  const target =
    loc ?? (typeof window !== 'undefined' && window.location ? window.location : null);
  if (!target) return false;
  const protocol = String(target.protocol || '').toLowerCase();
  const hostname = String(target.hostname || '').toLowerCase();
  if (
    protocol === 'tauri:' ||
    protocol === 'file:' ||
    protocol === 'vscode-webview:' ||
    protocol === 'capacitor:' ||
    protocol === 'ionic:'
  ) {
    return true;
  }
  return hostname === 'tauri.localhost' || hostname.endsWith('.tauri.localhost');
}

const resolveDefaultApiBaseUrl = (): string => {
  const configured = getEnvString('VITE_API_BASE_URL', '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return isEmbeddedAppOrigin() ? DEFAULT_PUBLIC_API_PROXY_URL : '';
};

const resolveDefaultWsBaseUrl = (): string => {
  const configured = getEnvString('VITE_WS_BASE_URL', '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (isEmbeddedAppOrigin()) {
    return DEFAULT_BACKEND_ORIGIN.replace(/^http/i, 'ws');
  }
  return isProdEnvironment() ? '' : 'ws://localhost:3000';
};

export const env: AppEnvConfig = {
  isMockEnabled: isProdEnvironment()
    ? false
    : (getRuntimeMockOverride() ?? getEnvBool('VITE_USE_MOCK', false)),
  // Same-origin by default on Web; automatically resolves to canonical cloud proxy inside Desktop/Mobile Tauri & WebViews.
  apiBaseUrl: resolveDefaultApiBaseUrl(),
  wsBaseUrl: resolveDefaultWsBaseUrl(),
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
  // বাংলা মন্তব্য: প্রাইভেসি মোড বা স্টোরেজ-ব্লকড ব্রাউজারে যাতে localStorage/window অ্যাক্সেস ক্র্যাশ না করে সেজন্য try-catch ব্যবহৃত
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('supremeai_mock_override', String(enabled));
    }
  } catch (err) {
    console.warn('[env] Failed to persist runtime mock override in localStorage:', err);
  }
  env.isMockEnabled = enabled;
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('supremeai-mock-mode-changed', { detail: { enabled } }));
    }
  } catch (err) {
    console.warn('[env] Failed to dispatch supremeai-mock-mode-changed event:', err);
  }
};
