import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Mail, Search, ShieldCheck, UserX, Users } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { SegmentedControl } from '../ui/SegmentedControl';
import { guardAdminAction } from '../../utils/adminGuard';
import { adminWriteErrorMessage } from '../../utils/adminWriteError';
import { toast } from '../../stores/useToastStore';
import {
  adminTeamService,
  type TeamMember,
  type TeamRole,
  type TeamSummary,
} from '../../services/adminTeamService';

/**
 * বাংলা মন্তব্য: Team & Access — আসল Supabase ইউজার, রোল আর সাসপেন্ড।
 * সব বদল সার্ভারে যাচাই হয় (নিজে/owner/শেষ অ্যাডমিন সুরক্ষা) এবং audit_logs-এ লেখা হয়।
 * কোনো ম্যানুয়াল রিফ্রেশ নেই — খুললেই লোড, প্রতিটি বদলের পর নিজে থেকেই আবার লোড।
 */

const STATUS_STYLE: Record<TeamMember['status'], string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  invited: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  suspended: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
};

function formatDate(value: string | null, never: string): string {
  if (!value) return never;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? never : date.toLocaleDateString();
}

export const AdminTeamAccessView: React.FC = () => {
  const { t } = useI18n();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('user');
  const [inviting, setInviting] = useState(false);

  const roleOptions = useMemo(
    () => [
      { value: 'user' as const, label: t.teamRoleUser },
      { value: 'admin' as const, label: t.teamRoleAdmin },
    ],
    [t]
  );

  const load = useCallback(async () => {
    try {
      const res = await adminTeamService.list();
      setMembers(res.members);
      setSummary(res.summary);
      setLoadError(null);
    } catch (err) {
      setLoadError(adminWriteErrorMessage(err, t.teamLoadError));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.email.includes(q) || m.name.toLowerCase().includes(q));
  }, [members, search]);

  const requestRoleChange = (member: TeamMember, role: TeamRole) => {
    if (role === member.role) return;
    guardAdminAction({
      title:
        role === 'admin'
          ? `${member.email} কে অ্যাডমিন বানাবেন`
          : `${member.email} এর অ্যাডমিন অ্যাক্সেস সরাবেন`,
      description:
        role === 'admin'
          ? 'পরের লগইন থেকে সে পুরো অ্যাডমিন প্যানেল ব্যবহার করতে পারবে।'
          : 'পরের লগইন থেকে সে আর অ্যাডমিন প্যানেলে ঢুকতে পারবে না।',
      impactSummary: `user=${member.email}\nrole: ${member.role} → ${role}`,
      riskLevel: role === 'admin' ? 'critical' : 'high',
      run: async () => {
        try {
          await adminTeamService.setRole(member.id, role);
          toast.success(
            t.teamTitle,
            `${member.email}: ${role === 'admin' ? t.teamRoleAdmin : t.teamRoleUser}`
          );
        } catch (err) {
          toast.error(t.teamTitle, adminWriteErrorMessage(err, 'Role change failed.'));
        }
        await load();
      },
    });
  };

  const requestSuspend = (member: TeamMember) => {
    const suspend = member.status !== 'suspended';
    guardAdminAction({
      title: suspend ? `${member.email} সাসপেন্ড করবেন` : `${member.email} আবার চালু করবেন`,
      description: suspend
        ? 'সে আর লগইন করতে পারবে না। পরে আবার চালু করা যাবে।'
        : 'সে আবার লগইন করতে পারবে।',
      impactSummary: `user=${member.email}\nsuspended=${suspend}`,
      riskLevel: suspend ? 'high' : 'medium',
      run: async () => {
        try {
          await adminTeamService.setSuspended(member.id, suspend);
          toast.info(
            t.teamTitle,
            `${member.email}: ${suspend ? t.teamStatusSuspended : t.teamStatusActive}`
          );
        } catch (err) {
          toast.error(t.teamTitle, adminWriteErrorMessage(err, 'Update failed.'));
        }
        await load();
      },
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    guardAdminAction({
      title: `${email} কে আমন্ত্রণ`,
      description:
        inviteRole === 'admin'
          ? 'ইমেইলে আমন্ত্রণ যাবে; যোগ দিলেই সে অ্যাডমিন হবে।'
          : 'ইমেইলে আমন্ত্রণ যাবে; সে সাধারণ সদস্য হিসেবে যোগ দেবে।',
      impactSummary: `email=${email}\nrole=${inviteRole}`,
      riskLevel: inviteRole === 'admin' ? 'critical' : 'medium',
      run: async () => {
        setInviting(true);
        try {
          await adminTeamService.invite(email, inviteRole);
          toast.success(t.teamInviteTitle, email);
          setInviteEmail('');
          setInviteRole('user');
        } catch (err) {
          toast.error(t.teamInviteTitle, adminWriteErrorMessage(err, 'Invite failed.'));
        } finally {
          setInviting(false);
        }
        await load();
      },
    });
  };

  const stats: Array<{ label: string; value: number; icon: React.ReactNode }> = [
    { label: t.teamStatTotal, value: summary?.total ?? 0, icon: <Users className="w-4 h-4" /> },
    {
      label: t.teamStatAdmins,
      value: summary?.admins ?? 0,
      icon: <ShieldCheck className="w-4 h-4" />,
    },
    { label: t.teamStatInvited, value: summary?.invited ?? 0, icon: <Mail className="w-4 h-4" /> },
    {
      label: t.teamStatSuspended,
      value: summary?.suspended ?? 0,
      icon: <UserX className="w-4 h-4" />,
    },
  ];

  return (
    <div
      className="flex-1 overflow-y-auto px-6 py-8 max-w-6xl mx-auto space-y-6 text-slate-800 dark:text-slate-200"
      data-testid="admin-team-access"
    >
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t.teamTitle}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.teamSubtitle}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {s.icon}
              <span>{s.label}</span>
            </div>
            <div className="text-2xl font-semibold mt-1 text-slate-900 dark:text-white">
              {loading ? '—' : s.value}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleInvite}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 flex flex-col md:flex-row md:items-end gap-3"
      >
        <label className="flex-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="block mb-1">{t.teamInviteTitle}</span>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            aria-label={t.teamInviteEmailLabel}
            placeholder="name@example.com"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
          />
        </label>
        <SegmentedControl
          label={t.teamRoleLabel}
          value={inviteRole}
          options={roleOptions}
          onChange={setInviteRole}
          size="sm"
          testId="team-invite-role"
        />
        <button
          type="submit"
          disabled={inviting || !inviteEmail.trim()}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
        >
          {t.teamInviteBtn}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.teamSearchPlaceholder}
            aria-label={t.teamSearchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        {loadError ? (
          <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">
            {loadError}
          </p>
        ) : !loading && filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">{t.teamEmpty}</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((m) => {
              const locked = m.isOwner || m.isSelf;
              return (
                <li
                  key={m.id}
                  className="p-4 flex flex-col md:flex-row md:items-center gap-3"
                  data-testid={`team-member-${m.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900 dark:text-white truncate">
                        {m.name}
                      </span>
                      {m.isOwner && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <Crown className="w-3 h-3" />
                          {t.teamOwnerBadge}
                        </span>
                      )}
                      {m.isSelf && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-500/20">
                          {t.teamYouBadge}
                        </span>
                      )}
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[m.status]}`}
                      >
                        {m.status === 'active'
                          ? t.teamStatusActive
                          : m.status === 'invited'
                            ? t.teamStatusInvited
                            : t.teamStatusSuspended}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {m.email} · {t.teamLastSeen}:{' '}
                      {formatDate(m.lastSignInAt, t.teamNeverSignedIn)}
                    </div>
                    {locked && (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {m.isOwner ? t.teamOwnerHint : t.teamSelfHint}
                      </div>
                    )}
                  </div>

                  {locked ? (
                    <span className="text-xs font-medium text-slate-500">
                      {m.role === 'admin' ? t.teamRoleAdmin : t.teamRoleUser}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <SegmentedControl
                        label={`${t.teamRoleLabel}: ${m.email}`}
                        hideLabel
                        value={m.role}
                        options={roleOptions}
                        onChange={(role) => requestRoleChange(m, role)}
                        size="sm"
                      />
                      <button
                        type="button"
                        onClick={() => requestSuspend(m)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border cursor-pointer ${
                          m.status === 'suspended'
                            ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                            : 'border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                        }`}
                      >
                        {m.status === 'suspended' ? t.teamReactivateBtn : t.teamSuspendBtn}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AdminTeamAccessView;
