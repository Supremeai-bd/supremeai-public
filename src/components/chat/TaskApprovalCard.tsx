import React from 'react';
import { Check, Clock, ShieldAlert, X } from 'lucide-react';
import type { PendingTaskApproval } from '../../shared/agentTypes';
import { useI18n } from '../../utils/i18n';

interface TaskApprovalCardProps {
  approval: PendingTaskApproval;
  onApprove: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

export const TaskApprovalCard: React.FC<TaskApprovalCardProps> = ({
  approval,
  onApprove,
  onSkip,
  onCancel,
}) => {
  const { t } = useI18n();
  const isBn = approval.language === 'bn';
  const pendingActions = approval.actions.filter((a) => a.requiresApproval);

  const kickerLabel =
    t.taskApprovalKicker ||
    (isBn ? 'কাজ চালানোর আগে নিশ্চিতকরণ প্রয়োজন' : 'Action confirmation required');
  const approveLabel =
    t.taskApprovalApproveBtn || (isBn ? 'অনুমোদন ও চালু করুন' : 'Approve & Execute');
  const skipLabel = t.taskApprovalSkipBtn || (isBn ? 'বাতিল করুন' : 'Skip Actions');
  const stepsHeader =
    t.taskApprovalStepsLabel || (isBn ? 'সম্পন্ন ধাপসমূহ' : 'Executed steps');

  return (
    <div
      data-testid="task-approval-card"
      className="w-full max-w-2xl mx-auto rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 sm:p-5 space-y-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>{kickerLabel}</span>
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            {approval.summary}
          </h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Dismiss task approval"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {approval.steps.length > 0 && (
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3 space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {stepsHeader}
          </div>
          <ul className="space-y-1">
            {approval.steps.map((step) => (
              <li
                key={step.id}
                className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300"
              >
                <span className="truncate">{step.label}</span>
                {step.detail && (
                  <span className="font-mono text-[10px] text-slate-400 truncate max-w-[45%]">
                    {step.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingActions.length > 0 && (
        <div className="space-y-2">
          {pendingActions.map((action) => (
            <div
              key={action.id}
              data-testid="pending-approval-action"
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-1"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>{action.label}</span>
              </div>
              {action.type === 'create_schedule' && (
                <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 pl-5">
                  <div className="font-mono text-[10px] text-cyan-600 dark:text-cyan-400 truncate">
                    {action.payload.targetUrl} · {action.payload.cronExpression}
                  </div>
                  <p className="line-clamp-2">{action.payload.instruction}</p>
                </div>
              )}
              {action.type === 'run_terminal' && (
                <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 pl-5 truncate">
                  {action.payload.command}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          data-testid="task-approval-skip-btn"
          onClick={onSkip}
          className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
        >
          {skipLabel}
        </button>
        <button
          type="button"
          data-testid="task-approval-approve-btn"
          onClick={onApprove}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>{approveLabel}</span>
        </button>
      </div>
    </div>
  );
};
