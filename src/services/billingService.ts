import { apiClient } from './apiClient';
import { env } from '../config/env';
import { PLAN_CATALOG, TOPUP_PACKAGES } from '../config/plans';
import { BillingInvoice } from '../types';
import { INITIAL_INVOICES } from '../data/customerWorkspaceData';

export const billingService = {
  async fetchInvoices(): Promise<BillingInvoice[]> {
    if (env.isMockEnabled) {
      return INITIAL_INVOICES;
    }
    try {
      const res = await apiClient.get<{ history?: BillingInvoice[]; invoices?: BillingInvoice[] }>(
        '/api/billing/history'
      );
      if (res && Array.isArray(res.invoices)) {
        return res.invoices;
      }
      if (res && Array.isArray(res.history)) {
        return res.history;
      }
      return [];
    } catch {
      return [];
    }
  },

  async fetchWallet(): Promise<{ balanceUsd: number }> {
    if (env.isMockEnabled) {
      return { balanceUsd: 0 };
    }
    try {
      const res = await apiClient.get<{
        balance_usd?: number;
        wallet?: { balance?: number };
        balance?: number;
      }>('/api/billing/wallet');
      const bal = res?.balance_usd ?? res?.wallet?.balance ?? res?.balance ?? 0;
      return { balanceUsd: Number.isFinite(Number(bal)) ? Number(bal) : 0 };
    } catch {
      return { balanceUsd: 0 };
    }
  },

  async createTopUp(
    addedTokens: number,
    costUsd: number
  ): Promise<{ success: boolean; invoice: BillingInvoice; balanceUsd?: number }> {
    const fallbackInvoice: BillingInvoice = {
      id: `inv_topup_${Date.now()}`,
      invoiceNumber: `TOP-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
      amountUsd: costUsd,
      status: 'paid',
      planName: `Pay-As-You-Go Credits (${(addedTokens / 1000000).toFixed(2)}M Tokens)`,
    };

    if (env.isMockEnabled) {
      return { success: true, invoice: fallbackInvoice };
    }
    const res = await apiClient.post<{
      success: boolean;
      invoice?: BillingInvoice;
      balance_usd?: number;
    }>('/api/billing/add-funds', {
      amount: costUsd,
      tokens: addedTokens,
    });
    return {
      success: Boolean(res?.success ?? true),
      invoice: res?.invoice || fallbackInvoice,
      balanceUsd: res?.balance_usd,
    };
  },

  async fetchPlans(): Promise<{
    plans: typeof PLAN_CATALOG;
    topupPackages: typeof TOPUP_PACKAGES;
  }> {
    if (env.isMockEnabled) {
      return { plans: PLAN_CATALOG, topupPackages: TOPUP_PACKAGES };
    }
    try {
      const res = await apiClient.get<{
        plans: typeof PLAN_CATALOG;
        topupPackages: typeof TOPUP_PACKAGES;
      }>('/api/billing/plans');
      if (res?.plans && typeof res.plans === 'object') {
        return res;
      }
      return { plans: PLAN_CATALOG, topupPackages: TOPUP_PACKAGES };
    } catch {
      return { plans: PLAN_CATALOG, topupPackages: TOPUP_PACKAGES };
    }
  },
};
