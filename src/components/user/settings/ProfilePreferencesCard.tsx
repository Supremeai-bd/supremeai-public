import React, { useEffect, useRef, useState } from 'react';
import { Check, Lightbulb, MessageSquareCode, Sparkles } from 'lucide-react';
import type { UserAccountSettings } from '../../../types';
import { useI18n } from '../../../utils/i18n';
import { SettingSwitch } from '../../ui/SettingSwitch';

/**
 * Profile preferences with auto-save (no Save button).
 *
 * বাংলা: নাম ও উত্তরের ধরন লেখা থামালে ~০.৭ সেকেন্ড পর নিজে থেকেই সেভ হয়; টিপস সুইচ
 * সাথে সাথে সেভ হয়। খালি নাম কখনো সেভ হয় না।
 */
export const AUTO_SAVE_DELAY_MS = 700;

interface ProfilePreferencesCardProps {
  settings: Pick<UserAccountSettings, 'name' | 'customInstructions' | 'showWorkspaceTips'>;
  onUpdateSettings: (patch: Partial<UserAccountSettings>) => void;
  /** Applied on every keystroke so the chat uses the new instructions immediately. */
  onInstructionsLive?: (value: string) => void;
}

export const ProfilePreferencesCard: React.FC<ProfilePreferencesCardProps> = ({
  settings,
  onUpdateSettings,
  onInstructionsLive,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState(settings.name);
  const [instructions, setInstructions] = useState(settings.customInstructions || '');
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRef = useRef(onUpdateSettings);
  updateRef.current = onUpdateSettings;

  useEffect(() => setName(settings.name), [settings.name]);
  useEffect(
    () => setInstructions(settings.customInstructions || ''),
    [settings.customInstructions]
  );
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  const save = (patch: Partial<UserAccountSettings>) => {
    updateRef.current(patch);
    setSavedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
  };

  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === settings.name) return;
    const id = setTimeout(() => save({ name: trimmed }), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [name, settings.name]);

  useEffect(() => {
    if (instructions === (settings.customInstructions || '')) return;
    const id = setTimeout(() => save({ customInstructions: instructions }), AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [instructions, settings.customInstructions]);

  return (
    <div
      data-testid="profile-preferences"
      className="p-5 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 space-y-5 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-slate-500" />
          <span>{t.profilePreferencesTitle}</span>
        </h2>
        <span
          role="status"
          aria-live="polite"
          data-testid="profile-autosave-status"
          className="text-[11px] text-slate-400 flex items-center gap-1"
        >
          {savedFlash ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">{t.settingsAutoSaved}</span>
            </>
          ) : (
            t.settingsAutoSaveHint
          )}
        </span>
      </div>

      <div>
        <label
          htmlFor="profile-display-name"
          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
        >
          {t.authFullNameLabel}
        </label>
        <input
          id="profile-display-name"
          type="text"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="w-full sm:max-w-sm px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="profile-custom-instructions"
          className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
        >
          <MessageSquareCode className="w-3.5 h-3.5 theme-accent-text" />
          <span>{t.customInstructionsLabel}</span>
        </label>
        <textarea
          id="profile-custom-instructions"
          rows={3}
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value);
            onInstructionsLive?.(e.target.value);
          }}
          placeholder={t.customInstructionsPlaceholder}
          className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[var(--theme-accent)]"
        />
      </div>

      <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
        <SettingSwitch
          label={t.workspaceTipsSettingLabel}
          description={t.workspaceTipsSettingDesc}
          icon={<Lightbulb className="w-3.5 h-3.5 text-amber-500" />}
          checked={settings.showWorkspaceTips !== false}
          onChange={(next) => save({ showWorkspaceTips: next })}
          testId="profile-workspace-tips"
        />
      </div>
    </div>
  );
};
