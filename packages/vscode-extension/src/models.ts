/**
 * SupremeAI-branded model tiers.
 */
export interface ModelTier {
  id: string;
  label: string;
  model: string;
}

export const MODEL_TIERS: ModelTier[] = [
  { id: 'supreme-core', label: 'SupremeAI Core (Unified Smart Routing)', model: 'auto' },
];

export function tierToModel(_tierOrModel: string): string {
  return 'auto';
}

export function modelToTier(_model: string): string {
  return 'supreme-core';
}
