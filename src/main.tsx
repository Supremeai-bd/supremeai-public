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
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(<App />);
