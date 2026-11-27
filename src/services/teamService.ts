import { apiClient } from './apiClient';
import { env } from '../config/env';
import { TeamMember } from '../types';
import { INITIAL_TEAM_MEMBERS } from '../data/customerWorkspaceData';
import { PLAN_CATALOG } from '../config/plans';

export interface TeamRosterResponse {
  members: TeamMember[];
  maxSeats: number;
  tier?: string;
}

/** A team the caller can chat in — their own (once it has members) or one they were invited to. */
export interface TeamChatRoom {
  ownerId: string;
  ownerEmail: string;
  myRole: TeamMember['role'];
  memberCount: number;
  lastMessage: { content: string; createdAt: string; senderEmail: string | null } | null;
}

export interface TeamChatMessage {
  id: string;
  content: string;
  createdAt: string;
  senderId: string | null;
  senderEmail: string | null;
  mine: boolean;
}

export const teamService = {
  async fetchTeam(): Promise<TeamRosterResponse> {
    if (env.isMockEnabled) {
      return {
        members: INITIAL_TEAM_MEMBERS,
        maxSeats: PLAN_CATALOG.Pro.maxSeats,
        tier: 'Pro',
      };
    }
    const res = await apiClient.get<{
      members?: TeamMember[];
      maxSeats?: number;
      tier?: string;
    }>('/api/user/team');
    return {
      members: Array.isArray(res?.members) ? res.members : [],
      maxSeats: typeof res?.maxSeats === 'number' ? res.maxSeats : PLAN_CATALOG.Free.maxSeats,
      tier: res?.tier,
    };
  },

  async inviteMember(
    email: string,
    role: TeamMember['role'],
    name?: string
  ): Promise<{ member: TeamMember; members: TeamMember[]; maxSeats?: number }> {
    if (env.isMockEnabled) {
      const namePart = email.split('@')[0] || 'Member';
      const displayName = name?.trim() || namePart.charAt(0).toUpperCase() + namePart.slice(1);
      const created: TeamMember = {
        id: `mem_${Date.now()}`,
        name: displayName,
        email,
        avatar: displayName.charAt(0).toUpperCase(),
        role,
        joinedDate: 'Just invited',
        twoFactorEnabled: false,
        status: 'invited',
      };
      return { member: created, members: [created] };
    }
    return apiClient.post('/api/user/team', { email, role, name });
  },

  async updateMemberRole(id: string, role: TeamMember['role']): Promise<{ members: TeamMember[] }> {
    if (env.isMockEnabled) {
      return { members: [] };
    }
    return apiClient.patch(`/api/user/team/${encodeURIComponent(id)}`, { role });
  },

  async removeMember(id: string): Promise<{ members: TeamMember[] }> {
    if (env.isMockEnabled) {
      return { members: [] };
    }
    return apiClient.delete(`/api/user/team/${encodeURIComponent(id)}`);
  },

  async fetchChatRooms(): Promise<TeamChatRoom[]> {
    if (env.isMockEnabled) return [];
    const res = await apiClient.get<{ rooms?: TeamChatRoom[] }>('/api/user/team/chat');
    return Array.isArray(res?.rooms) ? res.rooms : [];
  },

  /** `after` = createdAt of the newest message already shown (polling cursor). */
  async fetchChatMessages(ownerId: string, after?: string | null): Promise<TeamChatMessage[]> {
    if (env.isMockEnabled) return [];
    const qs = after ? `?after=${encodeURIComponent(after)}` : '';
    const res = await apiClient.get<{ messages?: TeamChatMessage[] }>(
      `/api/user/team/chat/${encodeURIComponent(ownerId)}${qs}`
    );
    return Array.isArray(res?.messages) ? res.messages : [];
  },

  async postChatMessage(ownerId: string, content: string): Promise<TeamChatMessage> {
    const res = await apiClient.post<{ message: TeamChatMessage }>(
      `/api/user/team/chat/${encodeURIComponent(ownerId)}`,
      { content }
    );
    return res.message;
  },
};
