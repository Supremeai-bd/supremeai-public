import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  ExternalLink,
  Lock,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { adminWriteErrorMessage } from '../../utils/adminWriteError';
import {
  adminBackupService,
  type BackupHealth,
  type BackupState,
} from '../../services/adminBackupService';

/**
 * বাংলা মন্তব্য: Admin → Deploy & CI → Backups।
 * আসল ব্যাকআপ: private রিপোর `db-backup.yml` প্রতিরাতে Supabase prod-এর pg_dump নেয়,
 * AES-256 এ এনক্রিপ্ট করে ৩০ দিন রাখে। এখানে শুধু অবস্থা দেখা — কোনো Run বাটন নেই
 * (সিস্টেম নিজেই চালায়), আর রিস্টোর ইচ্ছাকৃতভাবে runbook-ভিত্তিক (লাইভ ডেটা মুছে লেখে)।
 */

const REFRESH_MS = 5 * 60_000;

const HEALTH_STYLE: Record<BackupHealth, string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  stale: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  failing: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  never: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
  'not-deployed': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatDateTime(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export const AdminBackupsView: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<BackupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await adminBackupService.getState());
      setLoadError(null);
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, t.bkLoadError));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const healthLabel: Record<BackupHealth, string> = {
    ok: t.bkHealthOk,
    stale: t.bkHealthStale,
    failing: t.bkHealthFailing,
    never: t.bkHealthNever,
    'not-deployed': t.bkHealthNotDeployed,
  };
  const healthHint: Partial<Record<BackupHealth, string>> = {
    stale: t.bkHintStale,
    failing: t.bkHintFailing,
    'not-deployed': t.bkHintNotDeployed,
  };
  const health = state?.health;
  const HealthIcon =
    health === 'ok' ? CheckCircle2 : health === 'failing' ? ShieldAlert : AlertTriangle;

  const facts = state
    ? [
        {
          label: t.bkLastSuccess,
          value: formatDateTime(state.lastSuccessAt, t.bkNever),
          icon: <Clock className="w-4 h-4" />,
        },
        {
          label: t.bkSchedule,
          value: t.bkScheduleValue,
          icon: <CalendarClock className="w-4 h-4" />,
        },
        {
          label: t.bkRetention,
          value: `${state.retentionDays} ${t.bkDays}`,
          icon: <DatabaseBackup className="w-4 h-4" />,
        },
        { label: t.bkEncryption, value: state.encryption, icon: <Lock className="w-4 h-4" /> },
      ]
    : [];

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-6 text-slate-800 dark:text-slate-200"
      data-testid="admin-backups"
    >
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.bkTitle}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.bkSubtitle}</p>
        </div>
        {health && (
          <span
            data-testid="backup-health"
            data-health={health}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${HEALTH_STYLE[health]}`}
          >
            <HealthIcon className="w-3.5 h-3.5" />
            {healthLabel[health]}
          </span>
        )}
      </div>

      {loading && !state ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : loadError ? (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {loadError}
        </p>
      ) : state ? (
        <>
          {health && healthHint[health] && (
            <p
              data-testid="backup-hint"
              className={`rounded-lg border px-4 py-3 text-sm ${HEALTH_STYLE[health]}`}
            >
              {healthHint[health]}
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {facts.map((f) => (
              <div
                key={f.label}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4"
              >
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  {f.icon}
                  <span>{f.label}</span>
                </div>
                <div className="text-sm font-semibold mt-1.5 text-slate-900 dark:text-white">
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
              {t.bkListTitle}
            </div>
            {state.backups.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">{t.bkEmpty}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 dark:text-slate-400">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">{t.bkColCreated}</th>
                    <th className="px-4 py-2 font-medium">{t.bkColSize}</th>
                    <th className="px-4 py-2 font-medium hidden md:table-cell">{t.bkColExpires}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {state.backups.map((b) => (
                    <tr key={b.id} data-testid={`backup-row-${b.id}`}>
                      <td className="px-4 py-2.5">{formatDateTime(b.createdAt, '—')}</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatBytes(b.sizeBytes)}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-slate-500">
                        {formatDateTime(b.expiresAt, '—')}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {b.runId && state.workflowUrl && (
                          <a
                            href={state.workflowUrl.replace(
                              /\/workflows\/[^/]+$/,
                              `/runs/${b.runId}`
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {t.bkViewRun}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
              <ShieldAlert className="w-4 h-4" />
              {t.bkRestoreTitle}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5">{t.bkRestoreBody}</p>
          </div>
        </>
      ) : null}
    </div>
  );
};
