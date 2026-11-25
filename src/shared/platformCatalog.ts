/**
 * বাংলা মন্তব্য: চারটি প্ল্যাটফর্ম (Web, Desktop, Mobile Android/iOS, এবং VS Code Extension)
 * এবং উভয় ব্যাকএন্ডের (Express ও Cloudflare Pages Edge) জন্য একক ক্যানোনিকাল ক্যাটালগ।
 * সব মডেল, রোল (Persona), থিম এবং সিঙ্ক অপশনের একমাত্র উৎস হলো `packages/contracts/*.json`।
 */
import modelsContract from '../../packages/contracts/models.json';
import rolesContract from '../../packages/contracts/roles.json';
import syncContract from '../../packages/contracts/sync-protocol.json';
import themesContract from '../../packages/contracts/themes.json';
import type {
  ModelDetail,
  ModelPolicy,
  PlanTier,
  RolePersona,
  WorkbenchThinkingLevel,
} from '../types';

export type CanonicalModelId =
  | 'supreme-spark'
  | 'supreme-core'
  | 'supreme-reason'
  | 'supreme-deep'
  | 'supremeai-web'
  | 'supremeai-api';

export type SelectableModelId = 'auto' | CanonicalModelId;

export interface ServerModelEntry {
  name: string;
  description: string;
  tier: 'standard' | 'advanced';
  alias?: string;
  badge?: string;
  tagline?: string;
  idealFor?: string;
  latencyRating?: 'Ultra-Fast' | 'Balanced' | 'Deep-Compute';
  contextTokens?: string;
  reasoningCapability?: 'Standard' | 'High' | 'Extreme';
}

export interface SyncedFeatureOptions {
  selectedModelId: CanonicalModelId;
  autoModelRouting: boolean;
  activeRoleId: string;
  customInstruction: string;
  language: 'en' | 'bn';
  themeMode: 'system' | 'light' | 'dark';
  liveTheme: string;
  thinkingLevel: WorkbenchThinkingLevel;
  temperature: number;
  maxOutputTokens: number;
  enableSearchGrounding: boolean;
  enableKnowledgeGrounding: boolean;
  enableCodeExecution: boolean;
  liveArtifactSync: boolean;
  streamResponses: boolean;
}

export const DEFAULT_MODEL_ID: CanonicalModelId =
  (modelsContract.defaultModelId as CanonicalModelId) || 'supreme-core';

export const DEFAULT_ROLE_ID: string = rolesContract.defaultRoleId || 'supreme-general';

export const AUTO_MODEL_OPTION: ModelDetail = {
  id: modelsContract.autoOption.id,
  name: modelsContract.autoOption.name,
  alias: modelsContract.autoOption.alias,
  badge: modelsContract.autoOption.badge,
  tagline: modelsContract.autoOption.tagline,
  description: modelsContract.autoOption.description,
  idealFor: modelsContract.autoOption.idealFor,
  latencyRating: modelsContract.autoOption.latencyRating as ModelDetail['latencyRating'],
  contextTokens: modelsContract.autoOption.contextTokens,
  reasoningCapability:
    modelsContract.autoOption.reasoningCapability as ModelDetail['reasoningCapability'],
  tier: modelsContract.autoOption.tier as ModelDetail['tier'],
};

// বাংলা মন্তব্য: contracts/models.json থেকে ৬টি ক্যানোনিকাল মডেল লোড করা হচ্ছে (ক্রম অপরিবর্তিত: index 0 = supreme-spark, index 1 = supreme-core)
export const CANONICAL_MODELS: ModelDetail[] = modelsContract.models.map((m) => ({
  id: m.id,
  name: m.name,
  alias: m.alias,
  badge: m.badge,
  tagline: m.tagline,
  description: m.description,
  idealFor: m.idealFor,
  latencyRating: m.latencyRating as ModelDetail['latencyRating'],
  contextTokens: m.contextTokens,
  reasoningCapability: m.reasoningCapability as ModelDetail['reasoningCapability'],
  tier: m.tier as ModelDetail['tier'],
}));

export const MODEL_ALIASES: Record<string, SelectableModelId> =
  modelsContract.aliases as Record<string, SelectableModelId>;

// বাংলা মন্তব্য: যেকোনো পুরনো বা অ্যালায়াস মডেল আইডিকে ক্যানোনিকাল আইডিতে রূপান্তর করে
export function normalizeModelSelection(
  rawId?: string | null,
  allowAuto = true
): SelectableModelId {
  const clean = String(rawId || '')
    .trim()
    .toLowerCase();
  if (!clean) return DEFAULT_MODEL_ID;
  if (clean === 'auto') return allowAuto ? 'auto' : DEFAULT_MODEL_ID;

  if (clean in MODEL_ALIASES) {
    const mapped = MODEL_ALIASES[clean];
    return mapped === 'auto' && !allowAuto ? DEFAULT_MODEL_ID : mapped;
  }

  const exact = CANONICAL_MODELS.find((m) => m.id === clean);
  if (exact) return exact.id as CanonicalModelId;

  return DEFAULT_MODEL_ID;
}

export function normalizeConcreteModelId(rawId?: string | null): CanonicalModelId {
  const resolved = normalizeModelSelection(rawId, false);
  return resolved === 'auto' ? DEFAULT_MODEL_ID : resolved;
}

// বাংলা মন্তব্য: Express এবং Cloudflare Edge `/api/models`-এর জন্য একীভূত মডেল ম্যাপ
export const CANONICAL_SERVER_MODELS: Record<string, ServerModelEntry> = (() => {
  const map: Record<string, ServerModelEntry> = {
    auto: {
      name: AUTO_MODEL_OPTION.name,
      description: AUTO_MODEL_OPTION.description,
      tier: AUTO_MODEL_OPTION.tier,
      alias: AUTO_MODEL_OPTION.alias,
      badge: AUTO_MODEL_OPTION.badge,
      tagline: AUTO_MODEL_OPTION.tagline,
      idealFor: AUTO_MODEL_OPTION.idealFor,
      latencyRating: AUTO_MODEL_OPTION.latencyRating,
      contextTokens: AUTO_MODEL_OPTION.contextTokens,
      reasoningCapability: AUTO_MODEL_OPTION.reasoningCapability,
    },
  };
  for (const m of CANONICAL_MODELS) {
    map[m.id] = {
      name: m.name,
      description: m.description,
      tier: m.tier,
      alias: m.alias,
      badge: m.badge,
      tagline: m.tagline,
      idealFor: m.idealFor,
      latencyRating: m.latencyRating,
      contextTokens: m.contextTokens,
      reasoningCapability: m.reasoningCapability,
    };
  }
  return map;
})();

export const DEFAULT_MODEL_POLICIES: Record<string, ModelPolicy> = (() => {
  const policies: Record<string, ModelPolicy> = {};
  for (const m of modelsContract.models) {
    policies[m.id] = {
      enabled: m.enabled !== false,
      minTier: (m.minTier as PlanTier) || 'Free',
    };
  }
  return policies;
})();

export const CANONICAL_ROLES: RolePersona[] = rolesContract.roles.map((r) => ({
  id: r.id,
  name: r.name,
  badge: r.badge,
  tagline: r.tagline,
  description: r.description,
  suggestedModel: normalizeConcreteModelId(r.suggestedModel),
  systemInstruction: r.systemInstruction,
  quickPrompts: [...r.quickPrompts],
}));

export function resolveCanonicalRole(roleId?: string | null): RolePersona {
  const clean = String(roleId || '').trim();
  return (
    CANONICAL_ROLES.find((r) => r.id === clean) ||
    CANONICAL_ROLES.find((r) => r.id === DEFAULT_ROLE_ID) ||
    CANONICAL_ROLES[0]
  );
}

export const SYNC_PLATFORMS = [...syncContract.platforms] as const;
export const SYNC_DOMAINS = [...syncContract.domains] as const;
export const CANONICAL_THEME_IDS = themesContract.themes.map((p) => p.id);

export const DEFAULT_SYNCED_FEATURE_OPTIONS: SyncedFeatureOptions = {
  selectedModelId: normalizeConcreteModelId(syncContract.defaultFeatureOptions.selectedModelId),
  autoModelRouting: Boolean(syncContract.defaultFeatureOptions.autoModelRouting),
  activeRoleId: syncContract.defaultFeatureOptions.activeRoleId || DEFAULT_ROLE_ID,
  customInstruction: syncContract.defaultFeatureOptions.customInstruction || '',
  language: syncContract.defaultFeatureOptions.language === 'bn' ? 'bn' : 'en',
  themeMode:
    syncContract.defaultFeatureOptions.themeMode === 'dark' ||
    syncContract.defaultFeatureOptions.themeMode === 'light'
      ? syncContract.defaultFeatureOptions.themeMode
      : 'system',
  liveTheme:
    syncContract.defaultFeatureOptions.liveTheme ||
    themesContract.themes[0]?.id ||
    'alpine-dunes',
  thinkingLevel:
    (syncContract.defaultFeatureOptions.thinkingLevel as WorkbenchThinkingLevel) || 'MEDIUM',
  temperature: Number(syncContract.defaultFeatureOptions.temperature ?? 0.7),
  maxOutputTokens: Number(syncContract.defaultFeatureOptions.maxOutputTokens ?? 8192),
  enableSearchGrounding: syncContract.defaultFeatureOptions.enableSearchGrounding !== false,
  enableKnowledgeGrounding: syncContract.defaultFeatureOptions.enableKnowledgeGrounding !== false,
  enableCodeExecution: Boolean(syncContract.defaultFeatureOptions.enableCodeExecution),
  liveArtifactSync: syncContract.defaultFeatureOptions.liveArtifactSync !== false,
  streamResponses: syncContract.defaultFeatureOptions.streamResponses !== false,
};
