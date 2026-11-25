import { RolePersona } from '../types';
import { CANONICAL_ROLES, DEFAULT_ROLE_ID, resolveCanonicalRole } from '../shared/platformCatalog';

// বাংলা মন্তব্য: সিস্টেম রোল (Persona) তালিকা এখন `packages/contracts/roles.json` থেকে একক উৎস হিসেবে ব্যবহৃত হচ্ছে
export const SYSTEM_ROLES: RolePersona[] = CANONICAL_ROLES;
export { DEFAULT_ROLE_ID, resolveCanonicalRole };
