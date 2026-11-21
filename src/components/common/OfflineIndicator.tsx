import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-slate-950 shadow-lg backdrop-blur-sm"
    >
      <WifiOff className="h-3.5 w-3.5" />
      <span>Offline Mode — Cached workspace active</span>
    </div>
  );
};
