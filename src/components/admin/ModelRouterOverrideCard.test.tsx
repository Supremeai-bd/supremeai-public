import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ModelRouterOverrideCard } from './ModelRouterOverrideCard';
import { modelRouterService, type ModelRouterState } from '../../services/modelRouterService';
import { useControlCenterStore } from '../../stores/useControlCenterStore';

const BASE: ModelRouterState = {
  override: null,
  fallbackChain: ['groq/llama', 'gemini/flash'],
  providers: [
    { id: 'groq', status: 'healthy', latencyMs: 120, models: ['groq/llama', 'groq/mixtral'] },
    { id: 'gemini', status: 'unavailable', latencyMs: 0, models: ['gemini/flash'] },
  ],
};

afterEach(() => {
  cleanup();
  useControlCenterStore.setState({ pendingGate: null, isExecutingGate: false });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ModelRouterOverrideCard', () => {
  it('shows automatic mode and the live chain', async () => {
    vi.spyOn(modelRouterService, 'getState').mockResolvedValue(BASE);
    render(<ModelRouterOverrideCard />);
    expect(await screen.findByText(/groq\/llama → gemini\/flash/)).toBeTruthy();
    expect(screen.queryByTestId('model-router-active')).toBeNull();
  });

  it('applying goes through the SafetyGate with the chosen provider/model/duration', async () => {
    vi.spyOn(modelRouterService, 'getState').mockResolvedValue(BASE);
    const setOverride = vi.spyOn(modelRouterService, 'setOverride').mockResolvedValue();
    render(<ModelRouterOverrideCard />);
    await screen.findByTestId('model-router-provider');

    fireEvent.click(screen.getByTestId('model-router-model-trigger'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('mixtral'));
    fireEvent.click(within(screen.getByTestId('model-router-duration')).getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Apply|প্রয়োগ/ }));

    expect(setOverride).not.toHaveBeenCalled();
    expect(useControlCenterStore.getState().pendingGate?.riskLevel).toBe('critical');
    await useControlCenterStore.getState().executeGuardedAction({ dryRun: false });
    expect(setOverride).toHaveBeenCalledWith('groq', 'groq/mixtral', 100);
  });

  it('shows an active override and turns it off through the gate', async () => {
    vi.spyOn(modelRouterService, 'getState').mockResolvedValue({
      ...BASE,
      override: {
        provider: 'groq',
        model: 'groq/llama',
        remainingRequests: 0,
        setBy: 'ops@x.com',
        setAt: null,
      },
    });
    const clear = vi.spyOn(modelRouterService, 'clearOverride').mockResolvedValue();
    render(<ModelRouterOverrideCard />);
    const banner = await screen.findByTestId('model-router-active');
    expect(banner.textContent).toContain('ops@x.com');
    fireEvent.click(within(banner).getByRole('button'));
    await useControlCenterStore.getState().executeGuardedAction({ dryRun: true });
    expect(clear).not.toHaveBeenCalled();
  });

  it('is honest when core is not linked', async () => {
    vi.spyOn(modelRouterService, 'getState').mockRejectedValue(new Error('Core not linked'));
    render(<ModelRouterOverrideCard />);
    expect((await screen.findByRole('alert')).textContent).toContain('Core not linked');
  });
});
