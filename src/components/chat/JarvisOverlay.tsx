import React, { useEffect, useMemo, useState } from 'react';
import { Bot, X, Volume2, VolumeX, ChevronDown } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { useChatStore } from '../../stores/useChatStore';
import {
  getAnnouncementLog,
  isJarvisNarrationMuted,
  setJarvisNarrationMuted,
  subscribeJarvisAnnouncements,
  type JarvisAnnouncement,
} from '../../services/jarvisService';

/**
 * বাংলা মন্তব্য: JARVIS মোডের HUD (হেডস-আপ ডিসপ্লে)। Iron Man-এর সিনেমার JARVIS-এর
 * মতো ব্যবহারকারী সবসময় দেখতে পায় — সিস্টেম এখন কী করছে আর কী বলছে।
 *
 * এই কম্পোনেন্ট নিজে কোনো টাস্ক চালায় না; এটা শুধু দেখায়:
 *   - অবস্থা: স্ট্যান্ডবাই / এক্সিকিউশন চলছে / অনুমোদনের অপেক্ষায়
 *   - ঘোষণার লগ (শেষ ৬টি) — jarvisService ঘোষণার CustomEvent থেকে আসে
 *   - চ্যাট স্টোরের লাইভ agent steps (এক্সিকিউশন চলাকালীন)
 *
 * অ্যাক্সেসিবিলিটি: role="status" + aria-live — স্ক্রিন রিডারেও ঘোষণা পৌঁছায়।
 */

interface JarvisOverlayProps {
  /** বাংলা মন্তব্য: প্যানেল নিজে খোলা থাকবে কি না (মোড চালু = দৃশ্যমান) */
  onDisable: () => void;
  /** বাংলা মন্তব্য: ভয়েস প্যানেল ওপেন থাকলে ওভারল্যাপ এড়াতে স্মার্ট পজিশনিং ও কমান্ড সাপোর্ট */
  isVoicePanelOpen?: boolean;
  onQuickCommand?: (command: string) => void;
}

export const JarvisOverlay: React.FC<JarvisOverlayProps> = ({
  onDisable,
  isVoicePanelOpen = false,
  onQuickCommand,
}) => {
  const { lang, t } = useI18n();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const pendingTaskApproval = useChatStore((s) => s.pendingTaskApproval);
  const streamingAgentSteps = useChatStore((s) => s.streamingAgentSteps);
  const [muted, setMuted] = useState<boolean>(() => isJarvisNarrationMuted());
  const [collapsed, setCollapsed] = useState(false);
  const [quickCmd, setQuickCmd] = useState('');
  const [announcements, setAnnouncements] = useState<JarvisAnnouncement[]>(() =>
    getAnnouncementLog().slice(-6)
  );

  useEffect(() => {
    return subscribeJarvisAnnouncements((announcement) => {
      setAnnouncements((prev) => [...prev.slice(-5), announcement]);
    });
  }, []);

  const status = pendingTaskApproval
    ? 'approval'
    : isStreaming
      ? 'executing'
      : 'standby';

  const statusLabel = useMemo(() => {
    if (status === 'approval') return t.jarvisStatusApproval;
    if (status === 'executing') return t.jarvisStatusExecuting;
    return t.jarvisStatusStandby;
  }, [status, t]);

  const statusColor =
    status === 'approval'
      ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
      : status === 'executing'
        ? 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10'
        : 'text-slate-300 border-slate-400/30 bg-slate-400/10';

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    // বাংলা মন্তব্য: মিউট = JARVIS ন্যারেশন বন্ধ, কিন্তু মোড ও HUD চালু থাকে —
    // শুধু কথা বলা বন্ধ। সার্ভিস চলমান বাক্যও থামিয়ে দেয়।
    setJarvisNarrationMuted(next);
  };

  // বাংলা মন্তব্য: মোবাইলে (<sm) হেডার ও চ্যাট-ইনপুটের মাঝে পরিষ্কার জায়গায় (top-24) এবং বড় স্ক্রিনে ৩ডি অবতারের বামে HUD অবস্থান নেয়।
  const positionClass = isVoicePanelOpen
    ? 'top-24 right-4 sm:top-16 sm:right-6 lg:right-[366px] xl:right-[406px]'
    : 'bottom-20 right-4';

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={t.jarvisExpandLabel}
        data-testid="jarvis-overlay-collapsed"
        className={`fixed ${positionClass} z-50 inline-flex items-center gap-2 px-3 py-2 rounded-full border border-cyan-400/40 bg-slate-900/90 text-cyan-300 shadow-lg backdrop-blur-md cursor-pointer hover:bg-slate-800/90 transition-colors`}
      >
        <Bot className="w-4 h-4" aria-hidden="true" />
        <span className="text-xs font-semibold">JARVIS</span>
        <span className={`w-2 h-2 rounded-full ${status === 'standby' ? 'bg-slate-400' : 'bg-cyan-400 animate-pulse'}`} aria-hidden="true" />
      </button>
    );
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={t.jarvisOverlayLabel}
      data-testid="jarvis-overlay"
      className={`fixed ${positionClass} z-50 w-[min(92vw,330px)] rounded-2xl border border-cyan-400/30 bg-slate-900/95 dark:bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-md overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative inline-flex items-center justify-center">
            <span
              aria-hidden="true"
              className={`absolute inline-flex w-8 h-8 rounded-full ${status === 'standby' ? 'bg-cyan-400/10' : 'bg-cyan-400/25 animate-ping'}`}
            />
            <span className="relative inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan-400/15 border border-cyan-400/40">
              <Bot className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            </span>
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-wide text-white">JARVIS</div>
            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${statusColor}`}>
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full ${status === 'standby' ? 'bg-slate-300' : 'bg-current animate-pulse'}`}
              />
              {statusLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleMuteToggle}
            aria-pressed={muted}
            aria-label={muted ? t.jarvisUnmuteLabel : t.jarvisMuteLabel}
            title={muted ? t.jarvisUnmuteLabel : t.jarvisMuteLabel}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" aria-hidden="true" /> : <Volume2 className="w-4 h-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label={t.jarvisCollapseLabel}
            title={t.jarvisCollapseLabel}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer transition-colors"
          >
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDisable}
            aria-label={t.jarvisDisableLabel}
            title={t.jarvisDisableLabel}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2 max-h-64 overflow-y-auto">
        {announcements.length === 0 ? (
          <p className="text-xs text-slate-400">{t.jarvisEmptyHint}</p>
        ) : (
          announcements.map((a) => (
            <div
              key={a.id}
              className={`text-xs leading-relaxed border-l-2 pl-2 ${
                a.level === 'success'
                  ? 'border-emerald-400/60 text-emerald-300'
                  : a.level === 'warn'
                    ? 'border-amber-400/60 text-amber-300'
                    : a.level === 'error'
                      ? 'border-rose-400/60 text-rose-300'
                      : 'border-cyan-400/50 text-slate-200'
              }`}
            >
              {a.text}
            </div>
          ))
        )}
      </div>

      {streamingAgentSteps.length > 0 && status !== 'standby' && (
        <div className="px-4 pb-3 space-y-1 border-t border-white/10 pt-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            {t.jarvisStepsTitle}
          </p>
          {streamingAgentSteps.slice(-4).map((step) => (
            <div key={step.id} className="flex items-center gap-2 text-[11px] text-slate-300">
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  step.status === 'done'
                    ? 'bg-emerald-400'
                    : step.status === 'error'
                      ? 'bg-rose-400'
                      : 'bg-cyan-400 animate-pulse'
                }`}
              />
              <span className="truncate">{step.label}</span>
            </div>
          ))}
        </div>
      )}

      {onQuickCommand && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = quickCmd.trim();
            if (!trimmed) return;
            setQuickCmd('');
            onQuickCommand(trimmed);
          }}
          className="px-3 py-2 border-t border-white/10 flex items-center gap-1.5"
        >
          <input
            type="text"
            value={quickCmd}
            onChange={(e) => setQuickCmd(e.target.value)}
            placeholder={lang === 'bn' ? 'জার্ভিসকে কমান্ড দিন...' : 'Command JARVIS...'}
            aria-label={lang === 'bn' ? 'জার্ভিস কমান্ড' : 'JARVIS command'}
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/15 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={!quickCmd.trim()}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-500/80 hover:bg-cyan-500 disabled:opacity-40 text-[11px] font-semibold text-slate-950 cursor-pointer shrink-0"
          >
            {lang === 'bn' ? 'চালান' : 'Run'}
          </button>
        </form>
      )}

      <div className="px-4 py-2 border-t border-white/10 text-[10px] text-slate-500 flex items-center justify-between">
        <span>{t.jarvisShortcutHint}</span>
        <span className="font-mono">{lang === 'bn' ? 'জার্ভিস মোড' : 'Ctrl+Alt+J'}</span>
      </div>
    </aside>
  );
};

export default JarvisOverlay;
