import { apiClient } from './apiClient';

/** বাংলা মন্তব্য: edge `functions/_lib/adminBackups.ts`-এর সাথে একই আকার। */
export type BackupHealth = 'ok' | 'stale' | 'failing' | 'never' | 'not-deployed';

export interface BackupArtifact {
  id: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string | null;
  runId: number | null;
  commit: string | null;
}

export interface BackupRun {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  createdAt: string;
  url: string;
}

export interface BackupState {
  health: BackupHealth;
  schedule: string;
  retentionDays: number;
  encryption: string;
  lastRun: BackupRun | null;
  lastSuccessAt: string | null;
  backups: BackupArtifact[];
  workflowUrl: string;
}

const HEALTH: BackupHealth[] = ['ok', 'stale', 'failing', 'never', 'not-deployed'];

export const adminBackupService = {
  async getState(): Promise<BackupState> {
    const res = await apiClient.get<Partial<BackupState>>('/api/admin/backups');
    return {
      health: HEALTH.includes(res.health as BackupHealth) ? (res.health as BackupHealth) : 'never',
      schedule: String(res.schedule || ''),
      retentionDays: Number(res.retentionDays) || 30,
      encryption: String(res.encryption || 'AES-256'),
      lastRun: res.lastRun ?? null,
      lastSuccessAt: res.lastSuccessAt ?? null,
      backups: Array.isArray(res.backups) ? res.backups : [],
      workflowUrl: String(res.workflowUrl || ''),
    };
  },
};
