/**
 * PersonalMcpHubCard — Personal MCP Gateway (`*.mcp.supremeai.ai`), Passkey Device Manager,
 * and Personal Memory Graph Transparency (Waves 3.2, 5.2 & 5.3 Phase D).
 *
 * বাংলা মন্তব্য: কোনো ডামি বা হার্ডকোডেড ডেটা নয় — সরাসরি ব্যাকএন্ডের `/api/v1/mcp/*`,
 * `/api/auth/passkey/*`, এবং `/api/memory/graph` এপিআই কল করে ভ্যানিটি স্লাগ ক্লেইম,
 * Claude/Cursor/VS Code JSON কনফিগ কপি, পাসকি ডিভাইস ম্যানেজমেন্ট ও নিজের মেমরি মুছে ফেলার পূর্ণ নিয়ন্ত্রণ দেয়।
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Fingerprint,
  Globe,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Brain,
} from 'lucide-react';
import { DEFAULT_GATEWAY_URL } from '../../bridge/desktopBridge';
import {
  isPasskeySupported,
  listPasskeyDevices,
  registerPasskey,
  revokePasskeyDevice,
  type PasskeyDevice,
} from '../../services/passkeyService';

interface McpGatewayState {
  slug: string | null;
  gateway_url: string | null;
  tenant?: {
    id: string;
    plan: string;
    status: string;
    max_clients: number;
    active_clients?: number;
  };
}

interface McpClientItem {
  id: string;
  name: string;
  provider: string;
  role: string;
  token_prefix: string;
  status: string;
}

interface MemoryFactItem {
  id?: string;
  kind: string;
  value: string;
  count?: number;
}

interface PersonalMcpHubCardProps {
  userId?: string;
  userEmail?: string;
  userName?: string;
}

function getGatewayBase(): string {
  const fromEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPREMEAI_GATEWAY_URL
      : undefined;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('127.0.0.1')
  ) {
    return '';
  }
  return (DEFAULT_GATEWAY_URL || '').replace(/\/+$/, '');
}

async function fetchMcpWithFallback(path: string, init?: RequestInit): Promise<Response> {
  const base = getGatewayBase();
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && (!init?.method || init.method !== 'GET')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const primaryUrl = base ? `${base}${path}` : path;
  try {
    const res = await fetch(primaryUrl, { ...init, headers });
    if (res.ok || (res.status !== 404 && res.status !== 502 && res.status !== 503)) {
      return res;
    }
  } catch (err) {
    if (!DEFAULT_GATEWAY_URL || primaryUrl.startsWith(DEFAULT_GATEWAY_URL)) {
      throw err;
    }
  }

  if (DEFAULT_GATEWAY_URL && !primaryUrl.startsWith(DEFAULT_GATEWAY_URL)) {
    const fallbackUrl = `${DEFAULT_GATEWAY_URL.replace(/\/+$/, '')}${path}`;
    return fetch(fallbackUrl, { ...init, headers });
  }
  return fetch(primaryUrl, { ...init, headers });
}

function getToken(): string {
  if (typeof localStorage === 'undefined') return '';
  return (
    localStorage.getItem('supremeai_access_token') ||
    localStorage.getItem('supremeai_token') ||
    ''
  );
}

export const PersonalMcpHubCard: React.FC<PersonalMcpHubCardProps> = ({
  userId = '',
  userEmail = '',
  userName = '',
}) => {
  const [mcpState, setMcpState] = useState<McpGatewayState | null>(null);
  const [clients, setClients] = useState<McpClientItem[]>([]);
  const [slugInput, setSlugInput] = useState('');
  const [clientNameInput, setClientNameInput] = useState('Claude Desktop');
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);

  // Passkey device management state
  const [passkeys, setPasskeys] = useState<PasskeyDevice[]>([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyStatus, setPasskeyStatus] = useState<string | null>(null);

  // Personal Memory Graph transparency state
  const [memoryFacts, setMemoryFacts] = useState<MemoryFactItem[]>([]);
  const [memoryBusy, setMemoryBusy] = useState(false);

  const loadAll = useCallback(async () => {
    // 1. Personal MCP Gateway state
    try {
      const gwRes = await fetchMcpWithFallback('/api/v1/mcp/gateway');
      if (gwRes.ok) {
        const data = (await gwRes.json()) as McpGatewayState;
        setMcpState(data);
        if (data.slug) setSlugInput(data.slug);
      }
      const clRes = await fetchMcpWithFallback('/api/v1/mcp/clients');
      if (clRes.ok) {
        const clData = (await clRes.json()) as { clients?: McpClientItem[] };
        setClients(Array.isArray(clData.clients) ? clData.clients : []);
      }
    } catch {
      // Honest offline state: leave mcpState null so UI explains unconfigured state
    }

    // 2. Registered Passkeys
    if (userId) {
      const devs = await listPasskeyDevices(userId);
      setPasskeys(devs);
    }

    // 3. Personal Memory Graph
    try {
      const memRes = await fetchMcpWithFallback('/api/memory/graph');
      if (memRes.ok) {
        const memData = (await memRes.json()) as { facts?: MemoryFactItem[] };
        setMemoryFacts(Array.isArray(memData.facts) ? memData.facts : []);
      }
    } catch {
      // Quiet fallback when offline
    }
  }, [userId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleClaimSlug = async () => {
    const clean = slugInput.trim().toLowerCase();
    if (!clean) return;
    setMcpBusy(true);
    setMcpMessage(null);
    try {
      const res = await fetchMcpWithFallback('/api/v1/mcp/slug/claim', {
        method: 'POST',
        body: JSON.stringify({ slug: clean }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        gateway_url?: string;
        slug?: { slug: string } | string;
      };
      if (!res.ok) {
        setMcpMessage(body.detail || `Could not claim slug (HTTP ${res.status}).`);
      } else {
        setMcpMessage('Personal MCP vanity slug claimed.');
        await loadAll();
      }
    } catch (err: unknown) {
      setMcpMessage(err instanceof Error ? err.message : 'Network error claiming slug.');
    } finally {
      setMcpBusy(false);
    }
  };

  const handleCreateClient = async () => {
    if (!clientNameInput.trim()) return;
    setMcpBusy(true);
    setMcpMessage(null);
    setOneTimeToken(null);
    try {
      const res = await fetchMcpWithFallback('/api/v1/mcp/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: clientNameInput.trim(),
          provider: 'claude-desktop',
          role: 'agent',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        detail?: string;
      };
      if (!res.ok) {
        setMcpMessage(body.detail || `Client creation failed (HTTP ${res.status}).`);
      } else {
        if (body.token) setOneTimeToken(body.token);
        await loadAll();
      }
    } catch (err: unknown) {
      setMcpMessage(err instanceof Error ? err.message : 'Failed to register MCP client.');
    } finally {
      setMcpBusy(false);
    }
  };

  const gatewayEndpoint =
    mcpState?.gateway_url ||
    (slugInput.trim()
      ? `https://${slugInput.trim().toLowerCase()}.mcp.supremeai.ai/mcp`
      : `${getGatewayBase()}/mcp`);

  const ideJsonSnippet = JSON.stringify(
    {
      mcpServers: {
        'supremeai-personal': {
          url: gatewayEndpoint,
          headers: {
            Authorization: `Bearer ${oneTimeToken || '<YOUR_ONE_TIME_MCP_TOKEN>'}`,
          },
        },
      },
    },
    null,
    2
  );

  const handleCopyIdeJson = async () => {
    try {
      await navigator.clipboard.writeText(ideJsonSnippet);
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 1800);
    } catch {
      setMcpMessage('Clipboard permission denied.');
    }
  };

  const handleRegisterPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyStatus(null);
    const res = await registerPasskey(
      userEmail || `${userId || 'user'}@supremeai.local`,
      userName || userEmail || 'SupremeAI User',
      navigator.platform || 'Biometric Device'
    );
    if (res.ok) {
      setPasskeyStatus('Biometric Passkey registered on this device.');
      if (userId) {
        setPasskeys(await listPasskeyDevices(userId));
      } else if (res.device) {
        setPasskeys((prev) => [...prev, res.device!]);
      }
    } else {
      setPasskeyStatus(res.error || 'Passkey registration did not complete.');
    }
    setPasskeyBusy(false);
  };

  const handleRevokePasskey = async (credId: string) => {
    if (!userId) return;
    setPasskeyBusy(true);
    const ok = await revokePasskeyDevice(credId, userId);
    if (ok) {
      setPasskeys((prev) => prev.filter((d) => d.credential_id !== credId));
    }
    setPasskeyBusy(false);
  };

  const handleWipeMemory = async () => {
    setMemoryBusy(true);
    try {
      const res = await fetchMcpWithFallback('/api/memory/graph', {
        method: 'DELETE',
      });
      if (res.ok) {
        setMemoryFacts([]);
      }
    } finally {
      setMemoryBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Biometric Passkey Devices (Wave 5.2) */}
      <div
        data-testid="settings-passkey-devices-card"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-cyan-500" />
              <span>Biometric Passkeys (Face ID / Touch ID / Windows Hello)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Sign in passwordlessly using hardware-backed W3C WebAuthn credentials.
            </p>
          </div>
          {isPasskeySupported() && (
            <button
              type="button"
              disabled={passkeyBusy}
              onClick={handleRegisterPasskey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{passkeyBusy ? 'Registering…' : 'Register Passkey'}</span>
            </button>
          )}
        </div>

        {passkeyStatus && (
          <p className="text-xs text-cyan-600 dark:text-cyan-400">{passkeyStatus}</p>
        )}

        {passkeys.length === 0 ? (
          <p className="text-xs text-slate-400">
            No passkey devices registered for this account yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/70 dark:border-slate-800">
            {passkeys.map((dev) => (
              <div
                key={dev.credential_id}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {dev.device_name}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={passkeyBusy}
                  onClick={() => void handleRevokePasskey(dev.credential_id)}
                  className="text-rose-500 hover:text-rose-600 p-1 rounded cursor-pointer"
                  title="Revoke passkey"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Personal MCP Gateway Hub (Wave 5.3 Phase D) */}
      <div
        data-testid="personal-mcp-hub-card"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-violet-500" />
              <span>Personal MCP Gateway (*.mcp.supremeai.ai)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Claim your isolated subdomain slug and connect Claude Desktop, Cursor, or VS Code.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            title="Refresh MCP Hub"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder="your-handle"
            className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={mcpBusy || !slugInput.trim()}
            onClick={() => void handleClaimSlug()}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-[var(--theme-accent)] cursor-pointer disabled:opacity-50"
          >
            Claim Vanity Slug
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={clientNameInput}
            onChange={(e) => setClientNameInput(e.target.value)}
            placeholder="Client name (e.g. Cursor IDE)"
            className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={mcpBusy || !clientNameInput.trim()}
            onClick={() => void handleCreateClient()}
            className="px-3 py-1.5 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            Generate Client Token
          </button>
        </div>

        {mcpMessage && <p className="text-xs text-amber-600 dark:text-amber-400">{mcpMessage}</p>}

        {oneTimeToken && (
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="truncate font-mono">One-time token: {oneTimeToken}</span>
          </div>
        )}

        <div className="relative rounded-xl bg-slate-950 text-slate-200 p-3 text-[11px] font-mono overflow-x-auto">
          <button
            type="button"
            onClick={() => void handleCopyIdeJson()}
            className="absolute right-2 top-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 cursor-pointer"
          >
            {copiedConfig ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copiedConfig ? 'Copied' : 'Copy JSON'}</span>
          </button>
          <pre className="pr-20">{ideJsonSnippet}</pre>
        </div>

        {clients.length > 0 && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Active MCP clients: {clients.map((c) => `${c.name} (${c.token_prefix}…)`).join(', ')}
          </div>
        )}
      </div>

      {/* 3. Personal Memory Graph Transparency & Right-to-be-Forgotten (Wave 3.2) */}
      <div
        data-testid="personal-memory-transparency-card"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Brain className="w-4 h-4 text-cyan-500" />
              <span>Personal Memory Graph ({memoryFacts.length} facts)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Full transparency over what SupremeAI remembers about your preferences and tasks.
            </p>
          </div>
          {memoryFacts.length > 0 && (
            <button
              type="button"
              disabled={memoryBusy}
              onClick={() => void handleWipeMemory()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-semibold cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Wipe All Memory</span>
            </button>
          )}
        </div>

        {memoryFacts.length === 0 ? (
          <p className="text-xs text-slate-400">
            No personal memory facts stored yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {memoryFacts.slice(0, 12).map((fact, idx) => (
              <span
                key={`${fact.kind}-${idx}`}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-300"
              >
                <strong className="font-semibold">{fact.kind}:</strong> {fact.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
