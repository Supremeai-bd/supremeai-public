import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

type Cfg = { voicePersona: string; pitch: number; banglaAccent: 'bn-bd' | 'bn-in' };

const prefs = vi.hoisted(() => ({
  language: 'en' as string,
  setLanguage: vi.fn(),
}));
const tts = vi.hoisted(() => {
  const listeners = new Set<(c: Cfg) => void>();
  const state: { cfg: Cfg } = { cfg: { voicePersona: 'Zephyr', pitch: 1, banglaAccent: 'bn-bd' } };
  const update = (patch: Partial<Cfg>) => {
    state.cfg = { ...state.cfg, ...patch };
    listeners.forEach((l) => l(state.cfg));
    return state.cfg;
  };
  return {
    state,
    listeners,
    service: {
      getConfig: () => state.cfg,
      subscribe: (l: (c: Cfg) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      setBanglaAccent: vi.fn((banglaAccent: Cfg['banglaAccent']) => update({ banglaAccent })),
      setVoicePersona: vi.fn((voicePersona: string) => update({ voicePersona })),
      setPitch: vi.fn((pitch: number) => update({ pitch })),
    },
  };
});

vi.mock('../../../stores/useAppPreferencesStore', () => ({
  useAppPreferencesStore: (selector: (s: typeof prefs) => unknown) => selector(prefs),
}));
vi.mock('../../../services/ttsService', () => ({ ttsService: tts.service }));
vi.mock('../../../utils/hologramAvatar', () => ({ saveVoicePreference: vi.fn() }));

import { LanguageVoicePanel } from './LanguageVoicePanel';

function pick(testId: string, value: string) {
  fireEvent.click(screen.getByTestId(`${testId}-trigger`));
  fireEvent.click(screen.getByTestId(`${testId}-option-${value}`));
}

describe('LanguageVoicePanel', () => {
  beforeEach(() => {
    prefs.language = 'en';
    prefs.setLanguage.mockClear();
    tts.state.cfg = { voicePersona: 'Zephyr', pitch: 1, banglaAccent: 'bn-bd' };
    Object.values(tts.service).forEach((fn) => {
      if (typeof fn === 'function' && 'mockClear' in fn)
        (fn as { mockClear: () => void }).mockClear();
    });
  });
  afterEach(cleanup);

  it('hides the dialect dropdown for non-Bangla languages', () => {
    render(<LanguageVoicePanel />);
    expect(screen.getByTestId('settings-language-trigger')).toHaveTextContent('English');
    expect(screen.queryByTestId('settings-bangla-variant')).toBeNull();
  });

  it('lists Bangla once and switches the language from the dropdown', () => {
    render(<LanguageVoicePanel />);
    fireEvent.click(screen.getByTestId('settings-language-trigger'));
    expect(screen.queryByTestId('settings-language-option-bn-ctg')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-language-option-bn'));
    expect(prefs.setLanguage).toHaveBeenCalledWith('bn');
  });

  it('shows the dialect dropdown for Bangla and maps choices to language + accent', () => {
    prefs.language = 'bn';
    render(<LanguageVoicePanel />);
    expect(screen.getByTestId('settings-bangla-variant-trigger')).toHaveTextContent(
      'প্রমিত বাংলা (বাংলাদেশ)'
    );

    pick('settings-bangla-variant', 'bn-in');
    expect(tts.service.setBanglaAccent).toHaveBeenCalledWith('bn-in');
    expect(prefs.setLanguage).not.toHaveBeenCalled();

    pick('settings-bangla-variant', 'bn-ctg');
    expect(tts.service.setBanglaAccent).toHaveBeenLastCalledWith('bn-bd');
    expect(prefs.setLanguage).toHaveBeenCalledWith('bn-ctg');
  });

  it('keeps a regional dialect when re-selecting বাংলা in the main dropdown', () => {
    prefs.language = 'bn-syl';
    render(<LanguageVoicePanel />);
    expect(screen.getByTestId('settings-language-trigger')).toHaveTextContent('বাংলা');
    expect(screen.getByTestId('settings-bangla-variant-trigger')).toHaveTextContent('সিলেটি');
    pick('settings-language', 'bn');
    expect(prefs.setLanguage).not.toHaveBeenCalled();
  });

  it('names voices by tone, saves the choice instantly and previews', () => {
    const onPreview = vi.fn();
    render(<LanguageVoicePanel onPreview={onPreview} />);
    expect(screen.getByTestId('settings-voice-trigger')).toHaveTextContent('Bright & balanced');

    pick('settings-voice', 'Kore');
    expect(tts.service.setVoicePersona).toHaveBeenCalledWith('Kore');

    fireEvent.click(screen.getByTestId('settings-voice-trigger'));
    fireEvent.click(screen.getByTestId('settings-voice-preview-Charon'));
    expect(tts.service.setVoicePersona).toHaveBeenLastCalledWith('Charon');
    expect(onPreview).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('settings-voice-preview-btn'));
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it('updates pitch and offers a reset to natural', () => {
    render(<LanguageVoicePanel />);
    expect(screen.queryByTestId('settings-reset-pitch-btn')).toBeNull();
    fireEvent.change(screen.getByTestId('settings-voice-pitch-slider'), {
      target: { value: '1.3' },
    });
    expect(tts.service.setPitch).toHaveBeenCalledWith(1.3);
    fireEvent.click(screen.getByTestId('settings-reset-pitch-btn'));
    expect(tts.service.setPitch).toHaveBeenLastCalledWith(1);
  });

  it('follows TTS changes made elsewhere (e.g. the live voice panel)', () => {
    render(<LanguageVoicePanel />);
    act(() => {
      tts.service.setVoicePersona('Fenrir');
    });
    expect(screen.getByTestId('settings-voice-trigger')).toHaveTextContent('Crisp & direct');
  });
});
