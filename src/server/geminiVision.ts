import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Response } from 'express';
import { isTextReadableMimeOrFilename, decodeBase64AttachmentText } from '../utils/workbenchUtils';
import { buildFreeVisionCandidates, classifyVisionHttpError, VisionCooldownRegistry, type ClassifiedVisionError } from '../shared/visionRouting';
interface ChatRunConfigPayload {
  thinking_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
  google_search?: boolean;
  response_mime_type?: 'text/plain' | 'application/json';
  response_schema?: Record<string, unknown>;
}

// Local cooldown registry for free vision cascade
export const visionCooldownRegistry = new VisionCooldownRegistry();

export interface ChatAttachment {
  data: string;
  mimeType?: string;
  name?: string;
}

export function resolveThinkingLevel(
  rawLevel?: string,
  reqModel?: string,
  targetUpstreamModel?: string
): ThinkingLevel {
  const normalized = String(rawLevel || '').toUpperCase();
  const isGemini25 = Boolean(targetUpstreamModel && targetUpstreamModel.startsWith('gemini-2.5-'));
  const supportsXHigh = !targetUpstreamModel || targetUpstreamModel === 'gemini-4-hydrogen';
  if (normalized === 'LOW') return ThinkingLevel.LOW;
  if (normalized === 'MEDIUM') return ThinkingLevel.MEDIUM;
  if (normalized === 'HIGH') return ThinkingLevel.HIGH;
  if (normalized === 'XHIGH') {
    return isGemini25 || !supportsXHigh ? ThinkingLevel.HIGH : ThinkingLevel.XHIGH;
  }
  if (
    reqModel === 'supreme-reason' ||
    reqModel === 'supreme-deep' ||
    reqModel === 'supreme-reasoning'
  ) {
    return ThinkingLevel.HIGH;
  }
  if (reqModel === 'supreme-spark') {
    return ThinkingLevel.LOW;
  }
  return ThinkingLevel.MEDIUM;
}

export function resolveReasoningEffort(
  rawEffort?: unknown,
  rawThinkingLevel?: unknown,
  reqModel?: string
): 'low' | 'medium' | 'high' | undefined {
  const effort = String(rawEffort || '')
    .trim()
    .toLowerCase();
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return effort;
  }
  const lvl = String(rawThinkingLevel || '')
    .trim()
    .toUpperCase();
  if (lvl === 'LOW') return 'low';
  if (lvl === 'MEDIUM') return 'medium';
  if (lvl === 'HIGH' || lvl === 'XHIGH') return 'high';
  if (reqModel === 'supreme-reason' || reqModel === 'supreme-deep') return 'high';
  if (reqModel === 'supreme-spark') return 'low';
  return undefined;
}

export function resolveServerAutoModel(reqModel: string, messages: any[]): string {
  const clean = String(reqModel || '').trim();
  if (clean && clean !== 'auto' && clean !== 'default') {
    return clean;
  }
  const lastUserMsgObj = Array.isArray(messages)
    ? [...messages].reverse().find((m: any) => m?.role === 'user')
    : null;
  const lastText = extractTextFromMessageContent(lastUserMsgObj?.content).trim();
  const hasVision =
    Array.isArray(messages) && messages.some((m: any) => messageHasVisionOrAttachment(m));
  if (
    /\b(architect(?:ure)?|security\s*audit|vulnerabilit(?:y|ies)|proof|theorem|root\s*cause|distributed|race\s*condition|invariant|benchmark)\b|(আর্কিটেকচার|অডিট|নিরাপত্তা|রুট\s*কজ)/i.test(
      lastText
    )
  ) {
    return 'supreme-reason';
  }
  if (
    /\b(project|multi-file|full-stack|ecommerce|dashboard|web\s*app|website|saas|portfolio|php|laravel|python|flask|django|express|todo|calculator)\b|(প্রজেক্ট|অ্যাপ|ড্যাশবোর্ড|ওয়েবসাইট|পোর্টফোলিও)/i.test(
      lastText
    )
  ) {
    return 'supreme-deep';
  }
  if (
    /\b(latest|today|current(?:ly)?|news|price|weather|stock|live)\b|(সর্বশেষ|আজকের|খবর|দাম|আবহাওয়া)/i.test(
      lastText
    ) &&
    !hasVision
  ) {
    return 'supremeai-web';
  }
  if (
    hasVision ||
    lastText.length > 160 ||
    /\b(analyze|analyse|trade-?offs?|compare|step[\s-]+by[\s-]+step|optimize|debug|refactor|code|typescript|javascript|react)\b|(বিশ্লেষণ|তুলনা|ধাপে\s*ধাপে|কোড)/i.test(
      lastText
    )
  ) {
    return 'supreme-core';
  }
  return 'supreme-spark';
}

export function resolveUpstreamGeminiModel(
  _resolvedModel: string,
  _runConfig?: ChatRunConfigPayload
): string {
  return 'gemini-4-hydrogen';
}

export function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function messageHasVisionOrAttachment(msg: any): boolean {
  if (!msg) return false;
  if (msg.attachment && msg.attachment.data) return true;
  if (Array.isArray(msg.attachments) && msg.attachments.some((a: any) => Boolean(a?.data))) {
    return true;
  }
  if (
    Array.isArray(msg.content) &&
    msg.content.some((p: any) => p?.type === 'image_url' && typeof p?.image_url?.url === 'string')
  ) {
    return true;
  }
  if (Array.isArray(msg.parts) && msg.parts.some((p: any) => Boolean(p?.inlineData?.data))) {
    return true;
  }
  return false;
}

export function messageHasActualImage(msg: any): boolean {
  if (!msg) return false;
  const isImg = (att: any) =>
    Boolean(
      att?.data &&
      (String(att.mimeType || '')
        .toLowerCase()
        .startsWith('image/') ||
        String(att.data || '').startsWith('data:image/'))
    );
  if (isImg(msg.attachment)) return true;
  if (Array.isArray(msg.attachments) && msg.attachments.some((a: any) => isImg(a))) {
    return true;
  }
  if (
    Array.isArray(msg.content) &&
    msg.content.some((p: any) => p?.type === 'image_url' && typeof p?.image_url?.url === 'string')
  ) {
    return true;
  }
  if (
    Array.isArray(msg.parts) &&
    msg.parts.some(
      (p: any) =>
        Boolean(p?.inlineData?.data) &&
        String(p.inlineData.mimeType || 'image/png')
          .toLowerCase()
          .startsWith('image/')
    )
  ) {
    return true;
  }
  return false;
}

export function buildGeminiPartsFromMessage(msg: any): any[] {
  const parts: any[] = [];
  const seenInlineData = new Set<string>();
  const pushInlineData = (mimeType: string, data: string) => {
    const rawData = data.includes(',') ? data.split(',')[1] : data;
    const cleanData = rawData.replace(/\s+/g, '');
    if (!cleanData) return;
    const key = `${mimeType}:${cleanData.slice(0, 64)}:${cleanData.length}`;
    if (seenInlineData.has(key)) return;
    seenInlineData.add(key);
    parts.push({
      inlineData: {
        mimeType: mimeType || 'image/png',
        data: cleanData,
      },
    });
  };

  if (Array.isArray(msg?.content)) {
    for (const part of msg.content) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        parts.push({ text: part.text });
      } else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const urlStr = part.image_url.url;
        const dataMatch = urlStr.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/);
        if (dataMatch) {
          pushInlineData(dataMatch[1], dataMatch[2]);
        }
      }
    }
  } else if (typeof msg?.content === 'string' && msg.content.length > 0) {
    parts.push({ text: msg.content });
  }

  const rawAttachments: ChatAttachment[] = [];
  if (Array.isArray(msg?.attachments)) {
    for (const a of msg.attachments) {
      if (a) rawAttachments.push(a);
    }
  }
  if (msg?.attachment) {
    rawAttachments.push(msg.attachment);
  }

  const existingText = extractTextFromMessageContent(msg?.content);
  for (const att of rawAttachments) {
    if (!att || typeof att.data !== 'string' || att.data.length === 0) continue;
    const mime = String(att.mimeType || 'application/octet-stream');
    const name = String(att.name || 'attachment');
    if (isTextReadableMimeOrFilename(mime, name)) {
      if (
        !existingText.includes(`[ATTACHED FILE: ${name}]`) &&
        !existingText.includes(`[Attached Document: ${name}`)
      ) {
        const decoded = decodeBase64AttachmentText(att.data, 18000);
        if (decoded) {
          parts.push({ text: `[ATTACHED FILE: ${name}]\n\`\`\`\n${decoded}\n\`\`\`` });
        }
      }
    } else {
      pushInlineData(mime, att.data);
    }
  }

  if (seenInlineData.size === 0 && Array.isArray(msg?.parts)) {
    for (const part of msg.parts) {
      if (part?.inlineData?.data) {
        pushInlineData(
          String(part.inlineData.mimeType || 'image/png'),
          String(part.inlineData.data)
        );
      }
    }
  }

  if (parts.length === 0) {
    parts.push({ text: '' });
  }
  return parts;
}

export function buildGeminiGenerateConfig(
  systemInstruction: string,
  reqModel: string,
  runConfig?: ChatRunConfigPayload,
  tuning?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    thinking_budget?: number;
  },
  upstreamModel: string = 'gemini-4-hydrogen'
): Record<string, any> {
  const resolvedLevel = resolveThinkingLevel(runConfig?.thinking_level, reqModel, upstreamModel);
  const rawLevel = String(runConfig?.thinking_level || '').toUpperCase();
  const isGemini4 = upstreamModel.startsWith('gemini-4-');
  const isGemini3 = upstreamModel.startsWith('gemini-3');
  const isGemini25 = upstreamModel.startsWith('gemini-2.5-');
  const thinkingConfig: Record<string, any> = {};

  if (isGemini4 || isGemini3) {
    thinkingConfig.thinkingLevel = resolvedLevel;
  }

  if (isGemini25) {
    if (
      typeof tuning?.thinking_budget === 'number' &&
      Number.isFinite(tuning.thinking_budget) &&
      tuning.thinking_budget >= 0
    ) {
      thinkingConfig.thinkingBudget =
        upstreamModel.startsWith('gemini-2.5-pro') && tuning.thinking_budget === 0
          ? 128
          : tuning.thinking_budget;
    } else if (rawLevel === 'LOW' && upstreamModel.startsWith('gemini-2.5-flash')) {
      thinkingConfig.thinkingBudget = 0;
    } else if (rawLevel === 'XHIGH') {
      thinkingConfig.thinkingBudget = 16384;
    } else if (
      rawLevel === 'HIGH' ||
      reqModel === 'supreme-reason' ||
      reqModel === 'supreme-deep'
    ) {
      thinkingConfig.thinkingBudget = 8192;
    }
  }

  const config: Record<string, any> = {
    systemInstruction,
    ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
  };

  if (!isGemini4) {
    if (typeof tuning?.temperature === 'number' && Number.isFinite(tuning.temperature)) {
      config.temperature = tuning.temperature;
    }
    if (typeof tuning?.top_p === 'number' && Number.isFinite(tuning.top_p)) {
      config.topP = tuning.top_p;
    }
  }
  if (
    typeof tuning?.max_tokens === 'number' &&
    Number.isFinite(tuning.max_tokens) &&
    tuning.max_tokens > 0
  ) {
    config.maxOutputTokens = Math.floor(tuning.max_tokens);
  }

  const wantsJson = runConfig?.response_mime_type === 'application/json';
  if (wantsJson) {
    config.responseMimeType = 'application/json';
    if (
      runConfig?.response_schema &&
      typeof runConfig.response_schema === 'object' &&
      !Array.isArray(runConfig.response_schema)
    ) {
      config.responseSchema = runConfig.response_schema;
    }
  } else if (runConfig?.google_search === true) {
    config.tools = [{ googleSearch: {} }];
  }

  return config;
}

export function collectGroundingSourcesAndUsage(
  chunk: any,
  sourcesMap: Map<string, { title: string; uri: string }>,
  latestUsage: {
    promptTokens: number;
    candidateTokens: number;
    totalTokens: number;
    thoughtTokens?: number;
  } | null
): {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
  thoughtTokens?: number;
} | null {
  const groundingChunks = chunk?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (Array.isArray(groundingChunks)) {
    for (const gc of groundingChunks) {
      const uri = String(gc?.web?.uri || '').trim();
      if (!uri || !/^https?:\/\//i.test(uri)) continue;
      const title = String(gc?.web?.title || '').trim() || new URL(uri).hostname;
      if (!sourcesMap.has(uri)) {
        sourcesMap.set(uri, { title, uri });
      }
    }
  }
  const usage = chunk?.usageMetadata;
  if (usage && typeof usage === 'object') {
    return {
      promptTokens: Number(usage.promptTokenCount || 0),
      candidateTokens: Number(usage.candidatesTokenCount || 0),
      totalTokens: Number(usage.totalTokenCount || 0),
      ...(typeof usage.thoughtsTokenCount === 'number' && usage.thoughtsTokenCount > 0
        ? { thoughtTokens: usage.thoughtsTokenCount }
        : {}),
    };
  }
  return latestUsage;
}

export function countImagesInMessages(messages: any[]): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    if (!m) continue;
    const seen = new Set<string>();
    const addKey = (k: string) => {
      if (!seen.has(k)) {
        seen.add(k);
        total += 1;
      }
    };
    const inspectAtt = (att: any) => {
      if (!att?.data) return;
      const mime = String(att.mimeType || '').toLowerCase();
      const dataStr = String(att.data || '');
      if (mime.startsWith('image/') || dataStr.startsWith('data:image/')) {
        addKey(`att:${dataStr.slice(0, 64)}:${dataStr.length}`);
      }
    };
    inspectAtt(m.attachment);
    if (Array.isArray(m.attachments)) {
      for (const a of m.attachments) inspectAtt(a);
    }
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p?.type === 'image_url' && typeof p?.image_url?.url === 'string') {
          const u = p.image_url.url;
          addKey(`url:${u.slice(0, 64)}:${u.length}`);
        }
      }
    }
    if (Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (
          p?.inlineData?.data &&
          String(p.inlineData.mimeType || 'image/png')
            .toLowerCase()
            .startsWith('image/')
        ) {
          const d = String(p.inlineData.data);
          addKey(`inline:${d.slice(0, 64)}:${d.length}`);
        }
      }
    }
  }
  return total;
}

export function buildOpenAiVisionMessages(
  messages: any[],
  systemInstruction: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: any }> {
  const result: Array<{ role: 'system' | 'user' | 'assistant'; content: any }> = [
    { role: 'system', content: systemInstruction },
  ];

  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const role: 'user' | 'assistant' = m.role;
    const textChunks: string[] = [];
    const imageUrls: string[] = [];
    const seenUrls = new Set<string>();

    const pushImageUrl = (url: string) => {
      const clean = String(url || '').trim();
      if (!clean) return;
      const sig = `${clean.slice(0, 80)}:${clean.length}`;
      if (seenUrls.has(sig)) return;
      seenUrls.add(sig);
      imageUrls.push(clean);
    };

    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p?.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
          textChunks.push(p.text);
        } else if (p?.type === 'image_url' && typeof p?.image_url?.url === 'string') {
          pushImageUrl(p.image_url.url);
        }
      }
    } else if (typeof m.content === 'string' && m.content.trim()) {
      textChunks.push(m.content);
    }

    const rawAttachments: any[] = [];
    if (Array.isArray(m.attachments)) rawAttachments.push(...m.attachments);
    if (m.attachment) rawAttachments.push(m.attachment);
    for (const att of rawAttachments) {
      if (!att?.data) continue;
      const mime = String(att.mimeType || '');
      const name = String(att.name || 'attachment');
      if (mime.toLowerCase().startsWith('image/') || String(att.data).startsWith('data:image/')) {
        const dataUrl = String(att.data).startsWith('data:')
          ? String(att.data)
          : `data:${mime || 'image/png'};base64,${att.data}`;
        pushImageUrl(dataUrl);
      } else if (isTextReadableMimeOrFilename(mime, name)) {
        const decoded = decodeBase64AttachmentText(att.data, 18000);
        if (decoded) {
          textChunks.push(`[ATTACHED FILE: ${name}]\n\`\`\`\n${decoded}\n\`\`\``);
        }
      }
    }

    if (imageUrls.length === 0 && Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (p?.inlineData?.data) {
          const mime = String(p.inlineData.mimeType || 'image/png');
          if (mime.toLowerCase().startsWith('image/')) {
            pushImageUrl(`data:${mime};base64,${p.inlineData.data}`);
          }
        }
      }
    }

    const mergedText = textChunks.join('\n').trim();
    if (role === 'user' && imageUrls.length > 0) {
      const contentArr: any[] = [
        {
          type: 'text',
          text:
            mergedText ||
            'Please analyze the attached image(s) carefully, transcribing visible text accurately before explaining.',
        },
        ...imageUrls.map((url) => ({
          type: 'image_url',
          image_url: { url },
        })),
      ];
      result.push({ role: 'user', content: contentArr });
    } else {
      result.push({ role, content: mergedText || '' });
    }
  }

  return result;
}

export function extractSdkErrorMetadata(err: unknown): {
  status?: number;
  retryAfterHeader?: string | null;
  message: string;
} {
  const anyErr = err as any;
  const statusCandidate =
    typeof anyErr?.status === 'number'
      ? anyErr.status
      : typeof anyErr?.statusCode === 'number'
        ? anyErr.statusCode
        : typeof anyErr?.response?.status === 'number'
          ? anyErr.response.status
          : undefined;
  let retryAfterHeader: string | null = null;
  try {
    retryAfterHeader =
      anyErr?.response?.headers?.get?.('retry-after') ||
      anyErr?.headers?.get?.('retry-after') ||
      anyErr?.response?.headers?.['retry-after'] ||
      null;
  } catch {
    retryAfterHeader = null;
  }
  const message = err instanceof Error ? err.message : String(err || 'Unknown provider error');
  return { status: statusCandidate, retryAfterHeader, message };
}

export function writeVisionSseHeaders(
  res: Response,
  provider: string,
  modelSlot: string,
  tier: string = 'free-vision'
) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-SupremeAI-Provider', provider);
    res.setHeader('X-SupremeAI-Slot', modelSlot);
    res.setHeader('X-SupremeAI-Tier', tier);
    res.flushHeaders?.();
  }
}

export async function runOpenAiCompatibleVisionRequest(params: {
  endpoint: string;
  apiKey: string;
  candidate: any;
  openAiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
}): Promise<
  { ok: true; text: string; usage?: any } | { ok: false; classified: ClassifiedVisionError }
> {
  const { endpoint, apiKey, candidate, openAiMessages, maxTokens, extraHeaders } = params;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(extraHeaders || {}),
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: candidate.model,
        messages: openAiMessages,
        stream: false,
        max_tokens:
          typeof maxTokens === 'number' && maxTokens > 0 ? Math.min(4096, maxTokens) : 1400,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      let errMsg = `${resp.status} ${resp.statusText}`;
      try {
        const parsed = errText ? JSON.parse(errText) : null;
        errMsg =
          parsed?.error?.message ||
          parsed?.errors?.[0]?.message ||
          parsed?.message ||
          parsed?.detail ||
          errText ||
          errMsg;
      } catch {
        if (errText) errMsg = errText;
      }
      return {
        ok: false,
        classified: classifyVisionHttpError({
          status: resp.status,
          message: errMsg,
          retryAfterHeader: resp.headers.get('retry-after'),
          provider: candidate.provider,
          model: candidate.model,
        }),
      };
    }

    const data = (await resp.json().catch(() => null)) as any;
    const text =
      data?.choices?.[0]?.message?.content ?? data?.result?.response ?? data?.response ?? '';
    if (typeof text !== 'string' || !text.trim()) {
      return {
        ok: false,
        classified: classifyVisionHttpError({
          status: 502,
          message: 'Vision provider returned an empty response.',
          provider: candidate.provider,
          model: candidate.model,
        }),
      };
    }
    const rawUsage = data?.usage;
    const usage =
      rawUsage && typeof rawUsage === 'object'
        ? {
            promptTokens: Number(rawUsage.prompt_tokens || 0),
            candidateTokens: Number(rawUsage.completion_tokens || 0),
            totalTokens: Number(rawUsage.total_tokens || 0),
          }
        : undefined;
    return { ok: true, text, usage };
  } catch (err) {
    const meta = extractSdkErrorMetadata(err);
    return {
      ok: false,
      classified: classifyVisionHttpError({
        status: meta.status,
        message: meta.message,
        retryAfterHeader: meta.retryAfterHeader,
        provider: candidate.provider,
        model: candidate.model,
      }),
    };
  }
}

export async function executeFreeVisionCascade(params: {
  messages: any[];
  combinedSystem: string;
  resolvedModel: string;
  runConfig?: ChatRunConfigPayload;
  tuning: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    thinking_budget?: number;
  };
  imageCount: number;
  effectiveThinkingLevel: string;
  res: Response;
  priorRemoteError?: ClassifiedVisionError | null;
}): Promise<void> {
  const {
    messages,
    combinedSystem,
    resolvedModel,
    runConfig,
    tuning,
    imageCount,
    effectiveThinkingLevel,
    res,
    priorRemoteError,
  } = params;

  const candidates = buildFreeVisionCandidates(
    {
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiVisionModel: process.env.GEMINI_VISION_MODEL,
      geminiFallbackVisionModel: process.env.GEMINI_FALLBACK_VISION_MODEL,
      groqApiKey: process.env.GROQ_API_KEY,
      groqVisionModel: process.env.GROQ_VISION_MODEL,
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL,
      cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
      cloudflareVisionModel: process.env.CLOUDFLARE_VISION_MODEL,
    },
    imageCount
  );

  let lastError: ClassifiedVisionError | null = priorRemoteError || null;
  let maxCooldownSec = 0;
  let hadCoolingCandidate = false;

  const contents = messages
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: buildGeminiPartsFromMessage(m),
    }));
  const openAiMessages = buildOpenAiVisionMessages(messages, combinedSystem);

  for (const candidate of candidates) {
    if (visionCooldownRegistry.isCoolingDown(candidate.id)) {
      hadCoolingCandidate = true;
      const rem = visionCooldownRegistry.getRemainingSeconds(candidate.id);
      if (rem > maxCooldownSec) maxCooldownSec = rem;
      continue;
    }

    const startedAt = Date.now();

    if (candidate.provider === 'gemini') {
      const apiKey = (process.env.GEMINI_API_KEY || '').trim();
      let emittedChunk = false;
      try {
        const clientAi = new GoogleGenAI({
          apiKey,
          httpOptions: { apiVersion: 'v1beta', headers: { 'User-Agent': 'aistudio-build' } },
        });
        const streamConfig = buildGeminiGenerateConfig(
          combinedSystem,
          resolvedModel,
          runConfig,
          tuning,
          candidate.model
        );
        const streamRes = await clientAi.models.generateContentStream({
          model: candidate.model,
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
          latestUsage = collectGroundingSourcesAndUsage(chunk, sourcesMap, latestUsage);
          const textChunk = (chunk as any).text || '';
          if (textChunk) {
            if (!emittedChunk) {
              emittedChunk = true;
              firstTokenMs = Math.max(1, Date.now() - startedAt);
              writeVisionSseHeaders(res, 'local-gemini-pool', candidate.model, 'free-vision');
            }
            if (!res.writableEnded) {
              res.write(
                `data: ${JSON.stringify({
                  model: resolvedModel,
                  choices: [{ delta: { content: textChunk } }],
                  text: textChunk,
                })}\n\n`
              );
            }
          }
        }

        if (emittedChunk && !res.writableEnded) {
          const groundingSources = Array.from(sourcesMap.values());
          res.write(
            `data: ${JSON.stringify({
              ...(groundingSources.length > 0 ? { groundingSources } : {}),
              ...(latestUsage ? { tokenUsage: latestUsage } : {}),
              routeMeta: {
                provider: 'local-gemini-pool',
                poolType: 'api-pool',
                engine: candidate.model,
                servedModel: resolvedModel,
                ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
                thinkingLevel: effectiveThinkingLevel,
              },
            })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (!emittedChunk) {
          throw new Error('Gemini vision stream produced no text chunks.');
        }
        return;
      } catch (err) {
        const meta = extractSdkErrorMetadata(err);
        const classified = classifyVisionHttpError({
          status: meta.status,
          message: meta.message,
          retryAfterHeader: meta.retryAfterHeader,
          provider: candidate.provider,
          model: candidate.model,
        });
        const cdSec = visionCooldownRegistry.markFailure(candidate.id, classified);
        console.warn('[VisionRouter]', {
          provider: candidate.provider,
          model: candidate.model,
          status: classified.status,
          category: classified.category,
          retryAfterSeconds: classified.retryAfterSeconds ?? cdSec,
          imageCount,
        });
        lastError = classified;
        if (emittedChunk && !res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              error: {
                message: classified.safeSummary,
                category: classified.category,
                status: classified.status,
                retryAfterSeconds: classified.retryAfterSeconds,
                provider: classified.provider,
                model: classified.model,
                ocrSuggested: true,
              },
            })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        continue;
      }
    }

    let openAiResult:
      | { ok: true; text: string; usage?: any }
      | { ok: false; classified: ClassifiedVisionError }
      | null = null;

    if (candidate.provider === 'groq') {
      const groqKey = (process.env.GROQ_API_KEY || '').trim();
      openAiResult = await runOpenAiCompatibleVisionRequest({
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: groqKey,
        candidate,
        openAiMessages,
        maxTokens: tuning.max_tokens,
      });
    } else if (candidate.provider === 'openrouter') {
      const orKey = (process.env.OPENROUTER_API_KEY || '').trim();
      openAiResult = await runOpenAiCompatibleVisionRequest({
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: orKey,
        candidate,
        openAiMessages,
        maxTokens: tuning.max_tokens,
        extraHeaders: {
          'HTTP-Referer': 'https://supremeai.studio',
          'X-Title': 'SupremeAI Studio',
        },
      });
    } else if (candidate.provider === 'cloudflare') {
      const cfAcct = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
      const cfToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
      openAiResult = await runOpenAiCompatibleVisionRequest({
        endpoint: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAcct)}/ai/v1/chat/completions`,
        apiKey: cfToken,
        candidate,
        openAiMessages,
        maxTokens: tuning.max_tokens,
      });
    }

    if (openAiResult?.ok) {
      const firstTokenMs = Math.max(1, Date.now() - startedAt);
      const providerLabel = `free-${candidate.provider}-vision`;
      writeVisionSseHeaders(res, providerLabel, candidate.model, 'free-vision');
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            model: resolvedModel,
            choices: [{ delta: { content: openAiResult.text } }],
            text: openAiResult.text,
            ...(openAiResult.usage ? { tokenUsage: openAiResult.usage } : {}),
            routeMeta: {
              provider: providerLabel,
              poolType: 'api-pool',
              engine: candidate.model,
              servedModel: resolvedModel,
              firstTokenMs,
              thinkingLevel: effectiveThinkingLevel,
            },
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }

    if (openAiResult && !openAiResult.ok) {
      const cdSec = visionCooldownRegistry.markFailure(candidate.id, openAiResult.classified);
      console.warn('[VisionRouter]', {
        provider: candidate.provider,
        model: candidate.model,
        status: openAiResult.classified.status,
        category: openAiResult.classified.category,
        retryAfterSeconds: openAiResult.classified.retryAfterSeconds ?? cdSec,
        imageCount,
      });
      lastError = openAiResult.classified;
    }
  }

  writeVisionSseHeaders(res, 'vision-router', 'unavailable', 'free-vision');
  const finalErr: ClassifiedVisionError = lastError || {
    category: hadCoolingCandidate ? 'quota_rate_limit' : 'gateway_unavailable',
    ...(hadCoolingCandidate && maxCooldownSec > 0 ? { retryAfterSeconds: maxCooldownSec } : {}),
    safeSummary: hadCoolingCandidate
      ? 'Free-tier vision models are temporarily cooling down after rate limits. Use browser OCR below or retry shortly.'
      : 'No free-tier vision provider is currently configured or available. Use browser OCR below.',
    ocrSuggested: true,
  };
  if (!res.writableEnded) {
    res.write(
      `data: ${JSON.stringify({
        error: {
          message: finalErr.safeSummary,
          category: finalErr.category,
          status: finalErr.status,
          retryAfterSeconds: finalErr.retryAfterSeconds,
          provider: finalErr.provider,
          model: finalErr.model,
          ocrSuggested: true,
        },
      })}\n\n`
    );
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// Re-export shared types for convenience
export type { ClassifiedVisionError };
