import type { Express, Request, Response } from 'express';
import { loadRedisJson, saveRedisJson } from '../../redisStore';

const REDIS_QUEUE_KEY = 'supremeai:swarm:queue_jobs';

/**
 * Admin Swarm & Queue — in-memory simulation of BullMQ/Redis workers
 *
 * WHY THIS FILE EXISTS
 *   Swarm workers and queue jobs were defined as `const`/`let` immediately
 *   before 6 route handlers inside server.ts. They are exclusive to the
 *   admin surface (no other route reads devSwarmWorkers/devQueueJobs except
 *   for the overview which aggregates them — overview stays in server.ts and
 *   reads via ctx if needed). Owning the stores here removes ~300 lines from
 *   the monolith and makes the simulation replaceable with a real broker.
 *
 * CONTRACT WITH server.ts
 *   The stores are owned here; server.ts no longer defines them. The DLQ
 *   flush endpoint (originally between audit and swarm) is intentionally
 *   moved here — it mutates devQueueJobs, so colocating it avoids a cross-
 *   file dependency. Audit helpers are passed via ctx. Registration order
 *   is preserved — server.ts calls this where the inline swarm/queue block
 *   began, which is semantically identical because all these paths are
 *   distinct from the surrounding non-admin routes (knowledge/api-keys).
 */

interface SwarmWorker {
  id: string;
  name: string;
  type: string;
  status: string;
  currentTask: string;
  currentIssueOrPr: string;
  processedCount: number;
  successRate: number;
  cpuPercent: number;
  memoryMb: number;
  uptime: string;
  logs: string[];
}

interface QueueJob {
  id: string;
  queueName: string;
  taskType: string;
  payloadSummary: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  latencyMs: number;
  createdAt: string;
  errorDetails?: string;
}

export interface AdminSwarmQueueContext {
  devSwarmWorkers: SwarmWorker[];
  getRealGatewayTrafficSummary: () => { rpm: number; avgLatencyMs: number };
  resolveAuditActor: (req?: Request, explicitActor?: unknown) => string;
  recordAudit: (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request,
  ) => unknown;
}

export function registerAdminSwarmQueueRoutes(app: Express, ctx: AdminSwarmQueueContext): void {
  const devSwarmWorkers = ctx.devSwarmWorkers;

  app.get('/api/agent-swarm/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(
      `data: ${JSON.stringify({ type: 'swarm_connected', timestamp: Date.now(), status: 'active' })}\n\n`
    );

    const interval = setInterval(() => {
      const traffic = ctx.getRealGatewayTrafficSummary();
      const activeWorkersCount = devSwarmWorkers.filter((w) => w.status === 'active').length;
      const swarmHeartbeat = {
        type: 'swarm_pulse',
        timestamp: Date.now(),
        activeWorkers: activeWorkersCount,
        throughputRps: traffic.rpm,
        logEvent: {
          id: `log-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          source: 'autonomous-swarm-orchestrator',
          level: 'INFO',
          message: `Swarm heartbeat verified (${activeWorkersCount} active daemons · gateway ${traffic.rpm} RPM · avg ${traffic.avgLatencyMs}ms).`,
        },
      };
      res.write(`data: ${JSON.stringify(swarmHeartbeat)}\n\n`);
    }, 5000);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  let devQueueJobs: QueueJob[] = [
    {
      id: 'job_q_101',
      queueName: 'ai-reasoning',
      taskType: 'multi_turn_stream_inference',
      payloadSummary: 'Prompt inference on supreme-core for customer demo@supremeai.bd',
      status: 'active',
      attempts: 1,
      maxAttempts: 3,
      latencyMs: 38,
      createdAt: 'Just now',
    },
    {
      id: 'job_q_102',
      queueName: 'github-sync',
      taskType: 'repo_ast_index',
      payloadSummary: 'AST re-index for Supremeai-bd/supremeai-studio on commit d4e28f',
      status: 'active',
      attempts: 1,
      maxAttempts: 3,
      latencyMs: 120,
      createdAt: '1m ago',
    },
    {
      id: 'job_q_103',
      queueName: 'vector-embedding',
      taskType: 'chunk_embedding_upsert',
      payloadSummary: 'Vectorize 32 chunks from SupremeAI Core Architecture Spec.md',
      status: 'completed',
      attempts: 1,
      maxAttempts: 3,
      latencyMs: 840,
      createdAt: '3m ago',
    },
    {
      id: 'job_q_104',
      queueName: 'code-audit',
      taskType: 'security_fuzz_batch',
      payloadSummary: 'Automated security rule scan across gateway endpoints',
      status: 'completed',
      attempts: 1,
      maxAttempts: 3,
      latencyMs: 1420,
      createdAt: '5m ago',
    },
    {
      id: 'job_q_105',
      queueName: 'github-sync',
      taskType: 'webhook_event_dispatch',
      payloadSummary: 'Sync PR commit status to webhook endpoint hooks.slack.com',
      status: 'failed',
      attempts: 3,
      maxAttempts: 3,
      latencyMs: 5000,
      createdAt: '10m ago',
      errorDetails: 'Gateway timeout: upstream webhook target unreachable after 5000ms',
    },
    {
      id: 'job_q_106',
      queueName: 'ai-reasoning',
      taskType: 'high_demand_fallback',
      payloadSummary: 'Multi-agent debate consensus validation for critical task #31',
      status: 'dlq',
      attempts: 3,
      maxAttempts: 3,
      latencyMs: 15200,
      createdAt: '15m ago',
      errorDetails: 'Rate limit exhausted on fallback tier; moved to DLQ for admin inspection',
    },
  ];

  void loadRedisJson<QueueJob[]>(REDIS_QUEUE_KEY)
    .then((persisted) => {
      if (Array.isArray(persisted) && persisted.length > 0) {
        devQueueJobs = persisted;
      }
    })
    .catch(() => {});

  const syncQueueToRedis = () => {
    void saveRedisJson(REDIS_QUEUE_KEY, devQueueJobs, 86_400 * 7).catch(() => {});
  };

  // Dead-Letter Queue flush — moved here from the security block so it
  // shares ownership of devQueueJobs without a cross-module dependency.
  app.post('/api/admin/queue/flush-dlq', (req: Request, res: Response) => {
    devQueueJobs = devQueueJobs.map((job) =>
      job.status === 'dlq' ? { ...job, status: 'active', attempts: 1 } : job,
    );
    syncQueueToRedis();
    ctx.recordAudit(
      ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
      'DLQ_FLUSH',
      'BullMQ / Dead-Letter Queue',
      'Reprocessed all dead-letter jobs back into active queue',
      req,
    );
    res.json({ success: true, jobs: devQueueJobs });
  });

  app.get('/api/admin/swarm', (_req: Request, res: Response) => {
    const brokerConfigured = Boolean(process.env.REDIS_URL?.trim());
    res.json({
      workers: devSwarmWorkers,
      simulated: !brokerConfigured,
      brokerConfigured,
      note: brokerConfigured
        ? 'Redis state persistence active.'
        : 'In-memory mode: set REDIS_URL for durable cross-restart queue persistence.',
    });
  });

  app.post('/api/admin/swarm/:id/toggle', (req: Request, res: Response) => {
    const worker = devSwarmWorkers.find((w) => w.id === req.params.id);
    if (worker) {
      worker.status = worker.status === 'active' ? 'paused' : 'active';
      res.json({ success: true, worker });
      return;
    }
    res.status(404).json({ error: 'Worker not found' });
  });

  app.post('/api/admin/swarm/:id/scale', (req: Request, res: Response) => {
    const worker = devSwarmWorkers.find((w) => w.id === req.params.id);
    const delta = Number((req.body as Record<string, unknown>)?.delta) || 1;
    if (worker) {
      worker.cpuPercent = Math.max(1, Math.min(95, Math.round(worker.cpuPercent + delta * 4)));
      res.json({ success: true, worker });
      return;
    }
    res.status(404).json({ error: 'Worker not found' });
  });

  app.get('/api/admin/queue', (_req: Request, res: Response) => {
    const brokerConfigured = Boolean(process.env.REDIS_URL?.trim());
    res.json({
      jobs: devQueueJobs,
      simulated: !brokerConfigured,
      brokerConfigured,
      note: brokerConfigured
        ? 'Redis state persistence active.'
        : 'In-memory mode: set REDIS_URL for durable queue persistence.',
    });
  });

  app.post('/api/admin/queue/retry/:id', (req: Request, res: Response) => {
    const job = devQueueJobs.find((j) => j.id === req.params.id);
    if (job) {
      job.status = 'active';
      job.attempts = 1;
      delete (job as unknown as Record<string, unknown>).errorDetails;
      syncQueueToRedis();
      res.json({ success: true, job });
      return;
    }
    res.status(404).json({ error: 'Job not found' });
  });

  app.delete('/api/admin/queue/completed', (_req: Request, res: Response) => {
    devQueueJobs = devQueueJobs.filter((j) => j.status !== 'completed');
    syncQueueToRedis();
    res.json({ success: true, jobs: devQueueJobs });
  });
}
