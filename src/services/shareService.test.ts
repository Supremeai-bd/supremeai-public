// @vitest-environment node
// বাংলা মন্তব্য: production failure-এ কাল্পনিক link বানিয়ে success দেখানো নিষিদ্ধ।
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './apiClient';
import { env } from '../config/env';
import { shareService } from './shareService';

vi.mock('../config/env', () => ({ env: { isMockEnabled: false } }));
vi.mock('./apiClient', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://supremeai-studio.pages.dev' } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  env.isMockEnabled = false;
});

describe('shareService বাস্তব ফলাফল', () => {
  it('API failure হলে error caller-এ পৌঁছায়, fake URL নয়', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('offline'));
    await expect(shareService.generateShareLink('conversation')).rejects.toThrow('offline');
  });

  it.each([
    null,
    {},
    { id: 'stateless', share_url: '/?share=bad#chat' },
    { share_id: '', share_url: '/share/x' },
    { share_id: 'real', share_url: 8 },
  ])('অসামঞ্জস্যপূর্ণ response %j reject করে', async (body) => {
    vi.mocked(apiClient.post).mockResolvedValue(body);
    await expect(shareService.generateShareLink('conversation')).rejects.toThrow(
      'Invalid share response'
    );
  });

  it('বাস্তব backend success ও request contract অক্ষত থাকে', async () => {
    const body = { share_id: 'real', share_url: '/share/real', expires_at: '2026-12-27' };
    vi.mocked(apiClient.post).mockResolvedValue(body);
    expect(await shareService.generateShareLink('conversation')).toEqual(body);
    expect(apiClient.post).toHaveBeenCalledWith('/api/share/generate', {
      conversation_id: 'conversation',
    });
  });
});
