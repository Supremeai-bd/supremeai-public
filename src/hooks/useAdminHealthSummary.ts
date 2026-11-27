import { useEffect, useMemo } from 'react';
import { useAdminStore } from '../stores/useAdminStore';
import { useControlCenterStore } from '../stores/useControlCenterStore';
import { usePlatformStore } from '../stores/usePlatformStore';
import { useAdminHealthStore } from '../stores/useAdminHealthStore';
import {
  buildAdminHealthSummary,
  countIssuesBySection,
  type AdminHealthSummary,
} from '../utils/adminHealthSummary';

/** Live admin health summary composed from every admin store (no fake numbers). */
export function useAdminHealthSummary(): AdminHealthSummary & {
  issuesBySection: ReturnType<typeof countIssuesBySection>;
} {
  const customers = useAdminStore((s) => s.customers);
  const mcpServices = useAdminStore((s) => s.mcpServices);
  const jobs = useAdminStore((s) => s.queueJobs);
  const workers = useAdminStore((s) => s.swarmWorkers);
  const securityEvents = useAdminStore((s) => s.securityEvents);
  const schemaTables = useAdminStore((s) => s.schemaTables);

  const healthSnapshot = useControlCenterStore((s) => s.healthSnapshot);
  const ecosystemDiagnostics = useControlCenterStore((s) => s.ecosystemDiagnostics);
  const pendingHitlCount = useControlCenterStore((s) => s.pendingHitlCount);
  const latestDiagnose = useControlCenterStore((s) => s.latestDiagnose);
  const domainProvenance = useControlCenterStore((s) => s.domainProvenance);

  const config = usePlatformStore((s) => s.config);
  const providers = useAdminHealthStore((s) => s.providers);
  const deployments = useAdminHealthStore((s) => s.deployments);
  const vault = useAdminHealthStore((s) => s.vault);
  const connections = useAdminHealthStore((s) => s.connections);

  return useMemo(() => {
    const domainErrors = Object.entries(domainProvenance || {})
      .filter(([, entry]) => entry?.error)
      .map(([domain, entry]) => ({ domain, error: String(entry?.error) }));
    const summary = buildAdminHealthSummary({
      customers,
      mcpServices,
      healthSnapshot,
      ecosystemFindings: ecosystemDiagnostics?.findings ?? null,
      mcpReachable: ecosystemDiagnostics ? ecosystemDiagnostics.mcpReachable : null,
      deployments,
      providers,
      vault,
      connections,
      jobs,
      workers,
      securityEvents,
      pendingHitlCount: pendingHitlCount ?? 0,
      releaseGate: latestDiagnose?.releaseGate ?? null,
      schemaTables,
      maintenanceMode: Boolean(config.maintenanceMode),
      allowNewSignups: config.allowNewSignups !== false,
      domainErrors,
    });
    return { ...summary, issuesBySection: countIssuesBySection(summary.issues) };
  }, [
    customers,
    mcpServices,
    healthSnapshot,
    ecosystemDiagnostics,
    deployments,
    providers,
    vault,
    connections,
    jobs,
    workers,
    securityEvents,
    pendingHitlCount,
    latestDiagnose,
    schemaTables,
    config.maintenanceMode,
    config.allowNewSignups,
    domainProvenance,
  ]);
}

/** Refreshes all admin data on mount and every `intervalMs` while the console is open. */
export function useAdminAutoRefresh(intervalMs = 60_000): void {
  const refreshAll = useAdminHealthStore((s) => s.refreshAll);
  useEffect(() => {
    void refreshAll();
    const id = window.setInterval(() => void refreshAll(), intervalMs);
    return () => window.clearInterval(id);
  }, [refreshAll, intervalMs]);
}
