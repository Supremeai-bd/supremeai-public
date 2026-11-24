/**
 * GuestOnboardingCard — interactive glassmorphic onboarding (Blueprint §4).
 *
 * বাংলা মন্তব্য: স্ট্যাটিক ল্যান্ডিং নয় — জীবন্ত গেস্ট চ্যাটের ঠিক ইনপুটের
 * উপরে একটি ট্রান্সলুসেন্ট গ্লাস কার্ড: "নতুন? লাইভ ডেমো চেষ্টা করুন"।
 * ক্লিক করলেই ডেমো চলে (৩D ভয়েস অথবা ফুল-স্ট্যাক কোড), ইউজার নিজে
 * টাইপ শুরু করলে কার্ডটি মসৃণভাবে ফেড-আউট হয়। ৩D ক্যানভাস অক্ষত —
 * কার্ড কেবল ইনপুটের উপরে থাকে, অ্যাভাটার ঢাকে না।
 */

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AudioLines, Code2, Sparkles } from 'lucide-react';
import { useI18n } from '../../utils/i18n';

interface GuestOnboardingCardProps {
  /** বাংলা: প্যারেন্ট কার্ড লুকাতে চাইলে (যেমন প্রথম মেসেজ সেন্ডের পরে)। */
  visible: boolean;
  onTryVoice: () => void;
  onTryCode: () => void;
}

export const GuestOnboardingCard: React.FC<GuestOnboardingCardProps> = ({
  visible,
  onTryVoice,
  onTryCode,
}) => {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);

  // বাংলা: ইউজার নিজে টাইপ শুরু করলেই কার্ড ফেড-আউট — ফোকাস চ্যাটেই থাকে।
  useEffect(() => {
    if (!visible) return undefined;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setDismissed(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible]);

  const shown = visible && !dismissed;

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.35 } }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          data-testid="guest-onboarding-card"
          className="w-full max-w-xl mx-auto rounded-2xl border border-white/60 dark:border-cyan-500/25 bg-white/70 dark:bg-slate-900/55 backdrop-blur-xl shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:shadow-[0_0_34px_rgba(0,240,255,0.14)] px-4 py-3.5 select-none"
        >
          <div className="flex items-center gap-2 text-[13px] font-semibold chat-theme-text">
            <Sparkles className="w-4 h-4 theme-accent-text shrink-0" aria-hidden="true" />
            <span>{t.onboardingNewHere}</span>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed chat-theme-text-muted">
            {t.onboardingHint}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onTryVoice}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/70 dark:border-cyan-500/35 bg-white/80 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 text-[11.5px] font-semibold chat-theme-text transition-all cursor-pointer hover:shadow-[0_4px_18px_rgba(0,240,255,0.18)]"
            >
              <AudioLines className="w-3.5 h-3.5 text-cyan-500 shrink-0" aria-hidden="true" />
              <span>{t.onboardingVoiceCta}</span>
            </button>
            <button
              type="button"
              onClick={onTryCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/70 dark:border-cyan-500/35 bg-white/80 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 text-[11.5px] font-semibold chat-theme-text transition-all cursor-pointer hover:shadow-[0_4px_18px_rgba(139,92,246,0.18)]"
            >
              <Code2 className="w-3.5 h-3.5 text-violet-500 shrink-0" aria-hidden="true" />
              <span>{t.onboardingCodeCta}</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
