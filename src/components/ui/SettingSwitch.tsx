import React, { useId } from 'react';

/** On/off setting row with an accessible switch. বাংলা: চালু/বন্ধ সেটিং — সঙ্গে সঙ্গে সেভ হয়। */
export interface SettingSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ReactNode;
  testId?: string;
  disabled?: boolean;
}

export const SettingSwitch: React.FC<SettingSwitchProps> = ({
  label,
  description,
  checked,
  onChange,
  icon,
  testId,
  disabled = false,
}) => {
  const labelId = useId();
  const descId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span
          id={labelId}
          className="text-xs font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5"
        >
          {icon}
          <span>{label}</span>
        </span>
        {description && (
          <span id={descId} className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-ring)] ${
          checked ? 'theme-btn-primary' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
};
