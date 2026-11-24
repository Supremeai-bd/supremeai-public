import {
  useControlCenterStore,
  type ControlCenterDomain,
} from '../stores/useControlCenterStore';
import { useDataSource, type DataSourceState } from './useDataSource';

/**
 * বাংলা মন্তব্য: Control Center-এর কোনো ডোমেইনের (overview, releaseGate, hitl,
 * memory, bridge, compute, finOps, serviceHealth, mcpTools, diagnostics) সত্যিকার
 * ডেটা-উৎস নির্ধারণ করে।
 *
 * সত্যের উৎস: `useControlCenterStore.domainProvenance[domain]` — শুধুমাত্র লাইভ
 * `/api/admin/control-plane/*` কল সফল হলেই টাইমস্ট্যাম্প সেট হয়। ব্যর্থতা থাকলে
 * DEGRADED, কোনো সিঙ্ক হয়নি হলে UNKNOWN — মিথ্যা "LIVE" কখনো নয়।
 */
export function useControlCenterDomainSource(
  domain: ControlCenterDomain,
  demoReason?: string
): DataSourceState {
  const entry = useControlCenterStore((s) => s.domainProvenance[domain]);

  return useDataSource({
    loaded: Boolean(entry),
    lastUpdatedMs: entry?.at || undefined,
    error: entry?.error ?? null,
    demoReason,
  });
}

export default useControlCenterDomainSource;
