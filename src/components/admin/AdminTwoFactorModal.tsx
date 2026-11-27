import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  KeyRound,
  AlertCircle,
  X,
  Lock,
} from 'lucide-react';
import { TotpInputForm } from './two-factor/TotpInputForm';
import { TrustedBrowserCheckbox } from './two-factor/TrustedBrowserCheckbox';
import { authService, isAuthorizedAdminEmail } from '../../services/authService';

interface AdminTwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (trustedUntil: number | null) => void;
  userEmail: string;
  /** Server-verified admin flag (login/`/me` role). Email allowlist is only a fallback. */
  isAdminEligible?: boolean;
}

const getUtcTotpSecondsRemaining = () => 30 - (Math.floor(Date.now() / 1000) % 30);

export const AdminTwoFactorModal: React.FC<AdminTwoFactorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userEmail,
  isAdminEligible = false,
}) => {
  const [totpDigits, setTotpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [trustBrowser, setTrustBrowser] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(getUtcTotpSecondsRemaining);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setTotpDigits(['', '', '', '', '', '']);
    setSecondsRemaining(getUtcTotpSecondsRemaining());

    const timer = setInterval(() => {
      setSecondsRemaining(getUtcTotpSecondsRemaining());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  // Fail-closed gate: if user is not the authorized admin, reject immediately
  if (!isOpen) return null;
  if (!userEmail || !(isAdminEligible || isAuthorizedAdminEmail(userEmail))) {
    return null;
  }

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const updated = [...totpDigits];
    updated[index] = digit;
    setTotpDigits(updated);

    if (digit && index < 5) {
      const nextInput = document.getElementById(`totp-cell-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handlePasteDigits = (pasted: string) => {
    const chars = pasted.replace(/\D/g, '').slice(0, 6).split('');
    if (chars.length === 0) return;
    const updated = ['', '', '', '', '', ''];
    chars.forEach((c, i) => {
      updated[i] = c;
    });
    setTotpDigits(updated);
    const focusIdx = Math.min(5, chars.length - 1);
    document.getElementById(`totp-cell-${focusIdx}`)?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !totpDigits[index] && index > 0) {
      const prevInput = document.getElementById(`totp-cell-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleVerifyTotp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const fullCode = totpDigits.join('');
    if (fullCode.length !== 6) {
      setError('Please enter all 6 digits from your Authenticator app.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      // বাংলা মন্তব্য: ফ্রন্টএন্ডে কখনো কোনো সিক্রেট টোকেন বা কিউআর কোড থাকবে না; শুধু অথোরাইজড এডমিনের কোড সার্ভারে যাচাই হবে।
      const data = await authService.verify2FA({
        token: fullCode,
        method: 'totp',
        trustFor7Days: trustBrowser,
        userEmail,
      });

      if (!data.verified) {
        throw new Error('2-Step Verification failed. Check your Authenticator code.');
      }

      onSuccess(data.trustedUntil);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed.';
      setError(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#0b0f19] border border-slate-200 dark:border-cyan-500/30 p-6 shadow-2xl relative cyber-hud-glass max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Admin 2-Step Verification
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Identity: <span className="font-mono text-cyan-500">{userEmail}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close 2FA modal"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Invariant Badge: RFC 6238 Zero-Knowledge */}
        <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-[11px] text-cyan-700 dark:text-cyan-300">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <span>RFC 6238 Authenticator</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider">SHA-1 · 6-Digit</span>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-4 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60">
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed text-center">
            Enter the 6-digit Authenticator code from your device to unlock Admin Command.
          </p>
        </div>

        {/* 6-Digit Input Form */}
        <div className="mt-4">
          <TotpInputForm
            digits={totpDigits}
            onChangeDigit={handleDigitChange}
            onPasteDigits={handlePasteDigits}
            onKeyDown={handleKeyDown}
            onSubmit={handleVerifyTotp}
            isVerifying={isVerifying}
            secondsRemaining={secondsRemaining}
            submitLabel="Verify & Access Admin Command"
          />
        </div>

        {/* Zero-Knowledge Security Note */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <Lock className="w-3.5 h-3.5 text-cyan-500/70" />
          <span>Zero-Knowledge Architecture · No secrets exposed on client</span>
        </div>

        {/* 7-Day Trusted Browser Checkbox */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <TrustedBrowserCheckbox checked={trustBrowser} onChange={setTrustBrowser} />
        </div>
      </div>
    </div>
  );
};
