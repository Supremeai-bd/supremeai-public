import net from 'node:net';
import tls from 'node:tls';

export interface RedisCommandResult {
  ok: boolean;
  value?: string | string[] | null;
  error?: string;
}

interface ParsedRedisUrl {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db: number;
  useTls: boolean;
}

export function parseRedisUrl(rawUrl?: string): ParsedRedisUrl | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') return null;
    const dbPart = parsed.pathname.replace(/^\/+/, '');
    const db = dbPart ? Math.max(0, Number.parseInt(dbPart, 10) || 0) : 0;
    return {
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port) || 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      db,
      useTls: parsed.protocol === 'rediss:',
    };
  } catch {
    return null;
  }
}

export function encodeRespCommand(args: Array<string | number>): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const str = String(arg);
    const bytes = Buffer.byteLength(str, 'utf8');
    out += `$${bytes}\r\n${str}\r\n`;
  }
  return out;
}

function parseSingleRespReply(buf: Buffer): { value: string | string[] | null; error?: string } {
  const text = buf.toString('utf8');
  if (!text) return { value: null };
  const first = text[0];
  const nl = text.indexOf('\r\n');
  if (nl === -1) return { value: null };

  if (first === '+') {
    return { value: text.slice(1, nl) };
  }
  if (first === '-') {
    return { value: null, error: text.slice(1, nl) };
  }
  if (first === ':') {
    return { value: text.slice(1, nl) };
  }
  if (first === '$') {
    const len = Number.parseInt(text.slice(1, nl), 10);
    if (len < 0) return { value: null };
    const start = nl + 2;
    return { value: buf.subarray(start, start + len).toString('utf8') };
  }
  if (first === '*') {
    const count = Number.parseInt(text.slice(1, nl), 10);
    if (count < 0) return { value: null };
    const items: string[] = [];
    let offset = nl + 2;
    for (let i = 0; i < count && offset < buf.length; i++) {
      const nextNl = buf.indexOf('\r\n', offset);
      if (nextNl === -1) break;
      const prefix = String.fromCharCode(buf[offset]);
      if (prefix === '$') {
        const len = Number.parseInt(buf.subarray(offset + 1, nextNl).toString('utf8'), 10);
        const valStart = nextNl + 2;
        if (len >= 0) {
          items.push(buf.subarray(valStart, valStart + len).toString('utf8'));
          offset = valStart + len + 2;
        } else {
          offset = valStart;
        }
      } else {
        items.push(buf.subarray(offset + 1, nextNl).toString('utf8'));
        offset = nextNl + 2;
      }
    }
    return { value: items };
  }
  return { value: null };
}

export async function runRedisCommand(
  args: Array<string | number>,
  redisUrl = process.env.REDIS_URL,
  timeoutMs = 2500
): Promise<RedisCommandResult> {
  const cfg = parseRedisUrl(redisUrl);
  if (!cfg) {
    return { ok: false, error: 'REDIS_URL not configured' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];

    const socket = cfg.useTls
      ? tls.connect({ host: cfg.host, port: cfg.port, rejectUnauthorized: true })
      : net.createConnection({ host: cfg.host, port: cfg.port });

    const finish = (res: RedisCommandResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'Redis command timed out' });
    }, timeoutMs);

    socket.once('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: err.message });
    });

    socket.once('connect', () => {
      let pipeline = '';
      if (cfg.password) {
        pipeline += encodeRespCommand(
          cfg.username ? ['AUTH', cfg.username, cfg.password] : ['AUTH', cfg.password]
        );
      }
      if (cfg.db > 0) {
        pipeline += encodeRespCommand(['SELECT', cfg.db]);
      }
      pipeline += encodeRespCommand(args);
      socket.write(pipeline);
      socket.end();
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    socket.once('end', () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      // Skip AUTH/SELECT +OK lines before the target command reply
      let skipCount = (cfg.password ? 1 : 0) + (cfg.db > 0 ? 1 : 0);
      let cursor = raw;
      while (skipCount > 0 && cursor.length > 0) {
        const idx = cursor.indexOf('\r\n');
        if (idx === -1) break;
        const line = cursor.subarray(0, idx).toString('utf8');
        if (line.startsWith('-')) {
          finish({ ok: false, error: line.slice(1) });
          return;
        }
        cursor = cursor.subarray(idx + 2);
        skipCount--;
      }
      const parsed = parseSingleRespReply(cursor);
      if (parsed.error) {
        finish({ ok: false, error: parsed.error });
      } else {
        finish({ ok: true, value: parsed.value });
      }
    });
  });
}

export class PersistentSessionMap<V> extends Map<string, V> {
  private readonly prefix: string;
  private readonly defaultTtlSec: number;
  private readonly hashKey: boolean;

  constructor(prefix: string, defaultTtlSec: number = 86_400 * 7, hashKey: boolean = false) {
    super();
    this.prefix = prefix;
    this.defaultTtlSec = defaultTtlSec;
    this.hashKey = hashKey;
  }

  private storageKey(key: string): string {
    if (!this.hashKey) return `${this.prefix}${key}`;
    // Stable short FNV-1a/base64url key avoids storing raw bearer tokens as Redis keys
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `${this.prefix}${(h >>> 0).toString(16)}_${key.length}`;
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    if (process.env.REDIS_URL?.trim()) {
      const payload = JSON.stringify({ k: key, v: value });
      void runRedisCommand(['SET', this.storageKey(key), payload, 'EX', this.defaultTtlSec]).catch(
        () => {}
      );
    }
    return this;
  }

  override delete(key: string): boolean {
    const removed = super.delete(key);
    if (process.env.REDIS_URL?.trim()) {
      void runRedisCommand(['DEL', this.storageKey(key)]).catch(() => {});
    }
    return removed;
  }

  async hydrateFromRedis(maxEntries: number = 500): Promise<number> {
    if (!process.env.REDIS_URL?.trim()) return 0;
    const keysRes = await runRedisCommand(['KEYS', `${this.prefix}*`]);
    if (!keysRes.ok || !Array.isArray(keysRes.value)) return 0;
    let restored = 0;
    for (const redisKey of keysRes.value.slice(0, maxEntries)) {
      const valRes = await runRedisCommand(['GET', redisKey]);
      if (valRes.ok && typeof valRes.value === 'string') {
        try {
          const parsed = JSON.parse(valRes.value) as { k?: string; v?: V };
          if (typeof parsed?.k === 'string' && parsed.v !== undefined) {
            super.set(parsed.k, parsed.v);
            restored++;
          }
        } catch {
          // Ignore malformed entry
        }
      }
    }
    return restored;
  }
}

export async function loadRedisJson<T>(key: string): Promise<T | null> {
  if (!process.env.REDIS_URL?.trim()) return null;
  const res = await runRedisCommand(['GET', key]);
  if (!res.ok || typeof res.value !== 'string') return null;
  try {
    return JSON.parse(res.value) as T;
  } catch {
    return null;
  }
}

export async function saveRedisJson(
  key: string,
  value: unknown,
  ttlSec: number = 86_400
): Promise<boolean> {
  if (!process.env.REDIS_URL?.trim()) return false;
  const res = await runRedisCommand(['SET', key, JSON.stringify(value), 'EX', ttlSec]);
  return res.ok;
}
