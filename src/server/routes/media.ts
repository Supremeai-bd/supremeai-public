import type { Express, Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { registerAgentExecuteRoutes } from './agentExecute';

/**
 * AI Media & Intent — `POST /api/transcribe` + `POST /api/avatar/analyze-face` +
 * `POST /api/chat/title` + `POST /api/intent/analyze`
 *
 * WHY THIS FILE EXISTS
 *   Four AI-powered endpoints (transcribe, face-trait extraction, title
 *   generation, intent orchestration) lived inline in `server.ts` (~400 lines).
 *   Cohesive (all are stateless Gemini calls with similar auth/WAF guards)
 *   and have no other consumer. Moving them keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - All 4 POST handlers are OWNED here (no other route reads their state).
 *   - `isIpBlocked` + `platformConfig` injected via ctx (closures over WAF +
 *     maintenance flag).
 *   - `GoogleGenAI`, `ThinkingLevel`, `Type` imported directly.
 */

export interface MediaContext {
  isIpBlocked: (req: Request) => boolean;
  get platformConfig(): { maintenanceMode: boolean; maintenanceMessage?: string };
  safeFetchWithRedirectCheck?: (
    initialUrl: string | URL,
    init?: RequestInit,
    isLocalRelative?: boolean,
    maxRedirects?: number
  ) => Promise<globalThis.Response>;
}

export function registerMediaRoutes(app: Express, ctx: MediaContext): void {
  // Server-side Audio Transcription endpoint powered by gemini-3.5-transcribe
  app.post('/api/transcribe', async (req: Request, res: Response) => {
    try {
      if (ctx.isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      if (ctx.platformConfig.maintenanceMode) {
        res.status(503).json({
          error: ctx.platformConfig.maintenanceMessage || 'Platform is currently in maintenance mode.',
        });
        return;
      }

      const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
      if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
        res.status(400).json({
          error:
            'API key is not configured. Please check your key in the Settings > Secrets panel.',
        });
        return;
      }

      const rawData = typeof req.body?.audioData === 'string' ? req.body.audioData : '';
      const rawMimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/webm';
      const promptHint =
        typeof req.body?.prompt === 'string' && req.body.prompt.trim()
          ? req.body.prompt.trim()
          : 'Transcribe this audio accurately into clean, punctuated text. Return only the transcribed text.';

      if (!rawData) {
        res.status(400).json({ error: 'Audio payload is required for transcription.' });
        return;
      }

      const base64Audio = rawData.includes(',') ? rawData.split(',')[1] : rawData;
      const cleanMimeType = rawMimeType.split(';')[0].trim() || 'audio/webm';

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const startMs = Date.now();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanMimeType,
                data: base64Audio,
              },
            },
            { text: promptHint },
          ],
        },
      });

      const transcript = (response.text || '').trim();
      res.json({
        transcript,
        model: 'gemini-3.5-transcribe',
        latencyMs: Date.now() - startMs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Audio transcription failed.';
      console.error('Error in /api/transcribe:', err);
      res.status(502).json({ error: msg });
    }
  });

  // Intelligent Face Detection & Trait Extraction for Custom 3D Avatar Matching (gemini-4-hydrogen)
  app.post('/api/avatar/analyze-face', async (req: Request, res: Response) => {
    try {
      const rawData = typeof req.body?.imageData === 'string' ? req.body.imageData : '';
      const rawMimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'image/jpeg';
      if (!rawData) {
        res.status(400).json({ error: 'imageData is required.' });
        return;
      }

      const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
      if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
        res.json({ fallback: true, faceFound: false });
        return;
      }

      const base64Image = rawData.includes(',') ? rawData.split(',')[1] : rawData;
      const cleanMime = rawMimeType.split(';')[0].trim() || 'image/jpeg';

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: base64Image,
              },
            },
            {
              text: 'Locate the primary human face in this image (even if full-body or wide shot). Return normalized 0..1 bounding box coordinates covering ONLY the head/face from top of forehead/hairline to bottom of chin and ear-to-ear (exclude torso, legs, and background). Also extract natural skin hex, hair hex, eye iris hex, lip hex, gender silhouette cue (female or male), hair length style (short, medium, or long), and whether eyeglasses are worn.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              faceFound: { type: Type.BOOLEAN },
              faceBox: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                },
              },
              skinHex: { type: Type.STRING },
              hairHex: { type: Type.STRING },
              eyeHex: { type: Type.STRING },
              lipHex: { type: Type.STRING },
              genderCue: { type: Type.STRING },
              hairStyle: { type: Type.STRING },
              hasGlasses: { type: Type.BOOLEAN },
            },
          },
        },
      });

      const rawText = (response.text || '{}').trim();
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = {};
      }

      res.json({
        fallback: false,
        faceFound: Boolean(parsed.faceFound),
        faceBox: parsed.faceBox || null,
        skinHex: typeof parsed.skinHex === 'string' ? parsed.skinHex : undefined,
        hairHex: typeof parsed.hairHex === 'string' ? parsed.hairHex : undefined,
        eyeHex: typeof parsed.eyeHex === 'string' ? parsed.eyeHex : undefined,
        lipHex: typeof parsed.lipHex === 'string' ? parsed.lipHex : undefined,
        genderCue: parsed.genderCue === 'female' ? 'female' : 'male',
        hairStyle:
          parsed.hairStyle === 'long' || parsed.hairStyle === 'medium' ? parsed.hairStyle : 'short',
        hasGlasses: Boolean(parsed.hasGlasses),
      });
    } catch (err: unknown) {
      console.warn('Face analysis fallback triggered:', err instanceof Error ? err.message : err);
      res.json({ fallback: true, faceFound: false });
    }
  });

  // Concise Automatic Chat Session Title Generator (gemini-4-hydrogen + deterministic fallback)
  app.post('/api/chat/title', async (req: Request, res: Response) => {
    try {
      if (ctx.isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const attachmentName =
        typeof req.body?.attachmentName === 'string' ? req.body.attachmentName.trim() : '';
      const attachmentMimeType =
        typeof req.body?.attachmentMimeType === 'string' ? req.body.attachmentMimeType.trim() : '';

      if (!rawMessage && !attachmentName) {
        res.status(400).json({ error: 'message or attachmentName is required.' });
        return;
      }

      const sanitizeTitle = (raw: string): string => {
        const line =
          raw
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.length > 0) || '';
        let cleaned = line
          .replace(/^(?:title|topic|subject|summary|chat\s*title)\s*[:\-–—]\s*/i, '')
          .replace(/^[#>*\-\d.)\s]+/, '')
          .replace(/[`*_~"]/g, '')
          .replace(/^['‘’“”]+|['‘’“”]+$/g, '')
          .replace(/\s+/g, ' ')
          .replace(/[.?!:;,\-–—]+$/g, '')
          .trim();
        if (cleaned.length > 46) {
          const sliced = cleaned.slice(0, 46);
          const lastSpace = sliced.lastIndexOf(' ');
          cleaned = (lastSpace >= 24 ? sliced.slice(0, lastSpace) : sliced)
            .replace(/[.?!:;,\-–—]+$/g, '')
            .trim();
        }
        return cleaned;
      };

      const buildFallbackTitle = (): string => {
        if (!rawMessage && attachmentName) {
          const base = attachmentName
            .replace(/\.[^/.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .trim();
          const prefix = attachmentMimeType.startsWith('image/') ? 'Image' : 'File';
          return sanitizeTitle(`${prefix}: ${base || attachmentName}`) || 'File Analysis';
        }
        const cleanedText = rawMessage
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/https?:\/\/([^\s/]+)[^\s]*/gi, '$1')
          .replace(/^(?:hey|hi|hello|please|can you|could you|help me|how do i|what is)\s+/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        const words = cleanedText.split(/\s+/).filter(Boolean).slice(0, 6);
        return sanitizeTitle(words.join(' ')) || 'New Conversation';
      };

      const fallbackTitle = buildFallbackTitle();
      const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
      if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
        res.json({ title: fallbackTitle, source: 'heuristic' });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const promptSnippet = rawMessage.slice(0, 800);
      const userPrompt = attachmentName
        ? `User message: "${promptSnippet || '(No text)'}"\nAttachment: ${attachmentName} (${attachmentMimeType || 'file'})`
        : `User message: "${promptSnippet}"`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Generate a concise, relevant, scannable chat sidebar title (2 to 5 words, max 42 characters) capturing the core topic or task of the user message. Return ONLY the plain-text title in Title Case, with no quotation marks, no markdown, no emojis, and no trailing punctuation.',
        },
      });

      const aiTitle = sanitizeTitle(response.text || '');
      res.json({
        title: aiTitle || fallbackTitle,
        source: aiTitle ? 'gemini' : 'heuristic',
      });
    } catch (err: unknown) {
      console.warn('Chat title generation fallback:', err instanceof Error ? err.message : err);
      const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const words = rawMessage.replace(/\s+/g, ' ').split(' ').filter(Boolean).slice(0, 5);
      res.json({
        title: words.join(' ').slice(0, 42) || 'New Conversation',
        source: 'heuristic',
      });
    }
  });

  // Semantic Intent Orchestrator (English + Bengali + Banglish understanding, auto-routing, clarification & actions)
  app.post('/api/intent/analyze', async (req: Request, res: Response) => {
    try {
      if (ctx.isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      const rawPrompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const hasAttachment = Boolean(req.body?.hasAttachment);
      const isAdmin = Boolean(req.body?.isAdmin);
      const recentContext = Array.isArray(req.body?.recentTurns)
        ? req.body.recentTurns
            .slice(-4)
            .map(
              (t: { role?: string; content?: string }) =>
                `${t.role || 'user'}: ${String(t.content || '').slice(0, 220)}`
            )
            .join('\n')
        : '';
      const memorySummary =
        typeof req.body?.memorySummary === 'string' ? req.body.memorySummary.slice(0, 400) : '';

      if (!rawPrompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
      if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
        res.json({ source: 'heuristic' });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          memorySummary ? `User Profile Memory:\n${memorySummary}` : '',
          recentContext ? `Recent Conversation:\n${recentContext}` : '',
          `Has Attachment: ${hasAttachment ? 'yes' : 'no'}`,
          `User Is Admin: ${isAdmin ? 'yes' : 'no'}`,
          `Current User Request:\n${rawPrompt.slice(0, 1200)}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          systemInstruction: `You are SupremeAI's zero-friction Intent Orchestrator. Understand English, Bengali (বাংলা), and Banglish seamlessly.
Decide what the user truly wants so they NEVER need to manually choose models, toggles, or dashboard tabs.

Rules:
1. dashboardAction: set ONLY when the user is explicitly asking to control the app UI/settings/view (e.g. "dark mode on koro" -> toggle_dark_mode, "light theme dao" -> toggle_light_mode, "show usage/plan" -> open_usage, "open settings" -> open_settings, "open knowledge/files" -> open_knowledge, "show chat history" -> open_history, "turn on voice mode" -> toggle_voice, or admin ops like "check server health" -> open_admin_health, "check ai gateway/models" -> open_admin_ai, "show customers/security" -> open_admin_security, "open github pipeline/releases" -> open_admin_releases). Otherwise "none".
2. needsClarification: set true ONLY when the user makes a very vague, underspecified build/planning request with zero concrete details (like "build an app", "ekta website banao", "make a dashboard", "ekta business plan dao") AND there is no recent context answering it AND hasAttachment is false. Keep clarificationQuestion to 1 short sentence and clarificationOptions to 3-4 crisp clickable options in the SAME language the user wrote in (Bangla/Banglish/English). For normal questions, specific requests, greetings, or dashboard actions, ALWAYS set needsClarification = false.
3. autoOpenDockTab: "preview" for UI/app/website creation, "code" for code/script tasks, "browser" for browsing a URL, "schedule" for recurring reminders/schedules, otherwise "none".
4. planSummary: short clean human phrase separated by " · " (e.g. "App Builder · Live Preview" or "Live Web Search · Fast Answer" or "Deep Reasoning · Analysis"). No emojis, no technical jargon.`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              primaryGoal: {
                type: Type.STRING,
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
                type: Type.STRING,
                enum: [
                  'supreme-spark',
                  'supreme-core',
                  'supreme-deep',
                  'supreme-reason',
                  'supremeai-web',
                ],
              },
              recommendedThinkingLevel: {
                type: Type.STRING,
                enum: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'],
              },
              enableSearchGrounding: { type: Type.BOOLEAN },
              enableDeepResearch: { type: Type.BOOLEAN },
              enableProjectBuilder: { type: Type.BOOLEAN },
              autoOpenDockTab: {
                type: Type.STRING,
                enum: ['none', 'preview', 'code', 'browser', 'schedule'],
              },
              dashboardAction: {
                type: Type.STRING,
                enum: [
                  'none',
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
                ],
              },
              needsClarification: { type: Type.BOOLEAN },
              clarificationQuestion: { type: Type.STRING },
              clarificationOptions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              planSummary: { type: Type.STRING },
              inferredLanguage: {
                type: Type.STRING,
                enum: ['en', 'bn', 'banglish'],
              },
              inferredTopic: { type: Type.STRING },
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
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim());
      res.json({ source: 'gemini', intent: parsed });
    } catch (err: unknown) {
      console.warn('Semantic intent analyze fallback:', err instanceof Error ? err.message : err);
      res.json({ source: 'heuristic' });
    }
  });

  registerAgentExecuteRoutes(app, {
    isIpBlocked: ctx.isIpBlocked,
    safeFetchWithRedirectCheck: ctx.safeFetchWithRedirectCheck,
  });
}
