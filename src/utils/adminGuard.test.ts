import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/apiClient';
import { useControlCenterStore } from '../stores/useControlCenterStore';
import { guardAdminAction } from './adminGuard';
import { adminWriteErrorMessage, isNotWiredError } from './adminWriteError';

afterEach(() => {
  useControlCenterStore.setState({ pendingGate: null, isExecutingGate: false });
});

describe('guardAdminAction', () => {
  it('opens the shared SafetyGate instead of running immediately', () => {
    const run = vi.fn();
    guardAdminAction({
      title: 'Delete',
      description: 'd',
      impactSummary: 'i',
      riskLevel: 'critical',
      run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(useControlCenterStore.getState().pendingGate?.title).toBe('Delete');
  });

  it('dry-run never calls the action; live execution does', async () => {
    const run = vi.fn();
    guardAdminAction({ title: 'T', description: 'd', impactSummary: 'i', riskLevel: 'high', run });
    await useControlCenterStore.getState().executeGuardedAction({ dryRun: true });
    expect(run).not.toHaveBeenCalled();

    guardAdminAction({ title: 'T', description: 'd', impactSummary: 'i', riskLevel: 'high', run });
    await useControlCenterStore.getState().executeGuardedAction({ dryRun: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(useControlCenterStore.getState().pendingGate).toBeNull();
  });
});

describe('adminWriteErrorMessage', () => {
  it('explains 501 notWired honestly', () => {
    const err = new ApiError('Not wired', 501, { success: false, notWired: true });
    expect(isNotWiredError(err)).toBe(true);
    expect(adminWriteErrorMessage(err, 'x')).toContain('ব্যাকএন্ডে যুক্ত হয়নি');
  });

  it('keeps other errors as-is and falls back for unknown values', () => {
    expect(isNotWiredError(new ApiError('boom', 500))).toBe(false);
    expect(adminWriteErrorMessage(new Error('boom'), 'x')).toBe('boom');
    expect(adminWriteErrorMessage('weird', 'fallback')).toBe('fallback');
  });
});
