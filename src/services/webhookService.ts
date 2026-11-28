import { apiClient } from './apiClient';
import { env } from '../config/env';
import { WebhookItem } from '../types';
import { INITIAL_WEBHOOKS } from '../data/customerWorkspaceData';

export const webhookService = {
  async fetchWebhooks(): Promise<WebhookItem[]> {
    if (env.isMockEnabled) {
      return INITIAL_WEBHOOKS;
    }
    try {
      const res = await apiClient.get<{ webhooks: WebhookItem[] }>('/api/user/webhooks');
      if (res && Array.isArray(res.webhooks)) {
        return res.webhooks;
      }
      return [];
    } catch {
      return [];
    }
  },

  async createWebhook(
    newWebhook: Omit<WebhookItem, 'id' | 'lastTriggered' | 'failureCount'>
  ): Promise<WebhookItem> {
    const fallbackItem: WebhookItem = {
      ...newWebhook,
      id: `wh_${Date.now()}`,
      lastTriggered: 'Never',
      failureCount: 0,
    };
    if (env.isMockEnabled) {
      return fallbackItem;
    }
    const res = await apiClient.post<{ webhook?: WebhookItem }>('/api/user/webhooks', {
      name: newWebhook.name,
      url: newWebhook.url,
      events: newWebhook.events,
      secret: newWebhook.secret,
      active: newWebhook.active,
    });
    if (res && res.webhook) {
      return {
        ...fallbackItem,
        ...res.webhook,
        name: res.webhook.name || newWebhook.name,
      };
    }
    throw new Error('Server did not return a created webhook');
  },

  async deleteWebhook(id: string): Promise<boolean> {
    if (env.isMockEnabled) {
      return true;
    }
    try {
      await apiClient.delete(`/api/user/webhooks/${encodeURIComponent(id)}`);
      return true;
    } catch {
      return false;
    }
  },

  async testWebhook(
    id: string
  ): Promise<{ success: boolean; status_code?: number; error?: string }> {
    if (env.isMockEnabled) {
      return { success: true, status_code: 200 };
    }
    try {
      const res = await apiClient.post<{ success: boolean; status_code?: number; error?: string }>(
        `/api/user/webhooks/${encodeURIComponent(id)}/test`,
        {}
      );
      return res || { success: true, status_code: 200 };
    } catch (err: unknown) {
      return {
        success: false,
        status_code: 0,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  },
};
