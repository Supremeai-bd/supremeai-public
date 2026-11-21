import { authService } from '../services/authService';

/**
 * Builds authenticated headers for `/api/workspace/*` calls in both Express
 * and Cloudflare Pages Edge environments without throwing in Node test runners.
 */
export function getWorkspaceAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  let token: string | null = null;
  if (typeof localStorage !== 'undefined') {
    try {
      token = localStorage.getItem('supremeai_access_token');
    } catch {
      token = null;
    }
  }
  if (!token) {
    token = authService.getCachedGuestToken();
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-SupremeAI-Key'] = token;
  }
  return headers;
}
