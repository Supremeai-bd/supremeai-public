import React, { useState, useEffect } from 'react';
import { Users, UserPlus, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { PlanTier, TeamMember } from '../../types';
import { getPlanSpec } from '../../config/plans';
import { useI18n } from '../../utils/i18n';
import { TeamChatPanel } from './TeamChatPanel';

interface UserTeamViewProps {
  members: TeamMember[];
  onInviteMember: (member: Omit<TeamMember, 'id' | 'joinedDate' | 'avatar'>) => void;
  onUpdateRole: (id: string, newRole: TeamMember['role']) => void;
  onRemoveMember: (id: string) => void;
  maxSeats?: number;
  planTier?: PlanTier;
  onRefreshTeam?: () => void;
}

export const UserTeamView: React.FC<UserTeamViewProps> = ({
  members,
  onInviteMember,
  onUpdateRole,
  onRemoveMember,
  maxSeats,
  planTier = 'Free',
  onRefreshTeam,
}) => {
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamMember['role']>('Reviewer');
  const { t } = useI18n();

  useEffect(() => {
    onRefreshTeam?.();
  }, [onRefreshTeam]);

  const resolvedMaxSeats = Math.max(1, maxSeats ?? getPlanSpec(planTier).maxSeats);
  const seatsUsed = members.length;
  const seatPercentage = Math.min(100, Math.round((seatsUsed / resolvedMaxSeats) * 100));
  const isAtSeatLimit = seatsUsed >= resolvedMaxSeats;

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim() || isAtSeatLimit) return;

    onInviteMember({
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      role: inviteRole,
      twoFactorEnabled: false,
      status: 'invited',
    });

    setIsInviteModalOpen(false);
    setInviteEmail('');
    setInviteName('');
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 workspace-container space-y-8 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.teamStdTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.teamStdDesc}</p>
        </div>

        <button
          type="button"
          disabled={isAtSeatLimit}
          title={isAtSeatLimit ? t.seatLimitReachedMsg : undefined}
          onClick={() => {
            setInviteRole('Reviewer');
            setIsInviteModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-xs transition-colors cursor-pointer shrink-0 whitespace-nowrap"
        >
          <UserPlus className="w-4 h-4" />
          <span>{t.inviteMemberBtn}</span>
        </button>
      </div>

      {/* Seat Quota & Security Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {t.workspaceSeatUsage}
            </span>
            <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400 font-bold">
              {seatsUsed} / {resolvedMaxSeats} {t.seatsWord}
            </span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all"
              style={{ width: `${seatPercentage}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400">
            {`${t.seatQuotaIncludesPrefix} ${resolvedMaxSeats} ${t.seatQuotaIncludesSuffix}`}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.accountProtectionLabel}
            </div>
            <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
              {members.filter((m) => m.twoFactorEnabled).length} / {members.length} {t.verifiedWord}
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-slate-800 text-purple-600 dark:text-purple-400 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.activeRolesLabel}
            </div>
            <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
              {`${t.roleOwner}, ${t.roleEditor}, ${t.roleReviewer}, ${t.roleViewer}`}
            </div>
          </div>
        </div>
      </div>

      {/* Members Table */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                <th className="px-4 py-3">{t.colTeamMember}</th>
                <th className="px-4 py-3">{t.colAssignedRole}</th>
                <th className="px-4 py-3">{t.col2faSecurity}</th>
                <th className="px-4 py-3">{t.colJoinedDate}</th>
                <th className="px-4 py-3">{t.colStatus}</th>
                <th className="px-4 py-3 text-right">{t.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {members.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-xs">
                    {t.noTeamMembersYet}
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 flex items-center justify-center font-bold text-xs shrink-0">
                          {member.avatar}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {member.name}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <select
                        value={member.role}
                        onChange={(e) =>
                          onUpdateRole(member.id, e.target.value as TeamMember['role'])
                        }
                        disabled={member.role === 'Owner'}
                        className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white disabled:opacity-60 cursor-pointer"
                      >
                        {member.role === 'Owner' && <option value="Owner">{t.roleOwner}</option>}
                        <option value="Developer">{t.roleEditor}</option>
                        <option value="Reviewer">{t.roleReviewer}</option>
                        <option value="Viewer">{t.roleViewer}</option>
                      </select>
                    </td>
                    <td className="px-4 py-3.5">
                      {member.twoFactorEnabled ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {t.statusEnabled}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          {t.statusPending}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">
                      {member.joinedDate}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          member.status === 'active'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {member.status === 'active' ? t.statusActive : t.statusInvited}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {member.role !== 'Owner' && (
                        <button
                          type="button"
                          onClick={() => onRemoveMember(member.id)}
                          title={t.removeMemberTooltip}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team chat (roadmap 4.4) */}
      <TeamChatPanel rosterVersion={members.length} />

      {/* --- INVITE MODAL --- */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600" />
                {t.inviteModalTitle}
              </h3>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.authFullNameLabel}
                </label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder={t.teamMemberNamePlaceholder}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.authWorkEmailLabel}
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t.teamMemberEmailPlaceholder}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.inviteRoleLabel}
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as TeamMember['role'])}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="Developer">{t.roleEditorDesc}</option>
                  <option value="Reviewer">{t.roleReviewerStdDesc}</option>
                  <option value="Viewer">{t.roleViewerDesc}</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t.cancelBtn}
                </button>
                <button
                  type="submit"
                  disabled={isAtSeatLimit}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-xs cursor-pointer"
                >
                  {t.sendInvitationBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
