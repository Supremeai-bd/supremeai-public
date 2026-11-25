import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Mail,
  Lock,
  User,
  ArrowRight,
  Sparkles,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Fingerprint,
} from 'lucide-react';
import { isPasskeySupported, loginWithPasskey } from '../../services/passkeyService';
import { AuthUser } from '../../types';
import { LiveScreenBackdrop } from '../theme/LiveScreenBackdrop';
import { ThemeControlPopover } from '../theme/ThemeControlPopover';
import { usePlatformStore } from '../../stores/usePlatformStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useI18n } from '../../utils/i18n';

interface AuthPageProps {
  onLoginSuccess: (user: AuthUser, token?: string) => void;
  darkMode?: boolean;
  isModal?: boolean;
  onClose?: () => void;
  authReason?: string | null;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  onLoginSuccess,
  isModal = false,
  onClose,
  authReason,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const config = usePlatformStore((s) => s.config);
  const fetchConfig = usePlatformStore((s) => s.fetchConfig);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const clearAuthError = useAuthStore((s) => s.clearAuthError);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handlePasskeySignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await loginWithPasskey(email.trim() || undefined);
      if (res.ok && res.token) {
        const uid = res.userId || 'usr_passkey';
        onLoginSuccess(
          {
            id: uid,
            name: res.deviceName || email.split('@')[0] || 'Passkey User',
            email: email.trim() || `${uid}@supremeai.local`,
            role: res.role || 'user',
            isAdminEligible: res.role === 'admin',
            plan: 'Free',
            createdAt: new Date().toISOString(),
          },
          res.token
        );
      } else {
        setErrorMessage(res.error || 'Passkey authentication failed.');
        setIsLoading(false);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Passkey error.');
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    clearAuthError();

    try {
      if (mode === 'login') {
        const ok = await login(email.trim(), password);
        const state = useAuthStore.getState();
        if (!ok || !state.authUser) {
          throw new Error(state.authError || t.authLoginErrorFallback);
        }
        onLoginSuccess(state.authUser, localStorage.getItem('supremeai_access_token') || undefined);
      } else {
        const ok = await signup(name.trim(), email.trim(), password, 'Free', false);
        const state = useAuthStore.getState();
        if (!ok || !state.authUser) {
          throw new Error(state.authError || t.authSignupErrorFallback);
        }
        onLoginSuccess(state.authUser, localStorage.getItem('supremeai_access_token') || undefined);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : t.authLoginErrorFallback);
    } finally {
      setIsLoading(false);
    }
  };

  const signupPaused = mode === 'signup' && !config.allowNewSignups;

  return (
    <div
      className={
        isModal
          ? 'fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/65 backdrop-blur-md overflow-y-auto'
          : 'min-h-screen flex items-center justify-center p-4 sm:p-6 text-slate-900 dark:text-slate-100 relative overflow-hidden transition-colors'
      }
      onClick={isModal && onClose ? onClose : undefined}
    >
      {!isModal && <LiveScreenBackdrop isEmpty isChatView />}

      {!isModal && (
        <div className="fixed top-4 right-4 z-30">
          <ThemeControlPopover />
        </div>
      )}

      <div
        className="w-full max-w-md relative z-10 space-y-5 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-2 relative">
          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sign in dialog"
              className="absolute right-0 top-0 p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-500 dark:text-cyan-400 text-xs font-semibold mb-1">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>SupremeAI Studio</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
              <path
                d="M12 2C12 7.52285 16.4772 12 22 12C16.4772 12 12 16.4772 12 22C12 16.4772 7.52285 12 2 12C7.52285 12 12 7.52285 12 2Z"
                fill="url(#supreme-logo-gradient)"
              />
              <defs>
                <linearGradient
                  id="supreme-logo-gradient"
                  x1="2"
                  y1="2"
                  x2="22"
                  y2="22"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#3B82F6" />
                  <stop offset="0.5" stopColor="#8B5CF6" />
                  <stop offset="1" stopColor="#EC4899" />
                </linearGradient>
              </defs>
            </svg>
            {t.authWorkspaceHeading}
          </h1>

          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {authReason
              ? `${t.authReasonPrefix} ${authReason}.`
              : mode === 'login'
                ? t.authSignInDesc
                : t.authSignUpDesc}
          </p>
        </div>

        <div className="rounded-3xl bg-white/95 dark:bg-[#111622]/95 backdrop-blur-2xl border border-white/60 dark:border-slate-800 shadow-2xl p-6 sm:p-7 space-y-5">
          {config.maintenanceMode && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs">
              {t.authMaintenanceNotice}
            </div>
          )}

          <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.authSignInTab}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                mode === 'signup'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.authCreateAccountTab}
            </button>
          </div>

          {signupPaused && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t.authSignupsPausedNotice}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 text-xs space-y-1.5 animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{errorMessage}</span>
              </div>
              {(errorMessage.toLowerCase().includes('cloudflare') ||
                errorMessage.toLowerCase().includes('challenge') ||
                errorMessage.toLowerCase().includes('whitelist')) && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">
                  {t.authCfChallengeTip}
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t.authFullNameLabel}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Alex Rahman"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                  <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t.authWorkEmailLabel}
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  {t.authPasswordLabel}
                </label>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-9 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {mode === 'signup' && (
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 rounded-xl px-3 py-2">
                {t.authFreeTierNote}
              </p>
            )}

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-cyan-600 focus:ring-0"
                />
                <span>{t.authRememberDevice}</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading || signupPaused}
              className="w-full py-2.5 rounded-xl theme-btn-primary text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>{t.authProcessing}</span>
                </>
              ) : (
                <>
                  <span>{mode === 'login' ? t.authSignInBtn : t.authCreateBtn}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>

            {mode === 'login' && isPasskeySupported() && (
              <button
                type="button"
                onClick={handlePasskeySignIn}
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Fingerprint className="w-4 h-4 text-cyan-500" />
                <span>Sign in with Passkey / Face ID</span>
              </button>
            )}
          </form>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/70 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
            >
              {t.authContinueGuestBtn}
            </button>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 text-center">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>{t.authFooterVault}</span>
        </div>
      </div>
    </div>
  );
};
