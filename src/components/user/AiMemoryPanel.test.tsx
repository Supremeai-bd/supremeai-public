import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiMemoryPanel } from './AiMemoryPanel';
import { loadUserMemory, recordUserMemory } from '../../services/intentOrchestrator';
import { branchName } from '../admin/AdminGitHubPipelineView';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('AiMemoryPanel', () => {
  it('opens on click and shows what is remembered', () => {
    recordUserMemory({ language: 'bn', topic: 'Shop inventory', promptText: 'short please' });
    render(<AiMemoryPanel />);
    const toggle = screen.getByRole('button', { name: /\(1\)/ });
    expect(screen.queryByText('Shop inventory')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Shop inventory')).toBeInTheDocument();
    expect(screen.getByText('বাংলা')).toBeInTheDocument();
  });

  it('forgets one topic or everything', () => {
    recordUserMemory({ topic: 'Alpha topic' });
    recordUserMemory({ topic: 'Beta topic' });
    render(<AiMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: /\(2\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /Alpha topic/ }));
    expect(loadUserMemory().recentTopics).toEqual(['Beta topic']);
    expect(screen.queryByText('Alpha topic')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Forget everything|সব ভুলে যাও/ }));
    expect(loadUserMemory().recentTopics).toEqual([]);
  });

  it('explains when nothing is remembered', () => {
    render(<AiMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: /\(0\)/ }));
    expect(screen.getByText(/Nothing remembered yet|এখনো কিছু মনে রাখা হয়নি/)).toBeInTheDocument();
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
