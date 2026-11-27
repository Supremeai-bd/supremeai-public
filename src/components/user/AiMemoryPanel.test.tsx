import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiMemoryPanel } from './AiMemoryPanel';
import { loadUserMemory, recordUserMemory } from '../../services/intentOrchestrator';
import { branchName } from '../admin/AdminGitHubPipelineView';
import { clearSavedMemoriesCache, userMemoryService } from '../../services/userMemoryService';
import { apiClient } from '../../services/apiClient';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearSavedMemoriesCache();
});
beforeEach(() => localStorage.clear());

describe('AiMemoryPanel (sidebar entry)', () => {
  it('counts local topics plus saved memories and opens the AI Memory page', async () => {
    recordUserMemory({ language: 'bn', topic: 'Shop inventory', promptText: 'short please' });
    const onOpen = vi.fn();
    render(<AiMemoryPanel onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: /\(1\)/ });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    vi.spyOn(apiClient, 'get').mockResolvedValue({
      memories: [{ id: 'm1', content: 'Lives in Comilla', source: 'chatgpt', status: 'confirmed' }],
    });
    await act(async () => {
      await userMemoryService.list();
    });
    expect(screen.getByRole('button', { name: /\(2\)/ })).toBeInTheDocument();
  });

  it('updates when the device memory changes', () => {
    render(<AiMemoryPanel />);
    expect(screen.getByRole('button', { name: /\(0\)/ })).toBeInTheDocument();
    act(() => {
      recordUserMemory({ topic: 'Alpha topic' });
    });
    expect(screen.getByRole('button', { name: /\(1\)/ })).toBeInTheDocument();
    expect(loadUserMemory().recentTopics).toEqual(['Alpha topic']);
  });

  it('marks itself active on the AI Memory page', () => {
    render(<AiMemoryPanel active />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'page');
  });
});

describe('branchName (PR head/base)', () => {
  it('handles GitHub objects and gateway strings', () => {
    expect(branchName({ ref: 'fix/disable-staging-tests-free-tier', label: 'x:y' })).toBe(
      'fix/disable-staging-tests-free-tier'
    );
    expect(branchName('main')).toBe('main');
    expect(branchName(null)).toBe('');
    expect(branchName({})).toBe('');
  });
});
