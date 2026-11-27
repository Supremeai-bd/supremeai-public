import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdminFinOpsView, formatTokens, parseLimit } from './AdminFinOpsView';
import { adminFinOpsService, type FinOpsState } from '../../services/adminFinOpsService';

const BASE: FinOpsState = {
  settings: {
    enforce: true,
    userDailyTokens: 200_000,
    userRpm: 20,
    globalDailyTokens: 1_000_000,
    updatedBy: 'owner@x.com',
    updatedAt: '2026-11-27T10:00:00Z',
  },
  usage: {
    available: true,
    date: '2026-11-27',
    globalTokens: 250_000,
    topUsers: [{ userId: 'user-abc', tokens: 120_000 }],
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.restoreAllMocks());

describe('AdminFinOpsView', () => {
  it('shows live limits and approximate usage', async () => {
    vi.spyOn(adminFinOpsService, 'getState').mockResolvedValue(BASE);
    render(<AdminFinOpsView />);
    expect(await screen.findByTestId('finops-global-tokens')).toHaveTextContent('250K / 1M');
    expect((screen.getByTestId('finops-userRpm') as HTMLInputElement).value).toBe('20');
    expect(screen.getByText('user-abc')).toBeInTheDocument();
    expect(screen.getByText(/owner@x.com/)).toBeInTheDocument();
  });

  it('toggles enforcement immediately via the switch', async () => {
    vi.spyOn(adminFinOpsService, 'getState').mockResolvedValue(BASE);
    const update = vi
      .spyOn(adminFinOpsService, 'update')
      .mockResolvedValue({ ...BASE.settings, enforce: false });
    render(<AdminFinOpsView />);
    const sw = await screen.findByTestId('finops-enforce');
    fireEvent.click(sw.querySelector('button, [role="switch"]') ?? sw);
    expect(update).toHaveBeenCalledWith({ enforce: false });
  });

  it('auto-saves a valid number after typing stops and skips invalid input', async () => {
    vi.spyOn(adminFinOpsService, 'getState').mockResolvedValue(BASE);
    const update = vi
      .spyOn(adminFinOpsService, 'update')
      .mockResolvedValue({ ...BASE.settings, userRpm: 30 });
    render(<AdminFinOpsView />);
    const input = (await screen.findByTestId('finops-userRpm')) as HTMLInputElement;
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(update).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(input, { target: { value: '30' } });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(update).toHaveBeenCalledWith({ userRpm: 30 });
  });

  it('explains when the usage counter is offline', async () => {
    vi.spyOn(adminFinOpsService, 'getState').mockResolvedValue({
      ...BASE,
      usage: { available: false, date: '', globalTokens: 0, topUsers: [] },
    });
    render(<AdminFinOpsView />);
    expect(await screen.findByTestId('finops-usage-unavailable')).toBeInTheDocument();
  });

  it('shows a load error instead of fake data', async () => {
    vi.spyOn(adminFinOpsService, 'getState').mockRejectedValue(new Error('core unreachable'));
    render(<AdminFinOpsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('core unreachable');
  });
});

describe('helpers', () => {
  it('formats tokens and parses limits', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(2_000_000_000)).toBe('2B');
    expect(parseLimit('1,000', 10_000)).toBe(1000);
    expect(parseLimit('-1', 10)).toBeNull();
    expect(parseLimit('11', 10)).toBeNull();
    expect(parseLimit('', 10)).toBeNull();
  });
});
