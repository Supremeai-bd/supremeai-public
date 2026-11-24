import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import { LiveSessionStatus, LiveVoiceName } from '../../hooks/useLiveVoiceSession';
import { LiveVoiceAvatarCanvas } from './LiveVoiceAvatarCanvas';
import { useThemeStore } from '../../stores/useThemeStore';
import { useChatStore } from '../../stores/useChatStore';
import { useAvatarExpression } from '../../hooks/useAvatarExpression';
import {
  AvatarPreference,
  loadAvatarPreference,
  resolveAvatarSource,
  VOICE_AVATAR_SYNC_EVENT,
} from '../../utils/hologramAvatar';
import { useI18n } from '../../utils/i18n';

interface LiveVoicePanelProps {
  isOpen: boolean;
  status: LiveSessionStatus;
  voiceName: LiveVoiceName;
  liveModelText: string;
  levelsRef: React.MutableRefObject<{ input: number; output: number }>;
  isMuted?: boolean;
  onToggleMute?: () => void;
  onClose?: () => void;
}

/**
 * বাংলা মন্তব্য: ভয়েস ও জার্ভিসের জন্য সরলীকৃত 3D হলো-অবতার প্যানেল।
 * অপ্রয়োজনীয় Mic Gain ও Voice Pitch স্লাইডার সরিয়ে দেওয়া হয়েছে — ব্রাউজারের অটো-গেইন
 * এবং স্মার্ট ভয়েস কমান্ড থেকেই স্বয়ংক্রিয়ভাবে অডিও নিয়ন্ত্রিত হয়।
 */
export const LiveVoicePanel: React.FC<LiveVoicePanelProps> = ({
  isOpen,
  status,
  voiceName,
  liveModelText,
  levelsRef,
  isMuted = false,
  onToggleMute,
  onClose,
}) => {
  const [avatarPref, setAvatarPref] = useState<AvatarPreference>(() => loadAvatarPreference());
  const panelRef = useRef<HTMLElement | null>(null);
  const { lang, t } = useI18n();

  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const latestAssistantContent = useChatStore((s) => {
    const session = s.sessions.find((sess) => sess.id === s.activeSessionId);
    if (!session || session.messages.length === 0) return '';
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant' && session.messages[i].content.trim()) {
        return session.messages[i].content;
      }
    }
    return '';
  });
  const resolvedScheme = useThemeStore((s) => s.resolvedScheme);
  const isDark = resolvedScheme === 'dark';

  const activeAvatarSource = resolveAvatarSource(avatarPref);

  useEffect(() => {
    const handleSync = () => {
      setAvatarPref(loadAvatarPreference());
    };
    window.addEventListener(VOICE_AVATAR_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(VOICE_AVATAR_SYNC_EVENT, handleSync);
  }, []);

  // Stream real-time microphone RMS & voice output amplitude into CSS custom properties
  // directly on the panel node without triggering 60fps React re-renders.
  useEffect(() => {
    if (!isOpen) return;
    let rafId: number | null = null;
    let smoothedMic = 0;
    let smoothedOut = 0;

    const tick = () => {
      if (document.visibilityState === 'hidden') {
        rafId = null;
        return;
      }
      const el = panelRef.current;
      if (el) {
        const rawMic = Math.max(0, Math.min(1, levelsRef.current.input || 0));
        const rawOut = Math.max(0, Math.min(1, levelsRef.current.output || 0));
        smoothedMic += (rawMic - smoothedMic) * (rawMic > smoothedMic ? 0.52 : 0.24);
        smoothedOut += (rawOut - smoothedOut) * (rawOut > smoothedOut ? 0.52 : 0.24);

        el.style.setProperty('--avatar-mic-rms', smoothedMic.toFixed(3));
        el.style.setProperty('--avatar-audio-level', smoothedOut.toFixed(3));

        const isSpeechActive = smoothedMic > 0.03 || smoothedOut > 0.03 || status === 'speaking';
        el.classList.toggle('avatar-speech-active', isSpeechActive);
      }
      rafId = requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (document.visibilityState === 'visible') {
      rafId = requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isOpen, levelsRef, status]);

  const { expression, expressionClass, intensity } = useAvatarExpression({
    streamingContent,
    isStreaming,
    voiceText: liveModelText,
    latestAssistantContent,
    isConnecting: status === 'connecting',
  });

  if (!isOpen) return null;

  const statusWhisper =
    status === 'connecting'
      ? t.voiceStatusConnecting
      : status === 'speaking'
        ? `${t.voiceStatusSpeaking} · ${voiceName}`
        : status === 'listening'
          ? t.voiceStatusListening
          : status === 'muted'
            ? t.voiceStatusMuted
            : `${t.voiceStatusReady} · ${voiceName}`;

  return (
    <aside
      ref={panelRef}
      data-testid="live-voice-panel"
      aria-label="3D Real-time Voice Companion"
      data-expression={expression}
      className={`${expressionClass} hidden sm:flex sm:w-[230px] md:w-[300px] lg:w-[350px] xl:w-[390px] shrink-0 h-full bg-transparent border-0 flex-col overflow-hidden relative select-none`}
    >
      <div className="flex-1 w-full h-full min-h-[240px] relative bg-transparent overflow-hidden">
        <LiveVoiceAvatarCanvas
          status={status}
          voiceName={voiceName}
          levelsRef={levelsRef}
          avatarSrc={activeAvatarSource.src}
          isPrestyledHologram={activeAvatarSource.isPrestyledHologram}
          avatarPreset={avatarPref.preset}
          customTraits={avatarPref.customTraits}
          expression={expression}
          expressionIntensity={intensity}
          isStreaming={isStreaming}
          isDark={isDark}
        />
      </div>

      {/* সরল ও এক-ক্লিক ভয়েস কন্ট্রোল (অপ্রয়োজনীয় স্লাইডার সরানো হয়েছে) */}
      <div className="pb-5 px-3 flex flex-col items-center gap-2.5">
        <div className="inline-flex items-center gap-2 text-[11px] font-medium tracking-wide text-slate-600/90 dark:text-cyan-200/85 drop-shadow-[0_1px_6px_rgba(255,255,255,0.65)] dark:drop-shadow-[0_1px_8px_rgba(0,0,0,0.8)] whitespace-nowrap">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === 'speaking'
                ? 'bg-emerald-400 animate-ping'
                : status === 'listening'
                  ? 'bg-cyan-400 animate-pulse'
                  : status === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-400'
            }`}
          />
          <span
            aria-hidden="true"
            className="avatar-mouth-sim inline-block w-3.5 h-1 rounded-full bg-cyan-500/85 dark:bg-cyan-300/90"
          />
          <span>{statusWhisper}</span>
        </div>

        {(onToggleMute || onClose) && (
          <div className="inline-flex items-center gap-2">
            {onToggleMute && (
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold backdrop-blur-md transition-colors cursor-pointer ${
                  isMuted || status === 'muted'
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300'
                    : 'bg-white/80 dark:bg-slate-900/75 border-slate-200/80 dark:border-cyan-500/30 text-slate-700 dark:text-cyan-100 hover:border-cyan-400'
                }`}
              >
                {isMuted || status === 'muted' ? (
                  <MicOff className="w-3.5 h-3.5" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-cyan-500" />
                )}
                <span>
                  {isMuted || status === 'muted'
                    ? lang === 'bn'
                      ? 'মিউট করা'
                      : 'Muted'
                    : lang === 'bn'
                      ? 'শুনছে'
                      : 'Mic Live'}
                </span>
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={lang === 'bn' ? 'জার্ভিস বন্ধ করুন' : 'Turn off JARVIS'}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-slate-200/80 dark:border-slate-700 bg-white/80 dark:bg-slate-900/75 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-rose-500 hover:border-rose-400 backdrop-blur-md transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'বন্ধ' : 'Off'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
