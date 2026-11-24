import {
  PagesContext,
  extractLlmCompletionText,
  fetchWithTimeout,
  handleCorsPreflight,
  jsonEdgeResponse,
  mintOrExtractAuthHeaders,
  resolveUpstreamOrigin,
} from '../../_lib/edgeHelpers';

const INTENT_SYSTEM_INSTRUCTION = `You are SupremeAI's zero-friction Intent Orchestrator. Understand English, Bengali (বাংলা), and Banglish seamlessly.
Decide what the user truly wants so they NEVER need to manually choose models, toggles, or dashboard tabs.

Rules:
1. dashboardAction: set ONLY when the user is explicitly asking to control the app UI/settings/view (e.g. "dark mode on koro" -> toggle_dark_mode, "light theme dao" -> toggle_light_mode, "show usage/plan" -> open_usage, "open settings" -> open_settings, "open knowledge/files" -> open_knowledge, "show chat history" -> open_history, "turn on voice mode" -> toggle_voice, or admin ops like "check server health" -> open_admin_health, "check ai gateway/models" -> open_admin_ai, "show customers/security" -> open_admin_security, "open github pipeline/releases" -> open_admin_releases). Otherwise "none".
2. needsClarification: set true ONLY when the user makes a very vague, underspecified build/planning request with zero concrete details (like "build an app", "ekta website banao", "make a dashboard", "ekta business plan dao") AND there is no recent context answering it AND hasAttachment is false. Keep clarificationQuestion to 1 short sentence and clarificationOptions to 3-4 crisp clickable options in the SAME language the user wrote in (Bangla/Banglish/English). For normal questions, specific requests, greetings, or dashboard actions, ALWAYS set needsClarification = false.
3. autoOpenDockTab: "preview" for UI/app/website creation, "code" for code/script tasks, "browser" for browsing a URL, "schedule" for recurring reminders/schedules, otherwise "none".
4. planSummary: short clean human phrase separated by " · " (e.g. "App Builder · Live Preview" or "Live Web Search · Fast Answer" or "Deep Reasoning · Analysis"). No emojis, no technical jargon.`;

const INTENT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    primaryGoal: {
      type: 'STRING',
      enum: [
        'chat',
        'build_app',
        'deep_research',
        'live_web',
        'file_analysis',
        'schedule_task',
        'dashboard_action',
      ],
    },
    recommendedModelId: {
      type: 'STRING',
      enum: [
        'supreme-spark',
        'supreme-core',
        'supreme-deep',
        'supreme-reason',
        'supremeai-web',
      ],
    },
    recommendedThinkingLevel: {
      type: 'STRING',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'],
    },
    enableSearchGrounding: { type: 'BOOLEAN' },
    enableDeepResearch: { type: 'BOOLEAN' },
    enableProjectBuilder: { type: 'BOOLEAN' },
    autoOpenDockTab: {
      type: 'STRING',
      enum: ['none', 'preview', 'code', 'browser', 'schedule'],
    },
    dashboardAction: {
      type: 'STRING',
      enum: [
        'none',
        'toggle_dark_mode',
        'toggle_light_mode',
        'switch_lang_bn',
        'switch_lang_en',
        'set_live_theme',
        'toggle_theme_motion',
        'new_chat',
        'open_projects',
        'open_workspace_dock',
        'enable_dev_mode',
        'disable_dev_mode',
        'disable_jarvis',
        'open_usage',
        'open_settings',
        'open_knowledge',
        'open_history',
        'open_admin_health',
        'open_admin_ai',
        'open_admin_security',
        'open_admin_releases',
        'toggle_voice',
      ],
    },
    needsClarification: { type: 'BOOLEAN' },
    clarificationQuestion: { type: 'STRING' },
    clarificationOptions: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    planSummary: { type: 'STRING' },
    inferredLanguage: {
      type: 'STRING',
      enum: ['en', 'bn', 'banglish'],
    },
    inferredTopic: { type: 'STRING' },
  },
  required: [
    'primaryGoal',
    'recommendedModelId',
    'recommendedThinkingLevel',
    'enableSearchGrounding',
    'enableDeepResearch',
    'enableProjectBuilder',
    'autoOpenDockTab',
    'dashboardAction',
    'needsClarification',
    'planSummary',
    'inferredLanguage',
  ],
};

function parseIntentJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: unknown;
    hasAttachment?: unknown;
    isAdmin?: unknown;
    recentTurns?: unknown;
    memorySummary?: unknown;
  };

  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!rawPrompt) {
    return jsonEdgeResponse({ error: 'prompt is required' }, 400, request, undefined, env);
  }

  const hasAttachment = Boolean(body.hasAttachment);
  const isAdmin = Boolean(body.isAdmin);
  const recentContext = Array.isArray(body.recentTurns)
    ? body.recentTurns
        .slice(-4)
        .map(
          (t: { role?: unknown; content?: unknown }) =>
            `${String(t?.role || 'user')}: ${String(t?.content || '').slice(0, 220)}`
        )
        .join('\n')
    : '';
  const memorySummary =
    typeof body.memorySummary === 'string' ? body.memorySummary.slice(0, 400) : '';

  const userContent = [
    memorySummary ? `User Profile Memory:\n${memorySummary}` : '',
    recentContext ? `Recent Conversation:\n${recentContext}` : '',
    `Has Attachment: ${hasAttachment ? 'yes' : 'no'}`,
    `User Is Admin: ${isAdmin ? 'yes' : 'no'}`,
    `Current User Request:\n${rawPrompt.slice(0, 1200)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const geminiKey = env?.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
    try {
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
            systemInstruction: { parts: [{ text: INTENT_SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts: [{ text: userContent }] }],
            generationConfig: {
              thinkingConfig: { thinkingLevel: 'LOW' },
              responseMimeType: 'application/json',
              responseSchema: INTENT_RESPONSE_SCHEMA,
            },
          }),
        },
        4500
      );

      if (geminiRes.ok) {
        const gJson = (await geminiRes.json().catch(() => null)) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        } | null;
        const rawText = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = parseIntentJson(rawText);
        if (parsed) {
          return jsonEdgeResponse({ source: 'gemini', intent: parsed }, 200, request, undefined, env);
        }
      }
    } catch {
      // Fall through to upstream or heuristic fallback cleanly
    }
  }

  try {
    const upstreamOrigin = resolveUpstreamOrigin(env);
    const authHeaders = await mintOrExtractAuthHeaders(request, upstreamOrigin);
    const completion = await extractLlmCompletionText(
      upstreamOrigin,
      authHeaders,
      {
        model: 'supreme-spark',
        messages: [
          {
            role: 'system',
            content: `${INTENT_SYSTEM_INSTRUCTION}\n\nReturn ONLY raw JSON matching keys: primaryGoal, recommendedModelId, recommendedThinkingLevel, enableSearchGrounding, enableDeepResearch, enableProjectBuilder, autoOpenDockTab, dashboardAction, needsClarification, clarificationQuestion, clarificationOptions, planSummary, inferredLanguage, inferredTopic.`,
          },
          { role: 'user', content: userContent },
        ],
      },
      2500
    );
    const parsed = parseIntentJson(completion);
    if (parsed) {
      return jsonEdgeResponse({ source: 'gemini', intent: parsed }, 200, request, undefined, env);
    }
  } catch {
    // Graceful heuristic fallback
  }

  return jsonEdgeResponse({ source: 'heuristic' }, 200, request, undefined, env);
}
