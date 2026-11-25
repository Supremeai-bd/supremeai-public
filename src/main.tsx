import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { useAuthStore } from './stores/useAuthStore';
import { installGlobalErrorHandlers } from './services/telemetry';

// Integration plan Phase 1: validate any stored session against the deployed
// API at startup instead of trusting localStorage blindly.
installGlobalErrorHandlers();
useAuthStore.getState().restoreSession();

if (
  typeof window !== 'undefined' &&
  !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
) {
  const scheduleSw = () => registerSW({ immediate: true });
  if (typeof (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback === 'function') {
    (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(
      scheduleSw,
      { timeout: 5000 }
    );
  } else {
    setTimeout(scheduleSw, 3000);
  }
}

createRoot(document.getElementById('root')!).render(<App />);
