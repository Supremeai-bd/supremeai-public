import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/apiClient';
import { adminService } from '../services/adminService';
import { useAdminStore } from './useAdminStore';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useAdminStore admin writes are fail-honest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(adminService, 'fetchAuditRecords').mockResolvedValue([]);
    useAdminStore.setState({
      blockedIps: [
        { ip: '203.0.113.1', reason: 'abuse', date: 'yesterday' },
        { ip: '203.0.113.2', reason: 'abuse', date: 'yesterday' },
      ],
    });
  });

  it('a failed unblock restores the list instead of wiping it', async () => {
    vi.spyOn(adminService, 'unblockIp').mockRejectedValue(
      new ApiError('Not wired', 501, { notWired: true })
    );
    useAdminStore.getState().removeBlockedIp('203.0.113.1');
    expect(useAdminStore.getState().blockedIps).toHaveLength(1);
    await flush();
    expect(useAdminStore.getState().blockedIps.map((b) => b.ip)).toEqual([
      '203.0.113.1',
      '203.0.113.2',
    ]);
  });

  it('a failed block removes the optimistic row again', async () => {
    vi.spyOn(adminService, 'blockIp').mockRejectedValue(new Error('down'));
    useAdminStore.getState().addBlockedIp('198.51.100.7', 'test');
    expect(useAdminStore.getState().blockedIps).toHaveLength(3);
    await flush();
    expect(useAdminStore.getState().blockedIps).toHaveLength(2);
  });

  it('a successful unblock adopts the server list', async () => {
    vi.spyOn(adminService, 'unblockIp').mockResolvedValue([
      { ip: '203.0.113.2', reason: 'abuse', date: 'yesterday' },
    ]);
    useAdminStore.getState().removeBlockedIp('203.0.113.1');
    await flush();
    expect(useAdminStore.getState().blockedIps.map((b) => b.ip)).toEqual(['203.0.113.2']);
  });
});
