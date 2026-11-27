/**
 * বাংলা মন্তব্য: ফ্রন্টএন্ডে অ্যাডমিন চেনার একমাত্র জায়গা (SSOT)।
 *
 * আগে তিনটি ফাইলে ব্যক্তিগত ইমেইল হার্ডকোড করা ছিল (পাবলিক রিপোতে ফাঁস + ড্রিফট)।
 * এখন সত্যের উৎস সার্ভার: লগইন/`/me` রেসপন্সের `role` / `isAdminEligible`
 * (ব্যাকএন্ড নিজের `ADMIN_EMAILS` env থেকে ঠিক করে)। বিল্ড-টাইম
 * `VITE_ADMIN_EMAIL` / `VITE_ADMIN_EMAILS` থাকলে সেটা শুধু অতিরিক্ত UI-হিন্ট।
 * এটা কেবল UI দেখানো/লুকানোর জন্য — আসল অনুমতি সবসময় সার্ভার যাচাই করে।
 */

type EnvLike = Record<string, unknown> | undefined;

function readEnv(): EnvLike {
  try {
    return (import.meta as unknown as { env?: Record<string, unknown> }).env;
  } catch {
    return undefined;
  }
}

/** Build-time admin emails (lower-cased, de-duplicated). Empty when not configured. */
export function readConfiguredAdminEmails(env: EnvLike = readEnv()): string[] {
  const single = typeof env?.VITE_ADMIN_EMAIL === 'string' ? env.VITE_ADMIN_EMAIL : '';
  const many = typeof env?.VITE_ADMIN_EMAILS === 'string' ? env.VITE_ADMIN_EMAILS : '';
  const all = [single, ...many.split(',')].map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(all));
}

export function isAuthorizedAdminEmail(email?: string | null, env: EnvLike = readEnv()): boolean {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  if (!clean) return false;
  return readConfiguredAdminEmails(env).includes(clean);
}

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'owner']);

export interface AdminUserLike {
  email?: unknown;
  role?: unknown;
  rbacRole?: unknown;
  isAdminEligible?: unknown;
}

/** Server-provided role flags first, configured email list as a fallback hint. */
export function isAdminUserLike(user: AdminUserLike | null | undefined, env?: EnvLike): boolean {
  if (!user || typeof user !== 'object') return false;
  if (user.isAdminEligible === true) return true;
  const role = String(user.role ?? '').toLowerCase();
  const rbac = String(user.rbacRole ?? '').toLowerCase();
  if (ADMIN_ROLES.has(role) || ADMIN_ROLES.has(rbac)) return true;
  const email = typeof user.email === 'string' ? user.email : '';
  return env === undefined ? isAuthorizedAdminEmail(email) : isAuthorizedAdminEmail(email, env);
}

/** Reads the persisted `supremeai_auth_user` JSON and reports whether it is an admin. */
export function storedAuthUserIsAdmin(raw: string | null | undefined, env?: EnvLike): boolean {
  if (!raw) return false;
  try {
    return isAdminUserLike(JSON.parse(raw) as AdminUserLike, env);
  } catch {
    return false;
  }
}
