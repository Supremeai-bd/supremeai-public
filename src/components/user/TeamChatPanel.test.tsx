import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TEAM_CHAT_POLL_MS, TeamChatPanel, mergeMessages } from './TeamChatPanel';
import { teamService, type TeamChatMessage, type TeamChatRoom } from '../../services/teamService';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

const room = (ownerId: string, over: Partial<TeamChatRoom> = {}): TeamChatRoom => ({
  ownerId,
  ownerEmail: `${ownerId.slice(0, 4)}@x.com`,
  myRole: 'Developer',
  memberCount: 3,
  lastMessage: null,
  ...over,
});

const msg = (
  id: string,
  createdAt: string,
  over: Partial<TeamChatMessage> = {}
): TeamChatMessage => ({
  id,
  content: `text ${id}`,
  createdAt,
  senderId: null,
  senderEmail: 'peer@x.com',
  mine: false,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(teamService, 'fetchChatRooms').mockResolvedValue([
    room(OWNER_A, { myRole: 'Owner' }),
    room(OWNER_B),
  ]);
  vi.spyOn(teamService, 'fetchChatMessages').mockResolvedValue([
    msg('m1', '2026-11-27T10:00:00.000Z'),
  ]);
});

describe('mergeMessages', () => {
  it('appends new messages once, sorted oldest first', () => {
    const a = msg('a', '2026-11-27T10:00:00Z');
    const b = msg('b', '2026-11-27T10:01:00Z');
    const c = msg('c', '2026-11-27T10:02:00Z');
    expect(mergeMessages([a, b], [b, c]).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    const same = [a];
    expect(mergeMessages(same, [a])).toBe(same);
  });
});

describe('TeamChatPanel', () => {
  it('shows an invite hint when the user has no team rooms', async () => {
    vi.mocked(teamService.fetchChatRooms).mockResolvedValue([]);
    render(<TeamChatPanel />);
    expect(await screen.findByText(/Invite someone above/)).toBeTruthy();
    expect(teamService.fetchChatMessages).not.toHaveBeenCalled();
  });

  it('loads the first room, labels rooms, and switches rooms', async () => {
    render(<TeamChatPanel />);
    expect(await screen.findByText('text m1')).toBeTruthy();
    expect(teamService.fetchChatMessages).toHaveBeenCalledWith(OWNER_A, null);
    expect(screen.getByRole('tab', { name: 'My team' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: "2222@x.com's team" }));
    await waitFor(() => expect(teamService.fetchChatMessages).toHaveBeenCalledWith(OWNER_B, null));
  });

  it('sends on Enter and appends the posted message', async () => {
    const posted = msg('m2', '2026-11-27T10:05:00.000Z', { content: 'hello team', mine: true });
    const post = vi.spyOn(teamService, 'postChatMessage').mockResolvedValue(posted);
    render(<TeamChatPanel />);
    await screen.findByText('text m1');

    const box = screen.getByLabelText('Message your team…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '  hello team ' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await screen.findByText('hello team')).toBeTruthy();
    expect(post).toHaveBeenCalledWith(OWNER_A, 'hello team');
    expect(box.value).toBe('');
  });

  it('shows the server error when sending fails', async () => {
    vi.spyOn(teamService, 'postChatMessage').mockRejectedValue(
      new Error('too many messages, slow down')
    );
    render(<TeamChatPanel />);
    await screen.findByText('text m1');
    fireEvent.change(screen.getByLabelText('Message your team…'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('too many messages, slow down')).toBeTruthy();
  });

  it('polls with the newest message as the cursor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TeamChatPanel />);
    await screen.findByText('text m1');
    vi.mocked(teamService.fetchChatMessages).mockResolvedValue([
      msg('m3', '2026-11-27T10:09:00.000Z'),
    ]);
    await act(async () => {
      vi.advanceTimersByTime(TEAM_CHAT_POLL_MS + 10);
    });
    expect(teamService.fetchChatMessages).toHaveBeenLastCalledWith(
      OWNER_A,
      '2026-11-27T10:00:00.000Z'
    );
    expect(await screen.findByText('text m3')).toBeTruthy();
    expect(screen.getByText('text m1')).toBeTruthy();
  });
});
