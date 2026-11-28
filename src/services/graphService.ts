import { apiClient } from './apiClient';
import { env } from '../config/env';

export interface GraphNode {
  id: string;
  data: {
    label: string;
    category?: string;
    description?: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphPositionMap = Record<string, { x: number; y: number }>;

export interface StoredCustomGraph {
  graph: GraphData;
  positions: GraphPositionMap;
}

export interface PathResponse {
  path: string[];
}

export const CUSTOM_GRAPH_STORAGE_KEY = 'supremeai_custom_graph_v1';

const STUDIO_FALLBACK_GRAPH: GraphData = {
  nodes: [
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
        description: 'Primary Node.js/TypeScript backend on port 3000 handling SSE & proxy routes',
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
  ],
  edges: [
    { id: 'ge-1', source: 'studio-ui', target: 'express-gateway', label: 'SSE_STREAM' },
    { id: 'ge-2', source: 'studio-ui', target: 'workspace-sandbox', label: 'EXECUTES_VM' },
    { id: 'ge-3', source: 'studio-ui', target: 'voice-avatar', label: 'SYNCS_AUDIO' },
    { id: 'ge-4', source: 'express-gateway', target: 'route-arbiter', label: 'ROUTES_LLM' },
    { id: 'ge-5', source: 'express-gateway', target: 'knowledge-rag', label: 'GROUNDS_RAG' },
    { id: 'ge-6', source: 'express-gateway', target: 'workspace-browser', label: 'PROXIES_HTTP' },
    { id: 'ge-7', source: 'express-gateway', target: 'workspace-terminal', label: 'SHELL_BRIDGE' },
  ],
};

export function loadCustomGraph(): StoredCustomGraph {
  if (typeof localStorage === 'undefined') {
    return { graph: { nodes: [], edges: [] }, positions: {} };
  }
  try {
    const raw = localStorage.getItem(CUSTOM_GRAPH_STORAGE_KEY);
    if (!raw) return { graph: { nodes: [], edges: [] }, positions: {} };
    const parsed = JSON.parse(raw) as Partial<StoredCustomGraph>;
    const nodes = Array.isArray(parsed?.graph?.nodes) ? parsed.graph!.nodes : [];
    const edges = Array.isArray(parsed?.graph?.edges) ? parsed.graph!.edges : [];
    const positions =
      parsed?.positions && typeof parsed.positions === 'object' ? parsed.positions : {};
    return { graph: { nodes, edges }, positions };
  } catch {
    return { graph: { nodes: [], edges: [] }, positions: {} };
  }
}

export function saveCustomGraph(graph: GraphData, positions: GraphPositionMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_GRAPH_STORAGE_KEY, JSON.stringify({ graph, positions }));
  } catch {
    // Ignore storage quota errors
  }
}

function parseMermaidToken(rawToken: string): { id: string; label: string } {
  const token = rawToken.trim();
  const match = token.match(
    /^([A-Za-z0-9_.-]+)\s*(?:\[\[([\s\S]+?)\]\]|\(\(([\s\S]+?)\)\)|\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?$/
  );
  if (!match) {
    const fallbackId = token.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32) || 'node';
    return { id: fallbackId, label: token };
  }
  const id = match[1];
  const rawLabel = (match[2] || match[3] || match[4] || match[5] || match[6] || id).trim();
  const label = rawLabel.replace(/^["']|["']$/g, '');
  return { id, label };
}

export function parseMermaidFlowchartToGraph(source: string): GraphData {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const ensureNode = (token: string) => {
    const { id, label } = parseMermaidToken(token);
    if (!id) return null;
    const existing = nodeMap.get(id);
    if (!existing) {
      nodeMap.set(id, {
        id,
        data: { label, category: 'Mermaid' },
      });
    } else if (label !== id && existing.data.label === id) {
      existing.data.label = label;
    }
    return id;
  };

  // Normalize semicolon-separated statements cleanly into lines
  const lines = source
    .replace(/;/g, '\n')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const arrowPattern = /^(.*?)\s*(?:--+>|==+>|-\.+->|---+)\s*(?:\|([^|]+)\|\s*)?(.*)$/;

  for (const line of lines) {
    if (
      /^(?:%%|graph\b|flowchart\b|subgraph\b|end\b|style\b|classDef\b|class\b|linkStyle\b|direction\b)/i.test(
        line
      )
    ) {
      continue;
    }

    // Handle chained or simple edge expressions like: A[Client] -->|HTTP| B[Gateway] --> C[LLM]
    let remaining = line;
    let matchedAnyEdge = false;
    while (remaining) {
      const m = remaining.match(arrowPattern);
      if (!m) break;
      matchedAnyEdge = true;
      const lhsToken = m[1].trim();
      const edgeLabel = m[2]?.trim();
      const rhsRest = m[3].trim();

      // Check if rhsRest contains another arrow further right
      const nextArrowMatch = rhsRest.match(/^(.*?)\s+((?:--+>|==+>|-\.+->|---+)\s*.*)$/);
      const rhsToken = nextArrowMatch ? nextArrowMatch[1].trim() : rhsRest;

      const sourceId = ensureNode(lhsToken);
      const targetId = ensureNode(rhsToken);

      if (sourceId && targetId) {
        const edgeKey = `${sourceId}->${targetId}:${edgeLabel || ''}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          edges.push({
            id: `me-${edges.length + 1}`,
            source: sourceId,
            target: targetId,
            ...(edgeLabel ? { label: edgeLabel } : {}),
          });
        }
      }

      if (nextArrowMatch) {
        remaining = `${rhsToken} ${nextArrowMatch[2]}`;
      } else {
        remaining = '';
      }
    }

    // Standalone node declaration like: A[Single Node]
    if (!matchedAnyEdge && /^[A-Za-z0-9_.-]+\s*[[({]/.test(line)) {
      ensureNode(line);
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}

export function computeShortestPathBFS(graph: GraphData, startId: string, endId: string): string[] {
  if (!startId || !endId) return [];
  if (startId === endId) return [startId];

  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adj.get(edge.source)?.push(edge.target);
    adj.get(edge.target)?.push(edge.source);
  }

  if (!adj.has(startId) || !adj.has(endId)) return [];

  const queue: string[][] = [[startId]];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const tail = current[current.length - 1];
    if (tail === endId) {
      return current;
    }
    for (const neighbor of adj.get(tail) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...current, neighbor]);
      }
    }
  }

  return [];
}

export const graphService = {
  async getSkillGraph(): Promise<GraphData> {
    if (env.isMockEnabled) {
      return STUDIO_FALLBACK_GRAPH;
    }
    try {
      const res = await apiClient.get<GraphData>('/api/v1/graph/skills');
      if (res && Array.isArray(res.nodes) && res.nodes.length > 0) {
        return res;
      }
      return STUDIO_FALLBACK_GRAPH;
    } catch {
      return STUDIO_FALLBACK_GRAPH;
    }
  },

  async getLearningPath(
    startSkill: string,
    endSkill: string,
    graphSnapshot?: GraphData
  ): Promise<string[]> {
    const localGraph =
      graphSnapshot && graphSnapshot.nodes.length > 0 ? graphSnapshot : STUDIO_FALLBACK_GRAPH;
    if (env.isMockEnabled) {
      return computeShortestPathBFS(localGraph, startSkill, endSkill);
    }
    try {
      const res = await apiClient.get<PathResponse>(
        `/api/v1/graph/path?start_skill=${encodeURIComponent(startSkill)}&end_skill=${encodeURIComponent(endSkill)}`
      );
      if (res && Array.isArray(res.path) && res.path.length > 0) {
        return res.path;
      }
      return computeShortestPathBFS(localGraph, startSkill, endSkill);
    } catch {
      return computeShortestPathBFS(localGraph, startSkill, endSkill);
    }
  },
};
