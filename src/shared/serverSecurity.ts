import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

export interface SignedSessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  role?: string;
}

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  if (stored.startsWith('scrypt:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const [, salt, hex] = parts;
    if (!salt || !hex) return false;
    try {
      const expected = Buffer.from(hex, 'hex');
      const derived = crypto.scryptSync(plain, salt, expected.length);
      return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
    } catch {
      return false;
    }
  }
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signSessionToken(
  payload: { sub: string; email: string; iat: number; exp?: number; role?: string },
  secret: string,
  ttlMs: number = DEFAULT_SESSION_TTL_MS
): string {
  const exp =
    typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp
      : payload.iat + ttlMs;
  const fullPayload: SignedSessionPayload = {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    iat: payload.iat,
    exp,
    ...(payload.role ? { role: payload.role } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `tok_${encoded}.${sig}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Date.now()
): SignedSessionPayload | null {
  if (!token || !secret || !token.startsWith('tok_') || !token.includes('.')) return null;
  const raw = token.slice(4);
  const dotIdx = raw.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed.email !== 'string' ||
      typeof parsed.sub !== 'string' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }
    const exp =
      typeof parsed.exp === 'number' && Number.isFinite(parsed.exp)
        ? parsed.exp
        : parsed.iat + DEFAULT_SESSION_TTL_MS;
    if (exp <= now) return null;
    return {
      sub: parsed.sub,
      email: parsed.email.toLowerCase(),
      iat: Number(parsed.iat || 0),
      exp,
      role: typeof parsed.role === 'string' ? parsed.role : undefined,
    };
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function isProtectedWorkspaceFile(targetRel: string): boolean {
  const normalized = targetRel.replace(/\\/g, '/').trim();
  if (!normalized) return true;
  const segments = normalized.split('/').filter(Boolean);
  const lowerSegments = segments.map((s) => s.toLowerCase());
  const baseName = path.posix.basename(normalized).toLowerCase();

  if (baseName.startsWith('.env')) return true;
  if (
    lowerSegments.some(
      (seg) =>
        seg === '.git' ||
        seg === 'node_modules' ||
        seg === '.studio-data' ||
        seg === '.aistudio' ||
        seg === '.ssh'
    )
  ) {
    return true;
  }
  if (baseName.startsWith('.supremeai-') || baseName.includes('totp-vault')) return true;
  if (/firebase-adminsdk.*\.json$/i.test(baseName)) return true;
  if (/\.(pem|key|p12|pfx|jks|kdbx|keystore|crt|der)$/i.test(baseName)) return true;
  if (/^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i.test(baseName)) return true;
  return false;
}

export function isPrivateIpAddress(rawIp: string): boolean {
  const ip = rawIp
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!ip) return true;

  // Strip IPv6 zone ID if present (e.g. fe80::1%eth0)
  const cleanIp = ip.split('%')[0];

  // IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleanIp.startsWith('::ffff:')) {
    const mapped = cleanIp.slice(7);
    if (net.isIPv4(mapped)) {
      return isPrivateIpAddress(mapped);
    }
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIpAddress(v4);
    }
    return true;
  }

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a >= 224) return true; // multicast & reserved
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    if (cleanIp === '::' || cleanIp === '::1') return true;
    if (/^(fc|fd)/i.test(cleanIp)) return true; // ULA fc00::/7
    if (/^fe[89ab][0-9a-f]:/i.test(cleanIp)) return true; // link-local fe80::/10
    if (/^ff/i.test(cleanIp)) return true; // multicast
    return false;
  }

  return false;
}

export function isRestrictedProxyTarget(
  parsedUrl: URL,
  isLocalRelative: boolean
): { restricted: boolean; reason?: string } {
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { restricted: true, reason: 'Only http:// and https:// protocols are supported.' };
  }

  if (isLocalRelative) {
    const pathname = parsedUrl.pathname.toLowerCase();
    if (
      pathname.startsWith('/api/admin') ||
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/v1/auth') ||
      pathname.startsWith('/api/billing') ||
      pathname.startsWith('/api/workspace') ||
      pathname.startsWith('/api/api-keys') ||
      pathname.startsWith('/api/v1/api-keys') ||
      pathname.startsWith('/metrics')
    ) {
      return {
        restricted: true,
        reason: 'Access to privileged local API routes via browser proxy is restricted.',
      };
    }
    return { restricted: false };
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivateOrLoopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === '169.254.169.254' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    // Audit 2026-11-24 (item 3.1): the blanket startsWith('fc')/'fd') checks
    // were removed — they wrongly blocked public domains like fcbarcelona.com /
    // fdroid.org. ULA fc00::/7 literals are caught by net.isIP() + the
    // isPrivateIpAddress() parser below (which matches real IPv6 text only).
    host.startsWith('fe80:') ||
    /^::ffff:127\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    (net.isIP(host) !== 0 && isPrivateIpAddress(host));

  if (isPrivateOrLoopback) {
    return {
      restricted: true,
      reason: 'Access to loopback, private network, or cloud metadata addresses is restricted.',
    };
  }

  return { restricted: false };
}

/**
 * Resolves DNS for non-local proxy/webhook/schedule targets and blocks any host
 * that resolves to a private, loopback, link-local, or cloud metadata IP address.
 */
export async function resolveAndCheckProxyTarget(
  parsedUrl: URL,
  isLocalRelative: boolean
): Promise<{ restricted: boolean; reason?: string }> {
  const staticCheck = isRestrictedProxyTarget(parsedUrl, isLocalRelative);
  if (staticCheck.restricted || isLocalRelative) {
    return staticCheck;
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host) !== 0) {
    return isPrivateIpAddress(host)
      ? {
          restricted: true,
          reason: 'Access to loopback, private network, or cloud metadata addresses is restricted.',
        }
      : { restricted: false };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!Array.isArray(records) || records.length === 0) {
      return { restricted: true, reason: 'Could not resolve target hostname.' };
    }
    for (const rec of records) {
      if (isPrivateIpAddress(rec.address)) {
        return {
          restricted: true,
          reason:
            'Target hostname resolves to a loopback, private network, or cloud metadata address.',
        };
      }
    }
    return { restricted: false };
  } catch {
    return { restricted: true, reason: 'Target hostname DNS resolution failed.' };
  }
}

export function isAllowedCorsOrigin(
  origin: string | null | undefined,
  requestOrigin: string,
  extraAllowedCsv?: string
): boolean {
  if (!origin) return true;
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  const cleanReqOrigin = requestOrigin.trim().replace(/\/+$/, '');
  if (!cleanOrigin) return true;
  if (cleanOrigin === cleanReqOrigin) return true;

  const builtInAllowed = new Set([
    'https://supremeai-studio.pages.dev',
    'https://tauri.localhost',
    'http://tauri.localhost',
    'tauri://localhost',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  if (builtInAllowed.has(cleanOrigin)) return true;

  if (extraAllowedCsv) {
    const extras = extraAllowedCsv
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (extras.includes(cleanOrigin)) return true;
  }

  try {
    const parsed = new URL(cleanOrigin);
    if (parsed.protocol === 'https:') {
      if (parsed.hostname.endsWith('.supremeai-studio.pages.dev')) return true;
      if (parsed.hostname.endsWith('.run.app')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function validateGitLabHost(
  rawHost: string | undefined,
  configuredHost?: string
): { ok: true; host: string } | { ok: false; error: string } {
  const defaultHost = 'https://gitlab.com';
  const normalizedConfigured = (configuredHost || '').trim().replace(/\/+$/, '');
  const candidate = (rawHost || normalizedConfigured || defaultHost).trim().replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Invalid GitLab host URL.' };
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { ok: false, error: 'GitLab host must be a valid https:// origin without credentials.' };
  }

  const normalizedOrigin = parsed.origin.toLowerCase();
  const allowedOrigins = new Set<string>([defaultHost]);
  if (normalizedConfigured) {
    try {
      const cfgUrl = new URL(normalizedConfigured);
      if (cfgUrl.protocol === 'https:') {
        allowedOrigins.add(cfgUrl.origin.toLowerCase());
      }
    } catch {
      // Ignore malformed env config
    }
  }

  if (!allowedOrigins.has(normalizedOrigin)) {
    return {
      ok: false,
      error:
        'Untrusted GitLab host. Configure GITLAB_HOST on the server to allow self-hosted GitLab instances.',
    };
  }

  return { ok: true, host: parsed.origin };
}

export function isSafeGitHubRepoSlug(repo: string): boolean {
  const trimmed = String(repo || '').trim();
  if (!trimmed || trimmed.includes('..')) return false;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed);
}
