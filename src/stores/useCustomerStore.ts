import { create } from 'zustand';
import {
  ApiKeyItem,
  WebhookItem,
  KnowledgeDoc,
  TeamMember,
  BillingInvoice,
  UserProject,
  PluginItem,
  UserAccountSettings,
} from '../types';
import {
  INITIAL_API_KEYS,
  INITIAL_WEBHOOKS,
  INITIAL_KNOWLEDGE_DOCS,
  INITIAL_TEAM_MEMBERS,
  INITIAL_INVOICES,
} from '../data/customerWorkspaceData';
import { INITIAL_PLUGINS, INITIAL_USER_PROJECTS, DEFAULT_USER_SETTINGS } from '../data/userPlugins';
import { toast } from './useToastStore';
import { knowledgeService } from '../services/knowledgeService';
import { apiKeyService } from '../services/apiKeyService';
import { webhookService } from '../services/webhookService';
import { billingService } from '../services/billingService';
import { projectService } from '../services/projectService';
import { loadGitTokens } from '../services/gitExportService';
import { teamService } from '../services/teamService';
import { ttsService } from '../services/ttsService';
import { env } from '../config/env';
import { PLAN_CATALOG } from '../config/plans';
import { schedulePreferencesPatch } from '../services/userPreferencesSyncBus';
import { logger } from '../utils/logger';

const API_KEYS_KEY = 'supremeai_studio_api_keys';
const WEBHOOKS_KEY = 'supremeai_studio_webhooks';
const KNOWLEDGE_KEY = 'supremeai_studio_knowledge_docs';
const TEAM_KEY = 'supremeai_studio_team_members';
const INVOICES_KEY = 'supremeai_studio_invoices';
const PROJECTS_KEY = 'supremeai_studio_user_projects';
const PLUGINS_KEY = 'supremeai_studio_user_plugins';
const SETTINGS_KEY = 'supremeai_studio_user_settings';

interface CustomerState {
  apiKeys: ApiKeyItem[];
  webhooks: WebhookItem[];
  knowledgeDocs: KnowledgeDoc[];
  teamMembers: TeamMember[];
  invoices: BillingInvoice[];
  userProjects: UserProject[];
  userPlugins: PluginItem[];
  userSettings: UserAccountSettings;

  // API Key Actions
  fetchApiKeys: () => Promise<void>;
  addApiKey: (
    newKey: Omit<ApiKeyItem, 'id' | 'createdAt' | 'lastUsed'> & { rawSecret?: string }
  ) => Promise<void> | void;
  updateApiKey: (
    id: string,
    updates: Partial<ApiKeyItem> & { rawSecret?: string }
  ) => Promise<void> | void;
  revokeApiKey: (id: string) => Promise<void> | void;
  deleteApiKey: (id: string) => Promise<void> | void;
  probeApiKey: (id: string) => Promise<void>;

  // Webhook Actions
  fetchWebhooks: () => Promise<void>;
  addWebhook: (
    newWebhook: Omit<WebhookItem, 'id' | 'lastTriggered' | 'failureCount'>
  ) => Promise<void> | void;
  deleteWebhook: (id: string) => Promise<void> | void;
  testWebhook: (id: string) => Promise<void> | void;

  // Knowledge Base Actions
  fetchKnowledgeDocs: () => Promise<void>;
  addKnowledgeDoc: (doc: Omit<KnowledgeDoc, 'id' | 'lastIndexed'>) => Promise<void> | void;
  toggleKnowledgeGrounding: (id: string) => Promise<void> | void;
  deleteKnowledgeDoc: (id: string) => Promise<void> | void;

  // Team Actions
  maxSeats: number;
  fetchTeamMembers: () => Promise<void>;
  inviteTeamMember: (
    member: Omit<TeamMember, 'id' | 'joinedDate' | 'avatar'>
  ) => Promise<void> | void;
  updateTeamRole: (id: string, newRole: TeamMember['role']) => Promise<void> | void;
  removeTeamMember: (id: string) => Promise<void> | void;

  // Billing Actions
  fetchInvoices: () => Promise<void>;
  topUpTokens: (addedTokens: number, costUsd: number) => Promise<void> | void;

  // Project Actions
  fetchProjects: () => Promise<void>;
  addProject: (
    project: Omit<UserProject, 'id' | 'lastSynced' | 'stars' | 'aiReviewStatus'>
  ) => Promise<void> | void;
  forkProject: (project: UserProject) => Promise<void>;
  refreshProjectBuildStatus: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void> | void;

  // Plugin Actions
  togglePlugin: (id: string) => void;
  addCustomPlugin: (plugin: Omit<PluginItem, 'id'>) => void;

  // Settings Actions
  updateSettings: (newSettings: Partial<UserAccountSettings>, silent?: boolean) => void;
  applyRemoteSettings: (remoteSettings: Partial<UserAccountSettings>) => void;
  applyRemotePlugins: (remotePlugins: PluginItem[]) => void;
  hydrateRemoteWorkspaceResources: () => Promise<void>;
  resetAccountScopedData: () => void;
  recordTokenUsage: (estimatedTokens: number) => void;
}

export const useCustomerStore = create<CustomerState>((set, get) => {
  const getInitialStorage = <T>(key: string, fallback: T): T => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (error) {
      logger.debug('useCustomerStore: suppressed non-fatal error', error);
    }
    return fallback;
  };

  const initialApiKeys = getInitialStorage<ApiKeyItem[]>(
    API_KEYS_KEY,
    env.isMockEnabled ? INITIAL_API_KEYS : []
  );
  const initialWebhooks = getInitialStorage<WebhookItem[]>(
    WEBHOOKS_KEY,
    env.isMockEnabled ? INITIAL_WEBHOOKS : []
  );
  const initialKnowledgeDocs = getInitialStorage<KnowledgeDoc[]>(
    KNOWLEDGE_KEY,
    env.isMockEnabled ? INITIAL_KNOWLEDGE_DOCS : []
  );
  const initialTeamMembers = getInitialStorage<TeamMember[]>(
    TEAM_KEY,
    env.isMockEnabled ? INITIAL_TEAM_MEMBERS : []
  );
  const initialInvoices = getInitialStorage<BillingInvoice[]>(
    INVOICES_KEY,
    env.isMockEnabled ? INITIAL_INVOICES : []
  );
  const initialProjects = getInitialStorage<UserProject[]>(
    PROJECTS_KEY,
    env.isMockEnabled ? INITIAL_USER_PROJECTS : []
  );
  const initialPlugins = getInitialStorage<PluginItem[]>(PLUGINS_KEY, INITIAL_PLUGINS);
  const rawInitialSettings = getInitialStorage<UserAccountSettings>(
    SETTINGS_KEY,
    DEFAULT_USER_SETTINGS
  );
  const initialLanguage = rawInitialSettings.language === 'bn' ? 'bn' : 'en';
  const initialSettings: UserAccountSettings = {
    ...DEFAULT_USER_SETTINGS,
    ...rawInitialSettings,
    language: initialLanguage,
    streamResponses: true,
    enableKnowledgeGrounding: true,
  };

  if (typeof document !== 'undefined') {
    document.documentElement.lang = initialLanguage;
    if (initialSettings.contentLayout) {
      document.documentElement.dataset.workspaceLayout = initialSettings.contentLayout;
    }
  }
  ttsService.setLanguage(initialLanguage, { syncRemote: false });

  return {
    apiKeys: initialApiKeys,
    webhooks: initialWebhooks,
    knowledgeDocs: initialKnowledgeDocs,
    teamMembers: initialTeamMembers,
    maxSeats: PLAN_CATALOG[initialSettings.plan]?.maxSeats ?? PLAN_CATALOG.Free.maxSeats,
    invoices: initialInvoices,
    userProjects: initialProjects,
    userPlugins: initialPlugins,
    userSettings: initialSettings,

    fetchApiKeys: async () => {
      try {
        const keys = await apiKeyService.fetchApiKeys();
        set({ apiKeys: keys });
        localStorage.setItem(API_KEYS_KEY, JSON.stringify(keys));
      } catch (err) {
        logger.warn('Failed to fetch API keys from server:', err);
      }
    },

    addApiKey: async (newKey) => {
      try {
        const keyItem = await apiKeyService.createApiKey(newKey);
        set((state) => {
          const updated = [keyItem, ...state.apiKeys.filter((k) => k.id !== keyItem.id)];
          localStorage.setItem(API_KEYS_KEY, JSON.stringify(updated));
          return { apiKeys: updated };
        });
        toast.success('API Key Added', `Configured key ${keyItem.name} (${keyItem.keyPrefix})`);
      } catch (err) {
        console.error('Error generating API key:', err);
        toast.error(
          'API Key Failed',
          err instanceof Error ? err.message : 'Unable to save API key to server.'
        );
      }
    },

    updateApiKey: async (id, updates) => {
      const serverUpdated = await apiKeyService.updateApiKey(id, updates);
      set((state) => {
        const updated = state.apiKeys.map((k) => {
          if (k.id !== id) return k;
          if (serverUpdated) return serverUpdated;
          const next = { ...k, ...updates };
          if (updates.rawSecret && updates.rawSecret.trim()) {
            const clean = updates.rawSecret.trim();
            next.keyPrefix = clean.slice(0, Math.min(14, clean.length));
            next.secretMasked =
              clean.length > 10
                ? `${clean.slice(0, 10)}••••••••••••••••${clean.slice(-4)}`
                : '••••••••••••';
            next.healthStatus = 'healthy';
            next.lastChecked = 'Rotated just now';
          }
          delete (next as { rawSecret?: string }).rawSecret;
          return next;
        });
        localStorage.setItem(API_KEYS_KEY, JSON.stringify(updated));
        return { apiKeys: updated };
      });
      toast.success('API Key Updated', 'Credential configuration saved.');
    },

    revokeApiKey: async (id: string) => {
      set((state) => {
        const updated = state.apiKeys.map((k) =>
          k.id === id ? { ...k, status: 'revoked' as const } : k
        );
        localStorage.setItem(API_KEYS_KEY, JSON.stringify(updated));
        return { apiKeys: updated };
      });
      toast.warning('API Key Revoked', 'The key is permanently decommissioned.');
      try {
        await apiKeyService.revokeApiKey(id);
      } catch (err) {
        console.error('Error revoking API key on server:', err);
      }
    },

    deleteApiKey: async (id: string) => {
      set((state) => {
        const updated = state.apiKeys.filter((k) => k.id !== id);
        localStorage.setItem(API_KEYS_KEY, JSON.stringify(updated));
        return { apiKeys: updated };
      });
      toast.info('API Key Removed', 'Credential permanently deleted.');
      try {
        await apiKeyService.deleteApiKey(id);
      } catch (err) {
        console.error('Error deleting API key on server:', err);
      }
    },

    probeApiKey: async (id: string) => {
      try {
        const res = await apiKeyService.probeApiKey(id);
        set((state) => {
          const updated = state.apiKeys.map((k) => {
            if (k.id !== id) return k;
            if (res.key) return res.key;
            return {
              ...k,
              healthStatus: res.success ? ('healthy' as const) : ('degraded' as const),
              lastChecked: `Just now (${res.latencyMs}ms)`,
              lastUsed: 'Just now',
            };
          });
          localStorage.setItem(API_KEYS_KEY, JSON.stringify(updated));
          return { apiKeys: updated };
        });
        if (res.success) {
          toast.success('Provider Probe Healthy', `${res.message} (${res.latencyMs}ms)`);
        } else {
          toast.warning('Provider Probe Degraded', `${res.message} (${res.latencyMs}ms)`);
        }
      } catch (err) {
        toast.error(
          'Probe Failed',
          err instanceof Error ? err.message : 'Unable to reach provider gateway.'
        );
      }
    },

    fetchWebhooks: async () => {
      try {
        const whs = await webhookService.fetchWebhooks();
        set({ webhooks: whs });
        localStorage.setItem(WEBHOOKS_KEY, JSON.stringify(whs));
      } catch (err) {
        logger.warn('Failed to fetch webhooks from server:', err);
      }
    },

    addWebhook: async (newWebhook) => {
      try {
        const wh = await webhookService.createWebhook(newWebhook);
        set((state) => {
          const updated = [wh, ...state.webhooks.filter((w) => w.id !== wh.id)];
          localStorage.setItem(WEBHOOKS_KEY, JSON.stringify(updated));
          return { webhooks: updated };
        });
        toast.success('Webhook Endpoint Configured', wh.url);
      } catch (err) {
        console.error('Error creating webhook on server:', err);
        toast.error(
          'Webhook Error',
          err instanceof Error ? err.message : 'Unable to configure webhook endpoint.'
        );
      }
    },

    deleteWebhook: async (id: string) => {
      set((state) => {
        const updated = state.webhooks.filter((w) => w.id !== id);
        localStorage.setItem(WEBHOOKS_KEY, JSON.stringify(updated));
        return { webhooks: updated };
      });
      toast.info('Webhook Removed', 'Endpoint unregistered.');
      try {
        await webhookService.deleteWebhook(id);
      } catch (err) {
        console.error('Error deleting webhook on server:', err);
      }
    },

    testWebhook: async (id: string) => {
      try {
        const res = await webhookService.testWebhook(id);
        const statusText = res.success
          ? `HTTP ${res.status_code || 200} OK`
          : res.error || 'Failed';
        set((state) => {
          const updated = state.webhooks.map((w) =>
            w.id === id ? { ...w, lastTriggered: `Just now (${statusText})` } : w
          );
          localStorage.setItem(WEBHOOKS_KEY, JSON.stringify(updated));
          return { webhooks: updated };
        });
        if (res.success) {
          toast.success('Ping Delivered', 'Test payload returned HTTP 200 OK.');
        } else {
          toast.error('Ping Failed', res.error || 'Endpoint unreachable.');
        }
      } catch (err) {
        console.error('Error testing webhook:', err);
        toast.error(
          'Ping Failed',
          err instanceof Error ? err.message : 'Unable to reach webhook test endpoint.'
        );
      }
    },

    fetchKnowledgeDocs: async () => {
      try {
        const docs = await knowledgeService.fetchUserDocs();
        set({ knowledgeDocs: docs });
        localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(docs));
      } catch (err) {
        logger.warn('Failed to fetch knowledge docs from server:', err);
      }
    },

    addKnowledgeDoc: async (doc) => {
      try {
        const created = await knowledgeService.createDoc(doc);
        set((state) => {
          const updated = [created, ...state.knowledgeDocs.filter((d) => d.id !== created.id)];
          localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(updated));
          return { knowledgeDocs: updated };
        });
        toast.success('Document Indexed', `"${created.title}" ready for semantic grounding.`);
      } catch (err) {
        console.error('Error creating knowledge doc:', err);
        toast.error(
          'Indexing Failed',
          err instanceof Error ? err.message : 'Could not add document to knowledge base.'
        );
      }
    },

    toggleKnowledgeGrounding: async (id: string) => {
      let targetState = true;
      set((state) => {
        const match = state.knowledgeDocs.find((d) => d.id === id);
        if (match) {
          targetState = !match.isGroundingActive;
        }
        const updated = state.knowledgeDocs.map((d) =>
          d.id === id ? { ...d, isGroundingActive: !d.isGroundingActive } : d
        );
        localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(updated));
        return { knowledgeDocs: updated };
      });
      try {
        await knowledgeService.toggleGrounding(id, targetState);
      } catch (err) {
        console.error('Error toggling grounding:', err);
      }
    },

    deleteKnowledgeDoc: async (id: string) => {
      set((state) => {
        const updated = state.knowledgeDocs.filter((d) => d.id !== id);
        localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(updated));
        return { knowledgeDocs: updated };
      });
      toast.info('Document Removed', 'Source removed from knowledge base index.');
      try {
        await knowledgeService.deleteDoc(id);
      } catch (err) {
        console.error('Error deleting doc:', err);
      }
    },

    fetchTeamMembers: async () => {
      try {
        const res = await teamService.fetchTeam();
        set({ teamMembers: res.members, maxSeats: res.maxSeats });
        localStorage.setItem(TEAM_KEY, JSON.stringify(res.members));
      } catch (err) {
        logger.warn('Failed to fetch team roster from server:', err);
      }
    },

    inviteTeamMember: async (member) => {
      try {
        const res = await teamService.inviteMember(member.email, member.role, member.name);
        set((state) => {
          const updated =
            Array.isArray(res.members) && res.members.length > 0
              ? res.members
              : [...state.teamMembers, res.member];
          localStorage.setItem(TEAM_KEY, JSON.stringify(updated));
          return {
            teamMembers: updated,
            maxSeats: typeof res.maxSeats === 'number' ? res.maxSeats : state.maxSeats,
          };
        });
        toast.success('Invitation Sent', `Sent workspace invite to ${res.member.email}`);
      } catch (err) {
        toast.error(
          'Invite Failed',
          err instanceof Error ? err.message : 'Unable to send workspace invitation.'
        );
      }
    },

    updateTeamRole: async (id: string, newRole: TeamMember['role']) => {
      try {
        const res = await teamService.updateMemberRole(id, newRole);
        set((state) => {
          const updated =
            Array.isArray(res.members) && res.members.length > 0
              ? res.members
              : state.teamMembers.map((m) => (m.id === id ? { ...m, role: newRole } : m));
          localStorage.setItem(TEAM_KEY, JSON.stringify(updated));
          return { teamMembers: updated };
        });
        toast.info('Role Updated', 'Team permissions updated.');
      } catch (err) {
        toast.error(
          'Role Update Failed',
          err instanceof Error ? err.message : 'Unable to update member role.'
        );
      }
    },

    removeTeamMember: async (id: string) => {
      try {
        const res = await teamService.removeMember(id);
        set((state) => {
          const updated =
            Array.isArray(res.members) && !env.isMockEnabled
              ? res.members
              : state.teamMembers.filter((m) => m.id !== id);
          localStorage.setItem(TEAM_KEY, JSON.stringify(updated));
          return { teamMembers: updated };
        });
        toast.info('Member Removed', 'User removed from team roster.');
      } catch (err) {
        toast.error(
          'Remove Failed',
          err instanceof Error ? err.message : 'Unable to remove team member.'
        );
      }
    },

    fetchInvoices: async () => {
      try {
        const invs = await billingService.fetchInvoices();
        set({ invoices: invs });
        localStorage.setItem(INVOICES_KEY, JSON.stringify(invs));
      } catch (err) {
        logger.warn('Failed to fetch invoices:', err);
      }
    },

    topUpTokens: async (addedTokens: number, costUsd: number) => {
      try {
        const res = await billingService.createTopUp(addedTokens, costUsd);
        const newInv = res.invoice;

        set((state) => {
          const updatedSettings = {
            ...state.userSettings,
            monthlyTokensLimit: state.userSettings.monthlyTokensLimit + addedTokens,
          };
          const updatedInvoices = [newInv, ...state.invoices];
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(updatedSettings));
          localStorage.setItem(INVOICES_KEY, JSON.stringify(updatedInvoices));
          return {
            userSettings: updatedSettings,
            invoices: updatedInvoices,
          };
        });
        toast.success(
          'Tokens Recharged',
          `Added ${(addedTokens / 1000000).toFixed(1)}M tokens to your balance.`
        );
      } catch (err) {
        console.error('Error recharging tokens:', err);
        toast.error(
          'Top-Up Failed',
          err instanceof Error ? err.message : 'Unable to process credit top-up right now.'
        );
      }
    },

    fetchProjects: async () => {
      try {
        const projs = await projectService.fetchProjects();
        set({ userProjects: projs });
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projs));
      } catch (err) {
        logger.warn('Failed to fetch projects:', err);
      }
    },

    addProject: async (project) => {
      try {
        const newProject = await projectService.createProject(project);
        set((state) => {
          const updated = [newProject, ...state.userProjects.filter((p) => p.id !== newProject.id)];
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(updated));
          return { userProjects: updated };
        });
        toast.success('Project Connected', `Repository ${newProject.name} linked.`);
        void get().refreshProjectBuildStatus(newProject.id);
      } catch (err) {
        console.error('Error connecting project:', err);
        toast.error(
          'Project Link Failed',
          err instanceof Error ? err.message : 'Unable to connect repository right now.'
        );
      }
    },

    forkProject: async (project) => {
      try {
        const gitTokens = loadGitTokens();
        const result = await projectService.forkProject(project, gitTokens.githubToken);
        set((state) => {
          const updated = [
            result.project,
            ...state.userProjects.filter((p) => p.id !== result.project.id),
          ];
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(updated));
          return { userProjects: updated };
        });
        toast.success(
          result.remoteForked ? 'Repository Forked on GitHub' : 'Repository Fork Created',
          result.remoteForked
            ? `Created GitHub fork ${result.project.name} on branch ${result.project.branch}.`
            : `Added workspace fork ${result.project.name} from ${result.project.forkedFrom || project.name}.`
        );
      } catch (err) {
        console.error('Error forking project:', err);
        toast.error(
          'Fork Failed',
          err instanceof Error ? err.message : 'Unable to fork repository right now.'
        );
      }
    },

    refreshProjectBuildStatus: async (id: string) => {
      const target = get().userProjects.find((p) => p.id === id);
      if (!target) return;
      try {
        const gitTokens = loadGitTokens();
        const statusInfo = await projectService.fetchBuildStatus(
          target.repoUrl,
          target.branch,
          gitTokens.githubToken,
          target.id
        );
        set((state) => {
          const updated = state.userProjects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  buildStatus: statusInfo.buildStatus,
                  ...(statusInfo.buildUrl ? { buildUrl: statusInfo.buildUrl } : {}),
                  lastBuildCheckedAt: statusInfo.checkedAt,
                }
              : p
          );
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(updated));
          return { userProjects: updated };
        });
      } catch (err) {
        logger.debug('refreshProjectBuildStatus failed', err);
      }
    },

    deleteProject: async (id: string) => {
      set((state) => {
        const updated = state.userProjects.filter((p) => p.id !== id);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(updated));
        return { userProjects: updated };
      });
      toast.info('Project Disconnected', 'Repository removed from studio.');
      try {
        await projectService.deleteProject(id);
      } catch (err) {
        console.error('Error disconnecting project on server:', err);
      }
    },

    togglePlugin: (id: string) => {
      let updatedPlugins: PluginItem[] = [];
      set((state) => {
        const updated = state.userPlugins.map((p) =>
          p.id === id ? { ...p, isEnabled: !p.isEnabled } : p
        );
        updatedPlugins = updated;
        localStorage.setItem(PLUGINS_KEY, JSON.stringify(updated));
        return { userPlugins: updated };
      });
      schedulePreferencesPatch({ user_plugins: updatedPlugins });
    },

    addCustomPlugin: (plugin) => {
      const newPlugin: PluginItem = {
        ...plugin,
        id: `plugin_${Date.now()}`,
      };
      let updatedPlugins: PluginItem[] = [];
      set((state) => {
        const updated = [newPlugin, ...state.userPlugins];
        updatedPlugins = updated;
        localStorage.setItem(PLUGINS_KEY, JSON.stringify(updated));
        return { userPlugins: updated };
      });
      schedulePreferencesPatch({ user_plugins: updatedPlugins });
      toast.success('Tool Registered', `Plugin "${newPlugin.name}" added.`);
    },

    updateSettings: (newSettings, silent = false) => {
      let resolvedLanguage: 'en' | 'bn' | null = null;
      let latestUpdated: UserAccountSettings | null = null;
      set((state) => {
        const normalizedLang =
          newSettings.language !== undefined
            ? newSettings.language === 'bn'
              ? 'bn'
              : 'en'
            : state.userSettings.language === 'bn'
              ? 'bn'
              : 'en';
        const updated: UserAccountSettings = {
          ...state.userSettings,
          ...newSettings,
          language: normalizedLang,
        };
        resolvedLanguage = normalizedLang;
        latestUpdated = updated;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
        if (typeof document !== 'undefined') {
          if (updated.contentLayout) {
            document.documentElement.dataset.workspaceLayout = updated.contentLayout;
          }
          document.documentElement.lang = normalizedLang;
        }
        return { userSettings: updated };
      });
      if (resolvedLanguage) {
        ttsService.setLanguage(resolvedLanguage, { syncRemote: !silent });
      }
      if (!silent && latestUpdated) {
        const {
          monthlyTokensUsed: _unusedUsed,
          monthlyTokensLimit: _unusedLimit,
          plan: _unusedPlan,
          ...syncable
        } = latestUpdated as UserAccountSettings;
        schedulePreferencesPatch({ studio_settings: syncable });
        toast.info('Settings Saved', 'Account preferences updated.');
      }
    },

    applyRemoteSettings: (remoteSettings) => {
      if (!remoteSettings || typeof remoteSettings !== 'object') return;
      let resolvedLanguage: 'en' | 'bn' = 'en';
      set((state) => {
        const normalizedLang =
          remoteSettings.language === 'bn'
            ? 'bn'
            : remoteSettings.language === 'en'
              ? 'en'
              : state.userSettings.language === 'bn'
                ? 'bn'
                : 'en';
        const merged: UserAccountSettings = {
          ...state.userSettings,
          ...remoteSettings,
          // Keep server-authoritative auth/plan fields intact
          email: state.userSettings.email,
          plan: state.userSettings.plan,
          monthlyTokensLimit: state.userSettings.monthlyTokensLimit,
          language: normalizedLang,
        };
        resolvedLanguage = normalizedLang;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        if (typeof document !== 'undefined') {
          if (merged.contentLayout) {
            document.documentElement.dataset.workspaceLayout = merged.contentLayout;
          }
          document.documentElement.lang = normalizedLang;
        }
        return { userSettings: merged };
      });
      ttsService.setLanguage(resolvedLanguage, { syncRemote: false });
    },

    applyRemotePlugins: (remotePlugins) => {
      if (!Array.isArray(remotePlugins) || remotePlugins.length === 0) return;
      localStorage.setItem(PLUGINS_KEY, JSON.stringify(remotePlugins));
      set({ userPlugins: remotePlugins });
    },

    hydrateRemoteWorkspaceResources: async () => {
      await Promise.allSettled([
        get().fetchApiKeys(),
        get().fetchWebhooks(),
        get().fetchKnowledgeDocs(),
        get().fetchProjects(),
        get().fetchTeamMembers(),
        get().fetchInvoices(),
      ]);
    },

    resetAccountScopedData: () => {
      const resetSettings: UserAccountSettings = {
        ...DEFAULT_USER_SETTINGS,
        language: get().userSettings.language,
      };
      try {
        localStorage.removeItem(API_KEYS_KEY);
        localStorage.removeItem(WEBHOOKS_KEY);
        localStorage.removeItem(KNOWLEDGE_KEY);
        localStorage.removeItem(TEAM_KEY);
        localStorage.removeItem(INVOICES_KEY);
        localStorage.removeItem(PROJECTS_KEY);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(resetSettings));
      } catch {
        // ignore storage errors
      }
      set({
        apiKeys: env.isMockEnabled ? INITIAL_API_KEYS : [],
        webhooks: env.isMockEnabled ? INITIAL_WEBHOOKS : [],
        knowledgeDocs: env.isMockEnabled ? INITIAL_KNOWLEDGE_DOCS : [],
        teamMembers: env.isMockEnabled ? INITIAL_TEAM_MEMBERS : [],
        invoices: env.isMockEnabled ? INITIAL_INVOICES : [],
        userProjects: env.isMockEnabled ? INITIAL_USER_PROJECTS : [],
        userSettings: resetSettings,
      });
    },

    recordTokenUsage: (estimatedTokens) => {
      set((state) => {
        const updated = {
          ...state.userSettings,
          monthlyTokensUsed: state.userSettings.monthlyTokensUsed + estimatedTokens,
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
        return { userSettings: updated };
      });
    },
  };
});
