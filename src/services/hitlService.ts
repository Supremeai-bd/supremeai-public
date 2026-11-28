import { apiClient } from './apiClient';
import { env } from '../config/env';
import { unwrapCollection } from './federationBridge';

export interface HitlPendingRecord {
  id: string;
  action_name: string;
  command?: string;
  module?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['pending', 'approved', 'rejected'] as const;

/**
 * Tolerant mapper for `/api/v1/hitl/pending` payloads. The gateway returns
 * either a bare array or an envelope (`pending` / `tickets` / `items`), and the
 * federation snapshot stores whatever arrived, so both shapes must work.
 */
export function normalizeHitlPayload(payload: unknown): HitlPendingRecord[] {
  const records = unwrapCollection<Record<string, unknown>>(payload, [
    'pending',
    'tickets',
    'items',
    'records',
  ]);

  return records
    .map((raw, index) => {
      const context =
        raw.context && typeof raw.context === 'object'
          ? (raw.context as Record<string, unknown>)
          : undefined;

      const severityRaw = String(raw.severity ?? context?.severity ?? 'high').toLowerCase();
      const severity = (SEVERITIES as readonly string[]).includes(severityRaw)
        ? (severityRaw as HitlPendingRecord['severity'])
        : 'high';

      const statusRaw = String(raw.status ?? 'pending').toLowerCase();
      const status = (STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as HitlPendingRecord['status'])
        : 'pending';

      return {
        id: String(raw.id ?? raw.record_id ?? context?.record_id ?? `hitl_${index}`),
        action_name: String(
          raw.action_name ?? raw.action ?? raw.message ?? 'Sensitive Action Requires Approval'
        ),
        command: raw.command ? String(raw.command) : undefined,
        module: raw.module ? String(raw.module) : undefined,
        severity,
        context,
        created_at: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
        status,
      } satisfies HitlPendingRecord;
    })
    .filter((record) => record.status === 'pending');
}

export const hitlService = {
  async getPending(): Promise<HitlPendingRecord[]> {
    if (env.isMockEnabled) {
      return [];
    }
    try {
      const res = await apiClient.get<unknown>('/api/v1/hitl/pending');
      return normalizeHitlPayload(res);
    } catch {
      return [];
    }
  },

  async approve(recordId: string): Promise<boolean> {
    if (env.isMockEnabled) {
      return true;
    }
    try {
      await apiClient.post(`/api/v1/hitl/approve/${encodeURIComponent(recordId)}`);
      return true;
    } catch {
      return false;
    }
  },

  async reject(recordId: string, reason: string): Promise<boolean> {
    if (env.isMockEnabled) {
      return true;
    }
    try {
      await apiClient.post(`/api/v1/hitl/reject/${encodeURIComponent(recordId)}`, { reason });
      return true;
    } catch {
      return false;
    }
  },
};
