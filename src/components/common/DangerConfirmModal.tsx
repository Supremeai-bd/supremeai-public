import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface DangerConfirmState {
  action: string;
  title: string;
  description: string;
}

interface DangerConfirmModalProps {
  dangerConfirm: DangerConfirmState | null;
  isRunning: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DangerConfirmModal: React.FC<DangerConfirmModalProps> = ({
  dangerConfirm,
  isRunning,
  onCancel,
  onConfirm,
}) => {
  if (!dangerConfirm) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-rose-200 dark:border-rose-900/60 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {dangerConfirm.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {dangerConfirm.description}
        </p>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isRunning}
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isRunning ? 'Executing...' : 'Confirm Action'}
          </button>
        </div>
      </div>
    </div>
  );
};
