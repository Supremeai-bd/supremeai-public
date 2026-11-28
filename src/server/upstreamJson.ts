/**
 * Narrowing helpers for untyped JSON returned by the upstream gateway (`/api/v1/auth/*`).
 *
 * The gateway's payloads are not versioned, so route handlers read them as
 * `Record<string, unknown>` and narrow each field where it is used instead of trusting `any`.
 * Shared by `routes/auth.ts` and `routes/authTotp.ts`.
 */

/** Untyped JSON object from the upstream gateway. */
export type UpstreamJson = Record<string, unknown>;

/** Returns the value as an {@link UpstreamJson} object, or null for non-objects. */
export function asUpstreamJson(value: unknown): UpstreamJson | null {
  return value && typeof value === 'object' ? (value as UpstreamJson) : null;
}

/** A non-empty string, or undefined for anything else (numbers, objects, ''). */
export function upstreamString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The string items of an array; non-arrays become []. */
export function upstreamStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Merges a nested `user` object over the top-level payload (`{ ...data, ...data.user }`). */
export function mergeUpstreamUser(data: UpstreamJson): UpstreamJson {
  const nestedUser = asUpstreamJson(data.user);
  return nestedUser ? { ...data, ...nestedUser } : data;
}

/** First RBAC role hint across the gateway's camelCase / snake_case / legacy aliases. */
export function upstreamRbacRole(raw: UpstreamJson): string | undefined {
  return upstreamString(raw.rbacRole) || upstreamString(raw.rbac_role) || upstreamString(raw.role);
}
