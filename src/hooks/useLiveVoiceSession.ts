import { useState, useRef, useCallback, useEffect } from 'react';
import { env } from '../config/env';
import { ttsService } from '../services/ttsService';
import {
  loadVoicePreference,
  saveVoicePreference,
  VOICE_AVATAR_SYNC_EVENT,
} from '../utils/hologramAvatar';
import {
  type BanglaAccentId,
  buildClientDirectTtsUrl,
  chunkSpeechSegment,
  clampMicInputGain,
  clampVoicePitch,
  computeScaledRms,
  detectBengaliOrBanglish,
  loadBanglaAccentPreference,
  loadMicInputGainPreference,
  loadVoicePitchPreference,
  normalizeBanglaAccent,
  pickNativeSpeechVoice,
  resolveSpeechUtteranceTarget,
  sanitizeSpeechText,
  saveMicInputGainPreference,
  splitByScriptSegments,
  type TtsAudioChunk,
} from '../utils/speechUtils';
import { logger } from '../utils/logger';
import { TTS_INTL_VOICES, isIntlTtsLanguage, normalizeTtsLanguage } from '../shared/ttsLanguages';
import type { AppLanguage } from '../types';

export type LiveVoiceName = 'Zephyr' | 'Puck' | 'Kore' | 'Charon' | 'Fenrir';

export const LIVE_VOICE_OPTIONS: Array<{
  id: LiveVoiceName;
  label: string;
  tone: string;
}> = [
  { id: 'Zephyr', label: 'Zephyr', tone: 'Bright & balanced' },
  { id: 'Puck', label: 'Puck', tone: 'Upbeat & lively' },
  { id: 'Kore', label: 'Kore', tone: 'Clear & articulate' },
  { id: 'Charon', label: 'Charon', tone: 'Warm & composed' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Crisp & direct' },
];

export type LiveSessionStatus =
  'idle' | 'connecting' | 'listening' | 'speaking' | 'muted' | 'error';

export interface LiveTranscriptItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

/**
 * Shape of the frames the Live service pushes over the socket. Fields are
 * optional because each frame only carries the payload for its `type`; the
 * handler narrows with `typeof` before reading them.
 */
interface LiveServerMessage {
  type?: string;
  data?: unknown;
  text?: unknown;
  message?: unknown;
}

interface UseLiveVoiceSessionOptions {
  systemInstruction?: string;
  language?: AppLanguage;
  onTurnCommitted?: (
    userText: string,
    assistantText: string,
    voice: LiveVoiceName,
    meta?: { fromTeardown?: boolean }
  ) => void;
}

function resampleFloat32(
  input: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate === targetRate || input.length === 0) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIndex - low;
    output[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return output;
}

function float32ToBase64Pcm16(samples: Float32Array): string {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

function applyMicGain(samples: Float32Array, gain: number): Float32Array {
  const safeGain = clampMicInputGain(gain);
  if (Math.abs(safeGain - 1.0) < 0.01) return samples;
  const scaled = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    scaled[i] = Math.max(-1, Math.min(1, samples[i] * safeGain));
  }
  return scaled;
}

async function waitForBrowserVoices(timeoutMs: number = 350): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const existing = window.speechSynthesis.getVoices?.() || [];
  if (existing.length > 0) return existing;

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        window.speechSynthesis.removeEventListener?.('voiceschanged', done);
      } catch (error) {
        logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
      }
      resolve(window.speechSynthesis.getVoices?.() || []);
    };
    const timer = setTimeout(done, timeoutMs);
    try {
      window.speechSynthesis.addEventListener?.('voiceschanged', done);
    } catch {
      clearTimeout(timer);
      resolve([]);
    }
  });
}

export function useLiveVoiceSession({
  systemInstruction,
  language = 'en',
  onTurnCommitted,
}: UseLiveVoiceSessionOptions = {}) {
  const [status, setStatus] = useState<LiveSessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [hasMicrophone, setHasMicrophone] = useState<boolean>(true);
  const [voiceName, setVoiceNameState] = useState<LiveVoiceName>(
    () => ttsService.getConfig().voicePersona
  );
  const [inputGain, setInputGainState] = useState<number>(() => loadMicInputGainPreference());
  const [voicePitch, setVoicePitchState] = useState<number>(() => ttsService.getConfig().pitch);
  const [banglaAccent, setBanglaAccentState] = useState<BanglaAccentId>(
    () => ttsService.getConfig().banglaAccent
  );
  const [isMuted, setIsMuted] = useState(false);

  const setVoiceName = useCallback((next: LiveVoiceName) => {
    setVoiceNameState(next);
    const updated = ttsService.setVoicePersona(next);
    saveVoicePreference(updated.voicePersona);
  }, []);

  const inputGainRef = useRef<number>(inputGain);
  inputGainRef.current = inputGain;

  const voicePitchRef = useRef<number>(voicePitch);
  voicePitchRef.current = voicePitch;

  const banglaAccentRef = useRef<BanglaAccentId>(banglaAccent);
  banglaAccentRef.current = banglaAccent;

  const setInputGain = useCallback((nextGain: number) => {
    const safe = clampMicInputGain(nextGain);
    inputGainRef.current = safe;
    setInputGainState(safe);
    saveMicInputGainPreference(safe);
  }, []);

  const setVoicePitch = useCallback((nextPitch: number) => {
    const safe = clampVoicePitch(nextPitch);
    voicePitchRef.current = safe;
    setVoicePitchState(safe);
    ttsService.setPitch(safe);
  }, []);

  const setBanglaAccent = useCallback((nextAccent: BanglaAccentId) => {
    const safe = normalizeBanglaAccent(nextAccent);
    banglaAccentRef.current = safe;
    setBanglaAccentState(safe);
    ttsService.setBanglaAccent(safe);
  }, []);

  useEffect(() => {
    const applyTtsConfig = () => {
      const cfg = ttsService.getConfig();
      setVoiceNameState((prev) => (prev === cfg.voicePersona ? prev : cfg.voicePersona));
      voicePitchRef.current = cfg.pitch;
      setVoicePitchState((prev) => (prev === cfg.pitch ? prev : cfg.pitch));
      banglaAccentRef.current = cfg.banglaAccent;
      setBanglaAccentState((prev) => (prev === cfg.banglaAccent ? prev : cfg.banglaAccent));
      languageRef.current = cfg.language;
    };
    const unsubscribe = ttsService.subscribe(() => {
      applyTtsConfig();
    });
    const onSync = () => {
      const savedGain = loadMicInputGainPreference();
      setInputGainState((prev) => (prev === savedGain ? prev : savedGain));
      const savedVoice = loadVoicePreference();
      const savedPitch = loadVoicePitchPreference();
      const savedAccent = loadBanglaAccentPreference();
      setVoiceNameState((prev) => (prev === savedVoice ? prev : savedVoice));
      voicePitchRef.current = savedPitch;
      setVoicePitchState((prev) => (prev === savedPitch ? prev : savedPitch));
      banglaAccentRef.current = savedAccent;
      setBanglaAccentState((prev) => (prev === savedAccent ? prev : savedAccent));
    };
    window.addEventListener(VOICE_AVATAR_SYNC_EVENT, onSync);
    return () => {
      unsubscribe();
      window.removeEventListener(VOICE_AVATAR_SYNC_EVENT, onSync);
    };
  }, []);
  const [transcripts, setTranscripts] = useState<LiveTranscriptItem[]>([]);
  const [liveUserText, setLiveUserText] = useState('');
  const [liveModelText, setLiveModelText] = useState('');

  // Mutable refs for real-time audio callbacks (avoids stale closures & 60fps React renders)
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);

  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;

  const voiceRef = useRef<LiveVoiceName>(voiceName);
  voiceRef.current = voiceName;

  const systemInstructionRef = useRef<string | undefined>(systemInstruction);
  systemInstructionRef.current = systemInstruction;

  const languageRef = useRef<AppLanguage>(language);
  languageRef.current = language;

  const onTurnCommittedRef = useRef(onTurnCommitted);
  onTurnCommittedRef.current = onTurnCommitted;

  const pendingUserTextRef = useRef<string>('');
  const pendingModelTextRef = useRef<string>('');
  const queuedTextPromptsRef = useRef<string[]>([]);
  const isLiveReadyRef = useRef<boolean>(false);
  const ttsPulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsAnalyserRafRef = useRef<number | null>(null);
  const ttsGenerationRef = useRef<number>(0);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const activeHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());
  const levelsRef = useRef<{ input: number; output: number }>({ input: 0, output: 0 });
  const teardownGuardRef = useRef<boolean>(false);

  const flushPendingTurn = useCallback((meta?: { fromTeardown?: boolean }) => {
    const uText = pendingUserTextRef.current.trim();
    const mText = pendingModelTextRef.current.trim();
    if (!uText && !mText) return;

    const now = Date.now();
    const additions: LiveTranscriptItem[] = [];
    if (uText) {
      additions.push({
        id: `live_u_${now}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text: uText,
        timestamp: now,
      });
    }
    if (mText) {
      additions.push({
        id: `live_m_${now + 1}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        text: mText,
        timestamp: now + 1,
      });
    }

    pendingUserTextRef.current = '';
    pendingModelTextRef.current = '';
    setLiveUserText('');
    setLiveModelText('');
    setTranscripts((prev) => [...prev, ...additions]);

    if (onTurnCommittedRef.current) {
      onTurnCommittedRef.current(uText, mText, voiceRef.current, meta);
    }
  }, []);

  const stopAllPlayback = useCallback(() => {
    ttsGenerationRef.current += 1;
    if (ttsAbortRef.current) {
      try {
        ttsAbortRef.current.abort();
      } catch (error) {
        logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
      }
      ttsAbortRef.current = null;
    }
    if (ttsAnalyserRafRef.current !== null) {
      cancelAnimationFrame(ttsAnalyserRafRef.current);
      ttsAnalyserRafRef.current = null;
    }
    if (ttsPulseTimerRef.current) {
      clearInterval(ttsPulseTimerRef.current);
      ttsPulseTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      activeUtteranceRef.current = null;
      try {
        window.speechSynthesis.cancel();
      } catch (error) {
        logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
      }
    }
    if (activeHtmlAudioRef.current) {
      try {
        activeHtmlAudioRef.current.onended = null;
        activeHtmlAudioRef.current.onerror = null;
        activeHtmlAudioRef.current.pause();
        activeHtmlAudioRef.current.src = '';
      } catch (error) {
        logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
      }
      activeHtmlAudioRef.current = null;
    }
    for (const url of activeBlobUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
      }
    }
    activeBlobUrlsRef.current.clear();
    for (const src of activeSourcesRef.current) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore stopped source errors
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    levelsRef.current.output = 0;
  }, []);

  // Synchronously create/resume AudioContext inside user-gesture stack (critical for cross-origin iframes)
  const ensureUnlockedOutputContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!outputCtxRef.current || outputCtxRef.current.state === 'closed') {
      outputCtxRef.current = new AudioCtx();
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
    const ctx = outputCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }, []);

  const cleanupMediaAndSocket = useCallback(
    (preserveError: boolean = false) => {
      teardownGuardRef.current = true;
      isLiveReadyRef.current = false;
      queuedTextPromptsRef.current = [];

      flushPendingTurn({ fromTeardown: true });
      stopAllPlayback();

      if (processorRef.current) {
        try {
          processorRef.current.onaudioprocess = null;
          processorRef.current.disconnect();
        } catch (error) {
          logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
        }
        processorRef.current = null;
      }
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.disconnect();
        } catch (error) {
          logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
        }
        sourceNodeRef.current = null;
      }
      if (muteGainRef.current) {
        try {
          muteGainRef.current.disconnect();
        } catch (error) {
          logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
        }
        muteGainRef.current = null;
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          try {
            track.stop();
          } catch (error) {
            logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
          }
        }
        streamRef.current = null;
      }
      if (inputCtxRef.current) {
        inputCtxRef.current.close().catch(() => {});
        inputCtxRef.current = null;
      }
      if (outputCtxRef.current) {
        outputCtxRef.current.close().catch(() => {});
        outputCtxRef.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          try {
            ws.close();
          } catch (error) {
            logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
          }
        }
      }

      levelsRef.current = { input: 0, output: 0 };
      if (!preserveError) {
        setStatus('idle');
        setMicNotice(null);
      }
    },
    [flushPendingTurn, stopAllPlayback]
  );

  const playAudioChunk = useCallback((base64Pcm: string) => {
    const outputCtx = outputCtxRef.current;
    if (!outputCtx) return;
    if (outputCtx.state === 'suspended') {
      outputCtx.resume().catch(() => {});
    }

    const float32 = base64Pcm16ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    levelsRef.current.output = computeScaledRms(float32, 1.0);

    const audioBuffer = outputCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = outputCtx.createBufferSource();
    source.buffer = audioBuffer;
    const safePitch = clampVoicePitch(voicePitchRef.current);
    const detuneCents =
      Math.abs(safePitch - 1.0) > 0.02
        ? Math.max(-500, Math.min(500, Math.round(1200 * Math.log2(safePitch))))
        : 0;
    if (detuneCents !== 0 && 'detune' in source) {
      source.detune.value = detuneCents;
    }
    source.connect(outputCtx.destination);

    const effectiveRate = detuneCents !== 0 ? Math.pow(2, detuneCents / 1200) : 1;
    const now = outputCtx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + audioBuffer.duration / effectiveRate;

    activeSourcesRef.current.add(source);
    setStatus('speaking');

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        levelsRef.current.output = 0;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          setStatus(isMutedRef.current ? 'muted' : 'listening');
        }
      }
    };

    source.start(startAt);
  }, []);

  const connect = useCallback(
    async (overrideVoice?: LiveVoiceName) => {
      cleanupMediaAndSocket(false);
      teardownGuardRef.current = false;

      const selectedVoice = overrideVoice || voiceRef.current;
      if (overrideVoice) {
        setVoiceName(overrideVoice);
        voiceRef.current = overrideVoice;
      }

      setError(null);
      setMicNotice(null);
      setStatus('connecting');

      try {
        // Synchronously unlock AudioContext during user gesture before mic/async calls
        const outputCtx = ensureUnlockedOutputContext();
        if (!outputCtx) {
          throw new Error('Web Audio API is unavailable in this browser.');
        }
        if (outputCtx.state === 'suspended') {
          await outputCtx.resume().catch(() => {});
        }
        nextStartTimeRef.current = outputCtx.currentTime;

        const isBnLang = languageRef.current === 'bn';
        // Probe microphone non-fatally: if no hardware mic exists ("Requested device not found"),
        // keep the Live Voice Avatar session connected in audio-playback + text-input mode!
        let stream: MediaStream | null = null;
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            });
          } catch (micErr: unknown) {
            const errName = micErr instanceof DOMException ? micErr.name : '';
            if (errName === 'OverconstrainedError') {
              try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              } catch (fallbackErr: unknown) {
                stream = null;
                const fbName = fallbackErr instanceof DOMException ? fallbackErr.name : '';
                setMicNotice(
                  isBnLang
                    ? fbName === 'NotAllowedError'
                      ? 'মাইক্রোফোন অনুমতি বন্ধ আছে — নিচে লিখুন, অবতার বাংলায় উত্তর শোনাবে।'
                      : 'মাইক্রোফোন পাওয়া যায়নি — নিচে লিখে ভয়েস উত্তর শুনুন।'
                    : fbName === 'NotAllowedError'
                      ? 'Microphone access blocked — type below for avatar voice replies.'
                      : 'No microphone detected — type below to converse with voice playback.'
                );
              }
            } else {
              stream = null;
              setMicNotice(
                isBnLang
                  ? errName === 'NotAllowedError'
                    ? 'মাইক্রোফোন অনুমতি বন্ধ আছে — নিচে লিখুন, অবতার বাংলায় উত্তর শোনাবে।'
                    : 'মাইক্রোফোন পাওয়া যায়নি — নিচে লিখে ভয়েস উত্তর শুনুন।'
                  : errName === 'NotAllowedError'
                    ? 'Microphone access blocked — type below for avatar voice replies.'
                    : 'No microphone detected — type below to converse with voice playback.'
              );
            }
          }
        } else {
          setMicNotice(
            isBnLang
              ? 'এই ব্রাউজারে মাইক্রোফোন সাপোর্ট নেই — নিচে লিখে ভয়েস উত্তর শুনুন।'
              : 'Microphone unavailable in this browser — type below for avatar voice replies.'
          );
        }

        if (teardownGuardRef.current) {
          if (stream) for (const t of stream.getTracks()) t.stop();
          return;
        }

        const micAvailable = Boolean(stream);
        setHasMicrophone(micAvailable);
        if (!micAvailable) {
          isMutedRef.current = true;
          setIsMuted(true);
        } else {
          isMutedRef.current = false;
          setIsMuted(false);
        }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const storedToken =
          typeof window !== 'undefined'
            ? (localStorage.getItem('supremeai_access_token') || '').trim()
            : '';
        const wsTokenParam = storedToken ? `?token=${encodeURIComponent(storedToken)}` : '';
        const wsUrl = `${wsProtocol}//${window.location.host}/api/live${wsTokenParam}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        if (stream) {
          streamRef.current = stream;
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const inputCtx = new AudioCtx();
          await inputCtx.resume().catch(() => {});
          inputCtxRef.current = inputCtx;

          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(2048, 1, 1);
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);

          sourceNodeRef.current = source;
          processorRef.current = processor;
          muteGainRef.current = silentGain;

          processor.onaudioprocess = (event) => {
            const activeWs = wsRef.current;
            if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;

            if (isMutedRef.current) {
              levelsRef.current.input = 0;
              return;
            }

            const rawInput = event.inputBuffer.getChannelData(0);
            const activeGain = clampMicInputGain(inputGainRef.current);
            levelsRef.current.input = computeScaledRms(rawInput, activeGain);

            const pcm16k = resampleFloat32(rawInput, inputCtx.sampleRate, 16000);
            const gainedPcm = applyMicGain(pcm16k, activeGain);
            const base64Audio = float32ToBase64Pcm16(gainedPcm);
            activeWs.send(JSON.stringify({ type: 'audio', data: base64Audio }));
          };
        }

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'init',
              voiceName: selectedVoice,
              systemInstruction: systemInstructionRef.current || '',
              language: languageRef.current || 'en',
              pitch: voicePitchRef.current,
              accent: banglaAccentRef.current,
            })
          );
        };

        ws.onmessage = (event) => {
          let msg: LiveServerMessage;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }

          if (msg.type === 'connected' || msg.type === 'setup_complete') {
            isLiveReadyRef.current = true;
            setStatus(isMutedRef.current ? 'muted' : 'listening');
            if (queuedTextPromptsRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
              const queued = [...queuedTextPromptsRef.current];
              queuedTextPromptsRef.current = [];
              for (const qText of queued) {
                ws.send(JSON.stringify({ type: 'text', text: qText }));
              }
            }
          } else if (msg.type === 'audio' && typeof msg.data === 'string') {
            playAudioChunk(msg.data);
          } else if (msg.type === 'input_transcript' && typeof msg.text === 'string') {
            pendingUserTextRef.current += msg.text;
            setLiveUserText(pendingUserTextRef.current);
          } else if (msg.type === 'output_transcript' && typeof msg.text === 'string') {
            pendingModelTextRef.current += msg.text;
            setLiveModelText(pendingModelTextRef.current);
          } else if (msg.type === 'interrupted') {
            stopAllPlayback();
            flushPendingTurn();
            setStatus(isMutedRef.current ? 'muted' : 'listening');
          } else if (msg.type === 'turn_complete') {
            flushPendingTurn();
            if (activeSourcesRef.current.size === 0) {
              setStatus(isMutedRef.current ? 'muted' : 'listening');
            }
          } else if (msg.type === 'error') {
            const errMsg = String(msg.message || 'Live API error.');
            setError(errMsg);
            setStatus('error');
            cleanupMediaAndSocket(true);
          } else if (msg.type === 'closed') {
            cleanupMediaAndSocket(false);
          }
        };

        ws.onerror = () => {
          setError('WebSocket connection error while talking to SupremeAI Live service.');
          setStatus('error');
          cleanupMediaAndSocket(true);
        };

        ws.onclose = () => {
          if (!teardownGuardRef.current) {
            cleanupMediaAndSocket(false);
          }
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unable to start voice conversation.';
        setError(message);
        setStatus('error');
        cleanupMediaAndSocket(true);
      }
    },
    [
      cleanupMediaAndSocket,
      ensureUnlockedOutputContext,
      flushPendingTurn,
      playAudioChunk,
      setVoiceName,
      stopAllPlayback,
    ]
  );

  const disconnect = useCallback(() => {
    setError(null);
    cleanupMediaAndSocket(false);
  }, [cleanupMediaAndSocket]);

  const toggleMute = useCallback(() => {
    if (!hasMicrophone) {
      setMicNotice('No microphone detected on this device. Type below or attach a microphone.');
      return;
    }
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        levelsRef.current.input = 0;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'audio_end' }));
        }
        if (activeSourcesRef.current.size === 0) {
          setStatus('muted');
        }
      } else if (
        wsRef.current?.readyState === WebSocket.OPEN &&
        activeSourcesRef.current.size === 0
      ) {
        setStatus('listening');
      }
      return next;
    });
  }, [hasMicrophone]);

  const sendTextPrompt = useCallback(
    (text: string, options?: { recordUserTranscript?: boolean }): boolean => {
      const trimmed = text.trim();
      const ws = wsRef.current;
      if (
        !trimmed ||
        !ws ||
        (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)
      ) {
        return false;
      }

      stopAllPlayback();
      const now = Date.now();
      if (options?.recordUserTranscript !== false) {
        setTranscripts((prev) => [
          ...prev,
          {
            id: `live_txt_${now}`,
            role: 'user',
            text: trimmed,
            timestamp: now,
          },
        ]);
      }

      if (isLiveReadyRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'text', text: trimmed }));
      } else {
        queuedTextPromptsRef.current.push(trimmed);
      }
      return true;
    },
    [stopAllPlayback]
  );

  // Tier 1 (Default / $0 Cost / 0ms Latency): Browser Native Web Speech API
  const speakTier1Native = useCallback(
    (
      clean: string,
      genId: number,
      voices: SpeechSynthesisVoice[],
      onSilentOrError?: () => void
    ): boolean => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
      if (genId !== ttsGenerationRef.current) return false;

      const scriptSegments = splitByScriptSegments(clean.slice(0, 2000));
      if (scriptSegments.length === 0) return false;

      const utteranceQueue = scriptSegments.flatMap((seg) =>
        chunkSpeechSegment(seg.text, 220).map((chunkText) => ({
          text: chunkText,
          lang: seg.lang,
        }))
      );
      if (utteranceQueue.length === 0) return false;

      const startPulse = () => {
        setStatus('speaking');
        const t0 = performance.now();
        if (ttsPulseTimerRef.current) clearInterval(ttsPulseTimerRef.current);
        ttsPulseTimerRef.current = setInterval(() => {
          const s = (performance.now() - t0) / 1000;
          levelsRef.current.output = 0.42 + 0.28 * Math.sin(s * 12) + 0.16 * Math.cos(s * 19);
        }, 65);
      };

      const finishPulse = () => {
        activeUtteranceRef.current = null;
        if (ttsPulseTimerRef.current) {
          clearInterval(ttsPulseTimerRef.current);
          ttsPulseTimerRef.current = null;
        }
        levelsRef.current.output = 0;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          setStatus(isMutedRef.current ? 'muted' : 'listening');
        } else {
          setStatus('idle');
        }
      };

      let idx = 0;
      let fallbackTriggered = false;
      const triggerFailover = () => {
        if (fallbackTriggered || genId !== ttsGenerationRef.current || !onSilentOrError)
          return false;
        fallbackTriggered = true;
        finishPulse();
        try {
          window.speechSynthesis.cancel();
        } catch (error) {
          logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
        }
        onSilentOrError();
        return true;
      };

      const speakNext = () => {
        if (genId !== ttsGenerationRef.current || idx >= utteranceQueue.length) {
          finishPulse();
          return;
        }
        const seg = utteranceQueue[idx++];
        // Re-read browser voices dynamically on every chunk in case voices loaded asynchronously
        const liveVoices = window.speechSynthesis.getVoices?.();
        const availableVoices = liveVoices && liveVoices.length > 0 ? liveVoices : voices;

        const activeCfg = ttsService.getConfig();
        const activeLanguage = activeCfg.language || languageRef.current;
        const target = resolveSpeechUtteranceTarget(
          seg.text,
          seg.lang,
          activeLanguage,
          availableVoices,
          activeCfg.voicePersona || voiceRef.current,
          activeCfg.banglaAccent || banglaAccentRef.current
        );

        const utterance = new SpeechSynthesisUtterance(seg.text);
        activeUtteranceRef.current = utterance;
        utterance.lang = target.lang;
        if (target.voice) {
          utterance.voice = target.voice;
        }
        utterance.rate = target.targetScriptLang === 'bn-BD' ? 0.98 : activeCfg.rate;
        utterance.pitch = clampVoicePitch(activeCfg.pitch ?? voicePitchRef.current);
        const startedAt = performance.now();
        utterance.onend = () => {
          if (genId !== ttsGenerationRef.current) {
            finishPulse();
            return;
          }
          // Detect silent-skip bug when OS claims Bengali support but finishes in < 75ms without audio
          const elapsed = performance.now() - startedAt;
          if (
            target.targetScriptLang === 'bn-BD' &&
            seg.text.length > 5 &&
            elapsed < 75 &&
            triggerFailover()
          ) {
            return;
          }
          speakNext();
        };
        utterance.onerror = () => {
          if (genId !== ttsGenerationRef.current) {
            finishPulse();
            return;
          }
          if (triggerFailover()) return;
          speakNext();
        };
        window.speechSynthesis.speak(utterance);
      };

      startPulse();
      speakNext();
      return true;
    },
    []
  );

  // Play an ordered list of encoded TTS audio chunks cleanly (supports Web Audio Analyser + HTMLAudio fail-safe)
  const playEncodedTtsChunks = useCallback(
    async (
      chunks: TtsAudioChunk[],
      genId: number,
      pitchAppliedServerSide: boolean = false
    ): Promise<boolean> => {
      if (!chunks || chunks.length === 0 || genId !== ttsGenerationRef.current) return false;

      const ctx = ensureUnlockedOutputContext();
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      const playSingleViaHtmlAudio = (bytes: Uint8Array, mimeType: string): Promise<boolean> =>
        new Promise((resolve) => {
          if (genId !== ttsGenerationRef.current) {
            resolve(false);
            return;
          }
          const arrayBuf = new Uint8Array(bytes).buffer;
          const blob = new Blob([arrayBuf], { type: mimeType || 'audio/mpeg' });
          const blobUrl = URL.createObjectURL(blob);
          activeBlobUrlsRef.current.add(blobUrl);

          const audio = new Audio(blobUrl);
          activeHtmlAudioRef.current = audio;

          setStatus('speaking');
          const t0 = performance.now();
          if (ttsPulseTimerRef.current) clearInterval(ttsPulseTimerRef.current);
          ttsPulseTimerRef.current = setInterval(() => {
            const s = (performance.now() - t0) / 1000;
            levelsRef.current.output = 0.4 + 0.28 * Math.sin(s * 12) + 0.16 * Math.cos(s * 19);
          }, 55);

          const cleanupChunk = () => {
            if (ttsPulseTimerRef.current) {
              clearInterval(ttsPulseTimerRef.current);
              ttsPulseTimerRef.current = null;
            }
            levelsRef.current.output = 0;
            if (activeHtmlAudioRef.current === audio) {
              activeHtmlAudioRef.current = null;
            }
            activeBlobUrlsRef.current.delete(blobUrl);
            try {
              URL.revokeObjectURL(blobUrl);
            } catch (error) {
              logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
            }
          };

          audio.onended = () => {
            cleanupChunk();
            resolve(true);
          };
          audio.onerror = () => {
            cleanupChunk();
            resolve(false);
          };

          audio.play().catch(() => {
            cleanupChunk();
            resolve(false);
          });
        });

      const playSingleViaWebAudio = async (bytes: Uint8Array): Promise<boolean> => {
        if (!ctx || ctx.state !== 'running' || genId !== ttsGenerationRef.current) return false;
        const audioBuffer = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
        if (genId !== ttsGenerationRef.current) return false;

        return new Promise<boolean>((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          if (!pitchAppliedServerSide) {
            const safePitch = clampVoicePitch(voicePitchRef.current);
            if (Math.abs(safePitch - 1.0) > 0.02 && 'detune' in source) {
              source.detune.value = Math.max(
                -500,
                Math.min(500, Math.round(1200 * Math.log2(safePitch)))
              );
            }
          }
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          const sampleBuf = new Float32Array(analyser.fftSize);

          source.connect(analyser);
          analyser.connect(ctx.destination);

          activeSourcesRef.current.add(source);
          setStatus('speaking');

          const tickLevel = () => {
            if (genId !== ttsGenerationRef.current || activeSourcesRef.current.size === 0) {
              levelsRef.current.output = 0;
              ttsAnalyserRafRef.current = null;
              return;
            }
            analyser.getFloatTimeDomainData(sampleBuf);
            levelsRef.current.output = computeScaledRms(sampleBuf, 1.0);
            ttsAnalyserRafRef.current = requestAnimationFrame(tickLevel);
          };

          source.onended = () => {
            activeSourcesRef.current.delete(source);
            if (ttsAnalyserRafRef.current !== null) {
              cancelAnimationFrame(ttsAnalyserRafRef.current);
              ttsAnalyserRafRef.current = null;
            }
            levelsRef.current.output = 0;
            resolve(true);
          };

          source.start(0);
          ttsAnalyserRafRef.current = requestAnimationFrame(tickLevel);
        });
      };

      let playedAny = false;
      for (const chunk of chunks) {
        if (genId !== ttsGenerationRef.current) break;
        if (!chunk?.audioBase64) continue;

        const binary = atob(chunk.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        let ok = false;
        try {
          ok = await playSingleViaWebAudio(bytes);
        } catch {
          ok = false;
        }
        if (!ok && genId === ttsGenerationRef.current) {
          ok = await playSingleViaHtmlAudio(bytes, chunk.mimeType || 'audio/mpeg');
        }
        if (ok) playedAny = true;
      }

      if (genId === ttsGenerationRef.current) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          setStatus(isMutedRef.current ? 'muted' : 'listening');
        } else {
          setStatus('idle');
        }
      }
      return playedAny;
    },
    [ensureUnlockedOutputContext]
  );

  // Client-side direct <audio> fail-safe when both OS voice AND edge endpoint are unavailable
  const playDirectAudioTtsFallback = useCallback(
    async (clean: string, genId: number): Promise<boolean> => {
      if (typeof Audio === 'undefined' || genId !== ttsGenerationRef.current) return false;
      const segments = splitByScriptSegments(clean.slice(0, 1400));
      // বাংলা মন্তব্য: hi/es/… সিলেক্ট থাকলে বাংলা-বহির্ভূত অংশ সেই ভাষার locale-এ (আগে en-US)।
      const activeLang = ttsService.getConfig().language;
      const intlLocale = isIntlTtsLanguage(activeLang)
        ? TTS_INTL_VOICES[normalizeTtsLanguage(activeLang)]?.lang
        : undefined;
      const items: Array<{ text: string; lang: string }> = [];
      for (const seg of segments) {
        const lang = seg.lang === 'en-US' && intlLocale ? intlLocale : seg.lang;
        for (const piece of chunkSpeechSegment(seg.text, 175)) {
          items.push({ text: piece, lang });
        }
      }
      if (items.length === 0) return false;

      let playedAny = false;
      for (const item of items) {
        if (genId !== ttsGenerationRef.current) break;
        const ok = await new Promise<boolean>((resolve) => {
          const audio = new Audio(buildClientDirectTtsUrl(item.text, item.lang));
          try {
            (audio as HTMLAudioElement & { referrerPolicy?: string }).referrerPolicy =
              'no-referrer';
          } catch (error) {
            logger.debug('useLiveVoiceSession: suppressed non-fatal error', error);
          }
          activeHtmlAudioRef.current = audio;

          setStatus('speaking');
          const t0 = performance.now();
          if (ttsPulseTimerRef.current) clearInterval(ttsPulseTimerRef.current);
          ttsPulseTimerRef.current = setInterval(() => {
            const s = (performance.now() - t0) / 1000;
            levelsRef.current.output = 0.38 + 0.26 * Math.sin(s * 12) + 0.14 * Math.cos(s * 19);
          }, 55);

          const cleanup = () => {
            if (ttsPulseTimerRef.current) {
              clearInterval(ttsPulseTimerRef.current);
              ttsPulseTimerRef.current = null;
            }
            levelsRef.current.output = 0;
            if (activeHtmlAudioRef.current === audio) {
              activeHtmlAudioRef.current = null;
            }
          };

          audio.onended = () => {
            cleanup();
            resolve(true);
          };
          audio.onerror = () => {
            cleanup();
            resolve(false);
          };
          audio.play().catch(() => {
            cleanup();
            resolve(false);
          });
        });

        if (!ok) {
          return playedAny;
        }
        playedAny = true;
      }

      if (genId === ttsGenerationRef.current) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          setStatus(isMutedRef.current ? 'muted' : 'listening');
        } else {
          setStatus('idle');
        }
      }
      return playedAny;
    },
    []
  );

  const fetchAndPlayTtsEndpoint = useCallback(
    async (
      endpoint: '/api/tts/edge' | '/api/tts',
      clean: string,
      genId: number,
      signal: AbortSignal
    ): Promise<boolean> => {
      try {
        const targetUrl = `${env.apiBaseUrl}${endpoint}`;
        const payload = ttsService.buildSynthesizePayload(clean.slice(0, 1800));
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify(payload),
        });
        if (genId !== ttsGenerationRef.current || !res.ok) return false;
        const data = await res.json().catch(() => null);
        if (!data || genId !== ttsGenerationRef.current) return false;

        const pitchAppliedServerSide = Boolean(data.pitchAppliedServerSide);

        if (Array.isArray(data.chunks) && data.chunks.length > 0) {
          return await playEncodedTtsChunks(data.chunks, genId, pitchAppliedServerSide);
        }

        const base64Audio = typeof data.audioBase64 === 'string' ? data.audioBase64 : '';
        if (!base64Audio) return false;
        return await playEncodedTtsChunks(
          [
            {
              audioBase64: base64Audio,
              mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'audio/mpeg',
              lang: payload.locale as 'en-US' | 'bn-BD' | 'bn-IN',
            },
          ],
          genId,
          pitchAppliedServerSide
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        return false;
      }
    },
    [playEncodedTtsChunks]
  );

  // Automatic smart bilingual speech playback:
  // - Single unified voice per message (no mid-sentence male/female gender switching)
  // - Windows PC Chrome lacking local Bengali voice routes automatically via /api/tts/edge
  //   (Cloudflare Pages Edge Function / Express) -> /api/tts -> client audio fail-safe
  // - Android/macOS with native Bengali voice speaks instantaneously in one unified voice
  const speakFallbackText = useCallback(
    async (text: string) => {
      const clean = sanitizeSpeechText(text);
      if (!clean) return;

      stopAllPlayback();
      // Unlock AudioContext synchronously on user click BEFORE any await
      ensureUnlockedOutputContext();

      const genId = ttsGenerationRef.current;
      const controller = new AbortController();
      ttsAbortRef.current = controller;

      const playRemoteOrDirectFallback = async (): Promise<boolean> => {
        if (genId !== ttsGenerationRef.current) return false;
        const playedEdge = await fetchAndPlayTtsEndpoint(
          '/api/tts/edge',
          clean,
          genId,
          controller.signal
        );
        if (playedEdge || genId !== ttsGenerationRef.current) return true;

        const playedCloud = await fetchAndPlayTtsEndpoint(
          '/api/tts',
          clean,
          genId,
          controller.signal
        );
        if (playedCloud || genId !== ttsGenerationRef.current) return true;

        return await playDirectAudioTtsFallback(clean, genId);
      };

      try {
        const voices = await waitForBrowserVoices(320);
        if (genId !== ttsGenerationRef.current) return;

        const hasBengali = /[\u0980-\u09FF]/.test(clean) || detectBengaliOrBanglish(clean);
        const hasNativeBnVoice = Boolean(
          pickNativeSpeechVoice(voices, 'bn-BD', voiceRef.current, banglaAccentRef.current)
        );

        // On Windows PC Chrome without a native Bengali voice, synthesize via Edge/Cloud/Direct audio
        // so Bengali is never silently skipped.
        if (hasBengali && !hasNativeBnVoice) {
          const playedRemote = await playRemoteOrDirectFallback();
          if (playedRemote || genId !== ttsGenerationRef.current) return;
        }

        // বাংলা মন্তব্য: हिन्दी/Español/… — ব্রাউজারে সেই ভাষার নেটিভ ভয়েস না থাকলে আগে
        // Edge Neural (hi-IN-SwaraNeural ইত্যাদি); নইলে ইংরেজি ভয়েসে পড়ে ফেলত।
        const activeLanguage = ttsService.getConfig().language;
        if (!hasBengali && isIntlTtsLanguage(activeLanguage)) {
          const nativeIntl = resolveSpeechUtteranceTarget(
            clean,
            undefined,
            activeLanguage,
            voices,
            voiceRef.current
          );
          if (!nativeIntl.voice) {
            const playedRemote = await playRemoteOrDirectFallback();
            if (playedRemote || genId !== ttsGenerationRef.current) return;
          }
        }

        if (speakTier1Native(clean, genId, voices, () => void playRemoteOrDirectFallback())) {
          return;
        }

        await playRemoteOrDirectFallback();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const voices = window.speechSynthesis?.getVoices?.() || [];
        speakTier1Native(clean, genId, voices);
      }
    },
    [
      ensureUnlockedOutputContext,
      fetchAndPlayTtsEndpoint,
      playDirectAudioTtsFallback,
      speakTier1Native,
      stopAllPlayback,
    ]
  );

  const interruptPlayback = useCallback(() => {
    stopAllPlayback();
    flushPendingTurn();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setStatus(isMutedRef.current ? 'muted' : 'listening');
    }
  }, [flushPendingTurn, stopAllPlayback]);

  const clearTranscripts = useCallback(() => {
    pendingUserTextRef.current = '';
    pendingModelTextRef.current = '';
    setLiveUserText('');
    setLiveModelText('');
    setTranscripts([]);
  }, []);

  useEffect(() => {
    return () => {
      cleanupMediaAndSocket(false);
    };
  }, [cleanupMediaAndSocket]);

  return {
    status,
    error,
    micNotice,
    hasMicrophone,
    voiceName,
    setVoiceName,
    inputGain,
    setInputGain,
    voicePitch,
    setVoicePitch,
    banglaAccent,
    setBanglaAccent,
    isMuted,
    toggleMute,
    transcripts,
    liveUserText,
    liveModelText,
    levelsRef,
    connect,
    disconnect,
    sendTextPrompt,
    speakFallbackText,
    interruptPlayback,
    clearTranscripts,
  };
}
