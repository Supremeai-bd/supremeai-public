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
      // বাংলা মন্তব্য: সরাসরি টোকেন না থাকলে supremeai_auth_user অবজেক্টের ভেতরের টোকেন ফলব্যাক হিসেবে পড়া হচ্ছে।
      if (!token) {
        const userRaw = localStorage.getItem('supremeai_auth_user');
        if (userRaw) {
          const parsed = JSON.parse(userRaw);
          if (typeof parsed?.token === 'string' && parsed.token.trim()) {
            token = parsed.token.trim();
          }
        }
      }
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
