/**
 * InboxAdapterRegistry — channel → adapter map (contract-backed).
 * নতুন channel = একটি adapter class + এখানে এক লাইন। UI কখনো
 * channel-specific fetch জানবে না।
 */

import type { ChannelType, InboxAdapter, InboxAdapterRegistry } from '../../../packages/contracts/inbox-adapter';
import { GmailAdapter, gmailAdapter } from './gmailAdapter';

const registry: Partial<Record<ChannelType, InboxAdapter>> = {
  gmail: gmailAdapter,
};

export function getInboxAdapter(channel: ChannelType): InboxAdapter | undefined {
  return registry[channel];
}

/** Test/DI hook: override or clear a channel adapter. */
export function setInboxAdapter(channel: ChannelType, adapter: InboxAdapter | undefined): void {
  if (adapter) {
    registry[channel] = adapter;
  } else {
    delete registry[channel];
  }
}

export function listRegisteredChannels(): ChannelType[] {
  return Object.keys(registry) as ChannelType[];
}

/** Re-export for panel convenience. */
export { GmailAdapter, gmailAdapter };
