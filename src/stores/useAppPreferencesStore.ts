import { create } from 'zustand';
import type { AppLanguage, UserRole } from '../types';
import { useAuthStore } from './useAuthStore';
import { useCustomerStore } from './useCustomerStore';

export interface AppPreferencesState {
  language: AppLanguage;
  role: UserRole;
  setLanguage: (language: AppLanguage, options?: { silent?: boolean }) => void;
  setRole: (role: UserRole) => void;
}

const normalizeLanguage = (lang?: unknown): AppLanguage => {
  if (typeof lang === 'string' && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,4})?$/.test(lang.trim())) {
    return lang.trim().toLowerCase() as AppLanguage;
  }
  return 'en';
};

export const useAppPreferencesStore = create<AppPreferencesState>((set, get) => ({
  language: normalizeLanguage(useCustomerStore?.getState?.().userSettings?.language),
  role: useAuthStore?.getState?.().currentRole ?? 'user',

  setLanguage: (language, options) => {
    const normalized = normalizeLanguage(language);
    if (get().language !== normalized) {
      set({ language: normalized });
    }
    if (useCustomerStore.getState().userSettings.language !== normalized) {
      useCustomerStore
        .getState()
        .updateSettings({ language: normalized }, Boolean(options?.silent));
    }
  },

  setRole: (role) => {
    useAuthStore.getState().handleToggleRole(role);
    const resolvedRole = useAuthStore.getState().currentRole;
    if (get().role !== resolvedRole) {
      set({ role: resolvedRole });
    }
  },
}));

let listenersAttached = false;
function attachPreferenceSyncListeners(retries = 5): void {
  if (listenersAttached) return;
  if (
    typeof useCustomerStore?.subscribe !== 'function' ||
    typeof useAuthStore?.subscribe !== 'function'
  ) {
    if (retries > 0) {
      setTimeout(() => attachPreferenceSyncListeners(retries - 1), 0);
    }
    return;
  }

  listenersAttached = true;
  const initialLang = normalizeLanguage(useCustomerStore.getState()?.userSettings?.language);
  const initialRole = useAuthStore.getState()?.currentRole ?? 'user';
  if (
    useAppPreferencesStore.getState().language !== initialLang ||
    useAppPreferencesStore.getState().role !== initialRole
  ) {
    useAppPreferencesStore.setState({ language: initialLang, role: initialRole });
  }

  useCustomerStore.subscribe((state) => {
    const nextLang = normalizeLanguage(state.userSettings.language);
    if (useAppPreferencesStore.getState().language !== nextLang) {
      useAppPreferencesStore.setState({ language: nextLang });
    }
  });

  useAuthStore.subscribe((state) => {
    if (useAppPreferencesStore.getState().role !== state.currentRole) {
      useAppPreferencesStore.setState({ role: state.currentRole });
    }
  });
}

// Defer store subscriptions to a microtask so circular imports finish evaluating before listener registration.
queueMicrotask(() => attachPreferenceSyncListeners());
