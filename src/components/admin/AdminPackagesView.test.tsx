import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminPackagesView } from './AdminPackagesView';
import { creditPackageService, type CreditPackage } from '../../services/creditPackageService';
import { useControlCenterStore } from '../../stores/useControlCenterStore';

const PACK: CreditPackage = {
  id: 'p1',
  kind: 'topup',
  name: 'Growth pack',
  description: 'Never expires',
  credits: 1500000,
  priceUsd: 50,
  billingPeriod: 'one_time',
  badge: 'popular',
  sortOrder: 40,
  active: true,
  updatedAt: null,
};

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  useControlCenterStore.setState({ pendingGate: null, isExecutingGate: false });
});

describe('AdminPackagesView — dynamic plans & packages', () => {
  it('lists packages from the DB', async () => {
    vi.spyOn(creditPackageService, 'listAll').mockResolvedValue([PACK]);
    render(<AdminPackagesView />);
    const row = await screen.findByTestId('package-row-p1');
    expect(row).toHaveTextContent('Growth pack');
    expect(row).toHaveTextContent('1.5M');
    expect(row).toHaveTextContent('$50');
  });

  it('adds a package with name, credit limit and price', async () => {
    vi.spyOn(creditPackageService, 'listAll').mockResolvedValue([]);
    const create = vi.spyOn(creditPackageService, 'create').mockResolvedValue(PACK);
    render(<AdminPackagesView />);
    fireEvent.click(await screen.findByTestId('package-add'));
    fireEvent.change(screen.getByTestId('package-name'), { target: { value: 'Mega pack' } });
    fireEvent.change(screen.getByTestId('package-credits'), { target: { value: '9000000' } });
    fireEvent.change(screen.getByTestId('package-price'), { target: { value: '120' } });
    fireEvent.click(screen.getByTestId('package-save'));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'topup',
          name: 'Mega pack',
          credits: 9000000,
          priceUsd: 120,
          billingPeriod: 'one_time',
        })
      )
    );
  });

  it('edits an existing package', async () => {
    vi.spyOn(creditPackageService, 'listAll').mockResolvedValue([PACK]);
    const update = vi.spyOn(creditPackageService, 'update').mockResolvedValue(PACK);
    render(<AdminPackagesView />);
    fireEvent.click(await screen.findByTestId('package-edit-p1'));
    expect((screen.getByTestId('package-name') as HTMLInputElement).value).toBe('Growth pack');
    fireEvent.change(screen.getByTestId('package-price'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('package-save'));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('p1', expect.objectContaining({ priceUsd: 45 }))
    );
  });

  it('visible switch auto-saves', async () => {
    vi.spyOn(creditPackageService, 'listAll').mockResolvedValue([PACK]);
    const update = vi.spyOn(creditPackageService, 'update').mockResolvedValue(PACK);
    render(<AdminPackagesView />);
    const sw = await screen.findByTestId('package-active-p1');
    fireEvent.click(sw.querySelector('button') || sw);
    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { active: false }));
  });

  it('remove goes through the safety gate first', async () => {
    vi.spyOn(creditPackageService, 'listAll').mockResolvedValue([PACK]);
    const remove = vi.spyOn(creditPackageService, 'remove').mockResolvedValue();
    render(<AdminPackagesView />);
    fireEvent.click(await screen.findByTestId('package-remove-p1'));
    expect(remove).not.toHaveBeenCalled();
    await useControlCenterStore.getState().pendingGate!.onExecute({ dryRun: false } as never);
    expect(remove).toHaveBeenCalledWith('p1');
  });
});
