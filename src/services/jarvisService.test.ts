import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JARVIS_ANNOUNCE_EVENT,
  JARVIS_MODE_EVENT,
  JARVIS_MODE_STORAGE_KEY,
  announce,
  getAnnouncementLog,
  isJarvisModeEnabled,
  narrationForEvent,
  notifyTaskStep,
  resetNarrationDedup,
  setJarvisModeEnabled,
} from './jarvisService';

/** বাংলা মন্তব্য: jsdom-এ SpeechSynthesisUtterance থাকে না — সিনথেসিস স্টাব দরকার। */
class UtteranceStub {
  text: string;
  lang = 'en-US';
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installSpeechStubs() {
  const speakSpy = vi.fn();
  const cancelSpy = vi.fn();
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak: speakSpy, cancel: cancelSpy, getVoices: () => [] },
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: UtteranceStub,
  });
  return { speakSpy, cancelSpy };
}

function uninstallSpeechStubs() {
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: undefined,
  });
}

describe('jarvisService — narration text (pure)', () => {
  it('announces task acceptance in both languages', () => {
    expect(narrationForEvent('task_accepted', { language: 'en' })).toMatch(/task accepted/i);
    expect(narrationForEvent('task_accepted', { language: 'bn' })).toMatch(/টাস্ক গ্রহণ/);
  });

  it('builds step narration with position in both languages', () => {
    const en = narrationForEvent('task_step', {
      language: 'en',
      stepLabel: 'Scanning workspace files',
      stepIndex: 2,
      stepTotal: 4,
    });
    expect(en).toBe('Executing (step 2 of 4): Scanning workspace files');

    const bn = narrationForEvent('task_step', {
      language: 'bn',
      stepLabel: 'ওয়ার্কস্পেস ফাইল স্ক্যান হচ্ছে',
      stepIndex: 2,
      stepTotal: 4,
    });
    expect(bn).toContain('ধাপ 2/4'); // positional info present
    expect(bn).toContain('ওয়ার্কস্পেস ফাইল স্ক্যান হচ্ছে');
  });

  it('returns empty text for step narration without a label', () => {
    expect(narrationForEvent('task_step', { language: 'en' })).toBe('');
  });

  it('mentions the pending action count for approval requests', () => {
    const en = narrationForEvent('needs_approval', { language: 'en', actionCount: 3 });
    expect(en).toContain('3 pending actions');
    expect(en).toMatch(/approval required/i);

    const bn = narrationForEvent('needs_approval', { language: 'bn', actionCount: 1 });
    expect(bn).toContain('অনুমোদন প্রয়োজন');
  });

  it('truncates very long step labels for speech', () => {
    const longLabel = 'x'.repeat(500);
    const text = narrationForEvent('task_step', { language: 'en', stepLabel: longLabel });
    expect(text.length).toBeLessThan(260);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('jarvisService — mode persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(JARVIS_MODE_STORAGE_KEY);
    setJarvisModeEnabled(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(JARVIS_MODE_STORAGE_KEY);
  });

  it('starts disabled by default', () => {
    expect(isJarvisModeEnabled()).toBe(false);
  });

  it('persists the enabled flag and emits a mode-change event', () => {
    const onMode = vi.fn();
    window.addEventListener(JARVIS_MODE_EVENT, onMode);
    setJarvisModeEnabled(true);
    window.removeEventListener(JARVIS_MODE_EVENT, onMode);

    expect(isJarvisModeEnabled()).toBe(true);
    expect(window.localStorage.getItem(JARVIS_MODE_STORAGE_KEY)).toBe('true');
    expect(onMode).toHaveBeenCalledTimes(1);
    const detail = (onMode.mock.calls[0][0] as CustomEvent<{ enabled: boolean }>).detail;
    expect(detail.enabled).toBe(true);
  });
});

describe('jarvisService — announce event bus', () => {
  beforeEach(() => {
    setJarvisModeEnabled(false);
  });

  afterEach(() => {
    setJarvisModeEnabled(false);
    vi.restoreAllMocks();
  });

  it('dispatches announcement events even when speech is disabled (overlay still updates)', () => {
    const onAnnounce = vi.fn();
    window.addEventListener(JARVIS_ANNOUNCE_EVENT, onAnnounce);
    const result = announce('task_completed', { language: 'en' });
    window.removeEventListener(JARVIS_ANNOUNCE_EVENT, onAnnounce);

    expect(result).not.toBeNull();
    expect(result?.text).toMatch(/task completed/i);
    expect(onAnnounce).toHaveBeenCalledTimes(1);
    expect(getAnnouncementLog().length).toBeGreaterThan(0);
  });

  it('skips speaking when the mode is off (speechSynthesis untouched)', () => {
    const speakSpy = vi.fn();
    const cancelSpy = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: speakSpy, cancel: cancelSpy, getVoices: () => [] },
    });

    announce('task_accepted', { language: 'en' });
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('speaks narration when the mode is enabled', () => {
    const { speakSpy } = installSpeechStubs();

    setJarvisModeEnabled(true);
    announce('task_accepted', { language: 'en' });

    expect(speakSpy).toHaveBeenCalledTimes(1);
    const utterance = speakSpy.mock.calls[0][0] as unknown as UtteranceStub;
    expect(utterance.text).toMatch(/task accepted/i);

    uninstallSpeechStubs();
    setJarvisModeEnabled(false);
  });
});

describe('jarvisService — step dedup', () => {
  beforeEach(() => {
    setJarvisModeEnabled(false);
  });

  afterEach(() => {
    resetNarrationDedup();
    setJarvisModeEnabled(false);
  });

  it('narrates a running step only once per id', () => {
    const { speakSpy } = installSpeechStubs();

    setJarvisModeEnabled(true);
    notifyTaskStep({ id: 'step_a', label: 'Deploying service', status: 'running' });
    notifyTaskStep({ id: 'step_a', label: 'Deploying service', status: 'running' });
    notifyTaskStep({ id: 'step_a', label: 'Deploying service', status: 'done' });

    expect(speakSpy).toHaveBeenCalledTimes(1);

    uninstallSpeechStubs();
  });

  it('ignores steps entirely while the mode is off', () => {
    const onAnnounce = vi.fn();
    window.addEventListener(JARVIS_ANNOUNCE_EVENT, onAnnounce);
    notifyTaskStep({ id: 'step_b', label: 'Silent step', status: 'running' });
    window.removeEventListener(JARVIS_ANNOUNCE_EVENT, onAnnounce);
    expect(onAnnounce).not.toHaveBeenCalled();
  });
});
