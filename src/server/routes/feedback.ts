import type { Express, Request, Response } from 'express';

/**
 * Product Feedback — `GET /api/feedback` + `POST /api/feedback`
 *
 * WHY THIS FILE EXISTS
 *   Feedback micro-survey (store + 2 handlers) lived inline in `server.ts` (~50
 *   lines). Cohesive (single store, single audit side-effect) and has no other
 *   consumer. Moving it keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `feedbackSubmissions` store and both handlers are OWNED here (no other
 *     route reads feedback).
 *   - `verifyAdminAuthorization` (admin-only GET) + `resolveAuthenticatedEmail`
 *     (caller identity for POST) + `recordAudit` injected via ctx.
 */

export interface FeedbackContext {
  verifyAdminAuthorization: (req: Request) => Promise<{ ok: boolean; status?: number; error?: string }>;
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
  recordAudit: (actor: string, action: string, resource: string, details: string, req: Request) => void;
}

export function registerFeedbackRoutes(app: Express, ctx: FeedbackContext): void {
  const feedbackSubmissions: Array<{
    id: string;
    rating: 'great' | 'good' | 'okay' | 'needs_work';
    suggestion: string;
    userEmail: string;
    developerMode: boolean;
    createdAt: string;
  }> = [];

  app.get('/api/feedback', async (req: Request, res: Response) => {
    const adminAuth = await ctx.verifyAdminAuthorization(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status || 401).json({ error: adminAuth.error });
      return;
    }
    res.json({ feedback: feedbackSubmissions });
  });

  app.post('/api/feedback', async (req: Request, res: Response) => {
    const callerEmail = await ctx.resolveAuthenticatedEmail(req);
    const body = req.body || {};
    const validRatings = new Set(['great', 'good', 'okay', 'needs_work']);
    const rating = validRatings.has(body.rating) ? body.rating : 'good';
    const entry = {
      id: `fb_${Date.now()}`,
      rating: rating as 'great' | 'good' | 'okay' | 'needs_work',
      suggestion: String(body.suggestion || '')
        .trim()
        .slice(0, 1000),
      userEmail: callerEmail || String(body.userEmail || 'anonymous@user.local').trim(),
      developerMode: Boolean(body.developerMode),
      createdAt: new Date().toISOString(),
    };
    feedbackSubmissions.unshift(entry);
    ctx.recordAudit(
      entry.userEmail,
      'PRODUCT_FEEDBACK',
      `Survey (${rating})`,
      entry.suggestion || 'Quick pulse rating submitted',
      req
    );
    res.json({ success: true, entry });
  });
}
