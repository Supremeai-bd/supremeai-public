import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppCommandPalette } from './AppCommandPalette';
import { useChatStore } from '../stores/useChatStore';
import { openCommandPalette } from '../utils/commandPalette';
import type { ChatSession } from '../types';

const session = (id: string, title: string, updatedAt: number): ChatSession => ({
  id,
  title,
  createdAt: 1,
  updatedAt,
  model: 'auto',
  roleId: 'auto',
  messages: [{ id: `${id}-1`, role: 'user', content: `about ${title}`, timestamp: 1 }],
});

const pressCtrlK = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
const input = () => screen.getByRole('combobox') as HTMLInputElement;

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useChatStore.setState({
    sessions: [session('s1', 'Pricing page ideas', 200), session('s2', 'Fix login bug', 100)],
  });
});

describe('AppCommandPalette', () => {
  it('opens with Ctrl+K, closes with Esc and toggles with Ctrl+K again', () => {
    render(<AppCommandPalette isAdmin={false} onSelectTab={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    pressCtrlK();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    pressCtrlK();
    pressCtrlK();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the global open event (admin nav Search button)', () => {
    render(<AppCommandPalette isAdmin={false} onSelectTab={vi.fn()} />);
    act(() => openCommandPalette());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('hides admin sections from normal users', () => {
    render(<AppCommandPalette isAdmin={false} onSelectTab={vi.fn()} />);
    pressCtrlK();
    fireEvent.change(input(), { target: { value: 'backups' } });
    expect(screen.queryByText(/Backups/)).toBeNull();
  });

  it('filters, moves with arrows and opens the page with Enter', () => {
    const onSelectTab = vi.fn();
    render(<AppCommandPalette isAdmin onSelectTab={onSelectTab} />);
    pressCtrlK();
    // Admins see open problems first (empty stores in tests = "could not be loaded" warnings).
    expect(screen.getByText('Needs attention')).toBeTruthy();
    fireEvent.change(input(), { target: { value: 'backups' } });
    expect(screen.getByText('Deploy & CI › Backups')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSelectTab).toHaveBeenCalledWith('backups');
    expect(screen.queryByRole('dialog')).toBeNull();

    // It is remembered as Recent next time.
    pressCtrlK();
    // Admin "Needs attention" stays on top; Recent follows with the page just opened.
    const recentGroup = screen.getByText('Recent').parentElement!;
    expect(recentGroup.querySelector('[role="option"]')!.textContent).toContain('Backups');
  });

  it('opens a chat by searching its title', () => {
    const onSelectTab = vi.fn();
    const selectSession = vi.fn();
    useChatStore.setState({ selectSession });
    render(<AppCommandPalette isAdmin={false} onSelectTab={onSelectTab} />);
    pressCtrlK();
    fireEvent.change(input(), { target: { value: 'login bug' } });
    fireEvent.click(screen.getByText('Fix login bug'));
    expect(selectSession).toHaveBeenCalledWith('s2');
    expect(onSelectTab).toHaveBeenCalledWith('chat');
  });

  it('runs quick actions through the shared dashboard-action event', () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('supremeai-dashboard-action', listener);
    render(<AppCommandPalette isAdmin={false} onSelectTab={vi.fn()} />);
    pressCtrlK();
    fireEvent.change(input(), { target: { value: 'dark mode' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    window.removeEventListener('supremeai-dashboard-action', listener);
    expect(seen).toEqual([{ action: 'toggle_dark_mode', language: 'en' }]);
  });

  it('ArrowDown wraps through results', () => {
    render(<AppCommandPalette isAdmin={false} onSelectTab={vi.fn()} />);
    pressCtrlK();
    fireEvent.change(input(), { target: { value: 'mode' } });
    const options = () => screen.getAllByRole('option');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(options()[options().length - 1].getAttribute('aria-selected')).toBe('true');
  });
});
