import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InboxAiChats, chatSnippet, sortInboxChats } from './InboxAiChats';
import { UniversalInboxPanel } from './UniversalInboxPanel';
import { useChatStore } from '../../stores/useChatStore';
import type { ChatMessage, ChatSession } from '../../types';

const msg = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: `${role}-${content.slice(0, 8)}`,
  role,
  content,
  timestamp: 1,
});

const session = (id: string, over: Partial<ChatSession> = {}): ChatSession => ({
  id,
  title: `Chat ${id}`,
  createdAt: 1,
  updatedAt: 1,
  model: 'auto',
  roleId: 'auto',
  messages: [msg('user', `hello from ${id}`)],
  ...over,
});

const SESSIONS = [
  session('old', { updatedAt: 100 }),
  session('new', {
    updatedAt: 300,
    messages: [
      msg('user', 'build a site'),
      msg('assistant', '## Done\n```js\nx()\n```\n**Ready**'),
    ],
  }),
  session('pinned', { updatedAt: 50, isPinned: true }),
  session('blank', { updatedAt: 999, messages: [msg('system', 'sys only')] }),
];

afterEach(cleanup);
beforeEach(() => {
  useChatStore.setState({ sessions: SESSIONS, activeSessionId: 'old' });
});

describe('sortInboxChats / chatSnippet', () => {
  it('puts pinned first, then newest, and skips empty chats', () => {
    expect(sortInboxChats(SESSIONS).map((s) => s.id)).toEqual(['pinned', 'new', 'old']);
  });

  it('shows the last message as plain text', () => {
    expect(chatSnippet(SESSIONS[1])).toBe('Done (code) Ready');
    expect(chatSnippet(SESSIONS[3])).toBe('');
  });
});

describe('InboxAiChats', () => {
  it('lists chats, searches message text and opens a chat', () => {
    const open = vi.fn();
    render(<InboxAiChats onOpenChat={open} />);
    expect(screen.getByTestId('inbox-ai-chat-pinned')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-ai-chat-blank')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search your AI chats…'), {
      target: { value: 'build a' },
    });
    expect(screen.queryByTestId('inbox-ai-chat-old')).toBeNull();
    fireEvent.click(screen.getByTestId('inbox-ai-chat-new'));
    expect(open).toHaveBeenCalledWith('new');
  });
});

describe('UniversalInboxPanel sources', () => {
  it('starts on AI Chats when Gmail is not connected and switches to Gmail', () => {
    render(<UniversalInboxPanel onOpenChat={vi.fn()} />);
    expect(screen.getByTestId('inbox-ai-chats')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inbox-source-external'));
    expect(screen.queryByTestId('inbox-ai-chats')).toBeNull();
    expect(screen.getAllByText('Sign in with Google to access Gmail').length).toBeGreaterThan(0);
  });

  it('has no source tabs when embedded without chat access (browser Gmail view)', () => {
    render(<UniversalInboxPanel />);
    expect(screen.queryByTestId('inbox-source')).toBeNull();
    expect(screen.queryByTestId('inbox-ai-chats')).toBeNull();
  });
});
