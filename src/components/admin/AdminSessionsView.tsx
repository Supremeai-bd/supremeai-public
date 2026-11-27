import React, { useCallback, useEffect, useState } from 'react';
import {
  Laptop,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { adminWriteErrorMessage, guardAdminAction } from '../../utils/adminGuard';
import { toast } from '../../stores/useToastStore';
import {
  adminSessionService,
  type AdminSession,
  type AdminSessionUser,
  type AdminSessionsState,
} from '../../services/adminSessionService';

/**
 * বাংলা মন্তব্য: Admin → Users → Sessions।
 * কে কোথায় সাইন-ইন আছে (Supabase auth.sessions — শুধু জীবিত সেশন)। মরা সেশন প্রতিরাতে
 * নিজেই মুছে যায় (pg_cron) — কোনো "Clean up" বাটন নেই। সাইন-আউট সেফটি-গেট দিয়ে।
 */

const REFRESH_MS = 60_000;

export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

export const AdminSessionsView: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<AdminSessionsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await adminSessionService.getState());
      setLoadError(null);
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, t.ssLoadError));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const clientLabel = (s: AdminSession) =>
    s.client === 'browser'
      ? s.device || t.ssClientBrowser
      : s.client === 'studio-server'
        ? t.ssClientServer
        : s.client === 'cli'
          ? t.ssClientCli
          : t.ssClientUnknown;

  const ClientIcon = ({ s }: { s: AdminSession }) =>
    s.client === 'browser' ? (
      <MonitorSmartphone className="w-4 h-4" />
    ) : s.client === 'studio-server' ? (
      <Server className="w-4 h-4" />
    ) : s.client === 'cli' ? (
      <Terminal className="w-4 h-4" />
    ) : (
      <Laptop className="w-4 h-4" />
    );

  const revoke = (user: AdminSessionUser, session?: AdminSession) => {
    const who = user.email || user.userId;
    guardAdminAction({
      title: session ? t.ssConfirmOneTitle : t.ssConfirmAllTitle,
      description: `${who} — ${t.ssConfirmBody}`,
      impactSummary: session
        ? `user=${who}\nsession=${session.id.slice(0, 8)}`
        : `user=${who}\nsessions=${user.sessions.length}`,
      riskLevel: 'high',
      run: async () => {
        try {
          await adminSessionService.revoke(user.userId, session?.id);
          toast.success(t.ssSignedOut, who);
        } catch (err) {
          toast.error(t.ssTitle, adminWriteErrorMessage(err, t.ssRevokeError));
        }
        await load();
      },
    });
  };

  const summary = state?.summary;

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-6 text-slate-800 dark:text-slate-200"
      data-testid="admin-sessions"
    >
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t.ssTitle}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.ssSubtitle}</p>
      </div>

      {!state && !loadError ? (
        <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
      ) : loadError && !state ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
        >
          {loadError}
        </div>
      ) : state && summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="sessions-summary">
            {[
              { label: t.ssLive, value: summary.liveSessions },
              { label: t.ssUsersOnline, value: summary.usersOnline },
              { label: t.ssPendingCleanup, value: summary.pendingCleanup, hint: t.ssCleanupHint },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 p-4"
              >
                <div className="text-xs text-slate-500">{card.label}</div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                  {card.value}
                </div>
                {card.hint && <div className="text-[11px] text-slate-500 mt-1">{card.hint}</div>}
              </div>
            ))}
          </div>

          {state.users.length === 0 ? (
            <p className="text-sm text-slate-500">{t.ssEmpty}</p>
          ) : (
            <div className="space-y-4">
              {state.users.map((user) => {
                const canSignOutAll = !user.sessions.some((s) => s.current);
                return (
                  <section
                    key={user.userId}
                    data-testid={`session-user-${user.userId}`}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        {user.email || user.userId}
                        {user.isSelf && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600">
                            {t.ssYou}
                          </span>
                        )}
                        {user.isOwner && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                            {t.ssOwner}
                          </span>
                        )}
                      </div>
                      {canSignOutAll && user.sessions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => revoke(user)}
                          className="text-xs inline-flex items-center gap-1 text-rose-600 hover:underline"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          {t.ssSignOutAll}
                        </button>
                      )}
                    </header>
                    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                      {user.sessions.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ClientIcon s={s} />
                            <span className="truncate">{clientLabel(s)}</span>
                            {s.ip && (
                              <span className="font-mono text-xs text-slate-500">{s.ip}</span>
                            )}
                            {s.mfa && (
                              <ShieldCheck
                                className="w-3.5 h-3.5 text-emerald-500"
                                aria-label="MFA"
                              />
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span title={new Date(s.lastActiveAt).toLocaleString()}>
                              {t.ssActive} {timeAgo(s.lastActiveAt)}
                            </span>
                            {s.current ? (
                              <span className="text-sky-600 font-medium">{t.ssThisDevice}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => revoke(user, s)}
                                className="text-rose-600 hover:underline"
                                data-testid={`revoke-${s.id}`}
                              >
                                {t.ssSignOut}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-slate-500">{t.ssFootnote}</p>
        </>
      ) : null}
    </div>
  );
};

export default AdminSessionsView;
