import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiMemoryView } from './AiMemoryView';
import {
  type SavedMemory,
  clearSavedMemoriesCache,
  userMemoryService,
} from '../../services/userMemoryService';
import { loadUserMemory, recordUserMemory } from '../../services/intentOrchestrator';

const mem = (over: Partial<SavedMemory>): SavedMemory => ({
  id: 'm1',
  content: 'Lives in Comilla',
  kind: 'fact',
  source: 'chatgpt',
  sourceRef: null,
  createdBy: 'user',
  status: 'confirmed',
  createdAt: '',
  updatedAt: '',
  ...over,
});

const MEMORIES = [
  mem({}),
  mem({ id: 'm2', content: 'Prefers Bangla answers', source: 'claude' }),
  mem({ id: 'm3', content: 'Wants dark mode', source: 'mcp', status: 'candidate' }),
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearSavedMemoriesCache();
});
beforeEach(() => localStorage.clear());

describe('AiMemoryView — every AI in one place', () => {
  it('shows memories from different AIs with source filters', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue(MEMORIES);
    render(<AiMemoryView />);
    await screen.findByTestId('memory-item-m1');
    expect(screen.getByTestId('memory-item-m1')).toHaveTextContent('ChatGPT');
    expect(screen.getByTestId('memory-item-m2')).toHaveTextContent('Claude');
    // candidate is in review, not in the main list
    expect(screen.queryByTestId('memory-item-m3')).toBeNull();
    expect(screen.getByTestId('memory-pending')).toHaveTextContent('Wants dark mode');

    fireEvent.click(screen.getByTestId('memory-filter-claude'));
    expect(screen.queryByTestId('memory-item-m1')).toBeNull();
    expect(screen.getByTestId('memory-item-m2')).toBeTruthy();
  });

  it('search narrows the list', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue(MEMORIES);
    render(<AiMemoryView />);
    await screen.findByTestId('memory-item-m1');
    fireEvent.change(screen.getByTestId('memory-search'), { target: { value: 'bangla' } });
    expect(screen.queryByTestId('memory-item-m1')).toBeNull();
    expect(screen.getByTestId('memory-item-m2')).toBeTruthy();
  });

  it('imports pasted memories from ChatGPT with a preview and per-line opt-out', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue([]);
    const importItems = vi
      .spyOn(userMemoryService, 'importItems')
      .mockResolvedValue({ added: 1, skipped: 0, memories: [] });
    render(<AiMemoryView />);
    await screen.findByTestId('memory-empty');
    fireEvent.click(screen.getByTestId('memory-import-open'));

    expect(screen.getByTestId('memory-source-link').getAttribute('href')).toBe(
      'https://chatgpt.com/#settings/Personalization'
    );
    fireEvent.change(screen.getByTestId('memory-import-text'), {
      target: { value: "Here's what I remember:\n- Lives in Comilla\n- Likes tea" },
    });
    const preview = screen.getByTestId('memory-import-preview');
    const boxes = within(preview).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByTestId('memory-import-save'));
    await waitFor(() => expect(importItems).toHaveBeenCalledWith('chatgpt', ['Lives in Comilla']));
  });

  it('edits, deletes and approves memories', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue(MEMORIES);
    const update = vi.spyOn(userMemoryService, 'update').mockResolvedValue(null);
    const remove = vi.spyOn(userMemoryService, 'remove').mockResolvedValue();
    render(<AiMemoryView />);
    await screen.findByTestId('memory-item-m1');

    fireEvent.click(screen.getByTestId('memory-edit-m1'));
    const input = screen.getByTestId('memory-edit-input-m1');
    fireEvent.change(input, { target: { value: 'Lives in Dhaka' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(update).toHaveBeenCalledWith('m1', { content: 'Lives in Dhaka' }));

    fireEvent.click(screen.getByTestId('memory-delete-m2'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('m2'));

    fireEvent.click(screen.getByTestId('memory-keep-m3'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('m3', { status: 'confirmed' }));
  });

  it('clearing a whole source needs a second click', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue(MEMORIES);
    const clear = vi.spyOn(userMemoryService, 'clearSource').mockResolvedValue(1);
    render(<AiMemoryView />);
    await screen.findByTestId('memory-item-m1');
    fireEvent.click(screen.getByTestId('memory-filter-chatgpt'));
    fireEvent.click(screen.getByTestId('memory-clear-source'));
    expect(clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('memory-clear-source'));
    await waitFor(() => expect(clear).toHaveBeenCalledWith('chatgpt'));
  });

  it('adds a memory typed by the user', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue([]);
    const importItems = vi
      .spyOn(userMemoryService, 'importItems')
      .mockResolvedValue({ added: 1, skipped: 0, memories: [] });
    render(<AiMemoryView />);
    await screen.findByTestId('memory-empty');
    fireEvent.change(screen.getByTestId('memory-quick-add'), {
      target: { value: 'I work with React' },
    });
    fireEvent.click(screen.getByTestId('memory-quick-add-save'));
    await waitFor(() => expect(importItems).toHaveBeenCalledWith('manual', ['I work with React']));
  });

  it('keeps the device-learned profile: forget one topic or everything', async () => {
    vi.spyOn(userMemoryService, 'list').mockResolvedValue([]);
    recordUserMemory({ language: 'bn', topic: 'Alpha topic' });
    recordUserMemory({ topic: 'Beta topic' });
    render(<AiMemoryView />);
    const device = screen.getByTestId('memory-device');
    expect(device).toHaveTextContent('বাংলা');
    fireEvent.click(within(device).getByRole('button', { name: /Alpha topic/ }));
    expect(loadUserMemory().recentTopics).toEqual(['Beta topic']);
    fireEvent.click(within(device).getByRole('button', { name: /Forget everything|সব ভুলে যাও/ }));
    expect(loadUserMemory().recentTopics).toEqual([]);
    expect(screen.getByTestId('memory-device')).toHaveTextContent(
      /Nothing remembered yet|এখনো কিছু মনে রাখা হয়নি/
    );
  });

  it('guests see the device memory and a sign-in note, with no network call', () => {
    const list = vi.spyOn(userMemoryService, 'list');
    render(<AiMemoryView isGuest />);
    expect(screen.getByTestId('memory-device')).toBeTruthy();
    expect(screen.getByTestId('memory-saved')).toHaveTextContent(/Sign in|সাইন ইন/);
    expect(screen.queryByTestId('memory-import-open')).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('is honest when the list cannot be loaded', async () => {
    vi.spyOn(userMemoryService, 'list').mockRejectedValue(new Error('down'));
    render(<AiMemoryView />);
    expect(await screen.findByTestId('memory-unavailable')).toBeTruthy();
  });
});
