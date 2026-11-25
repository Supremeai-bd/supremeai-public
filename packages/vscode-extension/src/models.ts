/**
 * বাংলা মন্তব্য: VS Code Extension-এর জন্য ক্যানোনিকাল মডেল, রোল (Persona), থিম এবং অপশন ক্যাটালগ।
 * এটি সরাসরি `src/contracts/*.json` (যা `packages/contracts/*.json` থেকে সিঙ্ক হয়) ব্যবহার করে,
 * যাতে Web, Desktop, Mobile এবং VS Code-এ শতভাগ অভিন্ন ফিচার থাকে।
 */
import modelsContract from './contracts/models.json';
import rolesContract from './contracts/roles.json';
import syncContract from './contracts/sync-protocol.json';
import themesContract from './contracts/themes.json';

export type ThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
export type AppLanguage = 'en' | 'bn';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface ModelTier {
  id: string;
  name: string;
  label: string;
  alias: string;
  badge: string;
  tagline: string;
  description: string;
  latencyRating: string;
  tier: 'standard' | 'advanced';
  model: string;
  colorHex: string;
}

export interface RolePersona {
  id: string;
  name: string;
  badge: string;
  tagline: string;
  description: string;
  suggestedModel: string;
  systemInstruction: string;
  quickPrompts: string[];
}

export interface ThemePreset {
  id: string;
  name: string;
  accentHex: string;
  recommendedScheme: string;
}

export const DEFAULT_MODEL_ID = modelsContract.defaultModelId || 'supreme-core';
export const DEFAULT_ROLE_ID = rolesContract.defaultRoleId || 'supreme-general';

export const FOUNDATION_MODELS: ModelTier[] = modelsContract.models.map((m) => ({
  id: m.id,
  name: m.name,
  label: `${m.name} — ${m.alias}`,
  alias: m.alias,
  badge: m.badge,
  tagline: m.tagline,
  description: m.description,
  latencyRating: m.latencyRating,
  tier: m.tier === 'advanced' ? 'advanced' : 'standard',
  model: m.gatewayModel || m.id,
  colorHex: m.colorHex || '#06b6d4',
}));

// বাংলা মন্তব্য: ড্রপডাউন ও QuickPick-এ Auto-Routing + সব ৬টি ক্যানোনিকাল মডেল দেখানো হয়
export const MODEL_TIERS: ModelTier[] = [
  {
    id: modelsContract.autoOption.id,
    name: modelsContract.autoOption.name,
    label: `${modelsContract.autoOption.name} (${modelsContract.autoOption.alias})`,
    alias: modelsContract.autoOption.alias,
    badge: modelsContract.autoOption.badge,
    tagline: modelsContract.autoOption.tagline,
    description: modelsContract.autoOption.description,
    latencyRating: modelsContract.autoOption.latencyRating,
    tier: 'standard',
    model: 'auto',
    colorHex: '#6366f1',
  },
  ...FOUNDATION_MODELS,
];

const MODEL_ALIASES: Record<string, string> = modelsContract.aliases as Record<string, string>;

export function tierToModel(tierOrModel: string): string {
  const clean = String(tierOrModel || '')
    .trim()
    .toLowerCase();
  if (!clean || clean === 'auto') return 'auto';
  if (clean in MODEL_ALIASES) {
    return MODEL_ALIASES[clean];
  }
  const matched = FOUNDATION_MODELS.find((m) => m.id === clean || m.model === clean);
  return matched ? matched.id : 'auto';
}

export function modelToTier(model: string): string {
  const resolved = tierToModel(model);
  if (resolved === 'auto') return 'auto';
  return FOUNDATION_MODELS.some((m) => m.id === resolved) ? resolved : DEFAULT_MODEL_ID;
}

export const SYSTEM_ROLES: RolePersona[] = rolesContract.roles.map((r) => ({
  id: r.id,
  name: r.name,
  badge: r.badge,
  tagline: r.tagline,
  description: r.description,
  suggestedModel: r.suggestedModel,
  systemInstruction: r.systemInstruction,
  quickPrompts: [...r.quickPrompts],
}));

export function resolveRoleById(roleId?: string | null): RolePersona {
  const clean = String(roleId || '').trim();
  return (
    SYSTEM_ROLES.find((r) => r.id === clean) ||
    SYSTEM_ROLES.find((r) => r.id === DEFAULT_ROLE_ID) ||
    SYSTEM_ROLES[0]
  );
}

export function buildEffectiveSystemInstruction(
  roleId?: string | null,
  customInstruction?: string | null,
  language?: AppLanguage
): string {
  const role = resolveRoleById(roleId);
  const parts = [role.systemInstruction.trim()];
  const custom = String(customInstruction || '').trim();
  if (custom) {
    parts.push(`Additional User Instructions:\n${custom}`);
  }
  if (language === 'bn') {
    parts.push('Prefer clear, natural Bengali (বাংলা) explanations unless asked for English.');
  }
  return parts.join('\n\n');
}

export function thinkingLevelToReasoningEffort(level?: string): 'low' | 'medium' | 'high' {
  const upper = String(level || 'MEDIUM').toUpperCase();
  if (upper === 'LOW') return 'low';
  if (upper === 'HIGH' || upper === 'XHIGH') return 'high';
  return 'medium';
}

export const LIVE_THEMES: ThemePreset[] = themesContract.themes.map((p) => ({
  id: p.id,
  name: p.name,
  accentHex: p.accentHex,
  recommendedScheme: p.recommendedScheme,
}));

export const DEFAULT_SYNCED_OPTIONS = {
  selectedModelId: syncContract.defaultFeatureOptions.selectedModelId || DEFAULT_MODEL_ID,
  autoModelRouting: syncContract.defaultFeatureOptions.autoModelRouting !== false,
  activeRoleId: syncContract.defaultFeatureOptions.activeRoleId || DEFAULT_ROLE_ID,
  customInstruction: syncContract.defaultFeatureOptions.customInstruction || '',
  language: (syncContract.defaultFeatureOptions.language === 'bn' ? 'bn' : 'en') as AppLanguage,
  themeMode: (syncContract.defaultFeatureOptions.themeMode || 'system') as ThemeMode,
  liveTheme:
    syncContract.defaultFeatureOptions.liveTheme ||
    themesContract.themes[0]?.id ||
    'alpine-dunes',
  thinkingLevel: (syncContract.defaultFeatureOptions.thinkingLevel || 'MEDIUM') as ThinkingLevel,
  temperature: Number(syncContract.defaultFeatureOptions.temperature ?? 0.7),
  maxOutputTokens: Number(syncContract.defaultFeatureOptions.maxOutputTokens ?? 8192),
  enableSearchGrounding: syncContract.defaultFeatureOptions.enableSearchGrounding !== false,
};
