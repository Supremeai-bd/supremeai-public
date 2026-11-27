import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoostLimitView } from './BoostLimitView';
import { poolService } from '../../services/poolService';
import { POOL_PROVIDER_MANIFESTS } from '../../constants/poolProvidersManifest';
import { creditPackageService, type CreditPackage } from '../../services/creditPackageService';

const PACK: CreditPackage = {
  id: 'p-growth',
  kind: 'topup',
  name: 'Growth pack',
  description: null,
  credits: 1500000,
  priceUsd: 50,
  billingPeriod: 'one_time',
  badge: 'popular',
  sortOrder: 40,
  active: true,
  updatedAt: null,
};
const PLAN: CreditPackage = {
  ...PACK,
  id: 'p-pro',
  kind: 'plan',
  name: 'Pro',
  credits: 1000000,
  priceUsd: 29,
  billingPeriod: 'monthly',
  badge: null,
};

const GEMINI_KEY = 'AIzaSy' + 'Q'.repeat(33);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(creditPackageService, 'listActive').mockResolvedValue([PLAN, PACK]);
  vi.spyOn(poolService, 'getProviders').mockResolvedValue(POOL_PROVIDER_MANIFESTS);
  vi.spyOn(poolService, 'getQuota').mockResolvedValue({
    user_id: 'u1',
    valid_keys_count: 1,
    daily_bonus_tokens: 150000,
  });
  vi.spyOn(poolService, 'listMyKeys').mockResolvedValue([
    {
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'kilo',
      status: 'valid',
      bonus_weight: 150000,
      key_hint: 'eyJh••••abcd',
      created_at: '2026-11-26T10:00:00Z',
    },
  ]);
});

describe('BoostLimitView — লিমিট বাড়ান ট্যাব', () => {
  it('সার্ভারের আসল কোটা ও যোগ করা কী দেখায়', async () => {
    render(<BoostLimitView />);
    await waitFor(() => expect(screen.getByTestId('boost-daily-bonus').textContent).toBe('+150K'));
    expect(screen.getByText('eyJh••••abcd', { exact: false })).toBeTruthy();
    expect(screen.getByTestId('boost-provider-kilo').textContent).toMatch(/Added|যোগ হয়েছে/);
  });

  it('কী পেস্ট করলে প্রোভাইডার নিজে চেনে ও যোগ করে — কিছু বাছতে হয় না', async () => {
    const contribute = vi.spyOn(poolService, 'contributeKey').mockResolvedValue({
      status: 'accepted',
      provider: 'gemini',
      bonus_earned: 100000,
      message: 'ok',
    });
    render(<BoostLimitView />);
    const submit = screen.getByTestId('boost-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('boost-key-input'), { target: { value: GEMINI_KEY } });
    expect(screen.getByTestId('boost-detect-status').textContent).toMatch(/Gemini/);
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(contribute).toHaveBeenCalledWith('gemini', GEMINI_KEY));
    await waitFor(() =>
      expect((screen.getByTestId('boost-key-input') as HTMLInputElement).value).toBe('')
    );
  });

  it('অচেনা কী হলে যোগ বাটন বন্ধ ও স্পষ্ট বার্তা', () => {
    render(<BoostLimitView />);
    fireEvent.change(screen.getByTestId('boost-key-input'), {
      target: { value: 'random-text-123' },
    });
    expect((screen.getByTestId('boost-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('boost-detect-status').textContent).toMatch(
      /not recognised|চেনা যায়নি/
    );
  });

  it('সার্ভারের ত্রুটি লাল বার্তায় দেখায়', async () => {
    vi.spyOn(poolService, 'contributeKey').mockRejectedValue(new Error('Key already in pool'));
    render(<BoostLimitView />);
    fireEvent.change(screen.getByTestId('boost-key-input'), { target: { value: GEMINI_KEY } });
    fireEvent.click(screen.getByTestId('boost-submit'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Key already in pool')
    );
  });

  it('তালিকা আনা না গেলে ভুয়া "০ কী" নয়, সৎ বার্তা', async () => {
    vi.spyOn(poolService, 'listMyKeys').mockResolvedValue(null);
    render(<BoostLimitView />);
    await waitFor(() => expect(screen.getByTestId('boost-keys-unavailable')).toBeTruthy());
  });

  it('"Add API Key" now lives here: collapsed advanced section, opened for old deep links', async () => {
    const { unmount } = render(<BoostLimitView advanced={<div data-testid="keys-console" />} />);
    const section = await screen.findByTestId('boost-advanced');
    expect(screen.queryByTestId('keys-console')).toBeNull();
    fireEvent.click(section.querySelector('button')!);
    expect(screen.getByTestId('keys-console')).toBeTruthy();
    unmount();

    render(<BoostLimitView advanced={<div data-testid="keys-console" />} advancedOpen />);
    expect(await screen.findByTestId('keys-console')).toBeTruthy();
  });

  it('shows no advanced section when nothing is passed', async () => {
    render(<BoostLimitView />);
    await waitFor(() => expect(screen.getByTestId('boost-daily-bonus')).toBeTruthy());
    expect(screen.queryByTestId('boost-advanced')).toBeNull();
  });

  it('Part 1 (free) comes before Part 2 (paid)', async () => {
    render(<BoostLimitView />);
    const free = screen.getByTestId('boost-part-free');
    const paid = screen.getByTestId('boost-part-paid');
    expect(free.compareDocumentPosition(paid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(free.textContent).toMatch(/free|ফ্রি/i);
    await screen.findByTestId('boost-package-p-growth');
  });

  it('"Get key" opens the API-key page directly, even if the server sends a homepage', async () => {
    vi.spyOn(poolService, 'getProviders').mockResolvedValue(
      POOL_PROVIDER_MANIFESTS.map((m) =>
        m.id === 'kilo' ? { ...m, gmailAuthUrl: 'https://kilo.ai' } : m
      )
    );
    render(<BoostLimitView />);
    await waitFor(() => expect(screen.getByTestId('boost-daily-bonus').textContent).toBe('+150K'));
    expect(screen.getByTestId('boost-get-key-kilo').getAttribute('href')).toBe(
      'https://app.kilo.ai/profile'
    );
    expect(screen.getByTestId('boost-get-key-sambanova').getAttribute('href')).toBe(
      'https://cloud.sambanova.ai/apis'
    );
  });

  it('Tips Card shows the steps for the provider the user picks', async () => {
    render(<BoostLimitView />);
    await waitFor(() => expect(screen.getByTestId('boost-daily-bonus').textContent).toBe('+150K'));
    // kilo is already added → tips start at the first provider not yet added (gemini)
    expect(screen.getByTestId('boost-tips-card').textContent).toMatch(/Gemini/);
    expect(screen.getByTestId('boost-tips-link').getAttribute('href')).toBe(
      'https://aistudio.google.com/apikey'
    );
    fireEvent.click(screen.getByTestId('boost-get-key-kilo'));
    const tips = screen.getByTestId('boost-tips-card');
    expect(tips.textContent).toMatch(/Kilo/);
    expect(tips.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId('boost-tips-link').getAttribute('href')).toBe(
      'https://app.kilo.ai/profile'
    );
  });

  it('Part 2 lists DB packages; buying needs a second confirm click', async () => {
    const buy = vi.fn();
    render(<BoostLimitView onBuyPackage={buy} />);
    const card = await screen.findByTestId('boost-package-p-growth');
    expect(card.textContent).toContain('Growth pack');
    expect(card.textContent).toContain('$50');
    expect(card.textContent).toContain('1.5M');
    expect(screen.getByTestId('boost-package-p-pro').textContent).toMatch(/\$29.*(\/mo|\/মাস)/);

    fireEvent.click(screen.getByTestId('boost-buy-p-growth'));
    expect(buy).not.toHaveBeenCalled();
    expect(screen.getByTestId('boost-buy-p-growth').textContent).toMatch(/Confirm|নিশ্চিত/);
    fireEvent.click(screen.getByTestId('boost-buy-p-growth'));
    await waitFor(() => expect(buy).toHaveBeenCalledWith(PACK));
  });

  it('Part 2 is honest when there are no packages or the list fails', async () => {
    vi.spyOn(creditPackageService, 'listActive').mockResolvedValue([]);
    const { unmount } = render(<BoostLimitView />);
    expect(await screen.findByTestId('boost-packages-empty')).toBeTruthy();
    unmount();

    vi.spyOn(creditPackageService, 'listActive').mockRejectedValue(new Error('down'));
    render(<BoostLimitView />);
    expect(await screen.findByTestId('boost-packages-unavailable')).toBeTruthy();
  });
});
