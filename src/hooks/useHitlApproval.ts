import { useState, useEffect, useCallback } from 'react';
import { hitlService, HitlPendingRecord, normalizeHitlPayload } from '../services/hitlService';
import { env } from '../config/env';
import { useFederationLive } from './useFederationLive';
import { getFederationData } from '../services/federationBridge';
import { useAuthStore } from '../stores/useAuthStore';
import { isAuthorizedAdminEmail } from '../services/authService';
import { getWorkspaceAuthHeaders } from '../utils/workspaceAuth';

export function useHitlApproval() {
  const authUser = useAuthStore((s) => s.authUser);
  const isAdminEligible = Boolean(
    authUser &&
      (authUser.isAdminEligible ||
        isAuthorizedAdminEmail(authUser.email) ||
        authUser.role === 'admin' ||
        authUser.rbacRole === 'admin' ||
        authUser.rbacRole === 'super_admin')
  );

  const [pendingRequests, setPendingRequests] = useState<HitlPendingRecord[]>([]);
  const [activeRequest, setActiveRequest] = useState<HitlPendingRecord | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // The sync engine already polls /api/v1/hitl/pending on its own cadence
  // (with backoff, ETag revalidation and visibility pausing), so this hook
  // subscribes to that snapshot instead of running a second 15s timer.
  const { data: pendingPayload, refresh: refreshPending } = useFederationLive<unknown>(
    'hitl-pending',
    { maxAgeMs: 20_000, enabled: !env.isMockEnabled && isAdminEligible }
  );

  useEffect(() => {
    if (pendingPayload === null) return;
    const list = normalizeHitlPayload(pendingPayload);
    setPendingRequests(list);
    setActiveRequest((current) => {
      if (!current) return list[0] ?? null;
      return list.find((record) => record.id === current.id) ?? list[0] ?? null;
    });
  }, [pendingPayload]);

  const applyQueue = useCallback((list: HitlPendingRecord[]) => {
    setPendingRequests(list);
    setActiveRequest((current) => {
      if (!current) return list[0] ?? null;
      return list.find((record) => record.id === current.id) ?? list[0] ?? null;
    });
  }, []);

  const fetchPending = useCallback(async () => {
    // Normal path: let the engine fetch and read its snapshot — one request.
    await refreshPending();
    const payload = getFederationData<unknown>('hitl-pending');
    if (payload !== null) {
      applyQueue(normalizeHitlPayload(payload));
      return;
    }
    // Fabric cannot serve this source (restricted credentials or a failed
    // sync): fall back to a direct read so the operator still sees the queue.
    applyQueue(await hitlService.getPending());
  }, [applyQueue, refreshPending]);

  useEffect(() => {
    if (env.isMockEnabled || !isAdminEligible) return;

    fetchPending();

    // Optional SSE listener for live push (admin-only)
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const openSse = async () => {
      try {
        const sseUrl = `${env.apiBaseUrl}/api/v1/stream/hitl`;
        const headers = getWorkspaceAuthHeaders();
        const ticketRes = await fetch(`${env.apiBaseUrl}/api/v1/hitl/sse-ticket`, {
          method: 'POST',
          headers,
        });
        if (!ticketRes.ok) throw new Error(`ticket request failed: ${ticketRes.status}`);
        const ticketData = (await ticketRes.json()) as { ticket?: string };
        if (!ticketData.ticket) throw new Error('no ticket returned');
        eventSource = new EventSource(
          `${sseUrl}?ticket=${encodeURIComponent(ticketData.ticket)}`,
          { withCredentials: true }
        );
        eventSource.addEventListener('hitl', (event) => {
          try {
            const data = JSON.parse(event.data);
            const [newRecord] = normalizeHitlPayload([
              {
                id: data.context?.record_id || `hitl_${Date.now()}`,
                action_name: data.message || 'Sensitive Action Requires Approval',
                command: data.context?.command,
                module: data.module,
                severity: data.severity || 'high',
                context: data.context,
                created_at: new Date().toISOString(),
                status: 'pending',
              },
            ]);
            if (!newRecord) return;
            setPendingRequests((prev) => [newRecord, ...prev.filter((r) => r.id !== newRecord.id)]);
            setActiveRequest(newRecord);
          } catch {
            // Malformed SSE frame — ignore and keep the last good queue.
          }
        });
        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (reconnectAttempt < 5) {
            const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
            reconnectAttempt += 1;
            reconnectTimer = setTimeout(() => {
              void openSse();
            }, delay);
          }
        };
      } catch {
        // Ticket/SSE unavailable — polling covers it.
        if (reconnectAttempt < 5) {
          const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
          reconnectAttempt += 1;
          reconnectTimer = setTimeout(() => {
            void openSse();
          }, delay);
        }
      }
    };

    void openSse();

    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (eventSource) {
        eventSource.close();
      }
    };
    // Re-run when admin eligibility changes; fetchPending is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminEligible]);

  const approve = async (recordId: string) => {
    setIsProcessing(true);
    try {
      const ok = await hitlService.approve(recordId);
      if (ok) {
        setPendingRequests((prev) => prev.filter((r) => r.id !== recordId));
        setActiveRequest(null);
        void refreshPending();
      }
      return ok;
    } finally {
      setIsProcessing(false);
    }
  };

  const reject = async (recordId: string, reason: string) => {
    setIsProcessing(true);
    try {
      const ok = await hitlService.reject(recordId, reason);
      if (ok) {
        setPendingRequests((prev) => prev.filter((r) => r.id !== recordId));
        setActiveRequest(null);
        void refreshPending();
      }
      return ok;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    pendingRequests,
    activeRequest,
    isProcessing,
    approve,
    reject,
    dismiss: () => setActiveRequest(null),
    triggerManualCheck: fetchPending,
  };
}
