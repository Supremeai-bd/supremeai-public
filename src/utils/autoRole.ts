import type { RolePersona } from '../types';
import { SYSTEM_ROLES, DEFAULT_ROLE_ID } from '../data/roles';

/**
 * বাংলা মন্তব্য: রোল বাছাইয়ের কোনো মেনু নেই — প্রতিটি মেসেজ দেখে সিস্টেম নিজেই রোল ঠিক করে।
 * গল্প/কবিতা/চিঠি লিখলে "Creative Writer", অ্যাপ বা ওয়েবসাইট বানাতে বললে "Full-Stack",
 * ছোট বাগ/রেজেক্স ঠিক করতে বললে "Fast Code", নিরাপত্তা প্রশ্নে "Security", সিস্টেম ডিজাইনে
 * "Architect", বাকি সব ক্ষেত্রে "Generalist"। নিয়মগুলো সরল ও নির্ধারিত (deterministic)।
 */
export type AutoRoleId =
  | 'supreme-general'
  | 'supreme-writer'
  | 'supreme-fullstack'
  | 'supreme-fast-dev'
  | 'supreme-security'
  | 'supreme-architect';

const CODE_TERMS =
  /\b(code|coding|function|component|react|next\.?js|vue|angular|node|express|python|php|laravel|django|flask|java(script)?|typescript|html|css|tailwind|sql|api|backend|frontend|database|regex|bug|error|stack\s*trace|compile|deploy|docker|git)\b|কোড|প্রোগ্রাম/i;

const WRITER =
  /\b(story|stories|short\s+story|poem|poetry|verse|novel|chapter|essay|article|blog\s*post|lyrics|song|caption|slogan|tagline|speech|letter|cover\s+letter|email|newsletter|bio|script\s+for\s+a\s+(video|play|film))\b|গল্প|কবিতা|উপন্যাস|প্রবন্ধ|রচনা|চিঠি|গান|ছড়া|ক্যাপশন|ব্লগ|ভাষণ|\b(golpo|kobita|rochona|chithi|gaan|chora)\b/i;

const SECURITY =
  /\b(security|secure\s+(my|this|the)|vulnerab\w*|exploit|xss|csrf|sql\s*injection|owasp|pen\s*test\w*|threat\s*model|audit\s+(my|this|the)\s+(code|app|api)|cve-\d+)\b|নিরাপত্তা|সিকিউরিটি/i;

const ARCHITECT =
  /\b(architecture|system\s+design|design\s+(a|the|my)\s+(system|database|schema|backend)|scal(e|able|ability)\s+(to|for|my)|microservices?|event[-\s]driven|high\s+availability|infrastructure)\b|আর্কিটেকচার|সিস্টেম\s*ডিজাইন/i;

const BUILD =
  /\b(build|create|make|develop|generate|code|scaffold)\b.{0,40}\b(app|application|website|web\s*site|site|landing\s*page|dashboard|portfolio|game|api|backend|frontend|full[-\s]?stack|project|page|form|component|bot|extension)\b|(ওয়েবসাইট|অ্যাপ|ড্যাশবোর্ড|গেম|ল্যান্ডিং\s*পেজ).{0,20}(বানাও|বানিয়ে\s*দাও|তৈরি\s*করো)|\b(website|app|site|game)\s+(banao|baniye\s*dao|toiri\s*koro)\b/i;

const QUICK_FIX =
  /\b(fix|debug|why\s+(does|is)\s+.{0,30}(error|fail|crash)|regex|one[-\s]liner|snippet|refactor|convert\s+this|explain\s+this\s+code|what('s|\s+is)\s+wrong)\b|ঠিক\s*করো|\b(thik\s*koro|fix\s*koro)\b/i;

const roleById = (id: AutoRoleId): RolePersona =>
  SYSTEM_ROLES.find((r) => r.id === id) ||
  SYSTEM_ROLES.find((r) => r.id === DEFAULT_ROLE_ID) ||
  SYSTEM_ROLES[0];

/** শুধু রোল-আইডি — টেস্ট ও লগের জন্য। */
export function pickAutoRoleId(promptText: string): AutoRoleId {
  const text = (promptText || '').trim();
  if (!text) return 'supreme-general';

  const hasCodeTerms = CODE_TERMS.test(text);
  const isBuild = BUILD.test(text);

  // Creative writing wins unless the user is clearly asking for software
  if (WRITER.test(text) && !hasCodeTerms && !isBuild) return 'supreme-writer';
  if (SECURITY.test(text)) return 'supreme-security';
  if (ARCHITECT.test(text)) return 'supreme-architect';
  if (isBuild) return 'supreme-fullstack';
  if (QUICK_FIX.test(text) || text.includes('```')) return 'supreme-fast-dev';
  if (hasCodeTerms) return 'supreme-fullstack';
  return 'supreme-general';
}

export function pickAutoRole(promptText: string): RolePersona {
  return roleById(pickAutoRoleId(promptText));
}
