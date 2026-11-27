import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { adminWriteErrorMessage, guardAdminAction } from '../../utils/adminGuard';
import { toast } from '../../stores/useToastStore';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SettingSwitch } from '../ui/SettingSwitch';
import {
  adminAlertService,
  type AlertChannel,
  type AlertChannelKind,
  type AlertSeverity,
  type AlertsState,
  type ChannelSaveResult,
} from '../../services/adminAlertService';
import { timeAgo } from './AdminSessionsView';

/**
 * বাংলা মন্তব্য: Admin → System → Alerts।
 * কোথায় অ্যালার্ট যাবে (Telegram / Discord / Slack / webhook) আর কোন মাত্রা থেকে। সংযোগ দিলেই
 * নিজে থেকে একটা যাচাই-বার্তা যায় — আলাদা "Test" বাটন নেই; মাত্রা/চালু-বন্ধ বদলালে অটো-সেভ।
 */

const REFRESH_MS = 60_000;
const KINDS: AlertChannelKind[] = ['telegram', 'discord', 'slack', 'webhook'];

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  critical: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const inputClass =
  'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm';

export const AdminAlertsView: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<AlertsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<AlertChannelKind>('telegram');
  const [label, setLabel] = useState('');
  const [minSeverity, setMinSeverity] = useState<AlertSeverity>('warning');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await adminAlertService.getState());
      setLoadError(null);
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, t.alLoadError));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const kindLabel: Record<AlertChannelKind, string> = {
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    webhook: t.alKindWebhook,
  };
  const severityOptions = [
    { value: 'info' as const, label: t.alSevInfo },
    { value: 'warning' as const, label: t.alSevWarning },
    { value: 'critical' as const, label: t.alSevCritical },
  ];
  const severityLabel = (s: AlertSeverity) =>
    severityOptions.find((o) => o.value === s)?.label ?? s;

  const reportVerification = (name: string, result: ChannelSaveResult) => {
    if (!result.verification) return;
    if (result.verification.ok) toast.success(t.alVerifiedTitle, `${name} — ${t.alVerifiedBody}`);
    else toast.error(t.alVerifyFailedTitle, result.verification.error || name);
  };

  const resetForm = () => {
    setAdding(false);
    setLabel('');
    setBotToken('');
    setChatId('');
    setUrl('');
    setMinSeverity('warning');
  };

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = label.trim() || kindLabel[kind];
    setBusy(true);
    try {
      const secret =
        kind === 'telegram'
          ? { botToken: botToken.trim(), chatId: chatId.trim() }
          : { url: url.trim() };
      const result = await adminAlertService.create({ kind, label: name, minSeverity, ...secret });
      reportVerification(name, result);
      resetForm();
      await load();
    } catch (err) {
      toast.error(t.alTitle, adminWriteErrorMessage(err, t.alSaveError));
    } finally {
      setBusy(false);
    }
  };

  const patchChannel = async (
    channel: AlertChannel,
    patch: Partial<Pick<AlertChannel, 'minSeverity' | 'enabled'>>
  ) => {
    // বাংলা মন্তব্য: অপটিমিস্টিক — সাথে সাথে UI বদলায়, ব্যর্থ হলে রিলোডে আগের অবস্থা ফেরে।
    setState((prev) =>
      prev
        ? {
            ...prev,
            channels: prev.channels.map((c) => (c.id === channel.id ? { ...c, ...patch } : c)),
          }
        : prev
    );
    try {
      await adminAlertService.update(channel.id, patch);
    } catch (err) {
      toast.error(t.alTitle, adminWriteErrorMessage(err, t.alSaveError));
      await load();
    }
  };

  const removeChannel = (channel: AlertChannel) => {
    guardAdminAction({
      title: t.alRemoveTitle,
      description: `${channel.label} — ${t.alRemoveBody}`,
      impactSummary: `channel=${kindLabel[channel.kind]} "${channel.label}"`,
      riskLevel: 'medium',
      run: async () => {
        try {
          await adminAlertService.remove(channel.id);
          toast.success(t.alRemoved, channel.label);
        } catch (err) {
          toast.error(t.alTitle, adminWriteErrorMessage(err, t.alSaveError));
        }
        await load();
      },
    });
  };

  const acknowledge = async (id: string) => {
    try {
      await adminAlertService.acknowledge(id);
    } catch (err) {
      toast.error(t.alTitle, adminWriteErrorMessage(err, t.alSaveError));
    }
    await load();
  };

  const openCount = state?.events.filter((e) => !e.acknowledgedAt).length ?? 0;

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto space-y-6 text-slate-800 dark:text-slate-200"
      data-testid="admin-alerts"
    >
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t.alTitle}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.alSubtitle}</p>
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
      ) : state ? (
        <>
          <section className="space-y-3" data-testid="alert-channels">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t.alChannels}
              </h2>
              {!adding && (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="text-xs inline-flex items-center gap-1 text-sky-600 hover:underline"
                  data-testid="alert-add"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.alAddChannel}
                </button>
              )}
            </div>

            {state.channels.length === 0 && !adding && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
                {t.alNoChannels}
              </div>
            )}

            {state.channels.map((channel) => (
              <div
                key={channel.id}
                data-testid={`alert-channel-${channel.id}`}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <BellRing className="w-4 h-4 text-slate-500" />
                      {channel.label}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                        {kindLabel[channel.kind]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      {channel.lastStatus === 'ok' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      ) : channel.lastStatus === 'failed' ? (
                        <XCircle className="w-3.5 h-3.5 text-rose-500" />
                      ) : null}
                      <span>
                        {channel.lastStatus === 'ok'
                          ? t.alStatusOk
                          : channel.lastStatus === 'failed'
                            ? `${t.alStatusFailed}: ${channel.lastError || ''}`
                            : t.alStatusUntested}
                      </span>
                      {channel.targetHint && (
                        <span className="font-mono text-slate-400">· {channel.targetHint}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeChannel(channel)}
                    className="text-xs inline-flex items-center gap-1 text-rose-600 hover:underline"
                    data-testid={`alert-remove-${channel.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t.alRemove}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 items-center">
                  <SegmentedControl
                    label={t.alMinSeverity}
                    value={channel.minSeverity}
                    options={severityOptions}
                    onChange={(value) => void patchChannel(channel, { minSeverity: value })}
                    size="sm"
                    testId={`alert-severity-${channel.id}`}
                  />
                  <SettingSwitch
                    label={t.alEnabled}
                    checked={channel.enabled}
                    onChange={(checked) => void patchChannel(channel, { enabled: checked })}
                    testId={`alert-enabled-${channel.id}`}
                  />
                </div>
              </div>
            ))}

            {adding && (
              <form
                onSubmit={connect}
                data-testid="alert-add-form"
                className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-3"
              >
                <SegmentedControl
                  label={t.alKind}
                  value={kind}
                  options={KINDS.map((k) => ({ value: k, label: kindLabel[k] }))}
                  onChange={setKind}
                  size="sm"
                  testId="alert-kind"
                />
                <input
                  className={inputClass}
                  placeholder={t.alNamePlaceholder}
                  value={label}
                  maxLength={60}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label={t.alName}
                />
                {kind === 'telegram' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      className={inputClass}
                      placeholder="123456789:AA…"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      aria-label={t.alBotToken}
                      autoComplete="off"
                      type="password"
                      required
                    />
                    <input
                      className={inputClass}
                      placeholder="-1001234567890"
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                      aria-label={t.alChatId}
                      required
                    />
                  </div>
                ) : (
                  <input
                    className={inputClass}
                    placeholder={
                      kind === 'discord'
                        ? 'https://discord.com/api/webhooks/…'
                        : kind === 'slack'
                          ? 'https://hooks.slack.com/services/…'
                          : 'https://…'
                    }
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-label={t.alWebhookUrl}
                    autoComplete="off"
                    type="password"
                    required
                  />
                )}
                <p className="text-[11px] text-slate-500">
                  {kind === 'telegram' ? t.alTelegramHelp : t.alWebhookHelp}
                </p>
                <SegmentedControl
                  label={t.alMinSeverity}
                  value={minSeverity}
                  options={severityOptions}
                  onChange={setMinSeverity}
                  size="sm"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {busy ? t.alConnecting : t.alConnect}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-sm text-slate-500 hover:underline"
                  >
                    {t.alCancel}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="space-y-3" data-testid="alert-events">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t.alRecent}
              {openCount > 0 && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600">
                  {openCount} {t.alOpen}
                </span>
              )}
            </h2>
            {state.events.length === 0 ? (
              <p className="text-sm text-slate-500">{t.alNoEvents}</p>
            ) : (
              <ul className="rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 bg-white/60 dark:bg-slate-900/40">
                {state.events.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SEVERITY_STYLE[ev.severity]}`}
                        >
                          {severityLabel(ev.severity)}
                        </span>
                        <span className={ev.acknowledgedAt ? 'text-slate-500' : 'font-medium'}>
                          {ev.title}
                        </span>
                      </div>
                      {ev.body && <div className="text-xs text-slate-500 truncate">{ev.body}</div>}
                      <div className="text-[11px] text-slate-400">
                        {ev.source} · {t.alSentTo.replace('{n}', String(ev.delivered))}
                        {ev.failed > 0 && ` · ${t.alFailedTo.replace('{n}', String(ev.failed))}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span title={new Date(ev.createdAt).toLocaleString()}>
                        {timeAgo(ev.createdAt)}
                      </span>
                      {ev.acknowledgedAt ? (
                        <span>{t.alAcknowledged}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void acknowledge(ev.id)}
                          className="text-sky-600 hover:underline"
                          data-testid={`alert-ack-${ev.id}`}
                        >
                          {t.alAcknowledge}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};

export default AdminAlertsView;
