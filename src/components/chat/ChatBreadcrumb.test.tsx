import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession, UserProject } from '../../types';
import {
  buildSessionAncestry,
  ChatBreadcrumb,
  getRecentSessionTrail,
} from './ChatBreadcrumb';

const makeSession = (
  id: string,
  title: string,
  overrides: Partial<ChatSession> = {}
): ChatSession => ({
  id,
  title,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  model: 'supreme-core',
  roleId: 'default',
  messages: [],
  ...overrides,
});

describe('ChatBreadcrumb navigation & helpers', () => {
  afterEach(() => {
    cleanup();
  });

  it('builds ancestry chain safely with cycle protection', () => {
    const root = makeSession('s1', 'Root Architecture');
    const mid = makeSession('s2', 'API Schema', { parentSessionId: 's1' });
    const leaf = makeSession('s3', 'Auth Fixes', { parentSessionId: 's2' });

    expect(buildSessionAncestry([root, mid, leaf], leaf).map((s) => s.id)).toEqual([
      's1',
      's2',
      's3',
    ]);

    // Guard against cyclic parent links
    const cycleA = makeSession('c1', 'Cycle A', { parentSessionId: 'c2' });
    const cycleB = makeSession('c2', 'Cycle B', { parentSessionId: 'c1' });
    expect(buildSessionAncestry([cycleA, cycleB], cycleB).map((s) => s.id)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('orders recent session trail with active session first followed by latest updatedAt', () => {
    const older = makeSession('s1', 'Older Chat', { updatedAt: 100 });
    const active = makeSession('s2', 'Current Chat', { updatedAt: 200 });
    const newest = makeSession('s3', 'Newest Other Chat', { updatedAt: 500 });

    const trail = getRecentSessionTrail([older, active, newest], 's2', 6);
    expect(trail.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
  });

  it('renders current thread path, project, branched ancestors, and supports jumping', () => {
    const onSelectSession = vi.fn();
    const onOpenHistory = vi.fn();
    const onNewSession = vi.fn();

    const parent = makeSession('p1', 'Core Refactor Plan', {
      updatedAt: 100,
    });
    const child = makeSession('c1', 'Deep Thread Analysis', {
      parentSessionId: 'p1',
      projectId: 'proj_1',
      isPinned: true,
      updatedAt: 300,
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'Hi!', timestamp: 2 },
      ],
    });
    const other = makeSession('o1', 'Recent Billing Check', { updatedAt: 250 });

    const projects: UserProject[] = [
      {
        id: 'proj_1',
        name: 'SupremeAI Studio',
        repoUrl: 'https://github.com/Supremeai-bd/supremeai-public',
        branch: 'main',
        description: '',
        language: 'TypeScript',
        stars: 10,
        lastSynced: 1,
        aiReviewStatus: 'idle',
      },
    ];

    render(
      <ChatBreadcrumb
        sessions={[parent, child, other]}
        currentSession={child}
        projects={projects}
        onSelectSession={onSelectSession}
        onOpenHistory={onOpenHistory}
        onNewSession={onNewSession}
      />
    );

    const nav = screen.getByTestId('chat-breadcrumb');
    expect(nav.textContent).toContain('History');
    expect(nav.textContent).toContain('SupremeAI Studio');
    expect(nav.textContent).toContain('Core Refactor Plan');
    expect(nav.textContent).toContain('Deep Thread Analysis');
    expect(nav.textContent).toContain('2 msgs');

    // Click ancestor branch
    fireEvent.click(screen.getByRole('button', { name: 'Core Refactor Plan' }));
    expect(onSelectSession).toHaveBeenCalledWith('p1');

    // Click history root
    fireEvent.click(screen.getByTitle('All Conversations'));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);

    // Open recent session switcher and jump to another recent session
    fireEvent.click(screen.getByTitle('Switch recent thread'));
    const menuItem = screen.getByRole('menuitem', { name: /Recent Billing Check/i });
    fireEvent.click(menuItem);
    expect(onSelectSession).toHaveBeenCalledWith('o1');

    // Reopen switcher and trigger New Chat
    fireEvent.click(screen.getByTitle('Switch recent thread'));
    fireEvent.click(screen.getByRole('button', { name: /New chat/i }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it('shows title generation indicator while assistant is naming a new thread', () => {
    const active = makeSession('s_gen', 'New chat');
    render(
      <ChatBreadcrumb
        sessions={[active]}
        currentSession={active}
        generatingTitleIds={['s_gen']}
        onSelectSession={vi.fn()}
        onOpenHistory={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat-breadcrumb').textContent).toContain('Naming thread...');
  });
});
