import type { Express, Request, Response } from 'express';

export interface KnowledgeDocRecord {
  id: string;
  title: string;
  type: string;
  sizeBytes: number;
  tokenCount: number;
  chunkCount: number;
  status: string;
  lastIndexed: string;
  isGroundingActive: boolean;
  contentPreview: string;
}

export interface KnowledgeRoutesContext {
  isProduction: boolean;
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
}

const DEV_INITIAL_KNOWLEDGE_DOCS: KnowledgeDocRecord[] = [
  {
    id: 'doc_arch_01',
    title: 'SupremeAI Core Architecture Spec v2.4.md',
    type: 'markdown',
    sizeBytes: 142000,
    tokenCount: 28400,
    chunkCount: 32,
    status: 'indexed',
    lastIndexed: '2 hours ago',
    isGroundingActive: true,
    contentPreview:
      'Architecture specification for multi-agent swarm orchestration and real-time LLM router...',
  },
  {
    id: 'doc_mcp_02',
    title: 'Model Context Protocol Engineering Spec.pdf',
    type: 'pdf',
    sizeBytes: 310000,
    tokenCount: 62000,
    chunkCount: 68,
    status: 'indexed',
    lastIndexed: 'Yesterday',
    isGroundingActive: true,
    contentPreview:
      'MCP specification compliance guidelines: JSON-RPC stdio and SSE transport protocols...',
  },
  {
    id: 'doc_code_03',
    title: 'Supremeai-bd/supremeai Service Handlers.ts',
    type: 'code',
    sizeBytes: 88400,
    tokenCount: 19800,
    chunkCount: 24,
    status: 'indexed',
    lastIndexed: '3 days ago',
    isGroundingActive: false,
    contentPreview:
      'TypeScript microservice definitions for auth-token-prober, sse-stream-broker...',
  },
  {
    id: 'doc_audit_04',
    title: 'Security Hardening & RBAC Rules.md',
    type: 'markdown',
    sizeBytes: 54000,
    tokenCount: 11200,
    chunkCount: 14,
    status: 'indexed',
    lastIndexed: '4 days ago',
    isGroundingActive: true,
    contentPreview:
      'Zero-trust principle enforcement, fail-closed auth guards, sanitization policies...',
  },
];

export function registerKnowledgeRoutes(app: Express, ctx: KnowledgeRoutesContext): void {
  let devKnowledgeDocs: KnowledgeDocRecord[] = ctx.isProduction
    ? []
    : DEV_INITIAL_KNOWLEDGE_DOCS.map((doc) => ({ ...doc }));
  const devKnowledgeOwner = new Map<string, string>();

  app.get(
    ['/api/user/knowledge', '/api/v1/user/knowledge'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      res.json({
        documents: devKnowledgeDocs.filter((d) => (devKnowledgeOwner.get(d.id) || '') === owner),
      });
    }
  );

  app.post(
    ['/api/user/knowledge', '/api/v1/user/knowledge'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const payload = (req.body || {}) as Partial<KnowledgeDocRecord>;
      const newDoc: KnowledgeDocRecord = {
        id: `doc_${Date.now()}`,
        title: String(payload.title || 'Untitled Document').slice(0, 200),
        type: String(payload.type || 'markdown').slice(0, 40),
        sizeBytes: Number(payload.sizeBytes) || 1024,
        tokenCount: Number(payload.tokenCount) || 250,
        chunkCount: Number(payload.chunkCount) || 1,
        status: String(payload.status || 'indexed').slice(0, 40),
        lastIndexed: 'Just now',
        isGroundingActive: payload.isGroundingActive ?? true,
        contentPreview: String(
          payload.contentPreview || payload.title || 'New document content'
        ).slice(0, 1000),
      };
      devKnowledgeDocs.unshift(newDoc);
      devKnowledgeOwner.set(newDoc.id, owner);
      res.json({
        success: true,
        document: newDoc,
        documents: devKnowledgeDocs.filter((d) => (devKnowledgeOwner.get(d.id) || '') === owner),
      });
    }
  );

  app.patch(
    ['/api/user/knowledge/:id', '/api/v1/user/knowledge/:id'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const { id } = req.params;
      const doc = devKnowledgeDocs.find((d) => d.id === id);
      if (!doc || (devKnowledgeOwner.get(id) || '') !== owner) {
        res.status(404).json({ error: 'Knowledge document not found' });
        return;
      }
      const body = (req.body || {}) as Partial<KnowledgeDocRecord>;
      if (body.isGroundingActive !== undefined) {
        doc.isGroundingActive = Boolean(body.isGroundingActive);
      }
      if (typeof body.title === 'string' && body.title.trim()) {
        doc.title = body.title.trim().slice(0, 200);
      }
      doc.lastIndexed = 'Just now';
      res.json({ success: true, document: doc });
    }
  );

  app.delete(
    ['/api/user/knowledge/:id', '/api/v1/user/knowledge/:id'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const { id } = req.params;
      if ((devKnowledgeOwner.get(id) || '') !== owner) {
        res.status(404).json({ error: 'Knowledge document not found' });
        return;
      }
      devKnowledgeOwner.delete(id);
      devKnowledgeDocs = devKnowledgeDocs.filter((d) => d.id !== id);
      res.json({
        success: true,
        documents: devKnowledgeDocs.filter((d) => (devKnowledgeOwner.get(d.id) || '') === owner),
      });
    }
  );
}
