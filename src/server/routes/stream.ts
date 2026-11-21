import type { Express, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import type { PlanTier } from '../../types';
import type { ClassifiedVisionError } from '../../shared/visionRouting';

interface ChatRunConfigPayload {
  thinking_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
  google_search?: boolean;
  response_mime_type?: 'text/plain' | 'application/json';
  response_schema?: Record<string, unknown>;
}

/**
 * Stream Chat — `POST /api/v1/stream/chat` + `POST /api/chat`
 *
 * WHY THIS FILE EXISTS
 *   Two chat streaming endpoints (SSE proxy + local Gemini) lived inline in
 *   `server.ts` (~730 lines). Cohesive (both handle chat inference, share
 *   Gemini helpers, vision cascade, and upstream proxy) and have no other
 *   consumer for their handlers. Moving them keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - Both POST handlers OWNED here (no other route uses their streaming logic).
 *   - Helpers (`resolveServerAutoModel`, `resolveUpstreamGeminiModel`,
 *     `buildGeminiPartsFromMessage`, `buildGeminiGenerateConfig`,
 *     `collectGroundingSourcesAndUsage`, `executeFreeVisionCascade`,
 *     `extractTextFromMessageContent`, `messageHasActualImage`,
 *     `messageHasVisionOrAttachment`, `countImagesInMessages`,
 *     `resolveReasoningEffort`, `detectBengaliOrBanglish`,
 *     `classifyVisionHttpError`) injected via ctx (closures over server helpers).
 *   - Shared state (`platformConfig`, `customerDirectory`,
 *     `runtimeFeatureFlags`, `SUPPORTED_MODELS`, `TIER_RANK`) injected via ctx.
 *   - Auth helpers (`isIpBlocked`, `verifyBearerIdentity`,
 *     `verifyAdminAuthorization`) injected via ctx.
 */

export interface StreamContext {
  isIpBlocked: (req: Request) => boolean;
  platformConfig: {
    defaultModelId?: string;
    maintenanceMode: boolean;
    maintenanceMessage?: string;
    modelPolicies: Record<string, { enabled: boolean; minTier: PlanTier }>;
  };
  customerDirectory: readonly { email: string; tier: PlanTier; status?: string; tokensUsed: number; tokenLimit: number; lastActive?: string }[];
  runtimeFeatureFlags: Record<string, boolean>;
  SUPPORTED_MODELS: Record<string, { name: string }>;
  TIER_RANK: Record<string, number>;
  verifyBearerIdentity: (token: string) => Promise<{ email: string; isAdmin: boolean; tier: PlanTier } | null>;
  verifyAdminAuthorization: (req: Request) => Promise<{ ok: boolean; email?: string }>;
  resolveServerAutoModel: (reqModel: string, messages: any[]) => string;
  resolveUpstreamGeminiModel: (validatedModel: string, runConfig?: ChatRunConfigPayload) => string;
  buildGeminiPartsFromMessage: (msg: any) => any[];
  buildGeminiGenerateConfig: (systemInstruction: string, validatedModel: string, runConfig: any, tuning: any, upstreamModel: string) => any;
  collectGroundingSourcesAndUsage: (chunk: any, sourcesMap: Map<string, { title: string; uri: string }>, latestUsage: any) => any;
  executeFreeVisionCascade: (params: {
    messages: any[];
    combinedSystem: string;
    resolvedModel: string;
    runConfig: any;
    tuning: any;
    imageCount: number;
    effectiveThinkingLevel: string;
    res: Response;
    priorRemoteError?: ClassifiedVisionError | null;
  }) => Promise<void>;
  extractTextFromMessageContent: (content: any) => string;
  messageHasActualImage: (m: any) => boolean;
  messageHasVisionOrAttachment: (m: any) => boolean;
  countImagesInMessages: (messages: any[]) => number;
  resolveReasoningEffort: (effort: any, thinkingLevel: any, model: string) => any;
  detectBengaliOrBanglish: (text: string) => boolean;
  classifyVisionHttpError: (params: { status?: number; message?: string; retryAfterHeader?: string | null; provider?: string; model?: string }) => ClassifiedVisionError;
}

export function registerStreamRoutes(app: Express, ctx: StreamContext): void {
  // Same-origin /api/v1/stream/chat proxy & preview SSE handler (supports live upstream token, webhook, or local Gemini streaming)
  app.post('/api/v1/stream/chat', async (req: Request, res: Response) => {
    const remoteGatewayUrl =
      process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
    const authHeader = String(req.headers.authorization || '').trim();
    const apiKeyHeader = String(req.headers['x-supremeai-key'] || '').trim();
    const effectiveToken =
      apiKeyHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');
    const hasRemoteBackendToken =
      Boolean(effectiveToken) &&
      !effectiveToken.startsWith('tok_') &&
      !effectiveToken.startsWith('mock_tok_');
    const incomingMessagesPrecheck = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const hasImageInRequest =
      req.body?.task_type === 'vision' ||
      incomingMessagesPrecheck.some((m: any) => ctx.messageHasActualImage(m));
    const localKeyPrecheck = process.env.GEMINI_API_KEY?.trim() || '';
    const hasLocalGeminiKey = Boolean(localKeyPrecheck && localKeyPrecheck !== 'MY_GEMINI_API_KEY');
    let remoteVisionFailure: ClassifiedVisionError | null = null;

    if (hasRemoteBackendToken && !(hasImageInRequest && hasLocalGeminiKey)) {
      const upstreamAbort = new AbortController();
      let clientDisconnected = false;
      const connectTimer = setTimeout(() => {
        upstreamAbort.abort(new Error('Upstream gateway connect timeout'));
      }, 22000);
      const onClientClose = () => {
        if (!res.writableFinished && !res.writableEnded) {
          clientDisconnected = true;
          upstreamAbort.abort(new Error('Client closed connection'));
        }
      };
      res.on('close', onClientClose);

      try {
        const rawBody = (req.body || {}) as Record<string, any>;
        const upstreamBody: Record<string, any> = {
          model: rawBody.model || 'auto',
          messages: Array.isArray(rawBody.messages) ? rawBody.messages : [],
          stream: rawBody.stream !== false,
        };
        const derivedEffort = ctx.resolveReasoningEffort(
          rawBody.reasoning_effort,
          rawBody.run_config?.thinking_level,
          String(rawBody.model || '')
        );
        if (derivedEffort) upstreamBody.reasoning_effort = derivedEffort;
        if (typeof rawBody.temperature === 'number') upstreamBody.temperature = rawBody.temperature;
        if (typeof rawBody.top_p === 'number') upstreamBody.top_p = rawBody.top_p;
        if (typeof rawBody.max_tokens === 'number') upstreamBody.max_tokens = rawBody.max_tokens;
        if (rawBody.session_id) upstreamBody.session_id = rawBody.session_id;
        if (rawBody.conversation_id) upstreamBody.conversation_id = rawBody.conversation_id;
        if (rawBody.task_type) upstreamBody.task_type = rawBody.task_type;
        if (typeof rawBody.deepResearch === 'boolean')
          upstreamBody.deepResearch = rawBody.deepResearch;
        if (rawBody.userContext) upstreamBody.userContext = rawBody.userContext;
        if (rawBody.language_pref || rawBody.language) {
          upstreamBody.language_pref = rawBody.language_pref || rawBody.language;
        }

        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/stream/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKeyHeader ? { 'X-SupremeAI-Key': apiKeyHeader } : {}),
          },
          signal: upstreamAbort.signal,
          body: JSON.stringify(upstreamBody),
        });
        clearTimeout(connectTimer);

        if (upstreamRes.ok && upstreamRes.body) {
          res.status(upstreamRes.status);
          res.setHeader(
            'Content-Type',
            upstreamRes.headers.get('content-type') || 'text/event-stream'
          );
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          for (const hName of ['x-supremeai-provider', 'x-supremeai-slot', 'x-supremeai-tier']) {
            const hVal = upstreamRes.headers.get(hName);
            if (hVal) res.setHeader(hName, hVal);
          }
          res.flushHeaders?.();

          const reader = upstreamRes.body.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && !res.writableEnded) res.write(Buffer.from(value));
          }
          if (!res.writableEnded) res.end();
          return;
        }

        if (hasImageInRequest) {
          const errRaw = await upstreamRes.text().catch(() => '');
          let errMsg = `${upstreamRes.status} ${upstreamRes.statusText}`;
          try {
            const parsedErr = errRaw ? JSON.parse(errRaw) : null;
            errMsg =
              parsedErr?.error?.message ||
              parsedErr?.detail ||
              parsedErr?.message ||
              errRaw ||
              errMsg;
          } catch {
            if (errRaw) errMsg = errRaw;
          }
          remoteVisionFailure = ctx.classifyVisionHttpError({
            status: upstreamRes.status,
            message: errMsg,
            retryAfterHeader: upstreamRes.headers.get('retry-after'),
            provider: upstreamRes.headers.get('x-supremeai-provider') || 'supremeai-gateway',
            model: upstreamRes.headers.get('x-supremeai-slot') || undefined,
          });
          console.warn('[VisionRouter]', {
            provider: remoteVisionFailure.provider,
            model: remoteVisionFailure.model,
            status: remoteVisionFailure.status,
            category: remoteVisionFailure.category,
            retryAfterSeconds: remoteVisionFailure.retryAfterSeconds,
          });
        }
      } catch (proxyErr) {
        clearTimeout(connectTimer);
        if (clientDisconnected || res.writableEnded || res.destroyed) {
          return;
        }
        const reason = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
        if (hasImageInRequest) {
          remoteVisionFailure = ctx.classifyVisionHttpError({
            message: reason,
            provider: 'supremeai-gateway',
          });
        }
        console.info(
          `Upstream /api/v1/stream/chat unavailable (${reason}); serving via local studio pool.`
        );
      } finally {
        res.off('close', onClientClose);
      }
    }

    const body = req.body || {};
    const messages =
      Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages
        : [{ role: 'user', content: String(body.prompt || body.message || '') }];
    const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
    const isValidKey = Boolean(activeApiKey && activeApiKey !== 'MY_GEMINI_API_KEY');
    const reqModel = String(body.model || 'supreme-spark');
    const resolvedModel = ctx.resolveServerAutoModel(reqModel, messages);
    const runConfig: ChatRunConfigPayload | undefined =
      body.run_config && typeof body.run_config === 'object' ? body.run_config : undefined;
    const stealthWebhookUrl = process.env.STEALTH_WEBHOOK_URL?.trim() || '';

    if (
      stealthWebhookUrl &&
      !hasImageInRequest &&
      (resolvedModel === 'supremeai-web' || !isValidKey)
    ) {
      try {
        const webhookStart = Date.now();
        const webhookSecret = process.env.STEALTH_WEBHOOK_SECRET?.trim() || '';
        const wRes = await fetch(stealthWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(webhookSecret ? { 'X-SupremeAI-Webhook-Secret': webhookSecret } : {}),
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model: resolvedModel,
            messages,
            stream: false,
            ...(body.reasoning_effort ? { reasoning_effort: body.reasoning_effort } : {}),
          }),
        });
        if (wRes.ok) {
          const wJson = (await wRes.json().catch(() => null)) as any;
          const replyText =
            wJson?.choices?.[0]?.message?.content ?? wJson?.reply ?? wJson?.text ?? '';
          if (typeof replyText === 'string' && replyText.trim()) {
            const firstTokenMs = Math.max(1, Date.now() - webhookStart);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('X-SupremeAI-Provider', 'stealth-webhook');
            res.setHeader('X-SupremeAI-Slot', 'webhook-relay');
            res.setHeader('X-SupremeAI-Tier', 'webhook');
            res.flushHeaders?.();
            res.write(
              `data: ${JSON.stringify({
                model: resolvedModel,
                choices: [{ delta: { content: replyText } }],
                text: replyText,
                routeMeta: {
                  provider: 'stealth-webhook',
                  poolType: 'webhook',
                  engine: 'webhook-relay',
                  servedModel: resolvedModel,
                  firstTokenMs,
                  ...(runConfig?.thinking_level ? { thinkingLevel: runConfig.thinking_level } : {}),
                },
              })}\n\n`
            );
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }
      } catch (webhookErr) {
        console.warn('Local STEALTH_WEBHOOK_URL fallback failed, trying Gemini pool:', webhookErr);
      }
    }

    const upstreamModel = ctx.resolveUpstreamGeminiModel(resolvedModel, runConfig);
    const effectiveThinkingLevel = String(
      runConfig?.thinking_level ||
        (resolvedModel === 'supreme-reason' || resolvedModel === 'supreme-deep'
          ? 'HIGH'
          : resolvedModel === 'supreme-spark'
            ? 'LOW'
            : 'MEDIUM')
    ).toUpperCase();

    const systemMsgs = messages
      .filter((m: any) => m.role === 'system' && m.content)
      .map((m: any) => ctx.extractTextFromMessageContent(m.content).trim())
      .filter(Boolean);
    const systemMsg = systemMsgs.join('\n\n');
    const lastUserMsgObj = [...messages].reverse().find((m: any) => m.role === 'user');
    const lastUserMessageText = ctx.extractTextFromMessageContent(lastUserMsgObj?.content);
    const hasVisionAttachment = messages.some((m: any) => ctx.messageHasVisionOrAttachment(m));
    const rawBuildIntent =
      /\b(build|create|make|design|generate|project|php|laravel|python|flask|django|node|express|react|html|css|app|website|dashboard|portfolio|ecommerce|todo|calculator)\b|(প্রজেক্ট|অ্যাপ|ওয়েবসাইট|ড্যাশবোর্ড|বানাও|তৈরি\s*করো)/i.test(
        lastUserMessageText
      );
    const explicitBuildWithImage =
      /\b(build|create|make|generate|code|implement|convert|recreate|turn\s+(?:this|it)\s+into)\b|(বানাও|তৈরি\s*করো|কোড)/i.test(
        lastUserMessageText
      );
    const smartBuildIntent = hasVisionAttachment ? explicitBuildWithImage : rawBuildIntent;
    const smartResearchIntent =
      /\b(deep\s*research|comprehensive\s*(?:research\s*)?report|literature\s*review|citation(?:-ready)?)\b|(গভীর\s*রিসার্চ|রিসার্চ\s*রিপোর্ট)/i.test(
        lastUserMessageText
      );
    const serverIntentDirective =
      smartBuildIntent && !systemMsg.includes('[AUTONOMOUS PRODUCTION PROJECT BUILDER]')
        ? '\n\n[AUTONOMOUS PRODUCTION PROJECT BUILDER]\nDeliver a complete, styled, runnable multi-file project immediately using fenced blocks tagged with file="path" (e.g. ```php file="index.php"`, ```css file="styles.css"`, ```html file="index.html"`). Avoid empty stubs or manual tutorial checklists.'
        : smartResearchIntent
          ? '\n\n[AUTO DEEP RESEARCH]: Deliver a structured, comprehensive analytical report with executive takeaways, comparison tables, and clear citations.'
          : hasVisionAttachment && !systemMsg.includes('[MULTIMODAL VISION ANALYSIS PROTOCOL]')
            ? '\n\n[MULTIMODAL VISION ANALYSIS PROTOCOL]\nInspect all visual details, transcribe visible text/numbers verbatim before interpreting, state clearly if anything is blurry or cropped rather than guessing, and answer the user directly.'
            : '';
    const serverGroundingBlock =
      typeof body.groundingContext === 'string' &&
      body.groundingContext.trim() &&
      !systemMsg.includes(body.groundingContext.slice(0, 60))
        ? `\n\n[KNOWLEDGE BASE CONTEXT]\n${body.groundingContext.trim()}`
        : '';
    const userWroteBengali = ctx.detectBengaliOrBanglish(lastUserMessageText);
    const langDirective =
      body.language === 'bn' || userWroteBengali
        ? '\n\n[DEFAULT RESPONSE LANGUAGE]: Always reply in clear, natural Bengali (বাংলা script, not Romanized Banglish unless requested) by default, keeping code/technical identifiers in English unless the user explicitly asks for another language.'
        : '\n\n[DEFAULT RESPONSE LANGUAGE]: Reply in clear English by default unless the user writes in Bengali (বাংলা) or Romanized Bengali (Banglish), in which case reply in natural Bengali (বাংলা).';
    const combinedSystem = `${systemMsg || 'You are SupremeAI Studio, a helpful and authoritative AI assistant.'}${serverIntentDirective}${serverGroundingBlock}${langDirective}`;

    if (hasImageInRequest) {
      const imageCount = Math.max(1, ctx.countImagesInMessages(messages));
      await ctx.executeFreeVisionCascade({
        messages,
        combinedSystem,
        resolvedModel,
        runConfig,
        tuning: {
          temperature: body.temperature,
          top_p: body.top_p,
          max_tokens: body.max_tokens,
          thinking_budget: body.thinking_budget,
        },
        imageCount,
        effectiveThinkingLevel,
        res,
        priorRemoteError: remoteVisionFailure,
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-SupremeAI-Provider', 'local-gemini-pool');
    res.setHeader('X-SupremeAI-Slot', upstreamModel);
    res.setHeader(
      'X-SupremeAI-Tier',
      effectiveThinkingLevel === 'HIGH' || effectiveThinkingLevel === 'XHIGH'
        ? 'high-thinking'
        : effectiveThinkingLevel === 'LOW'
          ? 'low-latency'
          : 'balanced'
    );
    res.flushHeaders?.();

    if (isValidKey) {
      const streamStartAt = Date.now();
      try {
        const clientAi = new GoogleGenAI({
          apiKey: activeApiKey,
          httpOptions: { apiVersion: 'v1beta', headers: { 'User-Agent': 'aistudio-build' } },
        });
        const contents = messages
          .filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: ctx.buildGeminiPartsFromMessage(m),
          }));
        const streamConfig = ctx.buildGeminiGenerateConfig(
          combinedSystem,
          resolvedModel,
          runConfig,
          {
            temperature: body.temperature,
            top_p: body.top_p,
            max_tokens: body.max_tokens,
            thinking_budget: body.thinking_budget,
          },
          upstreamModel
        );
        const streamRes = await clientAi.models.generateContentStream({
          model: upstreamModel,
          contents,
          config: streamConfig,
        });
        const sourcesMap = new Map<string, { title: string; uri: string }>();
        let latestUsage: {
          promptTokens: number;
          candidateTokens: number;
          totalTokens: number;
          thoughtTokens?: number;
        } | null = null;
        let firstTokenMs: number | undefined;
        for await (const chunk of streamRes) {
          latestUsage = ctx.collectGroundingSourcesAndUsage(chunk, sourcesMap, latestUsage);
          const textChunk = (chunk as any).text || '';
          if (textChunk) {
            if (firstTokenMs === undefined) {
              firstTokenMs = Math.max(1, Date.now() - streamStartAt);
            }
            if (!res.writableEnded) {
              res.write(
                `data: ${JSON.stringify({ model: resolvedModel, choices: [{ delta: { content: textChunk } }], text: textChunk })}\n\n`
              );
            }
          }
        }
        const groundingSources = Array.from(sourcesMap.values());
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              ...(groundingSources.length > 0 ? { groundingSources } : {}),
              ...(latestUsage ? { tokenUsage: latestUsage } : {}),
              routeMeta: {
                provider: 'local-gemini-pool',
                poolType: 'api-pool',
                engine: upstreamModel,
                servedModel: resolvedModel,
                ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
                thinkingLevel: effectiveThinkingLevel,
              },
            })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
        }
        return;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Streaming inference failed';
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: { message: errMsg } })}\n\n`);
          res.end();
        }
        return;
      }
    }

    res.write(
      `data: ${JSON.stringify({ error: { message: 'No GEMINI_API_KEY or remote backend token configured for inference.' } })}\n\n`
    );
    res.end();
  });

  // Multi-turn chat endpoint (Enforces central Admin governance policies)
  app.post(
    '/api/chat',
    async (
      req: Request<Record<string, never>, Record<string, never>, any>,
      res: Response
    ) => {
      try {
        if (ctx.isIpBlocked(req)) {
          res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
          return;
        }

        const {
          model = ctx.platformConfig.defaultModelId || 'supreme-spark',
          messages = [],
          systemInstruction,
          groundingContext,
          stream = true,
          language,
          temperature,
          top_p,
          max_tokens,
          thinking_budget,
          run_config: runConfig,
        } = req.body;

        const authHeader = String(req.headers.authorization || '').trim();
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const verifiedIdentity = bearerToken ? await ctx.verifyBearerIdentity(bearerToken) : null;
        const adminAuth = verifiedIdentity?.isAdmin ? null : await ctx.verifyAdminAuthorization(req);
        const isVerifiedAdmin = Boolean(verifiedIdentity?.isAdmin || adminAuth?.ok);

        const callerRole = isVerifiedAdmin ? 'admin' : 'user';
        const callerEmail = verifiedIdentity?.email || (adminAuth?.ok ? adminAuth.email : '');
        const matchedCustomer = callerEmail
          ? ctx.customerDirectory.find((c) => c.email.toLowerCase() === callerEmail)
          : undefined;
        const callerTier: PlanTier = (matchedCustomer?.tier as PlanTier) || (verifiedIdentity?.tier as PlanTier) || 'Free';

        if (ctx.platformConfig.maintenanceMode && callerRole !== 'admin') {
          res.status(503).json({
            error:
              ctx.platformConfig.maintenanceMessage || 'Platform is currently in maintenance mode.',
          });
          return;
        }

        if (matchedCustomer && callerRole !== 'admin') {
          if (matchedCustomer.status === 'suspended') {
            res.status(403).json({
              error: 'Your workspace account is currently suspended. Contact your administrator.',
            });
            return;
          }
          if (matchedCustomer.tokensUsed >= matchedCustomer.tokenLimit) {
            res
              .status(429)
              .json({ error: 'Monthly token quota exhausted. Top up credits in Plan & Usage.' });
            return;
          }
        }

        if (!messages || messages.length === 0) {
          res.status(400).json({ error: 'Messages array is required and must not be empty.' });
          return;
        }

        const resolvedModel = ctx.resolveServerAutoModel(model, messages);
        const validatedModel = ctx.SUPPORTED_MODELS[resolvedModel] ? resolvedModel : 'supreme-spark';
        const upstreamModel = ctx.resolveUpstreamGeminiModel(validatedModel, runConfig);

        const modelPolicy = ctx.platformConfig.modelPolicies[validatedModel];
        if (modelPolicy) {
          if (!modelPolicy.enabled) {
            res.status(403).json({
              error: `Model "${ctx.SUPPORTED_MODELS[validatedModel]?.name || validatedModel}" is currently disabled by administrator policy.`,
            });
            return;
          }
          if (callerRole !== 'admin' && ctx.TIER_RANK[callerTier] < ctx.TIER_RANK[modelPolicy.minTier]) {
            res.status(403).json({
              error: `Model "${ctx.SUPPORTED_MODELS[validatedModel]?.name || validatedModel}" requires a ${modelPolicy.minTier} plan or higher.`,
            });
            return;
          }
        }

        const hasAttachment = messages.some((m: any) => ctx.messageHasVisionOrAttachment(m));
        if (hasAttachment && !ctx.runtimeFeatureFlags.enable_multimodal_vision) {
          res.status(403).json({
            error:
              'Multimodal image & file attachments are currently disabled by platform feature flags.',
          });
          return;
        }

        const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
        const isValidKey = activeApiKey && activeApiKey !== 'MY_GEMINI_API_KEY';

        const effectiveGrounding = ctx.runtimeFeatureFlags.enable_rag_grounding
          ? groundingContext
          : undefined;

        if (matchedCustomer) {
          const promptChars =
            ctx.extractTextFromMessageContent(messages[messages.length - 1]?.content).length || 120;
          matchedCustomer.tokensUsed += Math.max(120, Math.ceil(promptChars / 3) + 180);
          matchedCustomer.lastActive = 'Just now';
        }

        const defaultSystemInstruction =
          'You are SupremeAI, the premier intelligent AI engineering partner created by Supremeai-bd. You provide sharp, concise, authoritative code solutions, architectural insight, and deep reasoning with clean formatting.';

        let activeSystemInstruction = (systemInstruction || '').trim() || defaultSystemInstruction;

        const lastChatUserText = ctx.extractTextFromMessageContent(
          [...messages].reverse().find((m) => m.role === 'user')?.content
        );
        if (language === 'bn' || ctx.detectBengaliOrBanglish(lastChatUserText)) {
          activeSystemInstruction +=
            '\n\n[DEFAULT RESPONSE LANGUAGE]: Respond naturally and fluently in Bengali (বাংলা script, not Romanized Banglish unless requested) by default, keeping code/technical identifiers in English unless the user explicitly asks for another language.';
        } else {
          activeSystemInstruction +=
            '\n\n[DEFAULT RESPONSE LANGUAGE]: Respond in clear English by default unless the user writes in Bengali (বাংলা) or Romanized Bengali (Banglish), in which case respond in natural Bengali (বাংলা).';
        }

        if (effectiveGrounding && effectiveGrounding.trim()) {
          activeSystemInstruction += `\n\n[RETRIEVED KNOWLEDGE BASE CONTEXT (RAG)]:\n${effectiveGrounding.trim()}\n\nUse the above engineering knowledge context as primary truth and reference when answering.`;
        }

        if (isValidKey) {
          const clientAi = new GoogleGenAI({
            apiKey: activeApiKey,
            httpOptions: {
              apiVersion: 'v1beta',
              headers: {
                'User-Agent': 'aistudio-build',
              },
            },
          });

          const contents = messages
            .filter((msg: any) => msg.role === 'user' || msg.role === 'assistant')
            .map((msg: any) => ({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: ctx.buildGeminiPartsFromMessage(msg),
            }));

          if (contents.length === 0) {
            res.status(400).json({ error: 'No user or assistant messages found.' });
            return;
          }

          const generateConfig = ctx.buildGeminiGenerateConfig(
            activeSystemInstruction,
            validatedModel,
            runConfig,
            { temperature, top_p, max_tokens, thinking_budget },
            upstreamModel
          );

          const isDeepChatThinking =
            runConfig?.thinking_level === 'HIGH' ||
            runConfig?.thinking_level === 'XHIGH' ||
            validatedModel === 'supreme-reason' ||
            validatedModel === 'supreme-deep';
          const chatTimeoutMs = hasAttachment ? 35000 : isDeepChatThinking ? 35000 : 18000;
          if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('X-SupremeAI-Provider', 'local-gemini-pool');
            res.setHeader('X-SupremeAI-Slot', upstreamModel);
            res.flushHeaders?.();

            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(`Stream request timed out after ${Math.round(chatTimeoutMs / 1000)}s`)
                  ),
                chatTimeoutMs
              )
            );

            const responseStream = await Promise.race([
              clientAi.models.generateContentStream({
                model: upstreamModel,
                contents,
                config: generateConfig,
              }),
              timeoutPromise,
            ]);

            const sourcesMap = new Map<string, { title: string; uri: string }>();
            let latestUsage: {
              promptTokens: number;
              candidateTokens: number;
              totalTokens: number;
              thoughtTokens?: number;
            } | null = null;
            for await (const chunk of responseStream) {
              latestUsage = ctx.collectGroundingSourcesAndUsage(chunk, sourcesMap, latestUsage);
              const textChunk = (chunk as any).text || '';
              if (textChunk) {
                res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
              }
            }
            const groundingSources = Array.from(sourcesMap.values());
            if (groundingSources.length > 0 || latestUsage) {
              res.write(
                `data: ${JSON.stringify({
                  ...(groundingSources.length > 0 ? { groundingSources } : {}),
                  ...(latestUsage ? { tokenUsage: latestUsage } : {}),
                })}\n\n`
              );
            }

            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } else {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Inference request timed out after ${Math.round(chatTimeoutMs / 1000)}s`
                    )
                  ),
                chatTimeoutMs
              )
            );

            const chatStartAt = Date.now();
            const response = await Promise.race([
              clientAi.models.generateContent({
                model: upstreamModel,
                contents,
                config: generateConfig,
              }),
              timeoutPromise,
            ]);

            const sourcesMap = new Map<string, { title: string; uri: string }>();
            const tokenUsage = ctx.collectGroundingSourcesAndUsage(response, sourcesMap, null);
            const groundingSources = Array.from(sourcesMap.values());

            res.json({
              text: (response as any).text ?? '',
              model: validatedModel,
              routeMeta: {
                provider: 'local-gemini-pool',
                poolType: 'api-pool',
                engine: upstreamModel,
                servedModel: validatedModel,
                firstTokenMs: Math.max(1, Date.now() - chatStartAt),
                ...(runConfig?.thinking_level ? { thinkingLevel: runConfig.thinking_level } : {}),
              },
              ...(groundingSources.length > 0 ? { groundingSources } : {}),
              ...(tokenUsage ? { tokenUsage } : {}),
            });
            return;
          }
        }

        const lastUserMessage =
          [...messages].reverse().find((m: any) => m.role === 'user')?.content || 'Inquiry';
        const fallbackResponse = `### SupremeAI Studio Intelligence Engine\n\n**Model**: \`${validatedModel}\` · **Role**: Active Persona\n\nReceived prompt:\n> ${lastUserMessage}\n\n#### Architectural Insight\nSupremeAI Studio has processed your request through the ${validatedModel} pipeline. Here is the recommended technical approach for your \`supremeai-studio\` frontend and \`supremeai\` architecture:\n\n\`\`\`typescript\n// SupremeAI Core Pipeline Invariant\nexport interface StudioOrchestrator {\n  model: '${validatedModel}';\n  systemInstruction: string;\n  status: 'active';\n  latencyMode: 'low-latency';\n}\n\`\`\`\n\n*Note: To stream live inference directly, ensure your gateway connection is active.*`;

        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders?.();

          const words = fallbackResponse.split(' ');
          for (let i = 0; i < words.length; i += 3) {
            const chunk = words.slice(i, i + 3).join(' ') + ' ';
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
            await new Promise((r) => setTimeout(r, 40));
          }

          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.json({
            text: fallbackResponse,
            model: validatedModel,
          });
        }
      } catch (err: unknown) {
        console.error('Error in /api/chat:', err);
        let errorMessage =
          err instanceof Error ? err.message : 'Unknown server error during SupremeAI inference';

        try {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error?.message) {
            errorMessage = parsed.error.message;
          }
        } catch {
          // Keep original
        }

        if (!res.headersSent) {
          res.status(500).json({
            error: errorMessage,
            hint: errorMessage.includes('API_KEY')
              ? 'Please ensure your gateway credentials are configured in the environment.'
              : errorMessage.includes('demand')
                ? 'Model is under temporary high demand. Try SupremeAI Spark for faster throughput.'
                : 'SupremeAI inference failed.',
          });
        } else {
          res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
          res.end();
        }
      }
    }
  );
}
