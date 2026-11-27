import type { ChatSession } from '../types';

/**
 * বাংলা মন্তব্য: Sidebar-এর চ্যাট সার্চ (আগের "All Conversations" ট্যাবের বদলে)।
 * শিরোনাম + প্রতিটি মেসেজের লেখায় খোঁজে; একাধিক শব্দ দিলে সবগুলো থাকতে হবে (যেকোনো ক্রমে)।
 * পিন করা চ্যাট আগে, তারপর সাম্প্রতিকগুলো। মিল পাওয়া মেসেজ থেকে ছোট একটা অংশ (snippet) দেখায়।
 */

export const FOCUS_CHAT_SEARCH_EVENT = 'supremeai:focus-chat-search';

export interface ChatSearchResult {
  session: ChatSession;
  /** মেসেজের লেখায় মিল পেলে তার আশেপাশের অংশ; শুধু শিরোনামে মিল হলে null */
  snippet: string | null;
}

function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function makeSnippet(content: string, term: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const idx = flat.toLowerCase().indexOf(term);
  if (idx < 0) return flat.slice(0, 80);
  const start = Math.max(0, idx - 30);
  const end = Math.min(flat.length, idx + term.length + 50);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export function sortSessionsForSidebar(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
    return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
  });
}

export function searchChatSessions(sessions: ChatSession[], query: string): ChatSearchResult[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const results: ChatSearchResult[] = [];
  for (const session of sortSessionsForSidebar(sessions)) {
    const title = String(session.title || '').toLowerCase();
    const messages = (session.messages || []).map((m) => String(m.content || ''));
    const haystack = `${title}\n${messages.join('\n').toLowerCase()}`;
    if (!wanted.every((term) => haystack.includes(term))) continue;

    let snippet: string | null = null;
    const contentTerm = wanted.find((term) => !title.includes(term)) ?? wanted[0];
    const hit = messages.find((m) => m.toLowerCase().includes(contentTerm));
    if (hit && !wanted.every((term) => title.includes(term)))
      snippet = makeSnippet(hit, contentTerm);
    results.push({ session, snippet });
  }
  return results;
}
