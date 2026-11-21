import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskApprovalCard } from './TaskApprovalCard';
import type { PendingTaskApproval } from '../../shared/agentTypes';

const sampleApproval: PendingTaskApproval = {
  id: 'approval_1',
  originalPrompt: 'Check https://example.com daily at 8 AM and summarize updates',
  summary: '2 steps executed · 1 action',
  language: 'en',
  steps: [
    {
      id: 'step_1',
      label: 'Browsed example.com',
      tool: 'web_browse',
      status: 'done',
      detail: 'HTTP 200 · Example Domain',
    },
    {
      id: 'step_2',
      label: 'Prepared schedule: Example Check',
      tool: 'create_schedule',
      status: 'done',
      detail: '0 8 * * * · awaiting approval',
    },
  ],
  actions: [
    {
      id: 'act_sched_1',
      type: 'create_schedule',
      label: 'Schedule "Example Check" (0 8 * * *)',
      requiresApproval: true,
      payload: {
        title: 'Example Check',
        targetUrl: 'https://example.com',
        cadence: 'daily',
        cronExpression: '0 8 * * *',
        instruction: 'Summarize any page changes.',
      },
    },
  ],
  draftAnswer: 'Preview summary ready.',
};

describe('TaskApprovalCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders executed steps and pending side-effecting action details with approve/skip handlers', () => {
    const onApprove = vi.fn();
    const onSkip = vi.fn();
    const onCancel = vi.fn();

    render(
      <TaskApprovalCard
        approval={sampleApproval}
        onApprove={onApprove}
        onSkip={onSkip}
        onCancel={onCancel}
      />
    );

    const card = screen.getByTestId('task-approval-card');
    expect(card.textContent).toContain('2 steps executed · 1 action');
    expect(card.textContent).toContain('Browsed example.com');
    expect(card.textContent).toContain('Schedule "Example Check" (0 8 * * *)');
    expect(card.textContent).toContain('https://example.com · 0 8 * * *');

    fireEvent.click(screen.getByTestId('task-approval-approve-btn'));
    expect(onApprove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('task-approval-skip-btn'));
    expect(onSkip).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss task approval' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
