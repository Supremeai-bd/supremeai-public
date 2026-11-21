import type { Express, Request, Response } from 'express';
import { getPlanSpec } from '../../config/plans';
import type { PlanTier } from '../../types';

/**
 * User Team Management — `GET/POST/PATCH/DELETE /api/user/team*`
 *
 * WHY THIS FILE EXISTS
 *   Team CRUD (4 handlers + `userTeamStore`/`userTeamOwner`) lived inline
 *   in `server.ts` (~130 lines). Cohesive (single store, seat-limit via
 *   PlanSpec, owner-scoped) and has no other consumer. Moving it keeps the
 *   monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `userTeamStore` + `userTeamOwner` are OWNED here (no other route reads
 *     them; `projects` previously shared the file but not the store).
 *   - `customerDirectory` + `usersDb` are injected read-only for tier/name
 *     resolution; `resolveAuthenticatedEmail` is injected (closure over JWT).
 */

interface CustomerEntry {
  email: string;
  tier?: PlanTier;
  name?: string;
}

interface UsersDbEntry {
  email: string;
  plan?: PlanTier;
  name?: string;
  isAdminEligible?: boolean;
}

export interface TeamContext {
  customerDirectory: readonly CustomerEntry[];
  usersDb: readonly UsersDbEntry[];
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
}

export function registerTeamRoutes(app: Express, ctx: TeamContext): void {
  const userTeamOwner = new Map<string, string>();
  let userTeamStore: Array<{
    id: string;
    name: string;
    email: string;
    avatar: string;
    role: 'Owner' | 'Developer' | 'Reviewer' | 'Viewer';
    joinedDate: string;
    twoFactorEnabled: boolean;
    status: 'active' | 'invited';
  }> = [];

  app.get('/api/user/team', async (req: Request, res: Response) => {
    const email = await ctx.resolveAuthenticatedEmail(req);
    if (!email) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const customer = ctx.customerDirectory.find((c) => c.email.toLowerCase() === email);
    const matchedUser = ctx.usersDb.find((u) => u.email.toLowerCase() === email);
    const tier: PlanTier = customer?.tier || matchedUser?.plan || 'Free';
    const maxSeats = getPlanSpec(tier).maxSeats;

    let members = userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === email);
    if (members.length === 0) {
      const displayName = matchedUser?.name || customer?.name || email.split('@')[0];
      const ownerId = `member_owner_${email}`;
      userTeamStore.push({
        id: ownerId,
        name: displayName,
        email,
        avatar: displayName.charAt(0).toUpperCase(),
        role: 'Owner',
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        twoFactorEnabled: Boolean(matchedUser?.isAdminEligible),
        status: 'active',
      });
      userTeamOwner.set(ownerId, email);
      members = userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === email);
    }
    res.json({ members, maxSeats, tier });
  });

  app.post('/api/user/team', async (req: Request, res: Response) => {
    const reqEmail = await ctx.resolveAuthenticatedEmail(req);
    if (!reqEmail) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const customer = ctx.customerDirectory.find((c) => c.email.toLowerCase() === reqEmail);
    const matchedUser = ctx.usersDb.find((u) => u.email.toLowerCase() === reqEmail);
    const tier: PlanTier = customer?.tier || matchedUser?.plan || 'Pro';
    const maxSeats = getPlanSpec(tier).maxSeats;

    const orgMembers = userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === reqEmail);
    if (orgMembers.length >= maxSeats) {
      res.status(403).json({ error: `Team seat limit (${maxSeats}) reached for ${tier} tier.` });
      return;
    }

    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const role = (req.body?.role || 'Developer') as 'Developer' | 'Reviewer' | 'Viewer';
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid invite email is required.' });
      return;
    }
    if (orgMembers.some((m) => m.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'Member already exists in workspace team.' });
      return;
    }
    const namePart = email.split('@')[0];
    const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    const member = {
      id: `member_${Date.now()}`,
      name: displayName,
      email,
      avatar: displayName.charAt(0).toUpperCase(),
      role,
      joinedDate: 'Just invited',
      twoFactorEnabled: false,
      status: 'invited' as const,
    };
    userTeamStore.push(member);
    userTeamOwner.set(member.id, reqEmail);
    res.status(201).json({
      success: true,
      member,
      members: userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === reqEmail),
      maxSeats,
    });
  });

  app.patch('/api/user/team/:id', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const member = userTeamStore.find((m) => m.id === req.params.id);
    if (!member || (userTeamOwner.get(member.id) || '') !== owner) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    const role = req.body?.role;
    if (role === 'Owner' || role === 'Developer' || role === 'Reviewer' || role === 'Viewer') {
      member.role = role;
    }
    res.json({
      success: true,
      member,
      members: userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === owner),
    });
  });

  app.delete('/api/user/team/:id', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userTeamStore.find((m) => m.id === req.params.id);
    if (!target || (userTeamOwner.get(target.id) || '') !== owner) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    if (target.role === 'Owner') {
      res.status(400).json({ error: 'Cannot remove workspace owner.' });
      return;
    }
    userTeamOwner.delete(target.id);
    userTeamStore = userTeamStore.filter((m) => m.id !== req.params.id);
    res.json({
      success: true,
      members: userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === owner),
    });
  });
}
