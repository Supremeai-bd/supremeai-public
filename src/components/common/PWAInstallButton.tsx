import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="flex items-center gap-1.5 rounded-lg bg-[var(--theme-accent)] px-2.5 py-1.5 text-xs font-medium text-[var(--theme-accent-contrast)] shadow-sm transition hover:opacity-90"
        title="Install SupremeAI Studio as a desktop/mobile app"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--theme-surface-border)] bg-[var(--theme-surface-glass)] px-2.5 py-1.5 text-xs font-medium text-[var(--theme-chat-text)] transition hover:bg-[var(--theme-chat-hover-bg)]"
          title="Install SupremeAI Studio on iOS"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-xl border border-[var(--theme-surface-border)] bg-[var(--theme-surface-strong)] p-6 text-[var(--theme-chat-text)] shadow-xl">
              <h3 className="text-base font-semibold">Install on iPhone / iPad</h3>
              <p className="mt-2 text-sm text-[var(--theme-chat-text-secondary)]">
                1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-[var(--theme-accent)] py-2 text-sm font-medium text-[var(--theme-accent-contrast)] transition hover:opacity-90"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
