/**
 * GmailAdapter — UniversalInboxPanel থেকে extract করা Gmail channel logic।
 * বাংলা মন্তব্য: UI আগের মতোই একই কল করবে; adapter শুধু contract
 * (`packages/contracts/inbox-adapter.ts`) মেনে list/detail/availability দেয়।
 * OAuth session (connect/disconnect/token cache) gmailOAuthService-এ থাকে —
 * adapter কখনো token নিজে রাখে না।
 */

import type {
  InboxAdapter,
  InboxAvailability,
  InboxItem,
  InboxItemDetail,
  InboxListOptions,
} from '../../../packages/contracts/inbox-adapter';
import {
  clearExpiredGmailSession,
  fetchGmailInbox,
  fetchGmailMessageDetail,
  getGmailCachedToken,
  type GmailMessageDetail,
  type GmailMessageSummary,
} from '../../services/gmailOAuthService';

/** Map Gmail API summary → contract InboxItem (UI-identical fields). */
export function mapGmailSummaryToInboxItem(m: GmailMessageSummary): InboxItem {
  return {
    id: m.id,
    channel: 'gmail',
    sender: m.from || 'Unknown Sender',
    subject: m.subject || '(No subject)',
    snippet: m.snippet || '',
    timestamp: m.date || '',
    unread: Boolean(m.isUnread),
  };
}

export function mapGmailDetailToInboxItemDetail(d: GmailMessageDetail): InboxItemDetail {
  return {
    ...mapGmailSummaryToInboxItem(d),
    body: d.textBody || d.htmlBody || d.snippet || '',
    replyRef: d.threadId,
  };
}

export interface GmailAdapterDeps {
  /** Injectable for tests; defaults to live gmailOAuthService. */
  getToken?: () => string | null;
  fetchInbox?: typeof fetchGmailInbox;
  fetchDetail?: typeof fetchGmailMessageDetail;
  clearExpired?: typeof clearExpiredGmailSession;
}

/**
 * Cloud-OAuth Gmail channel. Token is resolved per call via getToken()
 * (default: getGmailCachedToken) so auth state stays in gmailOAuthService.
 */
export class GmailAdapter implements InboxAdapter {
  readonly channel = 'gmail' as const;
  readonly mode = 'cloud-oauth' as const;

  private readonly getToken: () => string | null;
  private readonly fetchInbox: typeof fetchGmailInbox;
  private readonly fetchDetail: typeof fetchGmailMessageDetail;
  private readonly clearExpired: typeof clearExpiredGmailSession;

  constructor(deps: GmailAdapterDeps = {}) {
    this.getToken = deps.getToken ?? getGmailCachedToken;
    this.fetchInbox = deps.fetchInbox ?? fetchGmailInbox;
    this.fetchDetail = deps.fetchDetail ?? fetchGmailMessageDetail;
    this.clearExpired = deps.clearExpired ?? clearExpiredGmailSession;
  }

  async isAvailable(): Promise<InboxAvailability> {
    if (this.getToken()) return { ok: true };
    return { ok: false, reason: 'Gmail not connected — use official Google OAuth first.' };
  }

  async list(opts?: InboxListOptions): Promise<InboxItem[]> {
    const token = this.getToken();
    if (!token) return [];
    try {
      const list = await this.fetchInbox(token, {
        maxResults: opts?.limit ?? 20,
        query: opts?.query ?? '',
      });
      return list.map(mapGmailSummaryToInboxItem);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load Gmail inbox.';
      if (msg.toLowerCase().includes('expired')) {
        await this.clearExpired();
      }
      throw new Error(msg, { cause: err });
    }
  }

  async detail(id: string): Promise<InboxItemDetail> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Gmail not connected.');
    }
    const d = await this.fetchDetail(token, id);
    return mapGmailDetailToInboxItemDetail(d);
  }
}

/** Singleton used by UniversalInboxPanel (swap in tests via constructor). */
export const gmailAdapter = new GmailAdapter();
