import { describe, expect, it } from 'vitest';
import {
  buildAdminHealthSummary,
  countIssuesBySection,
  type AdminHealthInput,
} from './adminHealthSummary';
import type { CustomerRecord, McpTowerService, ProviderKeyItem } from '../types';

const NOW = Date.parse('2026-11-27T10:00:00Z');

const base = (over: Partial<AdminHealthInput> = {}): AdminHealthInput => ({
  customers: [],
  mcpServices: [],
  healthSnapshot: null,
  deployments: [],
  providers: [],
  jobs: [],
  workers: [],
  securityEvents: [],
  pendingHitlCount: 0,
  schemaTables: [],
  maintenanceMode: false,
  allowNewSignups: true,
  now: NOW,
  ...over,
});

const provider = (id: string, status: ProviderKeyItem['status']): ProviderKeyItem => ({
  id,
  provider: id,
  displayName: id.toUpperCase(),
  maskedKey: 'sk-***',
  status,
  latencyMs: 120,
  priority: 1,
  lastChecked: '2026-11-27T09:59:00Z',
  rateLimitTpm: '1M',
});

const service = (id: string, status: McpTowerService['status']): McpTowerService => ({
  id,
  name: id,
  displayName: id,
  category: 'core',
  port: 0,
  status,
  uptime: '1d',
  latencyMs: 80,
  cpuPercent: 0,
  memoryMb: 0,
  lastChecked: '',
  version: '1',
  endpoint: `/api/${id}`,
  errorCount: 0,
  logs: [],
});

describe('buildAdminHealthSummary', () => {
  it('is green when everything is healthy', () => {
    const s = buildAdminHealthSummary(
      base({
        providers: [provider('openai', 'healthy')],
        mcpServices: [service('api', 'healthy')],
        deployments: [
          {
            id: 'gh',
            provider: 'GitHub Actions',
            service: 'main',
            deployedAt: null,
            status: 'success',
            commit: 'abc',
          },
        ],
      })
    );
    expect(s.overall).toBe('ok');
    expect(s.counts.critical).toBe(0);
    expect(s.score).toBe(100);
    expect(s.areas.find((a) => a.id === 'services')?.status).toBe('ok');
  });

  it('turns red and links to the fix tab when a deploy fails or a service is down', () => {
    const s = buildAdminHealthSummary(
      base({
        providers: [provider('openai', 'healthy')],
        mcpServices: [service('api', 'unhealthy')],
        deployments: [
          {
            id: 'core',
            provider: 'GitHub Actions',
            service: 'supremeai (main)',
            deployedAt: null,
            status: 'failure',
            commit: null,
          },
        ],
      })
    );
    expect(s.overall).toBe('critical');
    const deploy = s.issues.find((i) => i.id === 'issue-dep-core');
    expect(deploy?.severity).toBe('critical');
    expect(deploy?.targetTab).toBe('github-pipeline');
    expect(s.issues.find((i) => i.id === 'issue-svc-api')?.targetTab).toBe('mcp-tower');
    expect(s.issues[0].severity).toBe('critical');
  });

  it('distinguishes "no provider keys" (critical) from "could not load" (warning)', () => {
    const none = buildAdminHealthSummary(base({ providers: [] }));
    expect(none.issues.find((i) => i.id === 'issue-providers-none')?.severity).toBe('critical');
    const unknown = buildAdminHealthSummary(base({ providers: null }));
    expect(unknown.issues.find((i) => i.id === 'issue-providers-unknown')?.severity).toBe(
      'warning'
    );
    expect(unknown.areas.find((a) => a.id === 'ai')?.metrics[0].value).toBe('—');
  });

  it('flags unconfigured deploy status, maintenance lock, approvals and failed jobs', () => {
    const s = buildAdminHealthSummary(
      base({
        providers: [provider('groq', 'degraded')],
        deployments: [
          {
            id: 'cf',
            provider: 'Cloudflare Pages',
            service: 'studio',
            deployedAt: null,
            status: 'unconfigured',
            commit: null,
          },
        ],
        maintenanceMode: true,
        pendingHitlCount: 2,
        jobs: [
          {
            id: 'j1',
            queueName: 'ai-reasoning',
            taskType: 'x',
            payloadSummary: '',
            status: 'dlq',
            attempts: 3,
            maxAttempts: 3,
            latencyMs: 0,
            createdAt: '',
            errorDetails: 'timeout',
          },
        ],
      })
    );
    const ids = s.issues.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'issue-dep-config-cf',
        'issue-maintenance',
        'issue-hitl-pending',
        'issue-queue-failed',
        'issue-provider-groq',
      ])
    );
    expect(s.overall).toBe('warning');
    expect(s.issues.find((i) => i.id === 'issue-maintenance')?.targetTab).toBe('platform-settings');
  });

  it('counts users, new signups and only recent unblocked high-risk events', () => {
    const cust = (
      id: string,
      joined: string,
      status: CustomerRecord['status']
    ): CustomerRecord => ({
      id,
      name: id,
      email: `${id}@x.com`,
      tier: 'Free',
      status,
      mrr: 10,
      tokensUsed: 95,
      tokenLimit: 100,
      connectedRepos: 0,
      joinedDate: joined,
      lastActive: joined,
      region: 'BD',
    });
    const s = buildAdminHealthSummary(
      base({
        providers: [provider('a', 'healthy')],
        customers: [cust('a', '2026-11-25', 'active'), cust('b', '2026-01-01', 'past_due')],
        securityEvents: [
          {
            id: 'old',
            timestamp: '2026-11-20T00:00:00Z',
            severity: 'critical',
            category: 'suspicious_ip',
            sourceIp: '1.1.1.1',
            customerEmail: '',
            description: 'old',
            blocked: false,
          },
          {
            id: 'new',
            timestamp: '2026-11-27T09:00:00Z',
            severity: 'high',
            category: 'prompt_injection',
            sourceIp: '2.2.2.2',
            customerEmail: '',
            description: 'new attack',
            blocked: false,
          },
          {
            id: 'blk',
            timestamp: '2026-11-27T09:00:00Z',
            severity: 'critical',
            category: 'suspicious_ip',
            sourceIp: '3.3.3.3',
            customerEmail: '',
            description: 'blocked',
            blocked: true,
          },
        ],
      })
    );
    const users = s.areas.find((a) => a.id === 'users')!;
    expect(users.metrics.find((m) => m.label === 'New (7d)')?.value).toBe('1');
    expect(users.metrics.find((m) => m.label === 'MRR')?.value).toBe('$20');
    const threat = s.issues.find((i) => i.id === 'issue-security-threats');
    expect(threat?.title).toContain('1 unblocked');
    expect(s.issues.find((i) => i.id === 'issue-users-near-limit')?.severity).toBe('info');
  });

  it('groups issue counts by nav section', () => {
    const s = buildAdminHealthSummary(
      base({ providers: [provider('x', 'unhealthy')], pendingHitlCount: 1 })
    );
    const bySection = countIssuesBySection(s.issues);
    expect(bySection.ai?.critical).toBeGreaterThanOrEqual(1);
    expect(bySection.security?.warning).toBe(1);
  });

  it('reports live-data outages honestly', () => {
    const s = buildAdminHealthSummary(
      base({
        providers: [provider('x', 'healthy')],
        domainErrors: [{ domain: 'serviceHealth', error: 'HTTP 502' }],
      })
    );
    const issue = s.issues.find((i) => i.id === 'issue-domain-serviceHealth');
    expect(issue?.detail).toBe('HTTP 502');
    expect(issue?.targetTab).toBe('health-monitor');
  });

  it('says "vault not linked" (warning) instead of "no keys" when Infisical cannot be read', () => {
    const s = buildAdminHealthSummary(
      base({
        providers: [],
        vault: { connected: false, missingEnv: ['INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET'] },
      })
    );
    expect(s.issues.find((i) => i.id === 'issue-providers-none')).toBeUndefined();
    const vault = s.issues.find((i) => i.id === 'issue-vault-not-linked');
    expect(vault?.severity).toBe('warning');
    expect(vault?.detail).toContain('INFISICAL_CLIENT_ID');
    expect(vault?.targetTab).toBe('provider-keys');
  });

  it('turns missing connections into routed warnings without duplicating the vault issue', () => {
    const s = buildAdminHealthSummary(
      base({
        providers: [],
        vault: { connected: false, missingEnv: ['INFISICAL_PROJECT_ID'] },
        connections: [
          {
            id: 'infisical',
            name: 'Infisical vault',
            status: 'missing',
            detail: 'x',
            missingEnv: ['INFISICAL_PROJECT_ID'],
            targetTab: 'provider-keys',
          },
          {
            id: 'github',
            name: 'GitHub (CI & PRs)',
            status: 'error',
            detail: 'Token rejected (HTTP 401)',
            missingEnv: [],
            targetTab: 'github-pipeline',
          },
          {
            id: 'supabase',
            name: 'Supabase',
            status: 'connected',
            detail: 'ok',
            missingEnv: [],
            targetTab: 'customers',
          },
        ],
      })
    );
    expect(s.issues.find((i) => i.id === 'issue-connection-infisical')).toBeUndefined();
    expect(s.issues.find((i) => i.id === 'issue-connection-supabase')).toBeUndefined();
    const gh = s.issues.find((i) => i.id === 'issue-connection-github');
    expect(gh?.title).toBe('GitHub (CI & PRs) has a problem');
    expect(gh?.targetTab).toBe('github-pipeline');
  });
});
