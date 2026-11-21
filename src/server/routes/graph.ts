import type { Express, Request, Response } from 'express';
import { getLiveMcpTowerServices } from '../mcpHealthCollector';

/**
 * Live Architecture & Knowledge Topology Graph — `GET /api/v1/graph/*`
 *
 * WHY THIS FILE EXISTS
 *   The topology graph (2 routes + `buildStudioTopologyGraph` helper) lived
 *   inline in `server.ts` (~160 lines). It is cohesive (single builder + 2
 *   GET handlers) and has no other consumer. Moving it keeps the monolith
 *   shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `buildStudioTopologyGraph` is OWNED here (no other route uses it).
 *   - `mcpClusterServices` (fallback static dataset) is injected read-only
 *     via ctx getter (it is a `const` array defined in server.ts scope).
 *   - `getLiveMcpTowerServices` is imported directly (pure async helper).
 */

export interface GraphContext {
  readonly mcpClusterServices: ReadonlyArray<{
    id: string;
    displayName: string;
    status: string;
    port: number;
    latencyMs: number;
    cpuPercent: number;
  }>;
}

export function registerGraphRoutes(app: Express, ctx: GraphContext): void {
  const buildStudioTopologyGraph = async () => {
    const liveServices = await getLiveMcpTowerServices(false).catch(() => ctx.mcpClusterServices);
    const baseNodes = [
      {
        id: 'studio-ui',
        data: {
          label: 'React 19 Studio UI',
          category: 'Frontend',
          description: 'Vite + Tailwind v4 conversational cockpit & 3D voice interface',
        },
      },
      {
        id: 'express-gateway',
        data: {
          label: 'Express API Gateway',
          category: 'Gateway',
          description:
            'Primary Node.js/TypeScript backend on port 3000 handling SSE & proxy routes',
        },
      },
      {
        id: 'route-arbiter',
        data: {
          label: 'Dynamic Route Arbiter',
          category: 'AI Engine',
          description: 'Multi-provider LLM router with latency scoring & cooldown failover',
        },
      },
      {
        id: 'knowledge-rag',
        data: {
          label: 'Knowledge & RAG',
          category: 'Data',
          description: 'In-memory semantic chunk index for grounded document Q&A',
        },
      },
      {
        id: 'workspace-sandbox',
        data: {
          label: 'Ephemeral Sandbox',
          category: 'Workspace',
          description: 'Strict sandbox="allow-scripts" iframe VM for JS/TS/TSX/HTML',
        },
      },
      {
        id: 'workspace-browser',
        data: {
          label: 'Virtual Browser Proxy',
          category: 'Workspace',
          description: 'Server HTTP proxy with link interception & live CSS DOM inspector',
        },
      },
      {
        id: 'workspace-terminal',
        data: {
          label: 'XTerm Studio Shell',
          category: 'Workspace',
          description: 'Allowlisted diagnostic shell with Agent Swarm SSE telemetry stream',
        },
      },
      {
        id: 'voice-avatar',
        data: {
          label: '3D Hologram Voice',
          category: 'Multimodal',
          description: 'Three.js lip-sync avatar with bilingual EN/BN TTS & pitch control',
        },
      },
    ];

    const serviceNodes = (liveServices as typeof ctx.mcpClusterServices).slice(0, 6).map((svc) => ({
      id: `svc-${svc.id}`,
      data: {
        label: svc.displayName,
        category: svc.status === 'healthy' ? 'Service (Healthy)' : `Service (${svc.status})`,
        description: `Port ${svc.port} · Latency ${svc.latencyMs}ms · CPU ${svc.cpuPercent}%`,
      },
    }));

    const baseEdges = [
      { id: 'ge-1', source: 'studio-ui', target: 'express-gateway', label: 'SSE_STREAM' },
      { id: 'ge-2', source: 'studio-ui', target: 'workspace-sandbox', label: 'EXECUTES_VM' },
      { id: 'ge-3', source: 'studio-ui', target: 'voice-avatar', label: 'SYNCS_AUDIO' },
      { id: 'ge-4', source: 'express-gateway', target: 'route-arbiter', label: 'ROUTES_LLM' },
      { id: 'ge-5', source: 'express-gateway', target: 'knowledge-rag', label: 'GROUNDS_RAG' },
      { id: 'ge-6', source: 'express-gateway', target: 'workspace-browser', label: 'PROXIES_HTTP' },
      {
        id: 'ge-7',
        source: 'express-gateway',
        target: 'workspace-terminal',
        label: 'SHELL_BRIDGE',
      },
    ];

    const serviceEdges = serviceNodes.map((sn, idx) => ({
      id: `ge-svc-${idx}`,
      source: 'express-gateway',
      target: sn.id,
      label: 'HEALTH_PROBE',
    }));

    return {
      nodes: [...baseNodes, ...serviceNodes],
      edges: [...baseEdges, ...serviceEdges],
    };
  };

  app.get('/api/v1/graph/skills', async (_req: Request, res: Response) => {
    try {
      const graph = await buildStudioTopologyGraph();
      res.json(graph);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build graph' });
    }
  });

  app.get('/api/v1/graph/path', async (req: Request, res: Response) => {
    const startSkill = String(req.query.start_skill || '').trim();
    const endSkill = String(req.query.end_skill || '').trim();
    if (!startSkill || !endSkill) {
      res.status(400).json({ error: 'start_skill and end_skill are required', path: [] });
      return;
    }

    const graph = await buildStudioTopologyGraph();
    if (startSkill === endSkill) {
      res.json({ path: [startSkill] });
      return;
    }

    const adj = new Map<string, string[]>();
    for (const n of graph.nodes) adj.set(n.id, []);
    for (const e of graph.edges) {
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }

    const queue: string[][] = [[startSkill]];
    const visited = new Set<string>([startSkill]);
    let foundPath: string[] = [];

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      const tail = currentPath[currentPath.length - 1];
      if (tail === endSkill) {
        foundPath = currentPath;
        break;
      }
      for (const neighbor of adj.get(tail) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...currentPath, neighbor]);
        }
      }
    }

    res.json({ path: foundPath });
  });
}
