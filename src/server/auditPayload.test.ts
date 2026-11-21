import { describe, it, expect } from 'vitest';
import { buildDurableAuditRow } from './auditPayload';

const baseEntry = {
  actor: 'admin@example.com',
  action: 'admin.config.update',
  resource: '/api/admin/config',
  details: 'maintenanceMode=true',
  ipAddress: '203.0.113.7',
};

describe('src/server/auditPayload.ts', () => {
  it('emits exactly the columns the durable audit table accepts', () => {
    const row = buildDurableAuditRow(baseEntry);
    expect(Object.keys(row).sort()).toEqual(
      ['action', 'actor', 'created_at', 'details', 'ip_address', 'resource'].sort()
    );
  });

  it('never sends the in-memory string id (audit_logs.id is bigint)', () => {
    // Regression guard: a preceding version forwarded `id: audit_<ts>_<rand>`
    // which Postgres rejected with 22P02, silently dropping every audit row.
    const row = buildDurableAuditRow(baseEntry) as Record<string, unknown>;
    expect(row).not.toHaveProperty('id');
  });

  it('never sends timestamp so the partition key keeps its DEFAULT', () => {
    // `timestamp` is the RANGE partition key. Sending a value that falls
    // outside an existing partition caused 23514 before the DEFAULT
    // partition existed; relying on DEFAULT now() is what the gateway does.
    const row = buildDurableAuditRow(baseEntry) as Record<string, unknown>;
    expect(row).not.toHaveProperty('timestamp');
  });

  it('maps ipAddress to the snake_case ip_address column', () => {
    expect(buildDurableAuditRow(baseEntry).ip_address).toBe('203.0.113.7');
  });

  it('stamps an ISO-8601 created_at', () => {
    const row = buildDurableAuditRow(baseEntry, new Date('2026-11-21T02:30:00.000Z'));
    expect(row.created_at).toBe('2026-11-21T02:30:00.000Z');
  });

  it('falls back to safe defaults for empty fields', () => {
    const row = buildDurableAuditRow({
      actor: '',
      action: '',
      resource: '',
      details: '',
      ipAddress: '',
    });
    expect(row.actor).toBe('system-operator');
    expect(row.action).toBe('unknown');
    expect(row.ip_address).toBe('127.0.0.1');
  });
});
