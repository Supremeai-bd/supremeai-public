import { describe, expect, it } from 'vitest';
import type { ChatSession } from '../types';
import { searchChatSessions, sortSessionsForSidebar } from './chatSearch';

const session = (
  id: string,
  title: string,
  contents: string[],
  updatedAt: number,
  isPinned = false
): ChatSession =>
  ({
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    isPinned,
    messages: contents.map((content, i) => ({ id: `${id}-${i}`, role: 'user', content })),
  }) as unknown as ChatSession;

const sessions = [
  session('a', 'Login page', ['Build a React login form with Supabase auth'], 100),
  session('b', 'Bangla poem', ['একটা কবিতা লেখো বৃষ্টি নিয়ে'], 300),
  session('c', 'Old pinned', ['deploy to cloudflare pages'], 50, true),
];

describe('searchChatSessions', () => {
  it('returns nothing for an empty query', () => {
    expect(searchChatSessions(sessions, '   ')).toEqual([]);
  });

  it('matches titles case-insensitively without a snippet', () => {
    const res = searchChatSessions(sessions, 'LOGIN');
    expect(res.map((r) => r.session.id)).toEqual(['a']);
    expect(res[0].snippet).toBeNull();
  });

  it('matches message content (including Bangla) and returns a snippet', () => {
    const res = searchChatSessions(sessions, 'বৃষ্টি');
    expect(res.map((r) => r.session.id)).toEqual(['b']);
    expect(res[0].snippet).toContain('বৃষ্টি');
  });

  it('requires every word, in any order, across title and messages', () => {
    expect(searchChatSessions(sessions, 'supabase login').map((r) => r.session.id)).toEqual(['a']);
    expect(searchChatSessions(sessions, 'supabase cloudflare')).toEqual([]);
  });

  it('puts pinned chats first, then the most recent', () => {
    expect(sortSessionsForSidebar(sessions).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    const all = searchChatSessions(sessions, 'a');
    expect(all[0].session.id).toBe('c');
  });
});
