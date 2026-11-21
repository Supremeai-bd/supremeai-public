import type { Express, Request, Response } from 'express';
import {
  buildGitHubForkUrl,
  createForkedProjectPayload,
  mapWorkflowRunToBuildStatus,
  parseGitHubRepoSlug,
} from '../../utils/projectRepoUtils';

/**
 * User Projects CRUD & Repository Health / Forking — `GET/POST/DELETE /api/v1/projects*`
 *
 * WHY THIS FILE EXISTS
 *   The projects surface (5 handlers + in-memory `userProjectsStore`) lived inline
 *   in `server.ts` (~258 lines). It is cohesive (single store, single domain,
 *   GitHub fork/status helpers) and has no other consumer. Moving it keeps the
 *   monolith shrinking with minimal ctx.
 *
 * CONTRACT WITH server.ts
 *   - `userProjectsStore` is OWNED here — no other route reads it. The `let`
 *     reassignment in DELETE is local, not via ctx getter/setter.
 *   - `customerDirectory` (for `githubHandle` in fork) and `resolveAuthenticatedEmail`
 *     are injected via ctx because they close over shared auth state inside
 *     `startServer()` and cannot be imported. Read-only customer list.
 */

interface CustomerDirectoryEntry {
  email: string;
  githubHandle?: string;
}

export interface ProjectsContext {
  customerDirectory: readonly CustomerDirectoryEntry[];
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
}

export function registerProjectsRoutes(app: Express, ctx: ProjectsContext): void {
  let userProjectsStore: Array<{
    id: string;
    name: string;
    description: string;
    repoUrl: string;
    branch: string;
    language: string;
    lastSynced: number;
    stars: number;
    aiReviewStatus: 'idle' | 'analyzing' | 'ready';
    buildStatus?: 'passing' | 'failing' | 'building' | 'unknown';
    buildUrl?: string;
    lastBuildCheckedAt?: number;
    forkedFrom?: string;
    ownerEmail?: string;
  }> = [];

  app.get('/api/v1/projects', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    res.json({ projects: userProjectsStore.filter((p) => (p.ownerEmail || '') === owner) });
  });

  app.get('/api/v1/projects/github-status', async (req: Request, res: Response) => {
    const repoUrl = String(req.query.repoUrl || '').trim();
    const branch = String(req.query.branch || 'main').trim() || 'main';
    const projectId = String(req.query.projectId || '').trim();
    const parsed = parseGitHubRepoSlug(repoUrl);
    const checkedAt = Date.now();
    if (!parsed) {
      res.json({ buildStatus: 'unknown', checkedAt });
      return;
    }

    const clientToken =
      typeof req.headers['x-github-token'] === 'string' ? req.headers['x-github-token'].trim() : '';
    const serverToken =
      process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_READONLY_TOKEN?.trim() || '';
    const token = clientToken || serverToken;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Studio-Projects',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
        {
          headers,
          signal: AbortSignal.timeout(4500),
        }
      );
      if (!ghRes.ok) {
        res.json({
          buildStatus: 'unknown',
          buildUrl: `${parsed.normalizedUrl}/actions`,
          checkedAt,
        });
        return;
      }
      const data = (await ghRes.json()) as {
        workflow_runs?: Array<{ status?: string; conclusion?: string | null; html_url?: string }>;
      };
      const latestRun = Array.isArray(data.workflow_runs) ? data.workflow_runs[0] : undefined;
      const buildStatus = mapWorkflowRunToBuildStatus(latestRun);
      const buildUrl = latestRun?.html_url || `${parsed.normalizedUrl}/actions`;

      if (projectId) {
        const owner = await ctx.resolveAuthenticatedEmail(req).catch(() => null);
        if (owner) {
          const target = userProjectsStore.find(
            (p) => p.id === projectId && (p.ownerEmail || '') === owner
          );
          if (target) {
            target.buildStatus = buildStatus;
            target.buildUrl = buildUrl;
            target.lastBuildCheckedAt = checkedAt;
          }
        }
      }

      res.json({ buildStatus, buildUrl, checkedAt });
    } catch {
      res.json({
        buildStatus: 'unknown',
        buildUrl: `${parsed.normalizedUrl}/actions`,
        checkedAt,
      });
    }
  });

  app.post('/api/v1/projects', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      res.status(400).json({ error: 'Project name is required.' });
      return;
    }
    const rawBuildStatus = String(body.buildStatus || '');
    const buildStatus: 'passing' | 'failing' | 'building' | 'unknown' =
      rawBuildStatus === 'passing' ||
      rawBuildStatus === 'failing' ||
      rawBuildStatus === 'building' ||
      rawBuildStatus === 'unknown'
        ? rawBuildStatus
        : 'unknown';
    const project = {
      id: `proj_${Date.now()}`,
      name: String(body.name).trim(),
      description: String(body.description || '').trim(),
      repoUrl: String(body.repoUrl || '').trim(),
      branch: String(body.branch || 'main').trim(),
      language: String(body.language || 'TypeScript').trim(),
      lastSynced: Date.now(),
      stars: Number(body.stars) || 0,
      aiReviewStatus: 'idle' as const,
      buildStatus,
      ...(typeof body.buildUrl === 'string' && body.buildUrl.trim()
        ? { buildUrl: body.buildUrl.trim() }
        : {}),
      ...(typeof body.forkedFrom === 'string' && body.forkedFrom.trim()
        ? { forkedFrom: body.forkedFrom.trim() }
        : {}),
      ownerEmail: owner,
    };
    userProjectsStore.unshift(project);
    res.status(201).json({ ...project, project });
  });

  app.post('/api/v1/projects/fork', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    const sourceId = String(body.sourceId || '').trim();
    const existing = sourceId
      ? userProjectsStore.find((p) => p.id === sourceId && (p.ownerEmail || '') === owner)
      : undefined;

    const requestedBuildStatus =
      body.buildStatus === 'passing' ||
      body.buildStatus === 'failing' ||
      body.buildStatus === 'building'
        ? (body.buildStatus as 'passing' | 'failing' | 'building')
        : undefined;

    const sourceProject = existing
      ? {
          ...existing,
          buildStatus:
            existing.buildStatus && existing.buildStatus !== 'unknown'
              ? existing.buildStatus
              : requestedBuildStatus || existing.buildStatus || 'passing',
          aiReviewStatus:
            existing.aiReviewStatus === 'ready'
              ? ('reviewed' as const)
              : existing.aiReviewStatus === 'analyzing'
                ? ('pending' as const)
                : ('idle' as const),
        }
      : {
          id: sourceId || `proj_${Date.now()}`,
          name: String(body.name || 'repository').trim(),
          description: String(body.description || 'Connected GitHub repository').trim(),
          repoUrl: String(body.repoUrl || '').trim(),
          branch: String(body.branch || 'main').trim() || 'main',
          language: String(body.language || 'TypeScript').trim() || 'TypeScript',
          lastSynced: Date.now(),
          stars: 0,
          aiReviewStatus: 'idle' as const,
          buildStatus: requestedBuildStatus || ('passing' as const),
        };

    const parsed = parseGitHubRepoSlug(sourceProject.repoUrl);
    const githubForkUrl = buildGitHubForkUrl(sourceProject.repoUrl);
    const clientToken =
      typeof req.headers['x-github-token'] === 'string' ? req.headers['x-github-token'].trim() : '';
    const token = clientToken || process.env.GITHUB_TOKEN?.trim() || '';

    let remoteForked = false;
    let remoteForkHtmlUrl = '';
    let remoteForkName = '';
    let remoteForkBranch = sourceProject.branch;

    if (parsed && token) {
      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/forks`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
              'User-Agent': 'SupremeAI-Studio-Projects',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ default_branch_only: false }),
            signal: AbortSignal.timeout(6000),
          }
        );
        if (ghRes.ok) {
          const forkData = (await ghRes.json()) as {
            html_url?: string;
            name?: string;
            default_branch?: string;
          };
          if (forkData.html_url) {
            remoteForked = true;
            remoteForkHtmlUrl = forkData.html_url;
            remoteForkName = forkData.name || `${sourceProject.name}-fork`;
            remoteForkBranch = forkData.default_branch || sourceProject.branch;
          }
        }
      } catch {
        remoteForked = false;
      }
    }

    const customerRec = ctx.customerDirectory.find(
      (c) => c.email.toLowerCase() === owner.toLowerCase()
    );
    const forkPayload = createForkedProjectPayload(sourceProject, customerRec?.githubHandle);

    const forkedProject = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: remoteForked && remoteForkName ? remoteForkName : forkPayload.name,
      description: forkPayload.description,
      repoUrl: remoteForked && remoteForkHtmlUrl ? remoteForkHtmlUrl : forkPayload.repoUrl,
      branch: remoteForked ? remoteForkBranch : forkPayload.branch,
      language: forkPayload.language,
      lastSynced: Date.now(),
      stars: 0,
      aiReviewStatus: 'idle' as const,
      buildStatus: remoteForked ? ('building' as const) : forkPayload.buildStatus,
      ...(forkPayload.buildUrl ? { buildUrl: forkPayload.buildUrl } : {}),
      forkedFrom: forkPayload.forkedFrom,
      ownerEmail: owner,
    };

    userProjectsStore.unshift(forkedProject);
    res.status(201).json({
      project: forkedProject,
      remoteForked,
      githubForkUrl,
    });
  });

  app.delete('/api/v1/projects/:id', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userProjectsStore.find((p) => p.id === req.params.id);
    if (!target || (target.ownerEmail || '') !== owner) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    userProjectsStore = userProjectsStore.filter((p) => p.id !== req.params.id);
    res.json({
      success: true,
      projects: userProjectsStore.filter((p) => (p.ownerEmail || '') === owner),
    });
  });
}
