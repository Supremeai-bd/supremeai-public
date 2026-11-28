// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPrivateOrReservedIpLiteral } from './ipClassifier';
import { isPrivateIpAddress, isRestrictedProxyTarget } from './serverSecurity';
import { isRestrictedEdgeHost } from '../../functions/_lib/edgeHelpers';
import { onRequest as internalAlertsOnRequest } from '../../functions/api/internal/alerts';
import { buildChannelSecret } from '../../functions/_lib/adminAlerts';
import { executeVirtualPhpProject } from '../utils/phpPreviewRuntime';

describe('Unified IPv4/IPv6 SSRF Classifier & Edge/Node Parity', () => {
  it('blocks IPv6 ULA (fc00::/7), link-local (fe80::/10), and site-local (fec0::/10) across Edge and Node', () => {
    const privateIpv6Literals = [
      '::',
      '::1',
      '0:0:0:0:0:0:0:1',
      'fc00::1',
      'fd00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'fe80::1%eth0',
      'febf::abcd',
      'fec0::1',
      'ff02::1',
      '::7f00:1', // RFC 4291 deprecated IPv4-compatible 127.0.0.1
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '0:0:0:0:0:ffff:7f00:1',
      '64:ff9b::127.0.0.1', // NAT64 loopback
      '64:ff9b::a9fe:a9fe', // NAT64 cloud metadata 169.254.169.254
      '64:ff9b:1::c0a8:101', // RFC 8215 local-use NAT64 192.168.1.1
      '2002:7f00:0001::1', // 6to4 loopback
      '2002:0a00:0001::1', // 6to4 10.0.0.1
      '100::1', // RFC 6666 discard prefix
      '2001:db8::1', // RFC 3849 documentation prefix
    ];

    for (const ip of privateIpv6Literals) {
      expect(isPrivateOrReservedIpLiteral(ip), `classifier(${ip})`).toBe(true);
      expect(isPrivateIpAddress(ip), `node isPrivateIpAddress(${ip})`).toBe(true);
      const cleanBracket = `[${ip.split('%')[0]}]`;
      expect(isRestrictedEdgeHost(cleanBracket), `edge isRestrictedEdgeHost(${cleanBracket})`).toBe(
        true
      );
      const parsed = new URL(`http://${cleanBracket}/`);
      expect(
        isRestrictedProxyTarget(parsed, false).restricted,
        `node isRestrictedProxyTarget(${cleanBracket})`
      ).toBe(true);
    }
  });

  it('allows public IPv6 unicast, public NAT64/IPv4-mapped targets, and fc*/fd*/fe* public domains', () => {
    const publicIpv6 = [
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
      '0:0:0:0:0:ffff:8.8.8.8',
      '64:ff9b::0808:0808',
      '2002:0808:0808::1',
    ];
    for (const ip of publicIpv6) {
      expect(isPrivateOrReservedIpLiteral(ip), `public ip ${ip}`).toBe(false);
      expect(isPrivateIpAddress(ip), `node public ip ${ip}`).toBe(false);
      expect(isRestrictedEdgeHost(`[${ip}]`), `edge public ip ${ip}`).toBe(false);
    }

    const publicDomains = ['fcbarcelona.com', 'fdroid.org', 'fedoraproject.org', 'api.github.com'];
    for (const domain of publicDomains) {
      expect(isPrivateOrReservedIpLiteral(domain)).toBeNull();
      expect(isRestrictedEdgeHost(domain)).toBe(false);
      expect(isRestrictedProxyTarget(new URL(`https://${domain}/`), false).restricted).toBe(false);
    }
  });

  it('blocks shorthand, hex, octal, and malformed IPv4 literals while permitting public IPv4', () => {
    for (const restrictedV4 of [
      '127.1',
      '2130706433',
      '0x7f000001',
      '0177.0.0.1',
      '09.0.0.1', // invalid leading zero fails closed
      '169.254.169.254',
      '100.64.0.1',
      '198.51.100.5',
      '203.0.113.9',
    ]) {
      expect(isPrivateOrReservedIpLiteral(restrictedV4), restrictedV4).toBe(true);
      expect(isRestrictedEdgeHost(restrictedV4), restrictedV4).toBe(true);
    }

    expect(isPrivateOrReservedIpLiteral('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIpLiteral('1.1.1.1')).toBe(false);
  });
});

describe('POST /api/internal/alerts & Webhook SSRF Hardening', () => {
  it('handles OPTIONS preflight as 204 and routes POST requests to handleAlertIngest instead of swallowing as 204', async () => {
    const env = {
      ALERT_INGEST_TOKEN: 'sec_alert_tok_123',
      ALLOWED_ORIGINS: 'https://studio.supremeai.bd',
    };

    const preflightRes = await internalAlertsOnRequest({
      request: new Request('https://studio.supremeai.bd/api/internal/alerts', {
        method: 'OPTIONS',
        headers: { Origin: 'https://studio.supremeai.bd' },
      }),
      env,
    });
    expect(preflightRes.status).toBe(204);
    expect(preflightRes.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://studio.supremeai.bd'
    );

    const unauthPost = await internalAlertsOnRequest({
      request: new Request('https://studio.supremeai.bd/api/internal/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ severity: 'critical', source: 'ci', title: 'Probe failed' }),
      }),
      env,
    });
    expect(unauthPost.status).toBe(401);

    const badTokenPost = await internalAlertsOnRequest({
      request: new Request('https://studio.supremeai.bd/api/internal/alerts', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wrong_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ severity: 'critical', source: 'ci', title: 'Probe failed' }),
      }),
      env,
    });
    expect(badTokenPost.status).toBe(403);
  });

  it('blocks internal, metadata, and IP-literal URLs in alert webhook channel secrets', () => {
    expect(buildChannelSecret('webhook', { url: 'https://metadata.google.internal/hook' }).ok).toBe(
      false
    );
    expect(buildChannelSecret('webhook', { url: 'https://gateway.internal/hook' }).ok).toBe(false);
    expect(buildChannelSecret('webhook', { url: 'https://127.0.0.1/hook' }).ok).toBe(false);
    expect(buildChannelSecret('webhook', { url: 'https://[fd00::1]/hook' }).ok).toBe(false);
    expect(buildChannelSecret('webhook', { url: 'http://hooks.example.com/alert' }).ok).toBe(false);

    const valid = buildChannelSecret('webhook', { url: 'https://hooks.example.com/alerts/9876' });
    expect(valid.ok).toBe(true);
  });
});

describe('PHP Preview Runtime strict vs loose in_array & comparisons', () => {
  it('evaluates loose == vs strict === and in_array($needle, $haystack, $strict) accurately', () => {
    const result = executeVirtualPhpProject({
      entryPath: 'index.php',
      files: [
        {
          path: 'index.php',
          language: 'php',
          content: `<?php
$nums = [42, "hello"];
$loose = in_array("42", $nums) ? "yes" : "no";
$strictMiss = in_array("42", $nums, true) ? "yes" : "no";
$strictHit = in_array(42, $nums, true) ? "yes" : "no";
$eq = ("42" == 42) ? "eq" : "neq";
echo "$loose|$strictMiss|$strictHit|$eq";
?>`,
        },
      ],
    });
    expect(result.rawOutput.trim()).toBe('yes|no|yes|eq');
  });
});
