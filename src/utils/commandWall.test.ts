import { describe, expect, it } from 'vitest';
import { buildWallNodes, describeWallNode, sparklinePoints, type WallInput } from './commandWall';
import type { McpHealthMonitorSnapshot } from '../types/controlCenter';

const NOW = Date.parse('2026-11-27T12:00:00Z');

const snapshot = {
  services: [
    {
      id: 'core-api',
      name: 'core-api',
      displayName: 'Core API',
      provider: 'Render',
      category: 'compute',
      status: 'degraded',
      latencyMs: 820,
      p50LatencyMs: 400,
      p95LatencyMs: 900,
      cpuPercent: 71,
      memoryMb: 410,
      memoryPercent: 80,
      consecutiveFailures: 2,
      errorMessage: 'Timeout after 5s',
      checkedAt: '2026-11-27T11:59:00Z',
      history: [{ latencyMs: 300 }, { latencyMs: null }, { latencyMs: 600 }, { latencyMs: 820 }],
    },
  ],
  alerts: [
    {
      serviceId: 'core-api',
      message: 'Latency high',
      valueLabel: '820 ms',
      thresholdLabel: '500 ms',
    },
  ],
} as unknown as McpHealthMonitorSnapshot;

const base = (over: Partial<WallInput> = {}): WallInput => ({
  services: [
    {
      id: 'svc-core-api',
      name: 'Core API',
      provider: 'Render',
      status: 'warning',
      statusLabel: 'degraded',
      latencyMs: 820,
      detail: 'compute',
      targetTab: 'health-monitor',
    },
    {
      id: 'svc-edge',
      name: 'Edge',
      provider: 'Cloudflare',
      status: 'ok',
      statusLabel: 'healthy',
      latencyMs: 40,
      detail: 'edge',
      targetTab: 'health-monitor',
    },
  ],
  healthSnapshot: snapshot,
  connections: [
    {
      id: 'mcp-tower',
      name: 'MCP Tower',
      status: 'missing',
      detail: 'token not set',
      missingEnv: ['SUPREMEAI_TOWER_TOKEN'],
      targetTab: 'mcp-tower',
    },
    {
      id: 'github',
      name: 'GitHub',
      status: 'connected',
      detail: 'ok',
      missingEnv: [],
      targetTab: 'github-pipeline',
    },
  ],
  providers: [
    {
      id: 'k1',
      provider: 'openai',
      displayName: 'OpenAI',
      maskedKey: 'sk-…abcd',
      status: 'unhealthy',
      latencyMs: 0,
      priority: 1,
      lastChecked: '2026-11-27T11:00:00Z',
      rateLimitTpm: '90k',
    },
  ],
  workers: [
    {
      id: 'w1',
      name: 'Solver',
      type: 'solver',
      status: 'error',
      currentTask: 'fix #12',
      currentIssueOrPr: '',
      processedCount: 9,
      successRate: 77.7,
      cpuPercent: 10,
      memoryMb: 100,
      uptime: '1h',
      logs: ['a', 'b', 'c'],
    },
  ],
  jobs: [
    {
      id: 'j1',
      queueName: 'ai-reasoning',
      taskType: 'chat',
      payloadSummary: '',
      status: 'dlq',
      attempts: 3,
      maxAttempts: 3,
      latencyMs: 0,
      createdAt: '',
      errorDetails: 'quota',
    },
    {
      id: 'j2',
      queueName: 'ai-reasoning',
      taskType: 'chat',
      payloadSummary: '',
      status: 'waiting',
      attempts: 0,
      maxAttempts: 3,
      latencyMs: 0,
      createdAt: '',
    },
  ],
  securityEvents: [
    {
      id: 'e1',
      timestamp: '2026-11-27T10:00:00Z',
      severity: 'high',
      category: 'suspicious_ip',
      sourceIp: '1.2.3.4',
      customerEmail: '',
      description: 'scan',
      blocked: false,
    },
  ],
  pendingHitlCount: 2,
  deployments: [
    {
      id: 'd1',
      provider: 'render',
      service: 'core',
      deployedAt: null,
      status: 'failed',
      commit: 'abcdef1234567',
    },
  ],
  schemaTables: [],
  customers: [],
  maintenanceMode: true,
  allowNewSignups: true,
  issues: [
    {
      id: 'i1',
      severity: 'critical',
      area: 'services',
      title: 'Core API is slow',
      detail: 'p95 above threshold',
      actionLabel: 'Open health',
      targetTab: 'health-monitor',
    },
  ],
  now: NOW,
  ...over,
});

describe('buildWallNodes (L2)', () => {
  it('services: snapshot rows + matching connections, worst first', () => {
    const nodes = buildWallNodes('services', base());
    expect(nodes.map((n) => n.id)).toEqual([
      'service:svc-core-api',
      'connection:mcp-tower',
      'service:svc-edge',
    ]);
    expect(nodes[0]).toMatchObject({ status: 'warning', metric: '820 ms' });
  });

  it('ai / agents / security / deploy / settings map real store data', () => {
    const input = base();
    expect(buildWallNodes('ai', input)[0]).toMatchObject({ id: 'provider:k1', status: 'critical' });
    const agents = buildWallNodes('agents', input);
    expect(agents.map((n) => n.id)).toEqual(['worker:w1', 'queue:all']);
    expect(agents[1].metric).toBe('1 failed');
    const sec = buildWallNodes('security', input);
    expect(sec.find((n) => n.id === 'security:firewall')!.status).toBe('critical');
    expect(sec.find((n) => n.id === 'approvals:hitl')!.metric).toBe('2');
    const deploy = buildWallNodes('deploy', input);
    expect(deploy[0]).toMatchObject({ id: 'deployment:d1', status: 'critical' });
    expect(deploy.some((n) => n.id === 'connection:github')).toBe(true);
    expect(buildWallNodes('settings', input)[0]).toMatchObject({
      id: 'setting:maintenance',
      status: 'warning',
      metric: 'ON',
    });
  });

  it('copes with nothing loaded yet', () => {
    const empty = base({ providers: null, connections: null, deployments: null, services: [] });
    expect(buildWallNodes('ai', empty)).toEqual([]);
    expect(buildWallNodes('services', empty)).toEqual([]);
    expect(buildWallNodes('deploy', empty).map((n) => n.status)).toEqual(['unknown']);
  });
});

describe('describeWallNode (L3)', () => {
  it('service: metrics, sparkline, errors, alerts and related issues', () => {
    const input = base();
    const node = buildWallNodes('services', input)[0];
    const d = describeWallNode(node, input);
    expect(d.action).toBe('recheck-services');
    expect(d.latencySeries).toEqual([300, 600, 820]);
    expect(d.fields.find((f) => f.label === 'p50 / p95')!.value).toBe('400 / 900 ms');
    expect(d.problems).toEqual(['Timeout after 5s', 'Latency high (820 ms > 500 ms)']);
    expect(d.relatedIssues.map((i) => i.id)).toEqual(['i1']);
  });

  it('prefers the freshly fetched snapshot', () => {
    const input = base();
    const node = buildWallNodes('services', input)[0];
    const fresh = {
      services: [{ ...snapshot.services[0], latencyMs: 120, errorMessage: undefined, history: [] }],
      alerts: [],
    } as unknown as McpHealthMonitorSnapshot;
    const d = describeWallNode(node, input, fresh);
    expect(d.fields.find((f) => f.label === 'Latency')!.value).toBe('120 ms');
    expect(d.problems).toEqual([]);
  });

  it('provider, queue, worker and connection details', () => {
    const input = base();
    const prov = describeWallNode(buildWallNodes('ai', input)[0], input);
    expect(prov.action).toBe('test-provider');
    expect(prov.problems[0]).toMatch(/failed/);

    const [worker, queue] = buildWallNodes('agents', input);
    expect(describeWallNode(worker, input).logs).toEqual(['c', 'b', 'a']);
    const q = describeWallNode(queue, input);
    expect(q.action).toBe('retry-failed-jobs');
    expect(q.problems).toEqual(['chat: quota (3/3)']);

    const conn = buildWallNodes('services', input).find((n) => n.kind === 'connection')!;
    expect(describeWallNode(conn, input).problems).toEqual([
      'Missing settings: SUPREMEAI_TOWER_TOKEN',
    ]);
  });
});

describe('sparklinePoints', () => {
  it('needs at least two points and scales into the box', () => {
    expect(sparklinePoints([5])).toBe('');
    const pts = sparklinePoints([0, 10], 100, 20).split(' ');
    expect(pts).toEqual(['0.0,18.0', '100.0,2.0']);
  });
});
