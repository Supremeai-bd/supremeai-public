import type { AppLanguage } from '../types';
import { ttsService } from './ttsService';
import { logger } from '../utils/logger';

/**
 * বাংলা মন্তব্য: JARVIS মোড = ভয়েস + অটোনমাস টাস্ক এক্সিকিউশনের সেতুবন্ধ।
 *
 * আগে দুইটা সিস্টেম সম্পূর্ণ আলাদা ছিল:
 *   ১. ভয়েস মোড (useLiveVoiceSession) — কথা বলে চ্যাট করা যায়, কিন্তু
 *      প্রম্পট live সার্ভিসে রাউট হত, ফলে autonomous agent executor
 *      (`executeAutonomousTask`) কখনোই চলত না।
 *   ২. চ্যাট টাস্ক এক্সিকিউশন — agent executor দৌড়াত, কিন্তু সব নীরব।
 *
 * এই সার্ভিস টাস্কের প্রতিটি ধাপ স্পিচ-সিনথেসিস দিয়ে ঘোষণা করে (Iron Man-এর
 * JARVIS-এর মতো: "Task accepted... Executing step 2 of 4... Approval required")।
 *
 * ডিজাইন সিদ্ধান্ত:
 *   - এটা ইচ্ছাকৃতভাবে React-নিরপেক্ষ (store-free) — টেস্টেবল ও যেকোনো হুক থেকে চালানো যায়।
 *   - `window.speechSynthesis` অনুপলব্ধ হলে (Tauri Android WebView কিছু ক্ষেত্রে, টেস্ট রানার)
 *     নীরবে no-op — কখনো ক্র্যাশ করে ফিচার ভাঙবে না।
 *   - ফাইনাল উত্তর এখানে বলা হয় না: ফাইনাল উত্তর বিদ্যমান ভয়েস পাইপলাইনই বলে
 *     (App.tsx → liveVoice.speakFallbackText)। এখানে শুধু লাইফসাইকেল ন্যারেশন —
 *     নাহলে একই কথা দুবার শোনা যেত।
 */

export const JARVIS_MODE_STORAGE_KEY = 'supremeai_jarvis_mode_v1';
export const JARVIS_MUTE_STORAGE_KEY = 'supremeai_jarvis_muted_v1';
export const JARVIS_MODE_EVENT = 'supremeai:jarvis-mode-changed';
export const JARVIS_ANNOUNCE_EVENT = 'supremeai:jarvis-announce';

export type JarvisNarrationEvent =
  | 'task_accepted'
  | 'task_step'
  | 'needs_approval'
  | 'task_completed'
  | 'task_fallback'
  | 'mode_enabled'
  | 'mode_disabled';

export type JarvisAnnouncementLevel = 'info' | 'success' | 'warn' | 'error';

export interface JarvisAnnouncement {
  id: string;
  event: JarvisNarrationEvent;
  text: string;
  level: JarvisAnnouncementLevel;
  timestamp: number;
}

export interface NarrationOptions {
  language?: AppLanguage;
  stepLabel?: string;
  stepIndex?: number;
  stepTotal?: number;
  actionCount?: number;
  summary?: string;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Pure narration text builders — unit-testable, no DOM dependency.    */
/* ------------------------------------------------------------------ */

const MAX_SPOKEN_LENGTH = 220;

function truncateSpoken(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_SPOKEN_LENGTH) return clean;
  return `${clean.slice(0, MAX_SPOKEN_LENGTH - 1).trimEnd()}…`;
}

/**
 * বাংলা মন্তব্য: প্রতিটি ইভেন্টের জন্য বলার মতো টেক্সট বানায়। en/bn দুই ভাষাতেই;
 * ভাষা ব্যবহারকারীর অ্যাপ ভাষা অনুযায়ী আসে। এটা pure — speech ছোঁয় না।
 */
export function narrationForEvent(
  event: JarvisNarrationEvent,
  options: NarrationOptions = {}
): string {
  const language = options.language === 'bn' ? 'bn' : 'en';
  const bn = language === 'bn';

  switch (event) {
    case 'task_accepted':
      return bn
        ? 'টাস্ক গ্রহণ করা হয়েছে। স্বয়ংক্রিয় এক্সিকিউশন শুরু হচ্ছে।'
        : 'Task accepted. Initiating autonomous execution.';
    case 'task_step': {
      const label = truncateSpoken(options.stepLabel || '');
      if (!label) return '';
      if (bn) {
        const pos =
          typeof options.stepIndex === 'number' && typeof options.stepTotal === 'number'
            ? ` (ধাপ ${options.stepIndex}/${options.stepTotal})`
            : '';
        return `ধাপ চলছে${pos}: ${label}`;
      }
      const pos =
        typeof options.stepIndex === 'number' && typeof options.stepTotal === 'number'
          ? ` (step ${options.stepIndex} of ${options.stepTotal})`
          : '';
      return `Executing${pos}: ${label}`;
    }
    case 'needs_approval': {
      const count =
        typeof options.actionCount === 'number' && options.actionCount > 0
          ? options.actionCount
          : 1;
      return bn
        ? `অনুমোদন প্রয়োজন। ${count}টি অ্যাকশনের জন্য আপনার অনুমতি অপেক্ষমাণ।`
        : `Approval required. Awaiting your confirmation for ${count} pending action${count > 1 ? 's' : ''}.`;
    }
    case 'task_completed':
      return bn ? 'টাস্ক সম্পন্ন হয়েছে।' : 'Task completed.';
    case 'task_fallback':
      return bn
        ? 'অটোমেটেড এক্সিকিউশন সম্ভব হয়নি — সাধারণ চ্যাটে ফিরে যাওয়া হচ্ছে।'
        : 'Automated execution unavailable — falling back to chat.';
    case 'mode_enabled':
      return bn
        ? 'জার্ভিস মোড সক্রিয়। টাস্ক এক্সিকিউশন এখন ভয়েসে ঘোষণা করা হবে।'
        : 'JARVIS mode enabled. Task execution will now be narrated aloud.';
    case 'mode_disabled':
      return bn ? 'জার্ভিস মোড বন্ধ করা হয়েছে।' : 'JARVIS mode disabled.';
  }
}

/* ------------------------------------------------------------------ */
/* Mode persistence + event bus                                        */
/* ------------------------------------------------------------------ */

let jarvisModeEnabled = false;
let narrationMuted = false;
let lastSpokenKey = '';

try {
  if (typeof localStorage !== 'undefined') {
    jarvisModeEnabled = localStorage.getItem(JARVIS_MODE_STORAGE_KEY) === 'true';
    narrationMuted = localStorage.getItem(JARVIS_MUTE_STORAGE_KEY) === 'true';
  }
} catch {
  // Storage unavailable (private mode etc.) — default off.
}

/** বাংলা মন্তব্য: মিউট = শুধু কথা বলা বন্ধ; মোড ও HUD চালু থাকে, লগ জমতে থাকে। */
export function isJarvisNarrationMuted(): boolean {
  return narrationMuted;
}

let activeNarrationAudio: HTMLAudioElement | null = null;

export function stopJarvisSpeech(): void {
  if (activeNarrationAudio) {
    try {
      activeNarrationAudio.pause();
      activeNarrationAudio.currentTime = 0;
      activeNarrationAudio = null;
    } catch {
      // Non-fatal.
    }
  }
  if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Non-fatal.
    }
  }
}

export function setJarvisNarrationMuted(muted: boolean): void {
  narrationMuted = muted;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(JARVIS_MUTE_STORAGE_KEY, muted ? 'true' : 'false');
    }
  } catch {
    // Non-fatal.
  }
  if (muted) {
    stopJarvisSpeech();
  }
}

export function isJarvisModeEnabled(): boolean {
  return jarvisModeEnabled;
}

export function setJarvisModeEnabled(enabled: boolean, options?: { announce?: boolean }): void {
  jarvisModeEnabled = enabled;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(JARVIS_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    }
  } catch {
    // Non-fatal.
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(JARVIS_MODE_EVENT, { detail: { enabled } })
      );
    } catch {
      // Non-fatal.
    }
  }
  // বাংলা মন্তব্য: ঘোষণা শুধু স্পষ্ট opt-in হলে — টেস্ট/স্টোর-থেকে মোড বদলালে হঠাৎ
  // কথা বলে ওঠা বাঞ্ছনীয় নয়; ব্যবহারকারী যখন UI থেকে টগল করে, তখন UI ঘোষণা চালু করে।
  if (options?.announce) {
    announce(enabled ? 'mode_enabled' : 'mode_disabled', {});
  }
}

/** বাংলা মন্তব্য: React কম্পোনেন্টরা মোড-পরিবর্তনের জন্য এই সাবস্ক্রিপশন ব্যবহার করে। */
export function subscribeJarvisMode(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (evt: Event) => {
    const detail = (evt as CustomEvent<{ enabled: boolean }>).detail;
    listener(Boolean(detail?.enabled));
  };
  window.addEventListener(JARVIS_MODE_EVENT, handler);
  return () => window.removeEventListener(JARVIS_MODE_EVENT, handler);
}

export function subscribeJarvisAnnouncements(
  listener: (announcement: JarvisAnnouncement) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (evt: Event) => {
    const detail = (evt as CustomEvent<JarvisAnnouncement>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(JARVIS_ANNOUNCE_EVENT, handler);
  return () => window.removeEventListener(JARVIS_ANNOUNCE_EVENT, handler);
}

/* ------------------------------------------------------------------ */
/* Speech synthesis (narration voice — Edge Neural + Web Speech fallback) */
/* ------------------------------------------------------------------ */

function speakWithBrowserUtterance(text: string): boolean {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return false;
  }
  try {
    const resolved = ttsService.resolveVoiceForText(text);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = resolved.lang;
    utterance.pitch = Math.max(0, Math.min(2, resolved.pitch));
    utterance.rate = Math.max(0.5, Math.min(2, resolved.rate));
    utterance.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const match =
      voices.find((v) => v.name === resolved.voice) ||
      voices.find((v) => v.lang === resolved.lang) ||
      voices.find((v) => v.lang?.startsWith(resolved.lang.split('-')[0]));
    if (match) utterance.voice = match;

    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    logger.debug('jarvis: speech synthesis unavailable', err);
    return false;
  }
}

let narrationGeneration = 0;

function speakNarration(text: string): void {
  if (narrationMuted) return;
  if (typeof window === 'undefined') return;
  if (!text) return;

  stopJarvisSpeech();
  const currentGen = ++narrationGeneration;

  // বাংলা মন্তব্য: টেস্ট এনভায়রনমেন্টে সিনক্রোনাস স্পিচ স্টাব ব্যবহার করা হয়
  const isTestEnv =
    typeof process !== 'undefined' &&
    (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true');

  if (isTestEnv) {
    speakWithBrowserUtterance(text);
    return;
  }

  // বাংলা মন্তব্য: ১. ব্রাউজারে প্রথমে Cloudflare Edge Neural TTS (/api/tts/edge) চেষ্টা করি
  if (typeof fetch !== 'undefined' && typeof Audio !== 'undefined') {
    (async () => {
      try {
        const payload = ttsService.buildSynthesizePayload(text);
        const res = await fetch('/api/tts/edge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (currentGen === narrationGeneration && res.ok) {
          const data = await res.json().catch(() => null);
          let base64 = '';
          let mime = 'audio/mpeg';

          if (Array.isArray(data?.chunks) && data.chunks.length > 0) {
            base64 = data.chunks[0].audioBase64 || '';
            mime = data.chunks[0].mimeType || 'audio/mpeg';
          } else if (typeof data?.audioBase64 === 'string') {
            base64 = data.audioBase64;
            mime = typeof data?.mimeType === 'string' ? data.mimeType : 'audio/mpeg';
          }

          if (base64 && currentGen === narrationGeneration) {
            const audio = new Audio(`data:${mime};base64,${base64}`);
            activeNarrationAudio = audio;
            audio.onended = () => {
              if (activeNarrationAudio === audio) activeNarrationAudio = null;
            };
            audio.onerror = () => {
              if (activeNarrationAudio === audio) activeNarrationAudio = null;
            };
            await audio.play().catch(() => {
              // ব্রাউজার অটোপ্লে ব্লক করলে লোকাল স্পিচে ফলব্যাক
              speakWithBrowserUtterance(text);
            });
            return;
          }
        }
      } catch {
        // ফলব্যাক
      }

      if (currentGen === narrationGeneration) {
        speakWithBrowserUtterance(text);
      }
    })();
    return;
  }

  // বাংলা মন্তব্য: ২. ফলব্যাক: ব্রাউজারের নেটিভ SpeechSynthesisUtterance
  speakWithBrowserUtterance(text);
}

/* ------------------------------------------------------------------ */
/* Public narration API used by stores / App                           */
/* ------------------------------------------------------------------ */

const announcementLog: JarvisAnnouncement[] = [];

export function getAnnouncementLog(): JarvisAnnouncement[] {
  return [...announcementLog];
}

export function announce(event: JarvisNarrationEvent, options: NarrationOptions): JarvisAnnouncement | null {
  const text = narrationForEvent(event, options);
  if (!text) return null;

  const announcement: JarvisAnnouncement = {
    id: `jarvis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    event,
    text,
    level:
      event === 'needs_approval'
        ? 'warn'
        : event === 'task_completed'
          ? 'success'
          : event === 'task_fallback'
            ? 'error'
            : 'info',
    timestamp: Date.now(),
  };

  announcementLog.push(announcement);
  if (announcementLog.length > 30) announcementLog.shift();

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(JARVIS_ANNOUNCE_EVENT, { detail: announcement })
      );
    } catch {
      // Non-fatal.
    }
  }

  if (jarvisModeEnabled) {
    speakNarration(text);
  }
  return announcement;
}

/**
 * বাংলা মন্তব্য: একই ধাপ বারবার বলা আটকায় (pushAgentStep একই step id কয়েকবার
 * আপডেট করে — running → done)। শুধু 'running' অবস্থায় প্রথমবার বললেই যথেষ্ট।
 */
export function notifyTaskStep(step: { id: string; label: string; status: string }, options: NarrationOptions = {}): void {
  if (!jarvisModeEnabled) return;
  if (step.status !== 'running') return;
  const dedupKey = `step:${step.id}`;
  if (lastSpokenKey === dedupKey) return;
  lastSpokenKey = dedupKey;
  announce('task_step', { ...options, stepLabel: step.label });
}

export function resetNarrationDedup(): void {
  lastSpokenKey = '';
}

/* ------------------------------------------------------------------ */
/* Lifecycle helpers — called from useChatStore agent executor path    */
/* ------------------------------------------------------------------ */

export const jarvisService = {
  isEnabled: isJarvisModeEnabled,
  setEnabled: setJarvisModeEnabled,
  announce,
  resetDedup: resetNarrationDedup,
  /** টাস্ক গ্রহণ — agent executor চালু হওয়ার ঠিক আগে ডাকা হয় */
  notifyTaskAccepted(language?: AppLanguage): void {
    if (!jarvisModeEnabled) return;
    resetNarrationDedup();
    announce('task_accepted', { language });
  },
  /** প্রতিটি agent step — শুধু 'running' অবস্থা ঘোষণা করা হয় */
  notifyStep: notifyTaskStep,
  /** এজেন্ট আউটকাম — completed / needs_approval / fallback_chat */
  notifyOutcome(
    status: 'completed' | 'needs_approval' | 'fallback_chat',
    options: NarrationOptions = {}
  ): void {
    if (status === 'completed') {
      announce('task_completed', options);
    } else if (status === 'needs_approval') {
      announce('needs_approval', options);
    } else {
      announce('task_fallback', options);
    }
  },
};

export default jarvisService;
