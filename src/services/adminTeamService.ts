import { apiClient } from './apiClient';

/** বাংলা মন্তব্য: Team & Access — edge `functions/_lib/adminTeam.ts`-এর সাথে একই আকার। */
export type TeamRole = 'admin' | 'user';
export type TeamStatus = 'active' | 'invited' | 'suspended';

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: TeamRole;
  status: TeamStatus;
  isOwner: boolean;
  isSelf: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  provider: string;
}

export interface TeamSummary {
  total: number;
  admins: number;
  users: number;
  invited: number;
  suspended: number;
}

export const adminTeamService = {
  async list(): Promise<{ members: TeamMember[]; summary: TeamSummary }> {
    const res = await apiClient.get<{ members?: TeamMember[]; summary?: TeamSummary }>(
      '/api/admin/team'
    );
    const members = Array.isArray(res.members) ? res.members : [];
    return {
      members,
      summary: res.summary ?? {
        total: members.length,
        admins: members.filter((m) => m.role === 'admin').length,
        users: members.filter((m) => m.role === 'user').length,
        invited: members.filter((m) => m.status === 'invited').length,
        suspended: members.filter((m) => m.status === 'suspended').length,
      },
    };
  },

  async setRole(id: string, role: TeamRole): Promise<TeamMember> {
    const res = await apiClient.patch<{ member: TeamMember }>(
      `/api/admin/team/${encodeURIComponent(id)}/role`,
      { role }
    );
    return res.member;
  },

  async setSuspended(id: string, suspended: boolean): Promise<TeamMember> {
    const res = await apiClient.post<{ member: TeamMember }>(
      `/api/admin/team/${encodeURIComponent(id)}/suspend`,
      { suspended }
    );
    return res.member;
  },

  async invite(email: string, role: TeamRole): Promise<void> {
    await apiClient.post('/api/admin/team/invite', { email, role });
  },
};
