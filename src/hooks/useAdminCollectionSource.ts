import { useAdminStore, type AdminCollectionKey } from '../stores/useAdminStore';
import { useDataSource, type DataSourceState } from './useDataSource';

/**
 * বাংলা মন্তব্য: admin store-এর একটি কালেকশনের সত্যিকার ডেটা-উৎস নির্ধারণ করে।
 *
 * সত্যের উৎস: `useAdminStore.serverSyncedAt[key]` — শুধুমাত্র লাইভ সার্ভার API
 * থেকে সফল রেসপন্সেই টাইমস্ট্যাম্প সেট হয়। localStorage fallback-এ পুরনো ডেটা
 * থাকলেও এটা "live" গণ্য হয় না — ব্যাজ UNKNOWN/DEGRADED দেখাবে, মিথ্যা LIVE নয়।
 *
 * প্রতিটি data-bearing admin ভিউ এই হুকটাই ব্যবহার করে, তাই সব ভিউয়ে
 * "কোথা থেকে এলো" প্রশ্নের উত্তর একই নিয়মে আসে।
 */
export function useAdminCollectionSource(
  collection: AdminCollectionKey,
  demoReason?: string
): DataSourceState {
  const syncedAt = useAdminStore((s) => s.serverSyncedAt[collection]);
  const lastSyncError = useAdminStore((s) => s.lastSyncError);

  return useDataSource({
    loaded: typeof syncedAt === 'number',
    lastUpdatedMs: syncedAt,
    error: lastSyncError,
    demoReason,
  });
}

export default useAdminCollectionSource;
