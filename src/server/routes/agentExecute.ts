import type { Express, Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type, type FunctionDeclaration } from '@google/genai';
import { isProtectedWorkspaceFile, isRestrictedProxyTarget } from '../../shared/serverSecurity';
import { extractHtmlTitle, extractReadablePageSnippet } from '../../shared/scheduleExecution';
import { routeRateLimit } from '../routeRateLimit';
import type { AgentExecuteResponse, AgentToolAction } from '../../shared/agentTypes';
import type { AgentExecutionStep, GroundingSource } from '../../types';

export interface AgentExecuteContext {
  isIpBlocked: (req: Request) => boolean;
  // বাংলা মন্তব্য: অটোনোমাস এজেন্ট টুল-লুপে অনুমোদিত ব্যবহারকারী যাচাইয়ের জন্য ঐচ্ছিক হুক
  resolveAuthenticatedEmail?: (req: Request) => Promise<string | null>;
  safeFetchWithRedirectCheck?: (
    initialUrl: string | URL,
    init?: RequestInit,
    isLocalRelative?: boolean,
    maxRedirects?: number
  ) => Promise<globalThis.Response>;
}

interface WorkspaceFileInput {
  path: string;
  lang?: string;
  content: string;
}

const VALID_DASHBOARD_ACTIONS = new Set([
  'toggle_dark_mode',
  'toggle_light_mode',
  'open_usage',
  'open_settings',
  'open_knowledge',
  'open_history',
  'open_admin_health',
  'open_admin_ai',
  'open_admin_security',
  'open_admin_releases',
  'toggle_voice',
]);

// বাংলা মন্তব্য: হোস্ট সার্ভারের ডিস্ক (process.cwd()) পড়া সম্পূর্ণ বন্ধ করা হয়েছে; কেবল ইউজারের ভার্চুয়াল ওয়ার্কস্পেস বাফার ব্যবহৃত হবে
function normalizeVirtualPath(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

const AGENT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'list_workspace_files',
    description:
      'List files currently open in the active virtual workspace project buffer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dir: {
          type: Type.STRING,
          description: 'Optional relative directory prefix to filter, e.g. "src" or "components".',
        },
      },
    },
  },
  {
    name: 'read_workspace_file',
    description:
      'Read the contents of a file from the active virtual workspace buffer. Never request secrets or .env files.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative file path inside the active virtual workspace, e.g. "src/App.tsx".',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'web_browse',
    description:
      'Fetch a public http/https webpage and extract its title and readable text content for inspection or comparison.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'Full https:// or http:// URL to fetch and read.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'open_virtual_browser',
    description:
      'Open a target URL inside the user Workspace Virtual Browser panel so they can inspect it live.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'Full URL to open in Virtual Browser.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'create_scheduled_task',
    description:
      'Queue a recurring web monitoring or automation schedule for the user to approve and activate.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Short concise job title.' },
        targetUrl: { type: Type.STRING, description: 'Full target https:// URL to monitor.' },
        cadence: {
          type: Type.STRING,
          description: 'One of: hourly, daily, weekly, custom.',
        },
        cronExpression: {
          type: Type.STRING,
          description: 'Standard 5-part cron expression, e.g. "0 8 * * *".',
        },
        instruction: {
          type: Type.STRING,
          description: 'Clear instruction for what the scheduled run should check or summarize.',
        },
      },
      required: ['title', 'targetUrl', 'cadence', 'cronExpression', 'instruction'],
    },
  },
  {
    name: 'update_workspace_project',
    description:
      'Write or update complete runnable files inside the user Workspace editor & preview sandbox.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Short project title.' },
        runtime: {
          type: Type.STRING,
          description: 'One of: web, react, python, node, php, static.',
        },
        entryFile: {
          type: Type.STRING,
          description: 'Primary entry file path, e.g. "index.html", "src/App.tsx", or "main.py".',
        },
        files: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              path: { type: Type.STRING },
              lang: { type: Type.STRING },
              content: { type: Type.STRING },
            },
            required: ['path', 'lang', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'run_dashboard_action',
    description: 'Trigger a safe UI navigation or workspace control action requested by the user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'One of: toggle_dark_mode, toggle_light_mode, open_usage, open_settings, open_knowledge, open_history, open_admin_health, open_admin_ai, open_admin_security, open_admin_releases, toggle_voice.',
        },
      },
      required: ['action'],
    },
  },
];

export function registerAgentExecuteRoutes(app: Express, ctx: AgentExecuteContext): void {
  const agentRateLimit = routeRateLimit(30);
  app.post('/api/agent/execute', agentRateLimit, async (req: Request, res: Response) => {
    try {
      if (ctx.isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      // বাংলা মন্তব্য: বেনামী রিকোয়েস্টে LLM টুল-লুপ ও কোটা অপচয় রোধে বৈধ ইউজার সেশন আবশ্যক
      if (ctx.resolveAuthenticatedEmail) {
        const callerEmail = await ctx.resolveAuthenticatedEmail(req);
        if (!callerEmail) {
          res.status(401).json({ error: 'Authentication is required for autonomous agent execution.' });
          return;
        }
      }

      const rawPrompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!rawPrompt) {
        res.status(400).json({ error: 'prompt is required.' });
        return;
      }

      const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
      if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
        const fallback: AgentExecuteResponse = {
          status: 'fallback_chat',
          reason: 'no_gemini_key',
        };
        res.json(fallback);
        return;
      }

      const virtualFiles: WorkspaceFileInput[] = Array.isArray(req.body?.workspaceFiles)
        ? req.body.workspaceFiles
            .filter(
              (f: unknown): f is WorkspaceFileInput =>
                Boolean(f) &&
                typeof (f as WorkspaceFileInput).path === 'string' &&
                typeof (f as WorkspaceFileInput).content === 'string'
            )
            .slice(0, 20)
        : [];

      const recentContext = Array.isArray(req.body?.recentTurns)
        ? req.body.recentTurns
            .slice(-4)
            .map(
              (t: { role?: unknown; content?: unknown }) =>
                `${String(t?.role || 'user')}: ${String(t?.content || '').slice(0, 260)}`
            )
            .join('\n')
        : '';

      const languageHint = typeof req.body?.language === 'string' ? req.body.language : 'en';

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const contents: Array<Record<string, unknown>> = [
        {
          role: 'user',
          parts: [
            {
              text: [
                recentContext ? `Recent Conversation:\n${recentContext}` : '',
                virtualFiles.length > 0
                  ? `Active Virtual Workspace Files: ${virtualFiles.map((f) => f.path).join(', ')}`
                  : '',
                `Preferred Language: ${languageHint}`,
                `User Task Request:\n${rawPrompt}`,
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
        },
      ];

      const steps: AgentExecutionStep[] = [];
      const actions: AgentToolAction[] = [];
      const groundingSources: GroundingSource[] = [];
      let finalAnswer = '';

      const runTool = async (
        name: string,
        args: Record<string, unknown>,
        stepIndex: number
      ): Promise<Record<string, unknown>> => {
        const started = Date.now();
        const stepId = `agent_step_${stepIndex}`;

        if (name === 'list_workspace_files') {
          const dir = normalizeVirtualPath(typeof args.dir === 'string' ? args.dir : '').replace(/\/+$/, '');
          const matched = virtualFiles
            .map((f) => normalizeVirtualPath(f.path))
            .filter((p) => Boolean(p) && !isProtectedWorkspaceFile(p) && (!dir || p.startsWith(dir)))
            .slice(0, 80);
          steps.push({
            id: stepId,
            label: `Listed ${matched.length} workspace file(s)`,
            tool: 'workspace_list',
            status: 'done',
            detail: dir || 'virtual workspace',
            durationMs: Math.max(1, Date.now() - started),
          });
          return { files: matched };
        }

        if (name === 'read_workspace_file') {
          const reqPath = normalizeVirtualPath(typeof args.path === 'string' ? args.path : '');
          if (!reqPath || isProtectedWorkspaceFile(reqPath)) {
            const errorMsg = !reqPath
              ? 'File path is required.'
              : 'Access to protected environment or credential files is denied.';
            steps.push({
              id: stepId,
              label: `Read blocked: ${reqPath || 'unknown'}`,
              tool: 'workspace_read',
              status: 'error',
              detail: errorMsg,
              durationMs: Math.max(1, Date.now() - started),
            });
            return { error: errorMsg };
          }
          const vMatch = virtualFiles.find(
            (f) => normalizeVirtualPath(f.path) === reqPath
          );
          if (!vMatch) {
            const errorMsg = `File "${reqPath}" is not loaded in active workspace buffer.`;
            steps.push({
              id: stepId,
              label: `File not in active buffer: ${reqPath}`,
              tool: 'workspace_read',
              status: 'error',
              detail: errorMsg,
              durationMs: Math.max(1, Date.now() - started),
            });
            return { error: errorMsg };
          }
          steps.push({
            id: stepId,
            label: `Read ${vMatch.path}`,
            tool: 'workspace_read',
            status: 'done',
            detail: `${vMatch.content.length} chars (virtual buffer)`,
            durationMs: Math.max(1, Date.now() - started),
          });
          return { path: vMatch.path, content: vMatch.content.slice(0, 9000) };
        }

        if (name === 'web_browse') {
          const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
          try {
            const parsedUrl = new URL(rawUrl);
            const targetCheck = isRestrictedProxyTarget(parsedUrl, false);
            if (targetCheck.restricted) {
              throw new Error(targetCheck.reason || 'Restricted URL.');
            }
            const response = ctx.safeFetchWithRedirectCheck
              ? await ctx.safeFetchWithRedirectCheck(parsedUrl, { method: 'GET' }, false)
              : await fetch(parsedUrl.toString(), { method: 'GET', redirect: 'error' });
            const rawBody = await response.text();
            const title = extractHtmlTitle(rawBody, parsedUrl.hostname);
            const snippet = extractReadablePageSnippet(rawBody, 4500);
            groundingSources.push({ title, uri: parsedUrl.toString() });
            steps.push({
              id: stepId,
              label: `Browsed ${parsedUrl.hostname}`,
              tool: 'web_browse',
              status: response.ok ? 'done' : 'error',
              detail: `HTTP ${response.status} · ${title}`.slice(0, 90),
              durationMs: Math.max(1, Date.now() - started),
            });
            return {
              url: parsedUrl.toString(),
              statusCode: response.status,
              title,
              textPreview: snippet,
            };
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : 'Failed to browse URL';
            steps.push({
              id: stepId,
              label: `Browse failed: ${rawUrl || 'URL'}`,
              tool: 'web_browse',
              status: 'error',
              detail: errMsg,
              durationMs: Math.max(1, Date.now() - started),
            });
            return { error: errMsg };
          }
        }

        if (name === 'open_virtual_browser') {
          const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
          actions.push({
            id: `act_browser_${actions.length + 1}`,
            type: 'open_browser',
            label: `Open ${rawUrl} in Virtual Browser`,
            requiresApproval: false,
            payload: { url: rawUrl },
          });
          steps.push({
            id: stepId,
            label: `Queued Virtual Browser -> ${rawUrl}`,
            tool: 'open_browser',
            status: 'done',
            durationMs: Math.max(1, Date.now() - started),
          });
          return { queued: true, url: rawUrl };
        }

        if (name === 'create_scheduled_task') {
          const targetUrl = String(args.targetUrl || '').trim();
          const rawCadence = String(args.cadence || 'daily').toLowerCase();
          const cadence =
            rawCadence === 'hourly' || rawCadence === 'weekly' || rawCadence === 'custom'
              ? rawCadence
              : 'daily';
          const title = String(args.title || targetUrl || 'Scheduled Check').slice(0, 80);
          const cronExpression = String(args.cronExpression || '0 8 * * *').slice(0, 64);
          const instruction = String(args.instruction || 'Check updates and summarize.').slice(
            0,
            600
          );
          actions.push({
            id: `act_sched_${actions.length + 1}`,
            type: 'create_schedule',
            label: `Schedule "${title}" (${cronExpression})`,
            requiresApproval: true,
            payload: { title, targetUrl, cadence, cronExpression, instruction },
          });
          steps.push({
            id: stepId,
            label: `Prepared schedule: ${title}`,
            tool: 'create_schedule',
            status: 'done',
            detail: `${cronExpression} · awaiting approval`,
            durationMs: Math.max(1, Date.now() - started),
          });
          return { stagedForApproval: true, title, targetUrl, cronExpression };
        }

        if (name === 'update_workspace_project') {
          const filesRaw = Array.isArray(args.files) ? args.files : [];
          const normalizedFiles = filesRaw
            .filter(
              (f): f is { path: string; lang: string; content: string } =>
                Boolean(f) &&
                typeof (f as { path?: unknown }).path === 'string' &&
                typeof (f as { content?: unknown }).content === 'string'
            )
            .map((f) => ({
              path: f.path.trim(),
              lang: typeof f.lang === 'string' && f.lang.trim() ? f.lang.trim() : 'text',
              content: f.content,
            }));
          if (normalizedFiles.length > 0) {
            const rawRuntime = String(args.runtime || 'web').toLowerCase();
            const runtime =
              rawRuntime === 'react' ||
              rawRuntime === 'python' ||
              rawRuntime === 'node' ||
              rawRuntime === 'php' ||
              rawRuntime === 'static'
                ? rawRuntime
                : 'web';
            const title = typeof args.title === 'string' ? args.title : 'Agent Workspace Project';
            const entryFile =
              typeof args.entryFile === 'string' && args.entryFile.trim()
                ? args.entryFile.trim()
                : normalizedFiles[0].path;
            actions.push({
              id: `act_proj_${actions.length + 1}`,
              type: 'update_project',
              label: `Update workspace (${normalizedFiles.length} file${normalizedFiles.length > 1 ? 's' : ''})`,
              requiresApproval: false,
              payload: { title, runtime, entryFile, files: normalizedFiles },
            });
            steps.push({
              id: stepId,
              label: `Prepared workspace update (${normalizedFiles.length} file${normalizedFiles.length > 1 ? 's' : ''})`,
              tool: 'update_project',
              status: 'done',
              detail: entryFile,
              durationMs: Math.max(1, Date.now() - started),
            });
          }
          return { updated: true, fileCount: normalizedFiles.length };
        }

        if (name === 'run_dashboard_action') {
          const actionName = String(args.action || '').trim();
          if (VALID_DASHBOARD_ACTIONS.has(actionName)) {
            actions.push({
              id: `act_dash_${actions.length + 1}`,
              type: 'dashboard_action',
              label: `Dashboard action: ${actionName}`,
              requiresApproval: false,
              payload: { action: actionName as AgentToolAction extends { type: 'dashboard_action'; payload: { action: infer A } } ? A : never },
            });
            steps.push({
              id: stepId,
              label: `Triggered ${actionName}`,
              tool: 'dashboard_action',
              status: 'done',
              durationMs: Math.max(1, Date.now() - started),
            });
            return { executed: true, action: actionName };
          }
          return { executed: false, error: 'Unsupported dashboard action.' };
        }

        return { error: `Unknown tool: ${name}` };
      };

      const maxIterations = 5;
      for (let iter = 0; iter < maxIterations; iter += 1) {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: contents as unknown as Parameters<typeof ai.models.generateContent>[0]['contents'],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction: `You are SupremeAI's Autonomous Task Executor. You can call tools to inspect workspace files, browse live URLs, open the Virtual Browser, update workspace projects, or stage recurring scheduled tasks.
Rules:
1. Respond in the user's language (English, Bengali, or Banglish).
2. Always read relevant files or browse referenced URLs before claiming facts about them.
3. For recurring web monitoring requests with a URL, call create_scheduled_task so the user gets a one-click approval card.
4. Keep your final summary crisp, accurate, and grounded strictly in actual tool outputs.`,
            tools: [{ functionDeclarations: AGENT_FUNCTION_DECLARATIONS }],
          },
        });

        const candidateContent = response.candidates?.[0]?.content;
        if (candidateContent) {
          contents.push(candidateContent as unknown as Record<string, unknown>);
        }

        const calls = response.functionCalls;
        if (!calls || calls.length === 0) {
          finalAnswer = (response.text || '').trim();
          break;
        }

        const responseParts: Array<Record<string, unknown>> = [];
        for (let i = 0; i < calls.length; i += 1) {
          const call = calls[i];
          const toolName = call.name || 'unknown';
          const toolArgs = (call.args || {}) as Record<string, unknown>;
          const toolResult = await runTool(toolName, toolArgs, steps.length + 1);
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: toolName,
              response: toolResult,
            },
          });
        }
        contents.push({
          role: 'user',
          parts: responseParts,
        });
      }

      if (!finalAnswer && actions.length === 0) {
        const fallback: AgentExecuteResponse = {
          status: 'fallback_chat',
          reason: 'empty_agent_output',
        };
        res.json(fallback);
        return;
      }

      const approvedIds = new Set<string>(
        Array.isArray(req.body?.approvedActionIds)
          ? req.body.approvedActionIds.map((id: unknown) => String(id))
          : []
      );
      const needsApproval = actions.some(
        (action) => action.requiresApproval && !approvedIds.has(action.id)
      );

      const summaryText =
        steps.length > 0
          ? `${steps.length} step${steps.length > 1 ? 's' : ''} executed${actions.length > 0 ? ` · ${actions.length} action${actions.length > 1 ? 's' : ''}` : ''}`
          : 'Task analyzed';

      const payload: AgentExecuteResponse = {
        status: needsApproval ? 'needs_approval' : 'completed',
        answer:
          finalAnswer ||
          (needsApproval
            ? 'Prepared action plan — review and approve below to execute.'
            : 'Completed requested actions.'),
        summary: summaryText,
        steps,
        actions,
        ...(groundingSources.length > 0 ? { groundingSources } : {}),
      };
      res.json(payload);
    } catch (err: unknown) {
      console.warn(
        'Agent execute fallback triggered:',
        err instanceof Error ? err.message : err
      );
      res.json({
        status: 'fallback_chat',
        reason: err instanceof Error ? err.message : 'agent_error',
      } satisfies AgentExecuteResponse);
    }
  });
}
