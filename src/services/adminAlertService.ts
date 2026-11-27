import { apiClient } from './apiClient';

/** বাংলা মন্তব্য: edge `functions/_lib/adminAlerts.ts`-এর সাথে একই আকার। গোপন অংশ কখনো ফেরত আসে না। */
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannelKind = 'telegram' | 'discord' | 'slack' | 'webhook';

export interface AlertChannel {
  id: string;
  kind: AlertChannelKind;
  label: string;
  minSeverity: AlertSeverity;
  enabled: boolean;
  targetHint: string | null;
  lastStatus: 'ok' | 'failed' | 'untested';
  lastError: string | null;
  lastSentAt: string | null;
}

export interface AlertEvent {
  id: string;
  createdAt: string;
  severity: AlertSeverity;
  source: string;
  title: string;
  body: string | null;
  delivered: number;
  failed: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface AlertsState {
  channels: AlertChannel[];
  events: AlertEvent[];
}

/** Secret fields: telegram → botToken + chatId, everything else → url. */
export interface AlertChannelSecret {
  botToken?: string;
  chatId?: string;
  url?: string;
}

export interface ChannelSaveResult {
  channel: AlertChannel | null;
  verification?: { ok: boolean; error?: string };
}

export const adminAlertService = {
  async getState(): Promise<AlertsState> {
    const res = await apiClient.get<Partial<AlertsState>>('/api/admin/alerts');
    return {
      channels: Array.isArray(res.channels) ? res.channels : [],
      events: Array.isArray(res.events) ? res.events : [],
    };
  },
  async create(
    input: {
      kind: AlertChannelKind;
      label: string;
      minSeverity: AlertSeverity;
    } & AlertChannelSecret
  ): Promise<ChannelSaveResult> {
    return apiClient.post<ChannelSaveResult>('/api/admin/alerts/channels', input);
  },
  async update(
    id: string,
    patch: Partial<Pick<AlertChannel, 'label' | 'minSeverity' | 'enabled'>> & AlertChannelSecret
  ): Promise<ChannelSaveResult> {
    return apiClient.patch<ChannelSaveResult>(
      `/api/admin/alerts/channels/${encodeURIComponent(id)}`,
      patch
    );
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/api/admin/alerts/channels/${encodeURIComponent(id)}`);
  },
  async acknowledge(id: string): Promise<void> {
    await apiClient.post(`/api/admin/alerts/events/${encodeURIComponent(id)}/ack`, {});
  },
};
