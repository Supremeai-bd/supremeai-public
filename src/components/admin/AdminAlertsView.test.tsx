import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminAlertsView } from './AdminAlertsView';
import { adminAlertService, type AlertsState } from '../../services/adminAlertService';
import { useControlCenterStore } from '../../stores/useControlCenterStore';

const NOW = new Date().toISOString();

const STATE: AlertsState = {
  channels: [
    {
      id: 'c1',
      kind: 'discord',
      label: 'Ops',
      minSeverity: 'warning',
      enabled: true,
      targetHint: 'discord.com …efgh',
      lastStatus: 'failed',
      lastError: 'HTTP 404',
      lastSentAt: NOW,
    },
  ],
  events: [
    {
      id: 'e1',
      createdAt: NOW,
      severity: 'critical',
      source: 'core',
      title: 'Core is down',
      body: null,
      delivered: 1,
      failed: 0,
      acknowledgedAt: null,
      acknowledgedBy: null,
    },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  useControlCenterStore.setState({ pendingGate: null, isExecutingGate: false });
});

describe('AdminAlertsView', () => {
  it('shows channels with status/hint and open alerts', async () => {
    vi.spyOn(adminAlertService, 'getState').mockResolvedValue(STATE);
    render(<AdminAlertsView />);
    const channel = await screen.findByTestId('alert-channel-c1');
    expect(channel).toHaveTextContent('Ops');
    expect(channel).toHaveTextContent('HTTP 404');
    expect(channel).toHaveTextContent('discord.com …efgh');
    expect(screen.getByTestId('alert-events')).toHaveTextContent('Core is down');
    expect(screen.getByTestId('alert-events')).toHaveTextContent('1 open');
  });

  it('auto-saves severity and on/off changes', async () => {
    vi.spyOn(adminAlertService, 'getState').mockResolvedValue(STATE);
    const update = vi.spyOn(adminAlertService, 'update').mockResolvedValue({ channel: null });
    render(<AdminAlertsView />);
    fireEvent.click(await screen.findByTestId('alert-severity-c1-critical'));
    expect(update).toHaveBeenCalledWith('c1', { minSeverity: 'critical' });
    fireEvent.click(screen.getByTestId('alert-enabled-c1'));
    expect(update).toHaveBeenCalledWith('c1', { enabled: false });
  });

  it('connects a Telegram channel and reports the automatic verification', async () => {
    vi.spyOn(adminAlertService, 'getState').mockResolvedValue({ channels: [], events: [] });
    const create = vi
      .spyOn(adminAlertService, 'create')
      .mockResolvedValue({ channel: null, verification: { ok: true } });
    render(<AdminAlertsView />);
    fireEvent.click(await screen.findByTestId('alert-add'));
    fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: ' 123:abc ' } });
    fireEvent.change(screen.getByLabelText('Chat ID'), { target: { value: '-100' } });
    fireEvent.submit(screen.getByTestId('alert-add-form'));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        kind: 'telegram',
        label: 'Telegram',
        minSeverity: 'warning',
        botToken: '123:abc',
        chatId: '-100',
      })
    );
  });

  it('removes a channel only after the safety gate and acknowledges alerts', async () => {
    vi.spyOn(adminAlertService, 'getState').mockResolvedValue(STATE);
    const remove = vi.spyOn(adminAlertService, 'remove').mockResolvedValue();
    const ack = vi.spyOn(adminAlertService, 'acknowledge').mockResolvedValue();
    render(<AdminAlertsView />);
    fireEvent.click(await screen.findByTestId('alert-remove-c1'));
    expect(remove).not.toHaveBeenCalled();
    await useControlCenterStore.getState().pendingGate!.onExecute({ dryRun: false } as never);
    expect(remove).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByTestId('alert-ack-e1'));
    expect(ack).toHaveBeenCalledWith('e1');
  });

  it('shows a load error instead of fake data', async () => {
    vi.spyOn(adminAlertService, 'getState').mockRejectedValue(new Error('db down'));
    render(<AdminAlertsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('db down');
  });
});
