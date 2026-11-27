import React, { useEffect, useState } from 'react';
import { AudioLines, Globe, RotateCcw, Volume2 } from 'lucide-react';
import type { AppLanguage } from '../../../types';
import { useI18n } from '../../../utils/i18n';
import { useAppPreferencesStore } from '../../../stores/useAppPreferencesStore';
import { ttsService } from '../../../services/ttsService';
import { saveVoicePreference } from '../../../utils/hologramAvatar';
import {
  clampVoicePitch,
  DEFAULT_VOICE_PITCH,
  MAX_VOICE_PITCH,
  MIN_VOICE_PITCH,
} from '../../../utils/speechUtils';
import type { LiveVoiceName } from '../../../hooks/useLiveVoiceSession';
import {
  applyBanglaVariant,
  banglaVariantOf,
  banglaVariantOptions,
  isBanglaLanguage,
  primaryLanguageOf,
  primaryLanguageOptions,
  voiceOptions,
  type BanglaVariantId,
} from '../../../config/languageVoiceOptions';
import { OptionSelect } from '../../ui/OptionSelect';

interface LanguageVoicePanelProps {
  /** Speak a sample with the current language, dialect, voice and pitch. */
  onPreview?: () => void;
  /** Called whenever a choice changes (used to pulse the avatar preview). */
  onChanged?: () => void;
}

/**
 * Language & Voice in one place.
 * বাংলা: ভাষা → (বাংলা হলে) আঞ্চলিক ভাষা/উচ্চারণ → ভয়েস → পিচ → ▶ শুনে দেখুন।
 * সব বদল সঙ্গে সঙ্গে সেভ হয়; কোনো Save বাটন নেই।
 */
export const LanguageVoicePanel: React.FC<LanguageVoicePanelProps> = ({ onPreview, onChanged }) => {
  const { t } = useI18n();
  const language = useAppPreferencesStore((s) => s.language);
  const setLanguage = useAppPreferencesStore((s) => s.setLanguage);
  const [cfg, setCfg] = useState(() => ttsService.getConfig());

  useEffect(() => ttsService.subscribe(setCfg), []);

  const isBangla = isBanglaLanguage(language);
  const variant = banglaVariantOf(language, cfg.banglaAccent);

  const handleLanguage = (next: AppLanguage) => {
    if (next === 'bn') {
      // Switching into Bangla keeps the last accent (Dhaka/Kolkata) the user had.
      if (!isBanglaLanguage(language)) setLanguage('bn');
    } else {
      setLanguage(next);
    }
    onChanged?.();
  };

  const handleVariant = (id: BanglaVariantId) => {
    const next = applyBanglaVariant(id);
    if (next.accent !== cfg.banglaAccent) setCfg(ttsService.setBanglaAccent(next.accent));
    if (next.language !== language) setLanguage(next.language);
    onChanged?.();
  };

  const handleVoice = (voice: LiveVoiceName) => {
    saveVoicePreference(voice);
    setCfg(ttsService.setVoicePersona(voice));
    onChanged?.();
  };

  const handlePitch = (value: number) => {
    setCfg(ttsService.setPitch(clampVoicePitch(value)));
  };

  const pitchChanged = Math.abs(cfg.pitch - DEFAULT_VOICE_PITCH) > 0.01;

  return (
    <div
      data-testid="language-voice-panel"
      className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-5 shadow-xs"
    >
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Globe className="w-4 h-4 theme-accent-text" />
          <span>{t.languageVoiceTitle}</span>
        </h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          {t.languageVoiceSubtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <OptionSelect
          label={t.languageSelectLabel}
          value={primaryLanguageOf(language)}
          options={primaryLanguageOptions()}
          onChange={handleLanguage}
          testId="settings-language"
        />
        {isBangla && (
          <OptionSelect
            label={t.banglaVariantLabel}
            value={variant}
            options={banglaVariantOptions()}
            onChange={handleVariant}
            testId="settings-bangla-variant"
          />
        )}
      </div>

      <OptionSelect
        label={t.voiceSelectLabel}
        value={cfg.voicePersona}
        options={voiceOptions(t)}
        onChange={handleVoice}
        onPreview={
          onPreview
            ? (voice) => {
                if (voice !== cfg.voicePersona) handleVoice(voice);
                onPreview();
              }
            : undefined
        }
        previewLabel={t.voicePreviewBtn}
        testId="settings-voice"
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="settings-voice-pitch-slider"
            className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
          >
            <AudioLines className="w-3.5 h-3.5 theme-accent-text" />
            <span>{t.voicePitchLabel}</span>
          </label>
          {pitchChanged && (
            <button
              type="button"
              data-testid="settings-reset-pitch-btn"
              onClick={() => handlePitch(DEFAULT_VOICE_PITCH)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-[var(--theme-accent)] cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t.voicePitchNatural}</span>
            </button>
          )}
        </div>
        <input
          id="settings-voice-pitch-slider"
          data-testid="settings-voice-pitch-slider"
          type="range"
          min={MIN_VOICE_PITCH}
          max={MAX_VOICE_PITCH}
          step={0.05}
          value={cfg.pitch}
          onChange={(e) => handlePitch(Number.parseFloat(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-cyan-500"
        />
        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
          <span>{t.voicePitchLow}</span>
          <span>{t.voicePitchNatural}</span>
          <span>{t.voicePitchHigh}</span>
        </div>
      </div>

      {onPreview && (
        <button
          type="button"
          data-testid="settings-voice-preview-btn"
          onClick={onPreview}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer"
        >
          <Volume2 className="w-4 h-4" />
          <span>{t.voicePreviewBtn}</span>
        </button>
      )}
    </div>
  );
};
