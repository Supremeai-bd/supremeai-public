import {
  ChatAttachment,
  ChatMessage,
  ChatRouteMeta,
  GroundingSource,
  TokenUsageSummary,
  WorkbenchRunSettings,
} from '../types';
import { env } from '../config/env';
import { DEFAULT_BACKEND_ORIGIN } from '../config/platformEndpoints';
import { apiClient } from './apiClient';
import { detectBengaliOrBanglish } from '../utils/speechUtils';
import { authService } from './authService';
import {
  decodeBase64AttachmentText,
  isTextReadableMimeOrFilename,
  validateJsonSchemaInput,
} from '../utils/workbenchUtils';
import { getMessageAttachments, isImageAttachment } from '../utils/imageAttachmentUtils';
import { classifyVisionHttpError, type ClassifiedVisionError } from '../shared/visionRouting';

export class VisionRequestError extends Error {
  meta: ClassifiedVisionError;
  constructor(message: string, meta: ClassifiedVisionError) {
    super(message);
    this.name = 'VisionRequestError';
    this.meta = meta;
  }
}
import { resolveThinkingParams } from '../utils/chatAutoIntent';
import {
  WEB_RELAY_FALLBACK_MODEL,
  WEB_RELAY_MODEL,
  isWebRelayDown,
  isWebRelayFailure,
  markWebRelayDown,
} from './webRelayHealth';

export function prepareConversationMessagesForGateway(messages: ChatMessage[]): {
  preparedMessages: ChatMessage[];
  hasImageAttachment: boolean;
} {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  const preparedMessages = messages.map((m, idx) => {
    if (m.role !== 'user' || idx >= lastUserIndex) {
      return m;
    }
    const atts = getMessageAttachments(m);
    const hadImages = atts.some((att) => isImageAttachment(att));
    if (!hadImages) return m;

    let hasImmediateAssistantReply = false;
    for (let j = idx + 1; j < messages.length; j++) {
      if (messages[j].role === 'assistant') {
        hasImmediateAssistantReply = true;
        break;
      }
      if (messages[j].role === 'user') {
        break;
      }
    }
    if (hasImmediateAssistantReply) return m;

    const nonImageAttachments = atts.filter((att) => !isImageAttachment(att));
    const stripped: ChatMessage = {
      ...m,
      content: m.content?.trim()
        ? m.content
        : '[Previous image upload skipped after vision failure]',
    };
    delete stripped.attachment;
    delete stripped.attachments;
    if (nonImageAttachments.length > 0) {
      stripped.attachment = nonImageAttachments[0];
      if (nonImageAttachments.length > 1) {
        stripped.attachments = nonImageAttachments;
      }
    }
    return stripped;
  });

  const hasImageAttachment = preparedMessages.some((m) =>
    getMessageAttachments(m).some((att) => isImageAttachment(att))
  );

  return { preparedMessages, hasImageAttachment };
}

export interface ChatStreamMeta {
  groundingSources?: GroundingSource[];
  tokenUsage?: TokenUsageSummary;
  routeMeta?: ChatRouteMeta;
}

function inferRoutePoolType(
  provider?: string,
  badge?: string,
  requestedModel?: string
): ChatRouteMeta['poolType'] {
  const combined = `${provider || ''} ${badge || ''} ${requestedModel || ''}`.toLowerCase();
  if (
    combined.includes('stealth') ||
    combined.includes('webhook') ||
    combined.includes('ghost') ||
    combined.includes('web relay') ||
    requestedModel === 'supremeai-web'
  ) {
    return 'webhook';
  }
  if (
    combined.includes('local-gemini') ||
    combined.includes('local_gemini') ||
    combined.includes('studio-fallback')
  ) {
    return 'local';
  }
  if (
    combined.includes('squad') ||
    combined.includes('api-pool') ||
    combined.includes('api pool') ||
    combined.includes('groq') ||
    combined.includes('openrouter') ||
    combined.includes('cerebras') ||
    combined.includes('adaptive') ||
    requestedModel === 'supremeai-api'
  ) {
    return 'api-pool';
  }
  return undefined;
}

export interface ChatStreamOptions {
  model: string;
  messages: ChatMessage[];
  sessionId?: string;
  systemInstruction?: string;
  groundingContext?: string;
  deepResearch?: boolean;
  stream?: boolean;
  language?: 'en' | 'bn';
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  thinkingBudget?: number;
  runConfig?: WorkbenchRunSettings;
  userContext?: {
    email?: string;
    role?: 'admin' | 'user';
    tier?: 'Free' | 'Pro' | 'Enterprise';
  };
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onMeta?: (meta: ChatStreamMeta) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
}

export type OpenAIContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface FormattedGatewayMessage {
  role: string;
  content: string | OpenAIContentPart[];
  attachment?: ChatAttachment;
  parts?: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
}

export const chatService = {
  /**
   * বাংলা মন্তব্য: supremeai-web (relay-only) লেনে relay ডাউন হলে ব্যবহারকারী হার্ড এরর
   * না দেখে — কোনো টোকেন আসার আগেই ব্যর্থ হলে একবার স্বয়ংক্রিয়ভাবে API pool
   * (supremeai-api)-এ আবার চেষ্টা হয়, আর ৫ মিনিট relay এড়ানো হয় (webRelayHealth)।
   */
  async streamChat(options: ChatStreamOptions): Promise<void> {
    if (options.model !== WEB_RELAY_MODEL) {
      return chatService.streamChatOnce(options);
    }
    const toApiPool = () => {
      options.onMeta?.({
        routeMeta: { poolType: 'api-pool', servedModel: WEB_RELAY_FALLBACK_MODEL },
      });
      return chatService.streamChatOnce({ ...options, model: WEB_RELAY_FALLBACK_MODEL });
    };
    if (isWebRelayDown()) {
      return toApiPool();
    }
    let emitted = false;
    let relayFailure: Error | null = null;
    await chatService.streamChatOnce({
      ...options,
      onChunk: (chunk) => {
        if (chunk) emitted = true;
        options.onChunk(chunk);
      },
      onError: (err) => {
        if (!emitted && !options.signal?.aborted && isWebRelayFailure(err?.message)) {
          relayFailure = err;
          return;
        }
        options.onError(err);
      },
    });
    if (relayFailure) {
      markWebRelayDown();
      return toApiPool();
    }
  },

  async streamChatOnce(options: ChatStreamOptions): Promise<void> {
    const {
      model,
      messages,
      sessionId,
      systemInstruction,
      groundingContext,
      deepResearch = false,
      stream = true,
      language = 'en',
      temperature,
      topP,
      maxTokens,
      thinkingBudget,
      runConfig,
      userContext,
      signal,
      onChunk,
      onMeta,
      onDone,
      onError,
    } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    const formattedMessages: FormattedGatewayMessage[] = [];
    let serializedRunConfig:
      | {
          thinking_level: string;
          google_search: boolean;
          response_mime_type: string;
          response_schema?: Record<string, unknown>;
        }
      | undefined;
    const resolveBackendModel = (id: string): string => {
      switch (id) {
        case 'supremeai-web':
          return 'supremeai-web';
        case 'supremeai-api':
          return 'supremeai-api';
        case 'supreme-spark':
          return 'supreme-spark';
        case 'supreme-reason':
          return 'supreme-reason';
        case 'supreme-deep':
          return 'supreme-deep';
        case 'supreme-core':
          return 'supreme-core';
        default:
          return 'auto';
      }
    };
    const backendModel = resolveBackendModel(model);
    const derivedThinking = runConfig ? resolveThinkingParams(runConfig.thinkingLevel) : undefined;
    const effectiveThinkingBudget =
      thinkingBudget !== undefined ? thinkingBudget : derivedThinking?.defaultThinkingBudget;
    const reasoningEffort = derivedThinking?.reasoningEffort;

    try {
      const userToken = localStorage.getItem('supremeai_access_token');
      let activeToken = userToken || authService.getCachedGuestToken();
      if (!activeToken) {
        const pendingGuest = authService.getInFlightGuestTokenPromise();
        if (pendingGuest) {
          activeToken = await pendingGuest.catch(() => null);
        }
      }
      if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
        headers['X-SupremeAI-Key'] = activeToken;
      }

      if (systemInstruction?.trim()) {
        formattedMessages.push({ role: 'system', content: systemInstruction.trim() });
      }
      if (groundingContext?.trim()) {
        formattedMessages.push({
          role: 'system',
          content: `Grounding Knowledge Context:\n${groundingContext.trim()}`,
        });
      }
      const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const wantsBengali = language === 'bn' || detectBengaliOrBanglish(lastUserText);
      formattedMessages.push({
        role: 'system',
        content: wantsBengali
          ? 'Always respond naturally, fluently, and authoritatively in Bengali (বাংলা script, NOT Romanized Banglish unless explicitly requested) by default, keeping code syntax, technical identifiers, and commands in English unless the user explicitly requests another language.'
          : 'Always respond clearly, naturally, and authoritatively in English by default unless the user writes in Bengali (বাংলা) or Romanized Bengali (Banglish), or explicitly requests another language.',
      });
      const { preparedMessages, hasImageAttachment } =
        prepareConversationMessagesForGateway(messages);

      for (const m of preparedMessages) {
        let messageContent = m.content || '';
        const msgAttachments = getMessageAttachments(m);
        const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
        const imageNames: string[] = [];

        for (const att of msgAttachments) {
          if (!att.data) continue;
          if (isImageAttachment(att)) {
            const rawBase64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
            if (!rawBase64) continue;
            const mimeType = att.mimeType || 'image/png';
            imageNames.push(att.name || 'image');
            imageParts.push({
              inlineData: {
                mimeType,
                data: rawBase64,
              },
            });
          } else if (isTextReadableMimeOrFilename(att.mimeType, att.name)) {
            const decodedText = decodeBase64AttachmentText(att.data, 18000);
            if (decodedText) {
              messageContent = `${messageContent ? `${messageContent}\n\n` : ''}[Attached Document: ${att.name} (${att.mimeType})]:\n${decodedText}`;
            }
          }
        }

        let parts: FormattedGatewayMessage['parts'];
        let formattedContent: FormattedGatewayMessage['content'] = messageContent;
        if (imageParts.length > 0) {
          const promptText =
            messageContent.trim() ||
            'Please analyze the attached image(s) carefully, transcribing any visible text accurately and explaining key details.';
          formattedContent = [
            { type: 'text', text: promptText },
            ...imageParts.map((ip) => ({
              type: 'image_url' as const,
              image_url: {
                url: `data:${ip.inlineData.mimeType};base64,${ip.inlineData.data}`,
              },
            })),
          ];
          parts = [
            {
              text:
                m.content?.trim() ||
                'Please analyze the attached image(s) carefully, transcribing any visible text accurately and explaining key details.',
            },
            ...imageParts,
          ];
        }

        const entry: FormattedGatewayMessage = {
          role: m.role,
          content: formattedContent,
        };
        if (msgAttachments.length > 0) {
          entry.attachment = msgAttachments[0];
          if (msgAttachments.length > 1) {
            (entry as FormattedGatewayMessage & { attachments?: ChatAttachment[] }).attachments =
              msgAttachments;
          }
        }
        if (parts) {
          entry.parts = parts;
        }
        formattedMessages.push(entry);
      }

      const schemaCheck = runConfig?.jsonSchemaText
        ? validateJsonSchemaInput(runConfig.jsonSchemaText)
        : { valid: true };
      serializedRunConfig = runConfig
        ? {
            thinking_level: runConfig.thinkingLevel,
            google_search:
              runConfig.responseMimeType === 'application/json'
                ? false
                : Boolean(runConfig.enableSearchGrounding),
            response_mime_type: runConfig.responseMimeType,
            ...(runConfig.responseMimeType === 'application/json' &&
            schemaCheck.valid &&
            schemaCheck.parsed
              ? { response_schema: schemaCheck.parsed }
              : {}),
          }
        : undefined;

      const streamEndpoint = `${env.apiBaseUrl}/api/v1/stream/chat`;

      const payloadBody = JSON.stringify({
        session_id: sessionId,
        model: backendModel,
        task_type: deepResearch ? 'deep_research' : hasImageAttachment ? 'vision' : 'chat',
        messages: formattedMessages,
        stream,
        deepResearch,
        language,
        language_pref: language,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
        ...(effectiveThinkingBudget !== undefined
          ? { thinking_budget: effectiveThinkingBudget }
          : {}),
        ...(serializedRunConfig ? { run_config: serializedRunConfig } : {}),
        userContext,
      });

      const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

      // Live backend route on deployed gateway: /api/v1/stream/chat (strict OpenAI messages schema)
      let response = await fetch(streamEndpoint, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        signal,
        body: payloadBody,
      });

      // If in Guest Mode (!userToken) and backend requires a fresh guest trial token (401), obtain one and retry once
      if (response.status === 401 && !userToken) {
        const freshGuestToken = await authService.ensureGuestToken(true);
        if (freshGuestToken) {
          headers['Authorization'] = `Bearer ${freshGuestToken}`;
          headers['X-SupremeAI-Key'] = freshGuestToken;
          response = await fetch(streamEndpoint, {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            signal,
            body: payloadBody,
          });
        }
      }

      // বাংলা মন্তব্য: Cloudflare Pages -> Render প্রক্সিতে 403/429 চ্যালেঞ্জ বা 502/503/504 হলে ব্রাউজার থেকে সরাসরি Render গেটওয়েতে স্ট্রিমিং ও সিঙ্ক্রোনাস চ্যাট ফেইলওভার করা হচ্ছে
      if (
        !response.ok &&
        !env.apiBaseUrl &&
        (response.status === 403 ||
          response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504)
      ) {
        try {
          if (!headers['Authorization'] && !userToken) {
            const guestTok = await authService.ensureGuestToken();
            if (guestTok) {
              headers['Authorization'] = `Bearer ${guestTok}`;
              headers['X-SupremeAI-Key'] = guestTok;
            }
          }
          const directStreamRes = await fetch(`${DEFAULT_BACKEND_ORIGIN}/api/v1/stream/chat`, {
            method: 'POST',
            headers,
            credentials: 'omit',
            signal,
            body: payloadBody,
          });
          if (directStreamRes.ok) {
            response = directStreamRes;
          } else {
            const syncFallbackRes = await fetch('/api/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(headers['Authorization'] ? { Authorization: headers['Authorization'] } : {}),
                ...(headers['X-SupremeAI-Key']
                  ? { 'X-SupremeAI-Key': headers['X-SupremeAI-Key'] }
                  : {}),
              },
              credentials: 'same-origin',
              signal,
              body: JSON.stringify({
                model: backendModel,
                messages: formattedMessages,
                systemInstruction,
                groundingContext,
                stream: false,
                language,
                ...(temperature !== undefined ? { temperature } : {}),
                ...(topP !== undefined ? { top_p: topP } : {}),
                ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
                ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
                ...(effectiveThinkingBudget !== undefined
                  ? { thinking_budget: effectiveThinkingBudget }
                  : {}),
                ...(serializedRunConfig ? { run_config: serializedRunConfig } : {}),
                userContext,
              }),
            });
            if (syncFallbackRes.ok) {
              const syncData = await syncFallbackRes.json().catch(() => null);
              const syncText = String(syncData?.text || '');
              if (syncText) {
                onChunk(syncText);
                onDone(syncText);
                return;
              }
            }
          }
        } catch {
          // Fall through to standard error handling if direct retry also fails
        }
      }

      if (!response.ok) {
        const rawErrText = await response.text().catch(() => '');
        let errorData: any = {};
        try {
          errorData = rawErrText ? JSON.parse(rawErrText) : {};
        } catch {
          errorData = {};
        }
        const extractedMsg =
          errorData.detail ||
          errorData.error?.message ||
          errorData.error ||
          errorData.message ||
          (rawErrText && rawErrText.length < 240 ? rawErrText.trim() : '');
        const errorMsg =
          response.status === 500
            ? `Upstream API Gateway returned HTTP 500 (${extractedMsg || 'Internal Server Error'}).`
            : response.status === 429
              ? (extractedMsg || (language === 'bn' ? 'সার্ভার অতিরিক্ত অনুরোধ পেয়েছে (429 Rate Limit)। কিছুক্ষণ পর পুনরায় চেষ্টা করুন বা সাইন-ইন করুন।' : 'Server is temporarily rate-limited (429). Please retry shortly or sign in.'))
              : extractedMsg || `Server error: ${response.status} ${response.statusText}`.trim();

        if (hasImageAttachment) {
          const classified = classifyVisionHttpError({
            status: Number(errorData?.status) || response.status,
            message: errorMsg,
            retryAfterHeader:
              response.headers?.get?.('Retry-After') ||
              (errorData?.retryAfterSeconds ? String(errorData.retryAfterSeconds) : null),
            provider:
              errorData?.provider || response.headers?.get?.('X-SupremeAI-Provider') || undefined,
            model: errorData?.model || response.headers?.get?.('X-SupremeAI-Slot') || undefined,
          });
          throw new VisionRequestError(classified.safeSummary, classified);
        }
        throw new Error(errorMsg);
      }

      if (!response.body) {
        throw new Error('No readable response body received from SupremeAI inference gateway.');
      }

      const headerProvider = response.headers?.get?.('X-SupremeAI-Provider') || '';
      const headerSlot = response.headers?.get?.('X-SupremeAI-Slot') || '';
      const headerTier = response.headers?.get?.('X-SupremeAI-Tier') || '';
      let activeRouteMeta: ChatRouteMeta = {
        ...(headerProvider ? { provider: headerProvider } : {}),
        ...(headerSlot ? { engine: headerSlot } : {}),
        ...(headerTier ? { badge: headerTier } : {}),
        poolType: inferRoutePoolType(headerProvider, headerTier, backendModel),
        servedModel: backendModel,
        ...(runConfig?.thinkingLevel ? { thinkingLevel: runConfig.thinkingLevel } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      };
      if (headerProvider || headerSlot || headerTier) {
        onMeta?.({ routeMeta: activeRouteMeta });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let buffer = '';
      let firstTokenMs: number | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') break;
            let frameError: string | null = null;
            let frameErrorObj: Record<string, any> | null = null;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                frameErrorObj = typeof parsed.error === 'object' ? parsed.error : null;
                frameError =
                  typeof parsed.error === 'object'
                    ? parsed.error.message || JSON.stringify(parsed.error)
                    : String(parsed.error);
              } else {
                const chunk = parsed.choices?.[0]?.delta?.content ?? parsed.text ?? '';
                if (chunk && firstTokenMs === undefined) {
                  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                  firstTokenMs = Math.max(1, Math.round(now - requestStartedAt));
                }

                const supremeBranding =
                  parsed.supremeai && typeof parsed.supremeai === 'object'
                    ? parsed.supremeai
                    : null;
                const frameRouteMeta =
                  parsed.routeMeta && typeof parsed.routeMeta === 'object'
                    ? parsed.routeMeta
                    : null;

                let routeMetaChanged = false;
                if (
                  supremeBranding ||
                  frameRouteMeta ||
                  (chunk && activeRouteMeta.firstTokenMs !== firstTokenMs)
                ) {
                  const nextProvider =
                    frameRouteMeta?.provider ||
                    supremeBranding?.provider ||
                    activeRouteMeta.provider;
                  const nextEngine =
                    frameRouteMeta?.engine || supremeBranding?.engine || activeRouteMeta.engine;
                  const nextBadge =
                    frameRouteMeta?.badge || supremeBranding?.badge || activeRouteMeta.badge;
                  const nextServedModel =
                    frameRouteMeta?.servedModel ||
                    (typeof parsed.model === 'string' && parsed.model.trim()
                      ? parsed.model.trim()
                      : undefined) ||
                    activeRouteMeta.servedModel;
                  const nextPoolType =
                    frameRouteMeta?.poolType ||
                    inferRoutePoolType(nextProvider, nextBadge, nextServedModel || backendModel) ||
                    activeRouteMeta.poolType;
                  const nextFirstTokenMs =
                    typeof frameRouteMeta?.firstTokenMs === 'number'
                      ? frameRouteMeta.firstTokenMs
                      : firstTokenMs;

                  activeRouteMeta = {
                    ...activeRouteMeta,
                    ...(nextProvider ? { provider: nextProvider } : {}),
                    ...(nextEngine ? { engine: nextEngine } : {}),
                    ...(nextBadge ? { badge: nextBadge } : {}),
                    ...(nextServedModel ? { servedModel: nextServedModel } : {}),
                    ...(nextPoolType ? { poolType: nextPoolType } : {}),
                    ...(nextFirstTokenMs !== undefined ? { firstTokenMs: nextFirstTokenMs } : {}),
                  };
                  routeMetaChanged = true;
                }

                if (
                  Array.isArray(parsed.groundingSources) ||
                  (parsed.tokenUsage && typeof parsed.tokenUsage === 'object') ||
                  routeMetaChanged
                ) {
                  onMeta?.({
                    ...(Array.isArray(parsed.groundingSources)
                      ? { groundingSources: parsed.groundingSources }
                      : {}),
                    ...(parsed.tokenUsage && typeof parsed.tokenUsage === 'object'
                      ? { tokenUsage: parsed.tokenUsage }
                      : {}),
                    ...(routeMetaChanged ? { routeMeta: activeRouteMeta } : {}),
                  });
                }
                // Standard OpenAI/Gateway SSE delta chunk: parsed.choices[0].delta.content
                // Fallback legacy proxy chunk: parsed.text
                if (chunk) {
                  accumulatedText += chunk;
                  onChunk(chunk);
                }
              }
            } catch {
              // Non-json SSE data frame ignored safely
            }
            if (frameError) {
              if (hasImageAttachment || frameErrorObj?.ocrSuggested || /vision/i.test(frameError)) {
                const classified = classifyVisionHttpError({
                  status:
                    typeof frameErrorObj?.status === 'number' ? frameErrorObj.status : undefined,
                  message: frameError,
                  retryAfterHeader: frameErrorObj?.retryAfterSeconds
                    ? String(frameErrorObj.retryAfterSeconds)
                    : null,
                  provider: frameErrorObj?.provider || activeRouteMeta.provider,
                  model: frameErrorObj?.model || activeRouteMeta.engine,
                });
                throw new VisionRequestError(classified.safeSummary, classified);
              }
              throw new Error(frameError);
            }
          }
        }
      }

      onDone(accumulatedText);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Stream aborted by user
        return;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const isFetchNetworkFailure =
        /failed to fetch|networkerror|load failed|err_blocked_by_client|network error|http2/i.test(
          errMsg
        ) ||
        (err instanceof TypeError && /fetch|network|stream|body/i.test(errMsg));

      if (isFetchNetworkFailure) {
        let sameOriginHealthy = false;
        let isLocalStudioServer = false;
        try {
          const probeCtrl = new AbortController();
          const probeTimer = setTimeout(() => probeCtrl.abort(), 2500);
          const probeRes = await fetch('/api/health', {
            method: 'GET',
            cache: 'no-store',
            signal: probeCtrl.signal,
          });
          clearTimeout(probeTimer);
          sameOriginHealthy = probeRes.ok;
          if (probeRes.ok) {
            const probeJson = await probeRes.json().catch(() => null);
            isLocalStudioServer = probeJson?.app === 'SupremeAI Studio';
          }
        } catch {
          sameOriginHealthy = false;
        }

        // If same-origin /api proxy is reachable and SSE transport dropped mid-stream, fall back once to Edge/Express JSON /api/chat
        if (sameOriginHealthy || isLocalStudioServer) {
          try {
            const fallbackHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (headers['Authorization'])
              fallbackHeaders['Authorization'] = headers['Authorization'];
            if (headers['X-SupremeAI-Key'])
              fallbackHeaders['X-SupremeAI-Key'] = headers['X-SupremeAI-Key'];

            const fallbackRes = await fetch('/api/chat', {
              method: 'POST',
              headers: fallbackHeaders,
              credentials: 'same-origin',
              signal,
              body: JSON.stringify({
                model: backendModel,
                messages: formattedMessages,
                systemInstruction,
                groundingContext,
                stream: false,
                language,
                ...(temperature !== undefined ? { temperature } : {}),
                ...(topP !== undefined ? { top_p: topP } : {}),
                ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
                ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
                ...(effectiveThinkingBudget !== undefined
                  ? { thinking_budget: effectiveThinkingBudget }
                  : {}),
                ...(serializedRunConfig ? { run_config: serializedRunConfig } : {}),
                userContext,
              }),
            });
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              const text = String(fallbackData?.text || '');
              const fallbackMeta: ChatRouteMeta | undefined =
                fallbackData?.routeMeta || fallbackData?.model
                  ? {
                      ...(fallbackData.routeMeta || {}),
                      servedModel:
                        fallbackData?.routeMeta?.servedModel || fallbackData?.model || backendModel,
                      poolType:
                        fallbackData?.routeMeta?.poolType ||
                        inferRoutePoolType(
                          fallbackData?.source,
                          '',
                          fallbackData?.model || backendModel
                        ),
                      ...(runConfig?.thinkingLevel
                        ? { thinkingLevel: runConfig.thinkingLevel }
                        : {}),
                      ...(reasoningEffort ? { reasoningEffort } : {}),
                    }
                  : undefined;
              if (
                Array.isArray(fallbackData?.groundingSources) ||
                (fallbackData?.tokenUsage && typeof fallbackData.tokenUsage === 'object') ||
                fallbackMeta
              ) {
                onMeta?.({
                  ...(Array.isArray(fallbackData.groundingSources)
                    ? { groundingSources: fallbackData.groundingSources }
                    : {}),
                  ...(fallbackData.tokenUsage && typeof fallbackData.tokenUsage === 'object'
                    ? { tokenUsage: fallbackData.tokenUsage }
                    : {}),
                  ...(fallbackMeta ? { routeMeta: fallbackMeta } : {}),
                });
              }
              if (text) {
                onChunk(text);
                onDone(text);
                return;
              }
            }
          } catch {
            // Fall through to accurate diagnostic message below
          }
        }

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          onError(
            new Error('Network offline. Please check your internet connection and try again.')
          );
          return;
        }

        const wasCrossOriginBlocked =
          !sameOriginHealthy ||
          /err_blocked_by_client/i.test(errMsg) ||
          Boolean(
            env.apiBaseUrl &&
            typeof window !== 'undefined' &&
            !env.apiBaseUrl.startsWith(window.location.origin)
          );

        if (wasCrossOriginBlocked) {
          onError(
            new Error(
              'Network request blocked. If you are using an Ad-blocker or Privacy extension, please pause it for this site.'
            )
          );
          return;
        }

        onError(
          new Error(
            `Streaming transport error on /api/v1/stream/chat (${errMsg || 'connection reset'}). Same-origin /api/health is reachable.`
          )
        );
        return;
      }

      onError(err instanceof Error ? err : new Error('Chat streaming failed'));
    }
  },

  async fetchModels(): Promise<import('../types').ModelDetail[]> {
    const { SUPREMEAI_MODELS } = await import('../data/models');
    if (env.isMockEnabled) {
      return SUPREMEAI_MODELS;
    }
    try {
      const res = await apiClient.get<{ models?: Record<string, any> }>('/api/models');
      if (res?.models && typeof res.models === 'object') {
        const list = Object.entries(res.models)
          .filter(([id]) => id !== 'auto')
          .map(([id, raw]): import('../types').ModelDetail => {
          const m = raw as Record<string, any>;
          return {
            id,
            name: m.name || id,
            alias: m.alias || m.category || 'Standard',
            badge: m.badge || 'Live',
            tagline: m.tagline || m.description || '',
            description: m.description || '',
            idealFor: m.idealFor || 'General reasoning & coding',
            latencyRating:
              m.latencyRating === 'Deep-Compute' || m.latencyRating === 'Heavy Compute'
                ? 'Deep-Compute'
                : m.latencyRating === 'Balanced'
                  ? 'Balanced'
                  : 'Ultra-Fast',
            contextTokens: m.contextTokens || '1,000,000+',
            reasoningCapability:
              m.reasoningCapability === 'Extreme'
                ? 'Extreme'
                : m.reasoningCapability === 'Standard'
                  ? 'Standard'
                  : 'High',
            tier: m.tier === 'advanced' ? 'advanced' : 'standard',
          };
        });
        if (list.length > 0) return list;
      }
      return SUPREMEAI_MODELS;
    } catch {
      return SUPREMEAI_MODELS;
    }
  },
};
