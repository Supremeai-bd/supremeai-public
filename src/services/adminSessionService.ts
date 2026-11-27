import { apiClient } from './apiClient';

/** বাংলা মন্তব্য: edge `functions/_lib/adminSessions.ts`-এর সাথে একই আকার। */
export type SessionClient = 'studio-server' | 'cli' | 'browser' | 'unknown';

export interface AdminSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  client: SessionClient;
  device: string | null;
  ip: string | null;
  mfa: boolean;
  current: boolean;
}

export interface AdminSessionUser {
  userId: string;
  email: string;
  isOwner: boolean;
  isSelf: boolean;
  sessions: AdminSession[];
}

export interface AdminSessionsState {
  users: AdminSessionUser[];
  summary: { liveSessions: number; usersOnline: number; pendingCleanup: number };
}

export const adminSessionService = {
  async getState(): Promise<AdminSessionsState> {
    const res = await apiClient.get<Partial<AdminSessionsState>>('/api/admin/sessions');
    return {
      users: Array.isArray(res.users) ? res.users : [],
      summary: res.summary ?? { liveSessions: 0, usersOnline: 0, pendingCleanup: 0 },
    };
  },
  /** sessionId omitted = sign out every device of that user. */
  async revoke(userId: string, sessionId?: string): Promise<number> {
    const res = await apiClient.post<{ revoked?: number }>('/api/admin/sessions/revoke', {
      userId,
      ...(sessionId ? { sessionId } : {}),
    });
    return Number(res.revoked) || 0;
  },
};
