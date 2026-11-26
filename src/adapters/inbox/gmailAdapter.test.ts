import { describe, expect, it, vi } from 'vitest';
import {
  GmailAdapter,
  mapGmailDetailToInboxItemDetail,
  mapGmailSummaryToInboxItem,
} from './gmailAdapter';
import { getInboxAdapter, listRegisteredChannels, setInboxAdapter } from './registry';

const summary = {
  id: 'm1',
  threadId: 't1',
  subject: 'Hello',
  from: 'Ada <ada@example.com>',
  date: 'Mon, 01 Jan 2026 00:00:00 +0000',
  snippet: 'Hi there',
  isUnread: true,
};

describe('Gmail mapping (contract parity)', () => {
  it('maps summary → InboxItem with channel gmail', () => {
    const item = mapGmailSummaryToInboxItem(summary);
    expect(item).toEqual({
      id: 'm1',
      channel: 'gmail',
      sender: 'Ada <ada@example.com>',
      subject: 'Hello',
      snippet: 'Hi there',
      timestamp: 'Mon, 01 Jan 2026 00:00:00 +0000',
      unread: true,
    });
  });

  it('maps detail → InboxItemDetail with body + replyRef', () => {
    const detail = mapGmailDetailToInboxItemDetail({
      ...summary,
      to: 'me@example.com',
      htmlBody: '<p>Hi</p>',
      textBody: 'Hi',
    });
    expect(detail.body).toBe('Hi');
    expect(detail.replyRef).toBe('t1');
    expect(detail.channel).toBe('gmail');
  });

  it('defaults missing fields honestly', () => {
    const item = mapGmailSummaryToInboxItem({
      id: 'x',
      threadId: 't',
      subject: '',
      from: '',
      date: '',
      snippet: '',
      isUnread: false,
    });
    expect(item.sender).toBe('Unknown Sender');
    expect(item.subject).toBe('(No subject)');
    expect(item.unread).toBe(false);
  });
});

describe('GmailAdapter', () => {
  it('isAvailable false without token', async () => {
    const a = new GmailAdapter({ getToken: () => null });
    const av = await a.isAvailable();
    expect(av.ok).toBe(false);
    expect(av.reason).toBeTruthy();
  });

  it('isAvailable true with token', async () => {
    const a = new GmailAdapter({ getToken: () => 'tok' });
    expect((await a.isAvailable()).ok).toBe(true);
  });

  it('list returns [] without token (no throw)', async () => {
    const a = new GmailAdapter({ getToken: () => null });
    expect(await a.list()).toEqual([]);
  });

  it('list maps fetchInbox results', async () => {
    const fetchInbox = vi.fn().mockResolvedValue([summary]);
    const a = new GmailAdapter({ getToken: () => 'tok', fetchInbox: fetchInbox as never });
    const items = await a.list({ limit: 5, query: 'hi' });
    expect(fetchInbox).toHaveBeenCalledWith('tok', { maxResults: 5, query: 'hi' });
    expect(items).toHaveLength(1);
    expect(items[0].channel).toBe('gmail');
  });

  it('list clears expired session on expiry error', async () => {
    const clearExpired = vi.fn().mockResolvedValue(undefined);
    const fetchInbox = vi.fn().mockRejectedValue(new Error('Gmail session expired. Please sign in again.'));
    const a = new GmailAdapter({
      getToken: () => 'tok',
      fetchInbox: fetchInbox as never,
      clearExpired: clearExpired as never,
    });
    await expect(a.list()).rejects.toThrow(/expired/i);
    expect(clearExpired).toHaveBeenCalled();
  });

  it('detail throws without token', async () => {
    const a = new GmailAdapter({ getToken: () => null });
    await expect(a.detail('m1')).rejects.toThrow(/not connected/i);
  });

  it('detail maps fetchDetail result', async () => {
    const fetchDetail = vi.fn().mockResolvedValue({
      ...summary,
      textBody: 'body text',
      htmlBody: '',
    });
    const a = new GmailAdapter({ getToken: () => 'tok', fetchDetail: fetchDetail as never });
    const d = await a.detail('m1');
    expect(fetchDetail).toHaveBeenCalledWith('tok', 'm1');
    expect(d.body).toBe('body text');
    expect(d.id).toBe('m1');
  });
});

describe('registry', () => {
  it('registers gmail by default', () => {
    expect(listRegisteredChannels()).toContain('gmail');
    expect(getInboxAdapter('gmail')).toBeDefined();
    expect(getInboxAdapter('telegram')).toBeUndefined();
  });

  it('setInboxAdapter can override and clear', () => {
    const fake = new GmailAdapter({ getToken: () => null });
    setInboxAdapter('gmail', fake);
    expect(getInboxAdapter('gmail')).toBe(fake);
    setInboxAdapter('gmail', undefined);
    expect(getInboxAdapter('gmail')).toBeUndefined();
    // restore real adapter for other tests
    setInboxAdapter('gmail', new GmailAdapter());
  });
});
