/**
 * Durable audit-trail row shaping.
 *
 * `public.audit_logs` is a RANGE-partitioned table whose `id` is a bigint
 * identity column. The gateway previously sent the local in-memory id
 * (`audit_<timestamp>_<rand>`, a string) which Postgres rejected with 22P02,
 * so every durable audit write failed silently inside a `.catch(() => {})`.
 *
 * Keeping the shape in one tested helper stops that from being reintroduced:
 * the database owns `id` and `timestamp` (via DEFAULT now()), and the caller
 * only supplies the semantic fields.
 */

export interface AuditEntry {
  actor: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
}

export interface DurableAuditRow {
  actor: string;
  action: string;
  resource: string;
  details: string;
  ip_address: string;
  created_at: string;
}

/**
 * Builds the row posted to Supabase `audit_logs`.
 *
 * Deliberately excludes `id` and `timestamp`:
 *  - `id` is a bigint identity column; sending a string id fails with 22P02.
 *  - `timestamp` is the partition key and has `DEFAULT now()`; omitting it
 *    keeps the row in the catch-all partition instead of failing on a
 *    missing monthly range.
 */
export function buildDurableAuditRow(entry: AuditEntry, now: Date = new Date()): DurableAuditRow {
  return {
    actor: String(entry.actor || 'system-operator'),
    action: String(entry.action || 'unknown'),
    resource: String(entry.resource || ''),
    details: String(entry.details || ''),
    ip_address: String(entry.ipAddress || '127.0.0.1'),
    created_at: now.toISOString(),
  };
}
