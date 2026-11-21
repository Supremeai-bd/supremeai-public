/**
 * MCP Control Tower Client Bridge
 * Communicates via HTTPS/JSON-RPC to the live SupremeAI Control Tower endpoint.
 */

export const DEFAULT_LIVE_MCP_TOWER_URL = 'https://supremeai-mcp-tower-live.onrender.com/mcp';

export interface FederationHealth {
  status: 'nominal' | 'degraded' | 'critical' | 'offline';
  activeAgents: number;
  openClaims: number;
  runwayDepth: number;
  latencyMs: number;
  lastChecked: string;
}

export interface RunwayItem {
  id: string;
  repo: string;
  title: string;
  stage: 'queued' | 'in_gates' | 'landed' | 'rejected';
  ciStatus: 'pass' | 'fail' | 'pending';
  author: string;
}

export interface TaskDispatchRequest {
  repo: string;
  title: string;
  scopePaths: string[];
  description: string;
  priority?: 'P0-critical' | 'P1-high' | 'P2-medium' | 'P3-low';
}

export interface TaskDispatchResponse {
  success: boolean;
  taskId?: string;
  issueNumber?: number;
  error?: string;
}

export class McpBridge {
  private towerUrl: string;
  private timeoutMs: number;

  constructor(towerUrl = DEFAULT_LIVE_MCP_TOWER_URL, timeoutMs = 8000) {
    this.towerUrl = towerUrl;
    this.timeoutMs = timeoutMs;
  }

  public updateConfig(towerUrl: string, timeoutMs = 8000): void {
    this.towerUrl = towerUrl;
    this.timeoutMs = timeoutMs;
  }

  public async fetchHealth(): Promise<FederationHealth> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const healthUrl = this.towerUrl
        .replace(/\/agents\/[^/]+\/mcp\/?$/i, '/health')
        .replace(/\/mcp\/?$/i, '/health');
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - started;

      if (!res.ok) {
        return {
          status: 'degraded',
          activeAgents: 0,
          openClaims: 0,
          runwayDepth: 0,
          latencyMs,
          lastChecked: new Date().toISOString(),
        };
      }

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        status: (data.status as FederationHealth['status']) || 'nominal',
        activeAgents: typeof data.activeAgents === 'number' ? data.activeAgents : 0,
        openClaims: typeof data.openClaims === 'number' ? data.openClaims : 0,
        runwayDepth: typeof data.runwayDepth === 'number' ? data.runwayDepth : 0,
        latencyMs,
        lastChecked: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'offline',
        activeAgents: 0,
        openClaims: 0,
        runwayDepth: 0,
        latencyMs: Date.now() - started,
        lastChecked: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchRunway(): Promise<RunwayItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'work_runway_status',
          arguments: {},
        },
      };

      const res = await fetch(this.towerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) return [];

      const data = (await res.json().catch(() => ({}))) as {
        result?: { content?: Array<{ text?: string }> };
      };
      const rawText = data?.result?.content?.[0]?.text;
      if (!rawText) return [];

      const parsed = JSON.parse(rawText) as RunwayItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  public async dispatchTask(req: TaskDispatchRequest): Promise<TaskDispatchResponse> {
    if (!req.title || !req.repo) {
      return { success: false, error: 'Task title and repository are required.' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const bodyLines = [
        req.description || '',
        '',
        `**Scope paths:** ${req.scopePaths.length ? req.scopePaths.join(', ') : '(none)'}`,
        `**Priority:** ${req.priority || 'P1-high'}`,
      ];
      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'github.create_issue',
          arguments: {
            title: req.title,
            body: bodyLines.join('\n'),
            repo: req.repo,
            labels: [req.priority || 'P1-high', 'status:unclaimed'],
          },
        },
      };

      const res = await fetch(this.towerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        return { success: false, error: `Tower responded with HTTP ${res.status}` };
      }

      const data = (await res.json().catch(() => ({}))) as {
        result?: { content?: Array<{ text?: string }>; isError?: boolean };
        error?: { message?: string };
      };

      if (data.error) {
        return { success: false, error: data.error.message || 'MCP Dispatch Error' };
      }

      if (!data.result) {
        return { success: false, error: 'MCP response missing result' };
      }

      const responseText = data.result.content?.[0]?.text || '';
      if (data.result.isError) {
        return { success: false, error: responseText || 'MCP tool reported an error' };
      }

      let taskId: string | undefined;
      let issueNumber: number | undefined;
      if (responseText) {
        try {
          const parsed = JSON.parse(responseText) as Record<string, unknown>;
          taskId =
            (parsed.taskId as string) ||
            (parsed.task_id as string) ||
            (parsed.id as string) ||
            undefined;
          const rawIssue = parsed.issueNumber ?? parsed.issue_number ?? parsed.issue;
          if (typeof rawIssue === 'number') issueNumber = rawIssue;
          else if (typeof rawIssue === 'string' && /^\d+$/.test(rawIssue)) {
            issueNumber = Number(rawIssue);
          }
        } catch {
          taskId = responseText;
        }
      }

      if (!responseText && !taskId) {
        return { success: false, error: 'MCP dispatch returned no result content' };
      }

      return {
        success: true,
        taskId,
        issueNumber,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error during dispatch',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async triggerEmergencyKill(pin: string): Promise<boolean> {
    if (!pin || pin.length < 4) {
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'emergency_kill_switch',
          arguments: { pin },
        },
      };

      const res = await fetch(this.towerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) return false;

      const data = (await res.json().catch(() => ({}))) as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
        error?: { message?: string };
      };

      if (data.error) return false;
      if (!data.result || data.result.isError) return false;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
