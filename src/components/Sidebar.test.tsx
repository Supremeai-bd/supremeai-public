import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ChatSession } from '../types';
import { FOCUS_CHAT_SEARCH_EVENT } from '../utils/chatSearch';

vi.mock('./common/PlatformDownloadsCard', () => ({ PlatformDownloadsCard: () => null }));
vi.mock('./theme/ThemeControlPopover', () => ({ ThemeControlPopover: () => null }));

const session = (id: string, title: string, content: string, updatedAt: number): ChatSession =>
  ({
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    messages: [{ id: `${id}-m`, role: 'user', content }],
  }) as unknown as ChatSession;

function renderSidebar(sessions: ChatSession[], overrides: Record<string, unknown> = {}) {
  const props = {
    sessions,
    activeSessionId: '',
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onRenameSession: vi.fn(),
    onNewSession: vi.fn(),
    isOpen: true,
    onToggleOpen: vi.fn(),
    onSelectTab: vi.fn(),
    activeTab: 'chat',
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe('Sidebar chat search (replaces the All Conversations tab)', () => {
  afterEach(() => cleanup());

  it('has no All Conversations tab button', () => {
    renderSidebar([]);
    expect(screen.queryByText('All Conversations')).toBeNull();
    expect(screen.getByTestId('sidebar-chat-search')).toBeTruthy();
  });

  it('filters by message content, shows a snippet and opens the chat', () => {
    const props = renderSidebar([
      session('a', 'Login page', 'Build a login form with Supabase auth', 100),
      session('b', 'Poem', 'Write a poem about rain', 200),
    ]);
    fireEvent.change(screen.getByTestId('sidebar-chat-search'), {
      target: { value: 'supabase' },
    });
    const results = screen.getByTestId('sidebar-search-results');
    expect(results.textContent).toContain('Login page');
    expect(results.textContent).not.toContain('Poem');
    expect(screen.getByTestId('sidebar-search-snippet').textContent).toContain('Supabase');
    fireEvent.click(screen.getByText('Login page'));
    expect(props.onSelectSession).toHaveBeenCalledWith('a');
    expect(props.onSelectTab).toHaveBeenCalledWith('chat');
  });

  it('shows an empty state and clears with Escape', () => {
    renderSidebar([session('a', 'Login page', 'hello', 100)]);
    const input = screen.getByTestId('sidebar-chat-search');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No chat matches that search.')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('sidebar-search-results')).toBeNull();
  });

  it('lists every chat via "Show all" instead of a separate page', () => {
    const many = Array.from({ length: 30 }, (_, i) => session(`s${i}`, `Chat ${i}`, 'x', i));
    renderSidebar(many);
    expect(screen.queryByText('Chat 0')).toBeNull();
    fireEvent.click(screen.getByTestId('sidebar-show-all-chats'));
    expect(screen.getByText('Chat 0')).toBeTruthy();
  });

  it('focuses the search box when asked by voice/chat ("open history")', async () => {
    vi.useFakeTimers();
    try {
      renderSidebar([]);
      act(() => {
        window.dispatchEvent(new Event(FOCUS_CHAT_SEARCH_EVENT));
        vi.runAllTimers();
      });
      expect(document.activeElement).toBe(screen.getByTestId('sidebar-chat-search'));
    } finally {
      vi.useRealTimers();
    }
  });
});
