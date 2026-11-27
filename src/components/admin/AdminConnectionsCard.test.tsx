import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdminConnectionsCard } from './AdminConnectionsCard';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';

describe('AdminConnectionsCard', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    useAdminHealthStore.setState({ connections: null, isRefreshing: false });
  });

  it('shows an unknown state when connections could not be loaded', () => {
    render(<AdminConnectionsCard />);
    expect(screen.getByTestId('admin-connections-unknown')).toBeTruthy();
  });

  it('lists each connection with the env vars to add and routes to the fix page', () => {
    useAdminHealthStore.setState({
      connections: [
        {
          id: 'infisical',
          name: 'Infisical vault',
          status: 'missing',
          detail: 'The admin server cannot read the vault yet.',
          missingEnv: ['INFISICAL_CLIENT_ID'],
          targetTab: 'provider-keys',
        },
        {
          id: 'supabase',
          name: 'Supabase (users & data)',
          status: 'connected',
          detail: 'Auth users readable',
          missingEnv: [],
          targetTab: 'customers',
        },
      ],
    });
    const onNavigateTab = vi.fn();
    render(<AdminConnectionsCard onNavigateTab={onNavigateTab} />);
    expect(screen.getByText('1/2 connected')).toBeTruthy();
    const vault = screen.getByTestId('admin-connection-infisical');
    expect(vault.textContent).toContain('INFISICAL_CLIENT_ID');
    expect(vault.textContent).toContain('Not set up');
    fireEvent.click(screen.getByText('Open related page →'));
    expect(onNavigateTab).toHaveBeenCalledWith('provider-keys');
  });
});
