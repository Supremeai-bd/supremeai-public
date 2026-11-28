/**
 * Runtime-agnostic IPv4 / IPv6 private, loopback, link-local, metadata, and
 * reserved-address classifier shared across Cloudflare Edge and Node.js SSRF guards.
 *
 * বাংলা মন্তব্য: Edge (`functions/_lib/edgeHelpers.ts`) এবং Node (`src/shared/serverSecurity.ts`)
 * উভয় রানটাইমে একই নিখুঁত বিট-স্তরের IPv4/IPv6 যাচাই নিশ্চিত করার একক উৎস।
 */

/** Checks a 32-bit unsigned IPv4 value against private, loopback, and reserved ranges. */
export function isPrivateIpv4Value(value: number): boolean {
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC 1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 + 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved
  return false;
}

/**
 * Parses inet_aton-style IPv4 literals ("10.0.0.1", "127.1", "2130706433", "0x7f000001")
 * into an unsigned 32-bit integer, or returns null when invalid/ambiguous.
 */
export function parseIpv4NumericLiteral(input: string): number | null {
  const parts = input.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) return null;
    let n: number;
    if (/^0x[0-9a-f]{1,8}$/i.test(part)) {
      n = parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
      n = parseInt(part, 8);
    } else if (/^\d{1,10}$/.test(part)) {
      if (part.length > 1 && part.startsWith('0')) return null; // mixed octal/decimal fails closed
      n = parseInt(part, 10);
    } else {
      return null;
    }

    const maxFinal =
      parts.length === 1
        ? 0xffffffff
        : parts.length === 2
          ? 0xffffff
          : parts.length === 3
            ? 0xffff
            : 255;
    if (!Number.isFinite(n) || n < 0 || (i < parts.length - 1 ? n > 255 : n > maxFinal)) {
      return null;
    }
    nums.push(n);
  }

  let value = 0;
  for (let i = 0; i < nums.length - 1; i += 1) {
    value = value * 256 + nums[i];
  }
  const finalShift = 8 * (5 - nums.length);
  return (value * Math.pow(2, finalShift) + nums[nums.length - 1]) >>> 0;
}

/** Parses strict dotted-quad IPv4 ("a.b.c.d") into two 16-bit hextets for embedded IPv6 tails. */
function parseStrictDottedQuadHextets(v4Text: string): [number, number] | null {
  const octets = v4Text.split('.');
  if (octets.length !== 4) return null;
  const bytes: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    if (octet.length > 1 && octet.startsWith('0')) return null;
    const b = parseInt(octet, 10);
    if (b < 0 || b > 255) return null;
    bytes.push(b);
  }
  return [((bytes[0] << 8) | bytes[1]) & 0xffff, ((bytes[2] << 8) | bytes[3]) & 0xffff];
}

/**
 * Expands an IPv6 literal (with at most one "::" and optional trailing dotted-quad IPv4)
 * into eight 16-bit hextets (`0x0000`–`0xffff`).
 */
export function expandIpv6Groups(rawAddr: string): number[] | null {
  // Strip optional RFC 6874 zone identifier (e.g. fe80::1%eth0 or fe80::1%25eth0)
  const addr = rawAddr.split('%')[0];
  if (!addr || !addr.includes(':')) return null;
  if ((addr.match(/::/g) || []).length > 1) return null;

  let working = addr;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const embeddedV4Tail = parseStrictDottedQuadHextets(working.slice(lastColon + 1));
    if (!embeddedV4Tail) return null;
    working = working.slice(0, lastColon);
    if (working.endsWith(':')) {
      // Preserve "::" compression marker when input was e.g. "::ffff:127.0.0.1" or "::127.0.0.1"
      working = `${working}0`;
      const expanded = expandPureHexIpv6(working, 7);
      if (!expanded) return null;
      return [...expanded.slice(0, 6), embeddedV4Tail[0], embeddedV4Tail[1]];
    }
    const expanded = expandPureHexIpv6(working, 6);
    if (!expanded) return null;
    return [...expanded, embeddedV4Tail[0], embeddedV4Tail[1]];
  }

  return expandPureHexIpv6(working, 8);
}

function expandPureHexIpv6(addr: string, targetGroups: number): number[] | null {
  let head: string[];
  let tail: string[];
  if (addr.includes('::')) {
    const [h, t] = addr.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
    if (head.length + tail.length > targetGroups - 1) return null;
  } else {
    head = addr.split(':');
    tail = [];
    if (head.length !== targetGroups) return null;
  }

  const parseGroup = (g: string): number =>
    /^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : -1;
  const headGroups = head.map(parseGroup);
  const tailGroups = tail.map(parseGroup);
  if (headGroups.some((g) => g === -1) || tailGroups.some((g) => g === -1)) return null;

  const zeroFill = new Array<number>(targetGroups - headGroups.length - tailGroups.length).fill(0);
  return [...headGroups, ...zeroFill, ...tailGroups];
}

function hextetsToIpv4Value(hi: number, lo: number): number {
  return (
    (((hi >>> 8) & 0xff) * 16777216 +
      (hi & 0xff) * 65536 +
      ((lo >>> 8) & 0xff) * 256 +
      (lo & 0xff)) >>>
    0
  );
}

/** Classifies eight 16-bit IPv6 hextets against private, loopback, and reserved ranges. */
export function isPrivateOrReservedIpv6Groups(groups: readonly number[]): boolean {
  if (groups.length !== 8) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  // ::/96 (covers :: unspecified, ::1 loopback, and deprecated RFC 4291 IPv4-compatible ::a.b.c.d)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return true;
  }

  // IPv4-mapped ::ffff:0:0/96 and IPv4-translated ::ffff:0:a.b.c.d/96
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    ((g4 === 0 && g5 === 0xffff) || (g4 === 0xffff && g5 === 0))
  ) {
    return isPrivateIpv4Value(hextetsToIpv4Value(g6, g7));
  }

  // Unique Local Unicast fc00::/7 -> top 7 bits 1111110x (0xfc00..0xfdff)
  if ((g0 & 0xfe00) === 0xfc00) return true;

  // Link-Local Unicast fe80::/10 -> top 10 bits 1111111010 (0xfe80..0xfebf)
  if ((g0 & 0xffc0) === 0xfe80) return true;

  // Deprecated Site-Local Unicast fec0::/10 -> top 10 bits 1111111011 (0xfec0..0xfeff)
  if ((g0 & 0xffc0) === 0xfec0) return true;

  // Multicast ff00::/8 -> top 8 bits 11111111 (0xff00..0xffff)
  if ((g0 & 0xff00) === 0xff00) return true;

  // Discard-Only 100::/64 (RFC 6666)
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;

  // Documentation 2001:db8::/32 (RFC 3849) & IETF/Teredo/Benchmarking 2001:0000::/23
  if (g0 === 0x2001 && (g1 === 0x0db8 || (g1 & 0xfe00) === 0x0000)) {
    if (g1 === 0x0000) {
      // Teredo 2001:0000::/32 embeds obfuscated client IPv4 (~g6, ~g7)
      return isPrivateIpv4Value(hextetsToIpv4Value(g6 ^ 0xffff, g7 ^ 0xffff));
    }
    return true;
  }

  // 6to4 2002::/16 embeds IPv4 in groups 1..2 (RFC 3056)
  if (g0 === 0x2002) {
    return isPrivateIpv4Value(hextetsToIpv4Value(g1, g2));
  }

  // NAT64 Well-Known Prefix 64:ff9b::/96 (RFC 6052) & Local-Use 64:ff9b:1::/48 (RFC 8215)
  if (
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) ||
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001)
  ) {
    return isPrivateIpv4Value(hextetsToIpv4Value(g6, g7));
  }

  return false;
}

/**
 * Pure, dependency-free IP-literal classifier shared by Edge + Node guards.
 * Returns `true` (restricted), `false` (public IP literal), or `null` (hostname, not an IP literal).
 * Unparseable IP-looking inputs fail CLOSED (`true`) by design.
 */
export function isPrivateOrReservedIpLiteral(host: string): boolean | null {
  const h = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!h) return true;

  if (h.includes(':')) {
    const groups = expandIpv6Groups(h);
    if (!groups) return true;
    return isPrivateOrReservedIpv6Groups(groups);
  }

  // Every DNS TLD has at least one alphabetic character; if every dot-separated label
  // is pure decimal or 0x-hex, treat as an IPv4 numeric/shorthand literal and fail closed on invalid.
  const labels = h.split('.');
  const looksNumericIpv4 =
    labels.length >= 1 &&
    labels.length <= 4 &&
    labels.every((label) => /^(0x[0-9a-f]+|\d+)$/i.test(label));
  if (looksNumericIpv4) {
    const value = parseIpv4NumericLiteral(h);
    if (value === null) return true;
    return isPrivateIpv4Value(value);
  }

  return null;
}
