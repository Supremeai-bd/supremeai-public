import {
  PagesContext,
  fetchWithTimeout,
  handleCorsPreflight,
  isRestrictedEdgeHost,
  jsonEdgeResponse,
  safeEdgeFetch,
} from '../../_lib/edgeHelpers';
import { extractHtmlTitle, extractReadablePageSnippet } from '../../../src/shared/scheduleExecution';
import type { AgentExecuteResponse, AgentToolAction } from '../../../src/shared/agentTypes';
import type { AgentExecutionStep, GroundingSource } from '../../../src/types';

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

const EDGE_FUNCTION_DECLARATIONS = [
  {
    name: 'list_workspace_files',
    description:
      'List files currently open in the user active workspace project buffer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dir: { type: 'STRING', description: 'Optional directory filter prefix.' },
      },
    },
  },
  {
    name: 'read_workspace_file',
    description: 'Read a file from the user active virtual workspace project buffer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Relative path inside workspace.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'web_browse',
    description: 'Fetch a public http/https webpage and extract title and text content.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Public https:// or http:// URL to fetch.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'open_virtual_browser',
    description: 'Open a target URL in the user Virtual Browser tab.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Full URL to open.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'create_scheduled_task',
    description: 'Prepare a recurring scheduled web monitoring job for user approval.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        targetUrl: { type: 'STRING' },
        cadence: { type: 'STRING' },
        cronExpression: { type: 'STRING' },
        instruction: { type: 'STRING' },
      },
      required: ['title', 'targetUrl', 'cadence', 'cronExpression', 'instruction'],
    },
  },
  {
    name: 'update_workspace_project',
    description: 'Write or update runnable files inside the user Workspace editor.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        runtime: { type: 'STRING' },
        entryFile: { type: 'STRING' },
        files: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              path: { type: 'STRING' },
              lang: { type: 'STRING' },
              content: { type: 'STRING' },
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
    description: 'Trigger a safe dashboard navigation or UI control action.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING' },
      },
      required: ['action'],
    },
  },
];

interface GeminiRestPart {
  text?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: unknown;
    language?: unknown;
    workspaceFiles?: unknown;
    recentTurns?: unknown;
    approvedActionIds?: unknown;
  };

  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!rawPrompt) {
    return jsonEdgeResponse({ error: 'prompt is required.' }, 400, request, undefined, env);
  }

  const geminiKey = env?.GEMINI_API_KEY?.trim();
  if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
    return jsonEdgeResponse(
      { status: 'fallback_chat', reason: 'no_gemini_key' } satisfies AgentExecuteResponse,
      200,
      request,
      undefined,
      env
    );
  }

  const virtualFiles: WorkspaceFileInput[] = Array.isArray(body.workspaceFiles)
    ? body.workspaceFiles
        .filter(
          (f): f is WorkspaceFileInput =>
            Boolean(f) &&
            typeof (f as WorkspaceFileInput).path === 'string' &&
            typeof (f as WorkspaceFileInput).content === 'string'
        )
        .slice(0, 20)
    : [];

  const recentContext = Array.isArray(body.recentTurns)
    ? body.recentTurns
        .slice(-4)
        .map(
          (t: { role?: unknown; content?: unknown }) =>
            `${String(t?.role || 'user')}: ${String(t?.content || '').slice(0, 260)}`
        )
        .join('\n')
    : '';
  const languageHint = typeof body.language === 'string' ? body.language : 'en';

  const contents: Array<{ role: string; parts: GeminiRestPart[] }> = [
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
    const stepId = `edge_step_${stepIndex}`;

    if (name === 'list_workspace_files') {
      const dir = typeof args.dir === 'string' ? args.dir.trim().replace(/\/+$/, '') : '';
      const matched = virtualFiles
        .map((f) => f.path)
        .filter((p) => !dir || p.startsWith(dir));
      steps.push({
        id: stepId,
        label: `Listed ${matched.length} workspace file(s)`,
        tool: 'workspace_list',
        status: 'done',
        durationMs: Math.max(1, Date.now() - started),
      });
      return { files: matched };
    }

    if (name === 'read_workspace_file') {
      const reqPath = typeof args.path === 'string' ? args.path.trim().replace(/^\/+/, '') : '';
      const match = virtualFiles.find((f) => f.path.replace(/^\/+/, '') === reqPath);
      if (!match) {
        steps.push({
          id: stepId,
          label: `File not in active buffer: ${reqPath}`,
          tool: 'workspace_read',
          status: 'error',
          durationMs: Math.max(1, Date.now() - started),
        });
        return { error: `File "${reqPath}" is not loaded in active workspace buffer.` };
      }
      steps.push({
        id: stepId,
        label: `Read ${match.path}`,
        tool: 'workspace_read',
        status: 'done',
        detail: `${match.content.length} chars`,
        durationMs: Math.max(1, Date.now() - started),
      });
      return { path: match.path, content: match.content.slice(0, 9000) };
    }

    if (name === 'web_browse') {
      const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
      try {
        const parsed = new URL(rawUrl);
        if (
          (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
          isRestrictedEdgeHost(parsed.hostname)
        ) {
          throw new Error('Restricted or invalid target URL.');
        }
        const probe = await safeEdgeFetch(parsed.toString(), { method: 'GET' }, 7000);
        const rawBody = await probe.text().catch(() => '');
        const title = extractHtmlTitle(rawBody, parsed.hostname);
        const snippet = extractReadablePageSnippet(rawBody, 4500);
        groundingSources.push({ title, uri: parsed.toString() });
        steps.push({
          id: stepId,
          label: `Browsed ${parsed.hostname}`,
          tool: 'web_browse',
          status: probe.ok ? 'done' : 'error',
          detail: `HTTP ${probe.status} · ${title}`.slice(0, 90),
          durationMs: Math.max(1, Date.now() - started),
        });
        return {
          url: parsed.toString(),
          statusCode: probe.status,
          title,
          textPreview: snippet,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Browse failed';
        steps.push({
          id: stepId,
          label: `Browse failed: ${rawUrl || 'URL'}`,
          tool: 'web_browse',
          status: 'error',
          detail: msg,
          durationMs: Math.max(1, Date.now() - started),
        });
        return { error: msg };
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
      const instruction = String(args.instruction || 'Check updates and summarize.').slice(0, 600);
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
      const normalized = filesRaw
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
      if (normalized.length > 0) {
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
            : normalized[0].path;
        actions.push({
          id: `act_proj_${actions.length + 1}`,
          type: 'update_project',
          label: `Update workspace (${normalized.length} file${normalized.length > 1 ? 's' : ''})`,
          requiresApproval: false,
          payload: { title, runtime, entryFile, files: normalized },
        });
        steps.push({
          id: stepId,
          label: `Prepared workspace update (${normalized.length} file${normalized.length > 1 ? 's' : ''})`,
          tool: 'update_project',
          status: 'done',
          detail: entryFile,
          durationMs: Math.max(1, Date.now() - started),
        });
      }
      return { updated: true, fileCount: normalized.length };
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

  try {
    for (let iter = 0; iter < 5; iter += 1) {
      const geminiRes = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${encodeURIComponent(
          geminiKey
        )}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: `You are SupremeAI's Autonomous Task Executor. Use tools to inspect workspace files, browse URLs, open Virtual Browser, update workspace projects, or stage recurring scheduled tasks. Respond cleanly in the user's language.`,
                },
              ],
            },
            contents,
            tools: [{ functionDeclarations: EDGE_FUNCTION_DECLARATIONS }],
            generationConfig: {
              thinkingConfig: { thinkingLevel: 'LOW' },
            },
          }),
        },
        9500
      );

      if (!geminiRes.ok) {
        return jsonEdgeResponse(
          { status: 'fallback_chat', reason: `gemini_http_${geminiRes.status}` } satisfies AgentExecuteResponse,
          200,
          request,
          undefined,
          env
        );
      }

      const gJson = (await geminiRes.json().catch(() => null)) as {
        candidates?: Array<{ content?: { role?: string; parts?: GeminiRestPart[] } }>;
      } | null;

      const candidateContent = gJson?.candidates?.[0]?.content;
      const parts = candidateContent?.parts || [];
      if (candidateContent) {
        contents.push({
          role: candidateContent.role || 'model',
          parts,
        });
      }

      const calls = parts.filter((p) => p.functionCall?.name);
      if (calls.length === 0) {
        finalAnswer = parts
          .map((p) => p.text || '')
          .join('')
          .trim();
        break;
      }

      const fnResponseParts: GeminiRestPart[] = [];
      for (const p of calls) {
        const fc = p.functionCall!;
        const result = await runTool(fc.name!, fc.args || {}, steps.length + 1);
        fnResponseParts.push({
          functionResponse: {
            ...(fc.id ? { id: fc.id } : {}),
            name: fc.name!,
            response: result,
          },
        });
      }
      contents.push({
        role: 'user',
        parts: fnResponseParts,
      });
    }

    if (!finalAnswer && actions.length === 0) {
      return jsonEdgeResponse(
        { status: 'fallback_chat', reason: 'empty_agent_output' } satisfies AgentExecuteResponse,
        200,
        request,
        undefined,
        env
      );
    }

    const approvedIds = new Set<string>(
      Array.isArray(body.approvedActionIds) ? body.approvedActionIds.map((id) => String(id)) : []
    );
    const needsApproval = actions.some((a) => a.requiresApproval && !approvedIds.has(a.id));

    return jsonEdgeResponse(
      {
        status: needsApproval ? 'needs_approval' : 'completed',
        answer:
          finalAnswer ||
          (needsApproval
            ? 'Prepared action plan — review and approve below to execute.'
            : 'Completed requested actions.'),
        summary:
          steps.length > 0
            ? `${steps.length} step${steps.length > 1 ? 's' : ''} executed`
            : 'Task analyzed',
        steps,
        actions,
        ...(groundingSources.length > 0 ? { groundingSources } : {}),
      } satisfies AgentExecuteResponse,
      200,
      request,
      undefined,
      env
    );
  } catch (err: unknown) {
    return jsonEdgeResponse(
      {
        status: 'fallback_chat',
        reason: err instanceof Error ? err.message : 'edge_agent_error',
      } satisfies AgentExecuteResponse,
      200,
      request,
      undefined,
      env
    );
  }
}
