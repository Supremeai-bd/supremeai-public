import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import { Readable } from 'stream';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { registerControlPlaneRoutes } from './src/server/controlPlaneRouter';
import { registerMcpTowerRoutes } from './src/server/routes/mcpTowerRoutes';
import { registerAdminCustomerRoutes } from './src/server/routes/admin/customers';
import { registerAdminSecurityRoutes } from './src/server/routes/admin/security';
import { registerAdminSwarmQueueRoutes } from './src/server/routes/admin/swarmQueue';
import { registerAdminPlatformRoutes } from './src/server/routes/admin/platform';
import { registerAdminProvidersRoutes } from './src/server/routes/admin/providers';
import { registerAdminSystemRoutes } from './src/server/routes/admin/system';
import { registerWorkspaceTerminalRoutes } from './src/server/routes/workspace/terminal';
import { registerWorkspaceBrowserProxyRoutes } from './src/server/routes/workspace/browserProxy';
import { registerWorkspaceBrowserVaultRoutes } from './src/server/routes/workspace/browserVault';
import { registerWorkspaceGmailSessionRoutes } from './src/server/routes/workspace/gmailSession';
import { registerWorkspaceBrowserSchedulesRoutes } from './src/server/routes/workspace/browserSchedules';
import { registerConversationsRoutes } from './src/server/routes/conversations';
import { registerProjectsRoutes } from './src/server/routes/projects';
import { registerApiKeysRoutes } from './src/server/routes/apiKeys';
import { registerTeamRoutes } from './src/server/routes/team';
import { registerWebhooksRoutes } from './src/server/routes/webhooks';
import { registerAuthTotpRoutes } from './src/server/routes/authTotp';
import { registerBillingRoutes } from './src/server/routes/billing';
import { registerGitOauthRoutes } from './src/server/routes/gitOauth';
import { registerMediaRoutes } from './src/server/routes/media';
import { registerAuthRoutes } from './src/server/routes/auth';
import { registerFeedbackRoutes } from './src/server/routes/feedback';
import { registerReleasesRoutes } from './src/server/routes/releases';
import { registerTelemetryRoutes } from './src/server/routes/telemetry';
import { registerGraphRoutes } from './src/server/routes/graph';
import { registerTtsRoutes } from './src/server/routes/tts';
import { registerPreferencesRoutes } from './src/server/routes/preferences';
import {
  getLiveMcpTowerServices,
  getRealGatewayTrafficSummary,
  recordHttpRequestMetric,
} from './src/server/mcpHealthCollector';
import {
  buildBanglaSpeechStylePrompt,
  chunkSpeechSegment,
  clampVoicePitch,
  detectBengaliOrBanglish,
  normalizeBanglaAccent,
  resolveEdgeNeuralVoice,
  splitByScriptSegments,
  voicePitchToSsml,
  type TtsAudioChunk,
} from './src/utils/speechUtils';
import type { LiveVoiceName } from './src/hooks/useLiveVoiceSession';
import {
  DEFAULT_BACKEND_ORIGIN,
  DEFAULT_WEB_STUDIO_URL,
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
} from './src/config/platformEndpoints';
import {
  buildRollingAssetUrls,
  DEFAULT_RELEASE_MANIFEST,
  normalizeRemoteReleaseManifest,
  type ReleaseAssetEntry,
  type ReleaseManifest,
} from './src/config/releaseDownloads';
import QRCode from 'qrcode';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpToken } from './src/server/totp';
import { buildDurableAuditRow } from './src/server/auditPayload';
import {
  loginSchema,
  signupSchema,
  refreshSchema,
  totpConfirmSchema,
  verify2faSchema,
  parseBody,
} from './src/server/validation';
import { PLAN_CATALOG, TOPUP_PACKAGES, getPlanSpec } from './src/config/plans';
import {
  ADMIN_SESSION_TTL_MS,
  hashPassword,
  isRestrictedProxyTarget,
  parseCookieHeader,
  resolveAndCheckProxyTarget,
  signSessionToken,
  validateGitLabHost,
  verifyPassword,
  verifySessionToken,
} from './src/shared/serverSecurity';
import {
  decodeBase64AttachmentText,
  isTextReadableMimeOrFilename,
} from './src/utils/workbenchUtils';
import {
  buildFreeVisionCandidates,
  classifyVisionHttpError,
  VisionCooldownRegistry,
  type ClassifiedVisionError,
  type VisionCandidate,
} from './src/shared/visionRouting';
import {
  buildGitHubForkUrl,
  createForkedProjectPayload,
  mapWorkflowRunToBuildStatus,
  parseGitHubRepoSlug,
} from './src/utils/projectRepoUtils';

dotenv.config();
const visionCooldownRegistry = new VisionCooldownRegistry();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return String(pkg.version || '2.5.0').trim();
  } catch {
    return '2.5.0';
  }
})();

const portArgIndex = process.argv.indexOf('--port');
const portEqArg = process.argv.find((arg) => arg.startsWith('--port='));
const PORT =
  portArgIndex !== -1
    ? Number(process.argv[portArgIndex + 1]) || Number(process.env.PORT) || 3000
    : portEqArg
      ? Number(portEqArg.split('=')[1]) || Number(process.env.PORT) || 3000
      : Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Supported SupremeAI native models
const SUPPORTED_MODELS: Record<
  string,
  { name: string; description: string; tier: 'standard' | 'advanced' }
> = {
  auto: {
    name: 'SupremeAI Auto',
    description: 'Intelligent adaptive routing across API Pool and Webhook relays',
    tier: 'standard',
  },
  'supreme-core': {
    name: 'SupremeAI Core',
    description: 'Flagship multimodal foundation model for general tasks, synthesis & coding',
    tier: 'standard',
  },
  'supreme-spark': {
    name: 'SupremeAI Spark',
    description: 'Ultra-low latency model for high-frequency queries and streaming',
    tier: 'standard',
  },
  'supreme-reason': {
    name: 'SupremeAI Reason',
    description: 'Deep analytical and architectural reasoning engine',
    tier: 'advanced',
  },
  'supreme-deep': {
    name: 'SupremeAI Deep',
    description: 'Complex multi-step logic, code synthesis and autonomous tasks',
    tier: 'advanced',
  },
  'supremeai-web': {
    name: 'SupremeAI Web',
    description: 'Stealth web session relay via cookie pool',
    tier: 'standard',
  },
  'supremeai-api': {
    name: 'SupremeAI API',
    description: 'High-availability multi-key provider pool',
    tier: 'standard',
  },
};

const apiKey = process.env.GEMINI_API_KEY || '';

interface ChatAttachment {
  name: string;
  mimeType: string;
  data: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachment?: ChatAttachment;
}

interface ChatRunConfigPayload {
  thinking_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
  google_search?: boolean;
  response_mime_type?: 'text/plain' | 'application/json';
  response_schema?: Record<string, unknown>;
}

interface ChatRequestBody {
  model?: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  groundingContext?: string;
  stream?: boolean;
  language?: 'en' | 'bn';
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  thinking_budget?: number;
  run_config?: ChatRunConfigPayload;
  userContext?: {
    email?: string;
    role?: 'admin' | 'user';
    tier?: 'Free' | 'Pro' | 'Enterprise';
  };
}

function resolveThinkingLevel(
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

function resolveReasoningEffort(
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

function resolveServerAutoModel(reqModel: string, messages: any[]): string {
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

function resolveUpstreamGeminiModel(
  _resolvedModel: string,
  _runConfig?: ChatRunConfigPayload
): string {
  // gemini-4-hydrogen supports LOW, MEDIUM, HIGH, and XHIGH thinkingLevel across free & paid keys without 404/400 errors.
  return 'gemini-4-hydrogen';
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function messageHasVisionOrAttachment(msg: any): boolean {
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

function messageHasActualImage(msg: any): boolean {
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

function buildGeminiPartsFromMessage(msg: any): any[] {
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

  // Fallback: if caller only sent Gemini-style parts[] without attachment/image_url
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

function buildGeminiGenerateConfig(
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

  // thinkingBudget is only supported on legacy Gemini 2.5 models; Gemini 4 fails with 400 if thinkingBudget is set.
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

  // Do not pass deprecated sampling parameters (temperature, topP, topK) to gemini-4-* models
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

function collectGroundingSourcesAndUsage(
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

function countImagesInMessages(messages: any[]): number {
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

function buildOpenAiVisionMessages(
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

function extractSdkErrorMetadata(err: unknown): {
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

function writeVisionSseHeaders(
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

async function runOpenAiCompatibleVisionRequest(params: {
  endpoint: string;
  apiKey: string;
  candidate: VisionCandidate;
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

async function executeFreeVisionCascade(params: {
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
          const textChunk = chunk.text || '';
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

// Minimal Supabase PostgREST client (service-role). Returns null when Supabase
// is not configured; throws on non-2xx so callers can fall back to local state.
async function supabaseRestRequest(
  pathAndQuery: string,
  method: string,
  body?: unknown,
  prefer = 'return=minimal'
): Promise<any> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok)
    throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]} -> HTTP ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));

  const isHttpsRequest = (req: Request): boolean => {
    const protoHeader = String(req.header('x-forwarded-proto') || '').toLowerCase();
    const forwardedHeader = String(req.header('forwarded') || '').toLowerCase();
    const originHeader = String(req.header('origin') || '').toLowerCase();
    const refererHeader = String(req.header('referer') || '').toLowerCase();
    return (
      req.secure ||
      protoHeader.includes('https') ||
      forwardedHeader.includes('proto=https') ||
      originHeader.startsWith('https://') ||
      refererHeader.startsWith('https://')
    );
  };

  // Baseline production security headers (iframe-compatible for AI Studio preview)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (isProduction && isHttpsRequest(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // SSRF-hardened outbound fetch helper: validates hostname + resolved DNS IPs on initial request and every redirect hop
  const safeFetchWithRedirectCheck = async (
    initialUrl: string | URL,
    init: RequestInit = {},
    isLocalRelative = false,
    maxRedirects = 5
  ): Promise<globalThis.Response> => {
    let currentUrl = typeof initialUrl === 'string' ? new URL(initialUrl) : initialUrl;
    let currentLocal = isLocalRelative;
    let currentInit: RequestInit = { ...init, redirect: 'manual' };

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const check = await resolveAndCheckProxyTarget(currentUrl, currentLocal);
      if (check.restricted) {
        throw new Error(
          check.reason || 'Blocked outbound request to restricted or private target.'
        );
      }

      const response = await fetch(currentUrl.toString(), currentInit);
      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const location = response.headers.get('location');
        if (!location) return response;
        if (hop === maxRedirects) {
          throw new Error('Too many redirects from upstream target.');
        }
        const nextUrl = new URL(location, currentUrl);
        currentLocal =
          currentLocal && nextUrl.origin === currentUrl.origin && nextUrl.pathname.startsWith('/');
        currentUrl = nextUrl;
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            currentInit.method &&
            currentInit.method.toUpperCase() === 'POST')
        ) {
          currentInit = { ...currentInit, method: 'GET', body: undefined };
        }
        continue;
      }
      return response;
    }

    throw new Error('Redirect limit exceeded.');
  };

  // Real HTTP request throughput & latency instrumentation (excludes SSE streams)
  app.use('/api', (req, res, next) => {
    if (req.path.includes('/stream') || req.path === '/health') {
      next();
      return;
    }
    const start = Date.now();
    res.on('finish', () => {
      recordHttpRequestMetric(Date.now() - start, res.statusCode >= 500);
    });
    next();
  });

  // Zero-dependency in-memory sliding-window rate limiter (per client IP).
  const rateBuckets = new Map<string, number[]>();
  const makeRateLimit = (windowMs: number, max: number) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
      const bucketKey = `${req.baseUrl || req.path}:${ip}`;
      const now = Date.now();
      const hits = (rateBuckets.get(bucketKey) || []).filter((t) => now - t < windowMs);
      if (hits.length >= max) {
        res.status(429).json({ error: 'Too many requests. Please slow down and retry shortly.' });
        return;
      }
      hits.push(now);
      rateBuckets.set(bucketKey, hits);
      if (rateBuckets.size > 10000) {
        for (const [k, v] of rateBuckets) {
          if (v.length === 0 || now - v[v.length - 1] > windowMs) rateBuckets.delete(k);
        }
      }
      next();
    };
  };
  app.use(['/api/chat', '/api/v1/chat', '/api/v1/stream/chat'], makeRateLimit(60_000, 60));
  app.use(
    [
      '/api/auth/login',
      '/api/v1/auth/login',
      '/api/auth/verify-2fa',
      '/api/auth/totp',
      '/api/admin/auth/verify',
    ],
    makeRateLimit(60_000, 10)
  );
  app.use('/api/mcp-tower', makeRateLimit(60_000, 30));

  // Cached fetch of live catalog data (models/plans) from the gateway, with a
  // short TTL and graceful fallback to the bundled static catalog.
  const GATEWAY_BASE = (
    process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com'
  ).replace(/\/$/, '');
  const catalogCache = new Map<string, { data: any; expiresAt: number }>();
  const fetchGatewayJson = async (pathAndQuery: string, ttlMs = 60_000): Promise<any | null> => {
    const cached = catalogCache.get(pathAndQuery);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
      const res = await fetch(`${GATEWAY_BASE}${pathAndQuery}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) return cached?.data ?? null;
      const data = await res.json();
      catalogCache.set(pathAndQuery, { data, expiresAt: Date.now() + ttlMs });
      return data;
    } catch {
      return cached?.data ?? null;
    }
  };

  registerTelemetryRoutes(app, {
    fetchGatewayJson: (p, t) => fetchGatewayJson(p, t),
  });

  // --- MCP Tower Services & Health Orchestration Endpoints ---  // --- MCP Tower Services & Health Orchestration Endpoints ---
  const mcpClusterServices = [
    {
      id: 'supreme-gateway-service',
      name: 'supreme-gateway-service',
      displayName: 'SupremeAI Gateway Broker',
      category: 'core',
      port: 8081,
      status: 'healthy',
      uptime: '99.98%',
      latencyMs: 18,
      cpuPercent: 2.1,
      memoryMb: 142,
      lastChecked: 'Just now',
      version: 'v2.4.1',
      endpoint: '/api/chat',
      errorCount: 0,
      logs: [
        {
          id: 'gw-log-1',
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          message:
            'Active route pool healthy. 4 SupremeAI models registered with live streaming hooks.',
          details: 'Endpoints: supreme-core, supreme-spark, supreme-reason, supreme-deep',
        },
      ],
    },
    {
      id: 'mcp-context-server',
      name: 'mcp-context-server',
      displayName: 'MCP Context Protocol Server',
      category: 'ai',
      port: 9001,
      status: 'healthy',
      uptime: '99.94%',
      latencyMs: 34,
      cpuPercent: 4.8,
      memoryMb: 318,
      lastChecked: 'Just now',
      version: 'v1.8.0',
      endpoint: 'mcp://localhost:9001/protocol/v1',
      errorCount: 0,
      logs: [
        {
          id: 'mcp-log-1',
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          message: 'Model Context Protocol server listening on JSON-RPC stdio and SSE transport.',
        },
      ],
    },
    {
      id: 'code-auditor-worker',
      name: 'code-auditor-worker',
      displayName: 'Code Auditor & Security Worker',
      category: 'ai',
      port: 9002,
      status: 'unhealthy',
      uptime: '94.20%',
      latencyMs: 4120,
      cpuPercent: 98.4,
      memoryMb: 1840,
      lastChecked: '30s ago (Health check failed)',
      version: 'v1.3.2',
      endpoint: 'http://localhost:9002/audit/jobs',
      errorCount: 14,
      logs: [
        {
          id: 'aud-log-1',
          timestamp: new Date(Date.now() - 1000 * 60 * 14).toLocaleTimeString(),
          level: 'WARN',
          message: 'Worker queue depth exceeded threshold (depth: 84 jobs > threshold: 25).',
          details: 'High concurrency in repository AST parsing for Supremeai-bd/supremeai.',
        },
        {
          id: 'aud-log-2',
          timestamp: new Date(Date.now() - 1000 * 60 * 8).toLocaleTimeString(),
          level: 'ERROR',
          message:
            'Heap allocation failure: JavaScript heap out of memory during AST graph resolution.',
          details:
            'Process allocated 1840MB of 2048MB container limit. Garbage collection pauses > 1200ms.',
          stackTrace:
            'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\\n  at AstGraphResolver.traverseSyntaxNode (/workers/auditor/ast/parser.ts:412:18)\\n  at CodeAuditorWorker.processJob (/workers/auditor/worker.ts:184:22)',
        },
        {
          id: 'aud-log-3',
          timestamp: new Date(Date.now() - 1000 * 60 * 2).toLocaleTimeString(),
          level: 'ERROR',
          message:
            'Heartbeat ping timeout after 4000ms. Service process not responding to HTTP ping.',
          details:
            'TCP connection active on port 9002, but event loop delay is 3890ms. Recommend service reboot.',
        },
      ],
    },
    {
      id: 'sse-stream-broker',
      name: 'sse-stream-broker',
      displayName: 'SSE Real-time Stream Broker',
      category: 'core',
      port: 8084,
      status: 'degraded',
      uptime: '98.10%',
      latencyMs: 195,
      cpuPercent: 62.8,
      memoryMb: 680,
      lastChecked: 'Just now',
      version: 'v2.1.0',
      endpoint: 'http://localhost:8084/sse/hub',
      errorCount: 4,
      logs: [
        {
          id: 'sse-log-1',
          timestamp: new Date(Date.now() - 1000 * 60 * 7).toLocaleTimeString(),
          level: 'WARN',
          message: 'Connection pool saturation reached 89% (890 / 1000 concurrent listeners).',
          details: 'Backpressure detected on 12 streaming sockets. Latency elevated to 195ms.',
        },
      ],
    },
    {
      id: 'github-sync-daemon',
      name: 'github-sync-daemon',
      displayName: 'GitHub Repository Sync Daemon',
      category: 'integration',
      port: 8085,
      status: 'healthy',
      uptime: '99.85%',
      latencyMs: 42,
      cpuPercent: 1.1,
      memoryMb: 112,
      lastChecked: 'Just now',
      version: 'v3.0.4',
      endpoint: 'http://localhost:8085/webhook/github',
      errorCount: 0,
      logs: [
        {
          id: 'gh-log-1',
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          message: 'Webhook subscription confirmed for Supremeai-bd organization repositories.',
        },
      ],
    },
    {
      id: 'vector-cache-engine',
      name: 'vector-cache-engine',
      displayName: 'Vector & Prompt Cache Engine',
      category: 'core',
      port: 6379,
      status: 'healthy',
      uptime: '99.99%',
      latencyMs: 3,
      cpuPercent: 0.8,
      memoryMb: 524,
      lastChecked: 'Just now',
      version: 'v7.2.4',
      endpoint: 'redis://localhost:6379/0',
      errorCount: 0,
      logs: [
        {
          id: 'vec-log-1',
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          message: 'In-memory semantic cache hit ratio: 87.4% over 14,200 indexed queries.',
        },
      ],
    },
    {
      id: 'auth-token-prober',
      name: 'auth-token-prober',
      displayName: 'Auth Token & Identity Prober',
      category: 'integration',
      port: 8083,
      status: 'healthy',
      uptime: '99.99%',
      latencyMs: 11,
      cpuPercent: 0.4,
      memoryMb: 76,
      lastChecked: 'Just now',
      version: 'v1.4.0',
      endpoint: 'http://localhost:8083/auth/verify',
      errorCount: 0,
      logs: [
        {
          id: 'auth-log-1',
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          message:
            'Public key JWKS rotation cache validated. Zero signature validation rejections.',
        },
      ],
    },
    {
      id: 'telemetry-collector',
      name: 'telemetry-collector',
      displayName: 'OpenTelemetry & Prometheus Collector',
      category: 'telemetry',
      port: 9090,
      status: 'healthy',
      uptime: '99.95%',
      latencyMs: 24,
      cpuPercent: 1.4,
      memoryMb: 135,
      lastChecked: 'Just now',
      version: 'v0.92.0',
      endpoint: 'http://localhost:9090/metrics',
      errorCount: 0,
      logs: [
        {
          id: 'tel-log-1',
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          message: 'Scraping metrics from 8 local endpoints with 10s interval.',
        },
      ],
    },
  ];

  // MCP Tower proxy surface (health, services, reboot, probe, SSE stream) now
  // lives in src/server/routes/mcpTowerRoutes.ts. The four callbacks are passed
  // as lazy closures on purpose: `recordAudit`/`resolveAuditActor`/
  // `verifyAdminAuthorization` are declared further down this function, so a
  // direct reference here would hit the temporal dead zone. The handlers only
  // touch them at request time.
  registerMcpTowerRoutes(app, {
    mcpClusterServices,
    resolveAuditActor: (req, explicitActor) => resolveAuditActor(req, explicitActor),
    recordAudit: (actor, action, resource, details, req) =>
      recordAudit(actor, action, resource, details, req),
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
  });

  // GET /api/agent-swarm/stream - Live SSE for Agent Swarm worker heartbeats & terminal events
  app.get('/api/agent-swarm/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(
      `data: ${JSON.stringify({ type: 'swarm_connected', timestamp: Date.now(), status: 'active' })}\n\n`
    );

    const interval = setInterval(() => {
      const traffic = getRealGatewayTrafficSummary();
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

  // --- Admin Platform Control Endpoints & Central Governance State ---
  let runtimeFeatureFlags: Record<string, boolean> = {
    enable_supreme_reason: true,
    enable_multimodal_vision: true,
    enable_rag_grounding: true,
    enable_continuous_agent_swarm: true,
    enforce_strict_rate_limits: false,
    maintenance_mode: false,
  };

  type PlanTier = 'Free' | 'Pro' | 'Enterprise';
  const TIER_RANK: Record<PlanTier, number> = { Free: 0, Pro: 1, Enterprise: 2 };

  let platformConfig = {
    maintenanceMode: false,
    maintenanceMessage:
      'SupremeAI Studio is undergoing scheduled database maintenance. Administrators remain online.',
    announcementBanner: {
      active: false,
      message: 'All SupremeAI Core and SupremeAI Reason routes are operating normally.',
      level: 'info' as 'info' | 'warning' | 'critical',
    },
    allowNewSignups: true,
    defaultModelId: 'supreme-spark',
    modelPolicies: {
      'supreme-spark': { enabled: true, minTier: 'Free' as PlanTier },
      'supreme-core': { enabled: true, minTier: 'Free' as PlanTier },
      'supreme-reason': { enabled: true, minTier: 'Pro' as PlanTier },
      'supreme-deep': { enabled: true, minTier: 'Enterprise' as PlanTier },
      'supremeai-web': { enabled: true, minTier: 'Free' as PlanTier },
      'supremeai-api': { enabled: true, minTier: 'Free' as PlanTier },
    } as Record<string, { enabled: boolean; minTier: PlanTier }>,
  };

  interface ServerAuditRecord {
    id: string;
    timestamp: string;
    actor: string;
    action: string;
    resource: string;
    details: string;
    ipAddress: string;
  }

  const auditRecords: ServerAuditRecord[] = isProduction
    ? []
    : [
        {
          id: 'audit_rec_01',
          timestamp: 'Today at 09:40',
          actor: 'platform-admin',
          action: 'SERVICE_REBOOT',
          resource: 'MCP Tower / code-auditor-worker',
          details:
            'Graceful reboot triggered via Admin Dashboard. Memory garbage collected, cold boot latency 28ms.',
          ipAddress: '10.0.4.12',
        },
        {
          id: 'audit_rec_02',
          timestamp: 'Today at 08:15',
          actor: 'platform-admin',
          action: 'RATE_LIMIT_OVERRIDE',
          resource: 'Customer: techcorp_labs (cust_1042)',
          details: 'Increased RPM from 120 to 600 for Enterprise pilot rollout.',
          ipAddress: '10.0.4.12',
        },
        {
          id: 'audit_rec_03',
          timestamp: 'Yesterday at 17:20',
          actor: 'system-agent-scheduler',
          action: 'AUTONOMOUS_SWARM_SCALE',
          resource: 'Swarm Worker: solver-daemon-01',
          details:
            'Auto-scaled worker concurrency to 4 threads during high GitHub issue throughput.',
          ipAddress: '127.0.0.1',
        },
        {
          id: 'audit_rec_04',
          timestamp: 'Apr 10, 2026',
          actor: 'platform-admin',
          action: 'FAILOVER_RULE_UPDATE',
          resource: 'LLM Gateway / supreme-core',
          details: 'Configured automated fallback to supreme-spark on 503 high demand.',
          ipAddress: '10.0.4.12',
        },
      ];

  const getClientIp = (req: Request): string => {
    return String(req.ip || req.socket?.remoteAddress || '127.0.0.1').trim();
  };

  const resolveAuditActor = (req?: Request, explicitActor?: unknown): string => {
    if (typeof explicitActor === 'string' && explicitActor.trim()) {
      return explicitActor.trim();
    }
    if (req) {
      const authHeader = String(req.headers.authorization || '').trim();
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (token) {
        const sessionUserId = activeAuthSessions.get(token);
        const matchedUser = sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined;
        if (matchedUser?.email) return matchedUser.email;
        const verifiedPayload = verifyLocalSessionToken(token);
        if (verifiedPayload?.email) return verifiedPayload.email;
      }
    }
    return 'system-operator';
  };

  const recordAudit = (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request
  ) => {
    const entry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      actor: actor || resolveAuditActor(req),
      action,
      resource,
      details,
      ipAddress: req ? getClientIp(req) : '127.0.0.1',
    };
    auditRecords.unshift(entry);
    if (auditRecords.length > 200) {
      auditRecords.length = 200;
    }
    // Best-effort durable audit trail (survives redeploy when Supabase is configured).
    // NOTE: `audit_logs.id` is a bigint identity column, so the local `entry.id`
    // (an `audit_<ts>_<rand>` string used only for the in-memory list) must NOT be
    // sent — Postgres rejects it with 22P02 and the row is never written. The
    // durable id is assigned by the database.
    void supabaseRestRequest('audit_logs', 'POST', [buildDurableAuditRow(entry)]).catch(() => {});
  };

  let blockedIps: { ip: string; reason: string; date: string }[] = isProduction
    ? []
    : [
        { ip: '45.154.255.8', reason: 'Internal MCP Port Scanner', date: '2 days ago' },
        { ip: '198.51.100.44', reason: 'Adversarial Jailbreak Payload Injection', date: 'Today' },
      ];

  const isIpBlocked = (req: Request): boolean => {
    const clientIp = getClientIp(req);
    return blockedIps.some((entry) => entry.ip === clientIp);
  };

  // Durable platform state (blocked IPs, feature flags, platform config) in Supabase
  // so Render redeploys/restarts do not reset them. Falls back to in-memory when unset.
  const persistPlatformState = () => {
    void supabaseRestRequest(
      'platform_settings',
      'POST',
      [
        {
          id: 'global',
          value: { blockedIps, runtimeFeatureFlags, platformConfig },
          updated_at: new Date().toISOString(),
        },
      ],
      'resolution=merge-duplicates,return=minimal'
    ).catch(() => {});
  };
  const loadPlatformState = async () => {
    try {
      const rows = await supabaseRestRequest('platform_settings?id=eq.global&select=value', 'GET');
      const value = Array.isArray(rows) ? rows[0]?.value : rows?.value;
      if (value && typeof value === 'object') {
        if (Array.isArray(value.blockedIps)) blockedIps = value.blockedIps;
        if (value.runtimeFeatureFlags && typeof value.runtimeFeatureFlags === 'object') {
          runtimeFeatureFlags = { ...runtimeFeatureFlags, ...value.runtimeFeatureFlags };
        }
        if (value.platformConfig && typeof value.platformConfig === 'object') {
          platformConfig = { ...platformConfig, ...value.platformConfig };
        }
      }
      const logs = await supabaseRestRequest(
        'audit_logs?select=id,actor,action,resource,details,ip_address,created_at&order=created_at.desc&limit=200',
        'GET'
      );
      if (Array.isArray(logs) && logs.length > 0) {
        const mapped = logs.map((l: any) => ({
          id: l.id,
          timestamp: l.created_at
            ? new Date(l.created_at).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '',
          actor: l.actor,
          action: l.action,
          resource: l.resource,
          details: l.details,
          ipAddress: l.ip_address || '127.0.0.1',
        }));
        auditRecords.splice(0, auditRecords.length, ...mapped);
      }
    } catch {
      /* offline: keep seed/local state */
    }
  };
  void loadPlatformState();

  // Startup schema probe. The durable audit + platform-state writers swallow
  // errors so they can never break a request, which previously hid the fact
  // that `platform_settings` did not exist and that `audit_logs` had no
  // partition covering "now". Surface that drift in the logs instead of
  // failing silently.
  const verifyGatewaySchema = async () => {
    const checks: Array<{ table: string; path: string; requiredColumns: string[] }> = [
      {
        table: 'platform_settings',
        path: 'platform_settings?select=id&limit=1',
        requiredColumns: ['id', 'value', 'updated_at'],
      },
      {
        table: 'audit_logs',
        path: 'audit_logs?select=id,actor,action,resource,details,ip_address,created_at&limit=1',
        requiredColumns: [
          'id',
          'actor',
          'action',
          'resource',
          'details',
          'ip_address',
          'created_at',
        ],
      },
    ];
    for (const check of checks) {
      try {
        await supabaseRestRequest(check.path, 'GET');
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `[schema] ${check.table} is not usable by the gateway (expected columns: ${check.requiredColumns.join(', ')}). ` +
            `Durable writes to this table will be dropped. Apply supabase/migrations before deploying. Cause: ${detail}`
        );
      }
    }
  };
  void verifyGatewaySchema();

  // --- User Authentication & Unified Customer Directory ---
  const envAdminEmails = [
    process.env.ADMIN_EMAIL,
    ...(process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : []),
  ]
    .map((e) => (e || '').trim().toLowerCase())
    .filter(Boolean);

  // Personal/organisational emails are never seeded from source control. The only
  // built-in admin identities come from ADMIN_EMAIL / ADMIN_EMAILS, and users or
  // customers declared admin in the database (see getDatabaseAdminEmails below).
  const SEEDED_ADMIN_EMAILS = new Set<string>(envAdminEmails);
  // Admin user IDs are likewise environment-driven, never hardcoded.
  const ADMIN_USER_IDS = new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const ADMIN_RBAC_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'root_admin', 'owner']);

  type RbacRole = 'admin' | 'super_admin' | 'developer' | 'user';

  interface ServerUser {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    role: 'admin' | 'user';
    rbacRole?: RbacRole;
    isAdminEligible: boolean;
    isDeveloperEligible: boolean;
    adminUserId?: string;
    plan: PlanTier;
    createdAt: string;
    avatar?: string;
  }

  interface ServerCustomerRecord {
    id: string;
    name: string;
    email: string;
    tier: PlanTier;
    status: 'active' | 'past_due' | 'suspended';
    mrr: number;
    tokensUsed: number;
    tokenLimit: number;
    connectedRepos: number;
    joinedDate: string;
    lastActive: string;
    githubHandle?: string;
    region: string;
    isDeveloperEligible: boolean;
    isAdminEligible?: boolean;
    rbacRole?: RbacRole;
  }

  const getSessionSigningSecret = (): string => {
    const fromEnv =
      process.env.AUTH_TOKEN_SECRET?.trim() ||
      process.env.ADMIN_PASSKEY?.trim() ||
      process.env.SESSION_SECRET?.trim();
    if (fromEnv) return fromEnv;
    const keyFilePath = path.join(os.tmpdir(), 'supremeai_session_signing.key');
    try {
      if (fs.existsSync(keyFilePath)) {
        const existing = fs.readFileSync(keyFilePath, 'utf8').trim();
        if (existing.length >= 32) return existing;
      }
      const generated = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyFilePath, generated, { mode: 0o600 });
      return generated;
    } catch {
      return crypto.randomBytes(32).toString('hex');
    }
  };

  const TOKEN_SIGNING_SECRET = getSessionSigningSecret();
  const activeAdminSessions = new Map<string, number>();
  const upstreamTokenAdminCache = new Map<
    string,
    { email: string; isAdmin: boolean; tier: PlanTier; expiresAt: number }
  >();

  const signLocalSessionToken = (
    payload: { sub: string; email: string; iat: number; exp?: number; role?: string },
    ttlMs?: number
  ): string => signSessionToken(payload, TOKEN_SIGNING_SECRET, ttlMs);

  const verifyLocalSessionToken = (
    token: string
  ): { sub: string; email: string; iat: number; exp: number; role?: string } | null =>
    verifySessionToken(token, TOKEN_SIGNING_SECRET);

  const DEV_USERS_FILE = path.join(os.tmpdir(), 'supremeai_dev_users.json');
  const loadDevUsersDb = (): ServerUser[] => {
    if (isProduction) return [];
    try {
      if (fs.existsSync(DEV_USERS_FILE)) {
        const raw = fs.readFileSync(DEV_USERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore corrupt dev cache
    }
    return [];
  };
  const persistDevUsersDb = (users: ServerUser[]) => {
    if (isProduction) return;
    try {
      fs.writeFileSync(DEV_USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
    } catch {
      // Non-fatal in read-only environments
    }
  };

  // Seeded local user credentials removed; real accounts register or authenticate via upstream gateway.
  let usersDb: ServerUser[] = loadDevUsersDb();

  let customerDirectory: ServerCustomerRecord[] = isProduction
    ? []
    : [
        {
          id: 'cust_001',
          name: 'Studio Developer',
          email: 'demo.developer@supremeai.bd',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 142500,
          tokenLimit: 1000000,
          connectedRepos: 2,
          joinedDate: '2026-01-14',
          lastActive: 'Just now',
          githubHandle: 'supremeai-dev',
          region: 'Asia/Dhaka',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_sarah',
          name: 'Sarah Chen',
          email: 'sarah.chen@fintech.io',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 384200,
          tokenLimit: 1000000,
          connectedRepos: 4,
          joinedDate: '2026-03-10',
          lastActive: '5 mins ago',
          githubHandle: 'sarah-fintech',
          region: 'US/West',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_alex',
          name: 'Alex Johnson',
          email: 'alex.j@partner.io',
          tier: 'Free',
          status: 'active',
          mrr: 0,
          tokensUsed: 24500,
          tokenLimit: 100000,
          connectedRepos: 1,
          joinedDate: '2026-04-01',
          lastActive: '1 hour ago',
          githubHandle: 'alexj-partner',
          region: 'Europe/London',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_002',
          name: 'Rahim Chowdhury',
          email: 'rahim.chowdhury@techscale.io',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 1845000,
          tokenLimit: 5000000,
          connectedRepos: 14,
          joinedDate: '2025-11-03',
          lastActive: '12 mins ago',
          githubHandle: 'rahim-techscale',
          region: 'Asia/Singapore',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_003',
          name: 'Sarah Jenkins',
          email: 'sarah.j@vertexlabs.ai',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 2910000,
          tokenLimit: 5000000,
          connectedRepos: 8,
          joinedDate: '2025-10-22',
          lastActive: '45 mins ago',
          githubHandle: 'sjenkins-ai',
          region: 'US/East',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_004',
          name: 'Demo Developer',
          email: 'developer@supremeai.bd',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 620400,
          tokenLimit: 1000000,
          connectedRepos: 3,
          joinedDate: '2026-02-01',
          lastActive: '2 hours ago',
          githubHandle: 'demo-developer',
          region: 'Asia/Dhaka',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_005',
          name: 'Elena Rostova',
          email: 'elena@novasoft.eu',
          tier: 'Pro',
          status: 'past_due',
          mrr: 29,
          tokensUsed: 980200,
          tokenLimit: 1000000,
          connectedRepos: 4,
          joinedDate: '2026-01-18',
          lastActive: '5 hours ago',
          githubHandle: 'elena-novasoft',
          region: 'Europe/Berlin',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_006',
          name: 'Marcus Brody',
          email: 'marcus.brody@openbuild.dev',
          tier: 'Free',
          status: 'active',
          mrr: 0,
          tokensUsed: 42100,
          tokenLimit: 100000,
          connectedRepos: 1,
          joinedDate: '2026-02-10',
          lastActive: '1 day ago',
          githubHandle: 'mbrody',
          region: 'US/West',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_007',
          name: 'Fatima Al-Mansoor',
          email: 'fatima@cloudcore.ae',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 3120000,
          tokenLimit: 5000000,
          connectedRepos: 12,
          joinedDate: '2025-12-08',
          lastActive: '3 hours ago',
          githubHandle: 'fatima-cloud',
          region: 'MiddleEast/Dubai',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_010',
          name: 'David Zhao',
          email: 'zhao.david@quantmatrix.com',
          tier: 'Free',
          status: 'suspended',
          mrr: 0,
          tokensUsed: 100000,
          tokenLimit: 100000,
          connectedRepos: 0,
          joinedDate: '2026-02-04',
          lastActive: '7 days ago',
          githubHandle: 'zhaodavid',
          region: 'Asia/Tokyo',
          isDeveloperEligible: false,
        },
      ];

  // Provider Health & Failover Registry (server-managed + Infisical Vault synced secrets)
  const maskServerSecret = (val: string) => {
    if (!val || val === 'MY_GEMINI_API_KEY') return 'Not configured in server environment';
    if (val.length <= 10) return '••••••••••••';
    return `${val.slice(0, 6)}••••••••••••••••${val.slice(-4)}`;
  };

  // Map each provider to the server-side env var that holds its real API key.
  const PROVIDER_KEY_ENV: Record<string, string> = {
    google_ai_studio: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    mistral: 'MISTRAL_API_KEY',
  };

  // Lightweight, real upstream health probes. Each provider has a documented
  // models endpoint that validates the key without incurring token cost.
  const probeProviderUpstream = async (
    provider: string,
    key: string
  ): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs: number;
    message: string;
  }> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const headers: Record<string, string> = {};
    let url = '';

    switch (provider) {
      case 'openai':
        url = 'https://api.openai.com/v1/models';
        headers.Authorization = `Bearer ${key}`;
        break;
      case 'groq':
        url = 'https://api.groq.com/openai/v1/models';
        headers.Authorization = `Bearer ${key}`;
        break;
      case 'deepseek':
        url = 'https://api.deepseek.com/v1/models';
        headers.Authorization = `Bearer ${key}`;
        break;
      case 'mistral':
        url = 'https://api.mistral.ai/v1/models';
        headers.Authorization = `Bearer ${key}`;
        break;
      case 'anthropic':
        url = 'https://api.anthropic.com/v1/models';
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        break;
      default:
        clearTimeout(timer);
        return {
          status: 'unhealthy',
          latencyMs: 0,
          message: `No real probe implemented for provider "${provider}".`,
        };
    }

    try {
      const upstream = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      const latencyMs = Math.max(1, Date.now() - startedAt);
      clearTimeout(timer);
      if (upstream.ok) {
        return {
          status: 'healthy',
          latencyMs,
          message: `${provider} models endpoint responded HTTP ${upstream.status}`,
        };
      }
      // 401/403 => dead/invalid key. Other 4xx => key accepted but request rejected.
      const dead = upstream.status === 401 || upstream.status === 403;
      return {
        status: dead ? 'unhealthy' : 'degraded',
        latencyMs,
        message: `${provider} upstream returned HTTP ${upstream.status}`,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        status: 'unhealthy',
        latencyMs: Math.max(1, Date.now() - startedAt),
        message: aborted
          ? `${provider} probe timed out after 6s`
          : err instanceof Error
            ? err.message
            : 'Probe failed',
      };
    }
  };

  const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    supremeai: 'SupremeAI Gateway Mesh',
    google_ai_studio: 'Google AI Studio (Gemini)',
    vertex_ai: 'Google Cloud Vertex AI',
    openai: 'OpenAI Platform',
    anthropic: 'Anthropic Claude',
    groq: 'Groq LPU Broker',
    deepseek: 'DeepSeek R1',
    mistral: 'Mistral Codestral',
  };

  let providerMesh: Array<{
    id: string;
    provider: string;
    displayName: string;
    maskedKey: string;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'untested';
    latencyMs: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    priority: number;
    lastChecked: string;
    rateLimitTpm: string;
    infisicalPath: string;
    infisicalEnv: 'prod' | 'staging' | 'dev';
    vaultVersion: number;
    region: string;
  }> = [
    {
      id: 'prov_google_ai',
      provider: 'google_ai_studio',
      displayName: 'Google AI Studio (Gemini Global Direct)',
      maskedKey: process.env.GEMINI_API_KEY?.trim()
        ? maskServerSecret(process.env.GEMINI_API_KEY.trim())
        : 'not-configured',
      status: process.env.GEMINI_API_KEY?.trim() ? 'healthy' : 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 1,
      lastChecked: process.env.GEMINI_API_KEY?.trim()
        ? 'Configured (pending probe)'
        : 'Not configured (no API key)',
      rateLimitTpm: '4,000,000 TPM',
      infisicalPath: '/ai-providers/GEMINI_API_KEY',
      infisicalEnv: 'prod',
      vaultVersion: 7,
      region: 'global-edge',
    },
    {
      id: 'prov_vertex_ai',
      provider: 'vertex_ai',
      displayName: 'Google Cloud Vertex AI (asia-northeast1)',
      maskedKey: process.env.VERTEX_PROJECT_ID
        ? `projects/${process.env.VERTEX_PROJECT_ID}/locations/asia-northeast1`
        : 'not-configured',
      status: 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 2,
      lastChecked: process.env.VERTEX_PROJECT_ID ? 'Configured (pending probe)' : 'Not configured',
      rateLimitTpm: '10,000,000 TPM',
      infisicalPath: '/ai-providers/VERTEX_ADC_CREDENTIALS',
      infisicalEnv: 'prod',
      vaultVersion: 4,
      region: 'asia-northeast1',
    },
    {
      id: 'prov_groq',
      provider: 'groq',
      displayName: 'Groq LPU Inference Broker (Llama-3-70b)',
      maskedKey: process.env.GROQ_API_KEY?.trim()
        ? maskServerSecret(process.env.GROQ_API_KEY.trim())
        : 'not-configured',
      status: 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 3,
      lastChecked: process.env.GROQ_API_KEY?.trim()
        ? 'Configured (pending probe)'
        : 'Not configured (no API key)',
      rateLimitTpm: '2,500,000 TPM',
      infisicalPath: '/ai-providers/GROQ_API_KEY',
      infisicalEnv: 'prod',
      vaultVersion: 3,
      region: 'us-east-lpu',
    },
    {
      id: 'prov_openai',
      provider: 'openai',
      displayName: 'OpenAI Platform (GPT-4o / o3-mini)',
      maskedKey: process.env.OPENAI_API_KEY?.trim()
        ? maskServerSecret(process.env.OPENAI_API_KEY.trim())
        : 'not-configured',
      status: 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 4,
      lastChecked: process.env.OPENAI_API_KEY?.trim()
        ? 'Configured (pending probe)'
        : 'Not configured (no API key)',
      rateLimitTpm: '2,000,000 TPM',
      infisicalPath: '/ai-providers/OPENAI_API_KEY',
      infisicalEnv: 'prod',
      vaultVersion: 5,
      region: 'us-east-1',
    },
    {
      id: 'prov_anthropic',
      provider: 'anthropic',
      displayName: 'Anthropic Claude 3.7 Sonnet',
      maskedKey: process.env.ANTHROPIC_API_KEY?.trim()
        ? maskServerSecret(process.env.ANTHROPIC_API_KEY.trim())
        : 'not-configured',
      status: 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 5,
      lastChecked: process.env.ANTHROPIC_API_KEY?.trim()
        ? 'Configured (pending probe)'
        : 'Not configured (no API key)',
      rateLimitTpm: '1,000,000 TPM',
      infisicalPath: '/ai-providers/ANTHROPIC_API_KEY',
      infisicalEnv: 'prod',
      vaultVersion: 2,
      region: 'us-west-2',
    },
    {
      id: 'prov_deepseek',
      provider: 'deepseek',
      displayName: 'DeepSeek R1 Reasoning Cluster',
      maskedKey: process.env.DEEPSEEK_API_KEY?.trim()
        ? maskServerSecret(process.env.DEEPSEEK_API_KEY.trim())
        : 'not-configured',
      status: 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 6,
      lastChecked: process.env.DEEPSEEK_API_KEY?.trim()
        ? 'Configured (pending probe)'
        : 'Not configured (no API key)',
      rateLimitTpm: '1,500,000 TPM',
      infisicalPath: '/ai-providers/DEEPSEEK_API_KEY',
      infisicalEnv: 'prod',
      vaultVersion: 2,
      region: 'ap-southeast-1',
    },
    {
      id: 'prov_mistral',
      provider: 'mistral',
      displayName: 'Mistral Codestral Enterprise',
      maskedKey: process.env.MISTRAL_API_KEY?.trim()
        ? maskServerSecret(process.env.MISTRAL_API_KEY.trim())
        : 'not-configured',
      status: 'untested',
      latencyMs: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      priority: 7,
      lastChecked: process.env.MISTRAL_API_KEY?.trim()
        ? 'Configured (pending probe)'
        : 'Not configured (no API key)',
      rateLimitTpm: '1,000,000 TPM',
      infisicalPath: '/ai-providers/MISTRAL_API_KEY',
      infisicalEnv: 'staging',
      vaultVersion: 1,
      region: 'eu-west-1',
    },
  ];

  let infisicalExtraVaultKeys: Array<{
    id: string;
    secretName: string;
    infisicalPath: string;
    environment: 'prod' | 'staging' | 'dev';
    provider: string;
    providerDisplayName: string;
    maskedKey: string;
    version: number;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'untested';
    latencyMs: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    lastChecked: string;
    lastSyncedAt: string;
  }> = isProduction
    ? []
    : [
        {
          id: 'vault_infisical_gateway_master',
          secretName: 'SUPREMEAI_GATEWAY_SIGNING_KEY',
          infisicalPath: '/core/SUPREMEAI_GATEWAY_SIGNING_KEY',
          environment: 'prod' as const,
          provider: 'supremeai',
          providerDisplayName: 'SupremeAI Gateway Mesh',
          maskedKey: 'sk-supreme-••••••••••••••••not-configured',
          version: 9,
          status: 'healthy' as const,
          latencyMs: 12,
          avgLatencyMs: 15,
          p95LatencyMs: 24,
          lastChecked: 'Just now (HTTP 200)',
          lastSyncedAt: new Date().toISOString(),
        },
        {
          id: 'vault_infisical_gemini_staging',
          secretName: 'GEMINI_API_KEY_STAGING',
          infisicalPath: '/staging/ai-providers/GEMINI_API_KEY',
          environment: 'staging' as const,
          provider: 'google_ai_studio',
          providerDisplayName: 'Google AI Studio (Staging)',
          maskedKey: 'gsk-••••••••••••••••not-configured',
          version: 3,
          status: 'healthy' as const,
          latencyMs: 31,
          avgLatencyMs: 34,
          p95LatencyMs: 56,
          lastChecked: '5m ago (HTTP 200)',
          lastSyncedAt: new Date().toISOString(),
        },
        {
          id: 'vault_infisical_openai_dev',
          secretName: 'OPENAI_API_KEY_DEV',
          infisicalPath: '/dev/ai-providers/OPENAI_API_KEY',
          environment: 'dev' as const,
          provider: 'openai',
          providerDisplayName: 'OpenAI Platform (Dev Sandbox)',
          maskedKey: 'sk-proj-••••••••••••••••not-configured',
          version: 2,
          status: 'healthy' as const,
          latencyMs: 152,
          avgLatencyMs: 158,
          p95LatencyMs: 262,
          lastChecked: '18m ago (HTTP 200)',
          lastSyncedAt: new Date().toISOString(),
        },
      ];

  const buildInfisicalVaultKeys = () => {
    const nowIso = new Date().toISOString();
    const mappedProviders = providerMesh.map((p) => {
      const secretName = p.infisicalPath.split('/').pop() || `${p.provider.toUpperCase()}_API_KEY`;
      return {
        id: `vault_${p.id}`,
        secretName,
        infisicalPath: p.infisicalPath,
        environment: p.infisicalEnv,
        provider: p.provider,
        providerDisplayName: p.displayName,
        maskedKey: p.maskedKey,
        version: p.vaultVersion || 1,
        status: p.status,
        latencyMs: p.latencyMs,
        avgLatencyMs: p.avgLatencyMs ?? p.latencyMs,
        p95LatencyMs: p.p95LatencyMs ?? Math.round(p.latencyMs * 1.45),
        lastChecked: p.lastChecked,
        lastSyncedAt: nowIso,
      };
    });
    return [...mappedProviders, ...infisicalExtraVaultKeys];
  };

  let userApiKeysStore: Array<{
    id: string;
    name: string;
    provider: string;
    keyPrefix: string;
    secretMasked: string;
    createdAt: string;
    lastUsed: string;
    rateLimitRpm: number;
    status: 'active' | 'revoked';
    healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'untested';
    lastChecked: string;
    permissions: string[];
  }> = isProduction
    ? []
    : [
        {
          id: 'key_prod_01',
          name: 'SupremeAI Studio Production CLI',
          provider: 'supremeai',
          keyPrefix: 'sk-supreme-example',
          secretMasked: 'sk-supreme-••••••••••••••••not-configured',
          createdAt: '2026-03-12',
          lastUsed: '2 minutes ago',
          rateLimitRpm: 600,
          status: 'active',
          healthStatus: 'healthy',
          lastChecked: '2 mins ago',
          permissions: ['chat:write', 'models:read', 'knowledge:read', 'agents:invoke'],
        },
        {
          id: 'key_gemini_02',
          name: 'Google AI Studio (Gemini Flash Primary)',
          provider: 'google_ai_studio',
          keyPrefix: 'gsk-example',
          secretMasked: 'gsk-••••••••••••••••not-configured',
          createdAt: '2026-04-01',
          lastUsed: '5 minutes ago',
          rateLimitRpm: 360,
          status: 'active',
          healthStatus: 'healthy',
          lastChecked: 'Just now',
          permissions: ['chat:write', 'models:read', 'knowledge:read'],
        },
        {
          id: 'key_openai_03',
          name: 'OpenAI GPT-4o Fallback Bridge',
          provider: 'openai',
          keyPrefix: 'sk-proj-example',
          secretMasked: 'sk-proj-••••••••••••••••not-configured',
          createdAt: '2026-04-08',
          lastUsed: '18 minutes ago',
          rateLimitRpm: 240,
          status: 'active',
          healthStatus: 'healthy',
          lastChecked: '12 mins ago',
          permissions: ['chat:write', 'models:read'],
        },
        {
          id: 'key_anthropic_04',
          name: 'Anthropic Claude Sonnet Review Worker',
          provider: 'anthropic',
          keyPrefix: 'sk-ant-example',
          secretMasked: 'sk-ant-••••••••••••••••not-configured',
          createdAt: '2026-04-12',
          lastUsed: '1 hour ago',
          rateLimitRpm: 120,
          status: 'active',
          healthStatus: 'degraded',
          lastChecked: '1 hour ago',
          permissions: ['chat:write', 'agents:invoke'],
        },
        {
          id: 'key_groq_05',
          name: 'Groq LPU Ultra-Fast Synthesis',
          provider: 'groq',
          keyPrefix: 'gsk-example',
          secretMasked: 'gsk-••••••••••••••••not-configured',
          createdAt: '2026-04-20',
          lastUsed: '25 minutes ago',
          rateLimitRpm: 480,
          status: 'active',
          healthStatus: 'healthy',
          lastChecked: '4 mins ago',
          permissions: ['chat:write', 'models:read'],
        },
        {
          id: 'key_revoked_06',
          name: 'Legacy Staging Key (Deprecated)',
          provider: 'mistral',
          keyPrefix: 'msk-example',
          secretMasked: 'msk-••••••••••••••••not-configured',
          createdAt: '2026-01-15',
          lastUsed: '34 days ago',
          rateLimitRpm: 60,
          status: 'revoked',
          healthStatus: 'untested',
          lastChecked: '34 days ago',
          permissions: ['models:read'],
        },
      ];

  const activeAuthSessions = new Map<string, string>();
  // Local (dev/preview) refresh-token registry. The production gateway issues
  // and rotates refresh tokens itself; this keeps the local edge contract
  // identical so the client's 401-recovery path can be exercised offline.
  const activeRefreshTokens = new Map<string, { userId: string; expiresAt: number }>();
  const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const issueLocalRefreshToken = (userId: string): string => {
    const refreshToken = `rt_${crypto.randomBytes(32).toString('base64url')}`;
    activeRefreshTokens.set(refreshToken, {
      userId,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    });
    return refreshToken;
  };

  const getDatabaseAdminEmails = (extraEmails: string[] = []): Set<string> => {
    const emails = new Set<string>(SEEDED_ADMIN_EMAILS);
    for (const extra of extraEmails) {
      const clean = String(extra || '')
        .trim()
        .toLowerCase();
      if (clean) emails.add(clean);
    }
    for (const u of usersDb) {
      const clean = u.email.trim().toLowerCase();
      const rbac = String(u.rbacRole || u.role || '').toLowerCase();
      if (
        u.isAdminEligible ||
        ADMIN_RBAC_ROLES.has(rbac) ||
        (u.adminUserId && ADMIN_USER_IDS.has(u.adminUserId))
      ) {
        emails.add(clean);
      }
    }
    for (const c of customerDirectory) {
      const clean = c.email.trim().toLowerCase();
      const rbac = String(c.rbacRole || '').toLowerCase();
      if (c.isAdminEligible || ADMIN_RBAC_ROLES.has(rbac)) {
        emails.add(clean);
      }
    }
    return emails;
  };

  const resolveRbacUserProfile = (
    cleanEmail: string,
    user?: Partial<ServerUser>,
    customerRec?: Partial<ServerCustomerRecord>,
    extraAdminEmails: string[] = [],
    extraRbacRole?: string
  ) => {
    const adminEmails = getDatabaseAdminEmails(extraAdminEmails);
    const emailMatchedAdminDb = adminEmails.has(cleanEmail);
    const rbacCandidates = [extraRbacRole, user?.rbacRole, user?.role, customerRec?.rbacRole]
      .map((r) =>
        String(r || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);

    const hasAdminRbacRole = rbacCandidates.some((r) => ADMIN_RBAC_ROLES.has(r));
    const hasExplicitFlag = Boolean(
      user?.isAdminEligible ||
      customerRec?.isAdminEligible ||
      (user?.adminUserId && ADMIN_USER_IDS.has(user.adminUserId))
    );

    const isAdminEligible = Boolean(emailMatchedAdminDb || hasAdminRbacRole || hasExplicitFlag);
    const rbacRole: RbacRole = isAdminEligible
      ? rbacCandidates.includes('super_admin') || rbacCandidates.includes('superadmin')
        ? 'super_admin'
        : 'admin'
      : rbacCandidates.includes('developer') ||
          Boolean(customerRec?.isDeveloperEligible ?? user?.isDeveloperEligible)
        ? 'developer'
        : 'user';
    const role: 'admin' | 'user' = isAdminEligible ? 'admin' : 'user';
    const isDeveloperEligible = Boolean(
      isAdminEligible || customerRec?.isDeveloperEligible || user?.isDeveloperEligible
    );

    return {
      isAdminEligible,
      adminEmailMatched: emailMatchedAdminDb,
      rbacRole,
      role,
      isDeveloperEligible,
      adminUserId: user?.adminUserId || (isAdminEligible ? 'admin_root_001' : undefined),
      adminEmails: Array.from(adminEmails),
    };
  };

  const buildSafeAuthUser = (
    user: ServerUser,
    customerRec?: ServerCustomerRecord,
    extraAdminEmails: string[] = [],
    extraRbacRole?: string
  ) => {
    const cleanEmail = user.email.trim().toLowerCase();
    const rbac = resolveRbacUserProfile(
      cleanEmail,
      user,
      customerRec,
      extraAdminEmails,
      extraRbacRole
    );
    return {
      id: user.id,
      user_id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || user.name.charAt(0).toUpperCase(),
      role: rbac.role,
      rbacRole: rbac.rbacRole,
      isAdminEligible: rbac.isAdminEligible,
      adminEmailMatched: rbac.adminEmailMatched,
      isDeveloperEligible: rbac.isDeveloperEligible,
      adminUserId: rbac.adminUserId,
      plan: customerRec?.tier || user.plan,
      createdAt: user.createdAt,
      adminEmails: rbac.adminEmails,
    };
  };

  const setRefreshTokenCookie = (req: Request, res: Response, refreshToken: string) => {
    res.cookie('supremeai_refresh_token', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttpsRequest(req),
      path: '/api',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  };

  const setAdminSessionCookie = (req: Request, res: Response, token: string) => {
    activeAdminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    res.cookie('supremeai_admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttpsRequest(req),
      path: '/api/admin',
      maxAge: ADMIN_SESSION_TTL_MS,
    });
  };

  registerAuthRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    activeAuthSessions,
    activeAdminSessions,
    activeRefreshTokens,
    upstreamTokenAdminCache,
    isIpBlocked: (req) => isIpBlocked(req),
    platformConfig,
    buildSafeAuthUser: (u, c) => buildSafeAuthUser(u, c),
    signLocalSessionToken: (p) => signLocalSessionToken(p),
    verifyLocalSessionToken: (t) => verifyLocalSessionToken(t),
    issueLocalRefreshToken: (u) => issueLocalRefreshToken(u),
    setRefreshTokenCookie: (a, b, c) => setRefreshTokenCookie(a, b, c),
    setAdminSessionCookie: (a, b, c) => setAdminSessionCookie(a, b, c),
    resolveRbacUserProfile: (...a) => resolveRbacUserProfile(...a),
    recordAudit: (a, b, c, d, e) => recordAudit(a, b, c, d, e),
    persistDevUsersDb: (u) => persistDevUsersDb(u),
  });

  registerReleasesRoutes(app);

  registerFeedbackRoutes(app, {
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    recordAudit: (a, b, c, d, r) => recordAudit(a, b, c, d, r),
  });

  registerAuthTotpRoutes(app, {
    activeAuthSessions,
    activeAdminSessions,
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    verifyLocalSessionToken: (t) => verifyLocalSessionToken(t),
    resolveRbacUserProfile: (...a) => resolveRbacUserProfile(...a),
    recordAudit: (a, b, c, d, r) => recordAudit(a, b, c, d, r),
  });

  const verifyBearerIdentity = async (
    rawToken: string
  ): Promise<{ email: string; isAdmin: boolean; tier: PlanTier } | null> => {
    if (!rawToken || rawToken.startsWith('tok_guest_') || rawToken.startsWith('sk-supreme-guest')) {
      return null;
    }

    const verifiedLocal = verifyLocalSessionToken(rawToken);
    if (verifiedLocal) {
      const adminExp = activeAdminSessions.get(rawToken);
      if (verifiedLocal.sub === 'admin_passkey') {
        if (adminExp && adminExp > Date.now()) {
          return { email: verifiedLocal.email, isAdmin: true, tier: 'Enterprise' };
        }
        activeAdminSessions.delete(rawToken);
        return null;
      }
      const sessionUserId = activeAuthSessions.get(rawToken);
      const matchedUser =
        (sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined) ||
        usersDb.find((u) => u.email.toLowerCase() === verifiedLocal.email);
      const customerRec = customerDirectory.find(
        (c) => c.email.toLowerCase() === verifiedLocal.email
      );
      const rbac = resolveRbacUserProfile(verifiedLocal.email, matchedUser, customerRec);
      return {
        email: verifiedLocal.email,
        isAdmin: rbac.isAdminEligible || verifiedLocal.role === 'admin',
        tier:
          customerRec?.tier || matchedUser?.plan || (rbac.isAdminEligible ? 'Enterprise' : 'Pro'),
      };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const cached = upstreamTokenAdminCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return { email: cached.email, isAdmin: cached.isAdmin, tier: cached.tier };
    }

    if (!rawToken.startsWith('tok_') && !rawToken.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${rawToken}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4500),
        });
        if (upstreamRes.ok) {
          const data: any = await upstreamRes.json().catch(() => null);
          const raw =
            data && typeof data === 'object'
              ? data.user && typeof data.user === 'object'
                ? { ...data, ...data.user }
                : data
              : null;
          const cleanEmail = String(raw?.email || '')
            .trim()
            .toLowerCase();
          if (cleanEmail) {
            const matchedUser = usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
            const customerRec = customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);
            const upstreamAdminEmails: string[] = [
              ...(Array.isArray(data?.adminEmails) ? data.adminEmails : []),
              ...(Array.isArray(data?.admin_emails) ? data.admin_emails : []),
            ];
            const upstreamRbac = raw.rbacRole || raw.rbac_role || raw.role;
            const rbac = resolveRbacUserProfile(
              cleanEmail,
              matchedUser || {
                rbacRole: upstreamRbac,
                isAdminEligible: Boolean(
                  raw.isAdminEligible ?? raw.is_admin_eligible ?? raw.is_admin
                ),
                isDeveloperEligible: Boolean(raw.isDeveloperEligible ?? raw.is_developer_eligible),
                adminUserId: raw.adminUserId || raw.admin_user_id,
              },
              customerRec,
              upstreamAdminEmails,
              upstreamRbac
            );
            const resolved = {
              email: cleanEmail,
              isAdmin: rbac.isAdminEligible,
              tier: (customerRec?.tier ||
                raw.plan ||
                (rbac.isAdminEligible ? 'Enterprise' : 'Pro')) as PlanTier,
            };
            upstreamTokenAdminCache.set(tokenHash, {
              ...resolved,
              expiresAt: Date.now() + 60_000,
            });
            return resolved;
          }
        }
      } catch {
        return null;
      }
    }

    return null;
  };

  // Resolve the authenticated caller's email from the bearer token, or null when
  // the request is anonymous/invalid. Used to scope per-user resources.
  const resolveAuthenticatedEmail = async (req: Request): Promise<string | null> => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    const identity = await verifyBearerIdentity(token);
    const email = identity?.email?.trim().toLowerCase();
    return email && email !== 'guest' ? email : null;
  };

  const verifyAdminAuthorization = async (
    req: Request
  ): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const adminHeader = String(req.headers['x-admin-token'] || '').trim();
    const cookies = parseCookieHeader(req.headers.cookie);
    const cookieToken = cookies.supremeai_admin_session || '';

    const candidates = [adminHeader, cookieToken, bearerToken].filter(Boolean);
    if (candidates.length === 0) {
      return { ok: false, status: 401, error: 'Administrator authentication is required.' };
    }

    for (const candidate of candidates) {
      const identity = await verifyBearerIdentity(candidate);
      if (identity?.isAdmin) {
        return { ok: true, email: identity.email };
      }
    }

    return {
      ok: false,
      status: 403,
      error: 'Administrator privileges are required for this endpoint.',
    };
  };

  const requireAdminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/auth/verify' && req.method === 'POST') {
      next();
      return;
    }
    const authResult = await verifyAdminAuthorization(req);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    next();
  };

  app.use('/api/admin', requireAdminMiddleware);
  app.use('/api/schema-parity', requireAdminMiddleware);

  registerAdminPlatformRoutes(app, {
    get platformConfig() {
      return platformConfig;
    },
    set platformConfig(_v) {
      // platformConfig reassignment never happens; property mutations
      // via reference are used. Setter is a placeholder for completeness.
    },
    get runtimeFeatureFlags() {
      return runtimeFeatureFlags;
    },
    set runtimeFeatureFlags(v) {
      runtimeFeatureFlags = v;
    },
    customerDirectory,
    blockedIps,
    auditRecords,
    SUPPORTED_MODELS,
    activeAdminSessions,
    signLocalSessionToken: (payload, ttlMs) => signLocalSessionToken(payload as Parameters<typeof signLocalSessionToken>[0], ttlMs),
    isHttpsRequest: (req) => isHttpsRequest(req),
    persistPlatformState: () => persistPlatformState(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

    registerAdminCustomerRoutes(app, {
    get customerDirectory() {
      return customerDirectory;
    },
    set customerDirectory(v) {
      customerDirectory = v;
    },
    get usersDb() {
      return usersDb;
    },
    set usersDb(v) {
      usersDb = v;
    },
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

    const devSwarmWorkers = [
    {
      id: 'worker-solver-01',
      name: 'Autonomous Solver Agent',
      type: 'solver',
      status: 'active',
      currentTask: 'Resolving Issue #42: Backpressure handling in WebSocket stream broker',
      currentIssueOrPr: 'Supremeai-bd/supremeai #42',
      processedCount: 184,
      successRate: 97.8,
      cpuPercent: 18.4,
      memoryMb: 412,
      uptime: '14h 22m',
      logs: [
        'Identified unbounded buffer allocation in event emitter.',
        'Generated patch applying bounded circular ring-buffer.',
        'Unit test suite verified: 34 tests passing with 0 regressions.',
      ],
    },
    {
      id: 'worker-verifier-02',
      name: 'AST Code Verifier & Validator',
      type: 'verifier',
      status: 'active',
      currentTask: 'Running TypeScript AST graph verification on PR #94',
      currentIssueOrPr: 'Supremeai-bd/supremeai-studio #94',
      processedCount: 312,
      successRate: 99.4,
      cpuPercent: 9.2,
      memoryMb: 280,
      uptime: '28h 10m',
      logs: [
        'AST tree generated for 84 source modules.',
        'Checked symbol cross-references: 0 circular dependencies.',
        'Strict null check verification PASSED.',
      ],
    },
    {
      id: 'worker-scout-03',
      name: 'Ecosystem Scout & Dependency Tracker',
      type: 'ecosystem-scout',
      status: 'idle',
      currentTask: 'Awaiting scheduled 15-minute package index crawl',
      currentIssueOrPr: 'Continuous background crawler',
      processedCount: 94,
      successRate: 100.0,
      cpuPercent: 1.1,
      memoryMb: 145,
      uptime: '42h 50m',
      logs: [
        'Checked @google/genai SDK v3.2.0 compatibility.',
        'Found 0 upstream security advisories in current node_modules lockfile.',
      ],
    },
    {
      id: 'worker-security-04',
      name: 'Adversarial Prompt & Rules Breaker',
      type: 'rules-breaker',
      status: 'active',
      currentTask: 'Fuzzing prompt boundaries with 500 adversarial jailbreak vectors',
      currentIssueOrPr: 'Adversarial Test Suite #19',
      processedCount: 780,
      successRate: 99.8,
      cpuPercent: 24.6,
      memoryMb: 520,
      uptime: '19h 45m',
      logs: [
        'Injected recursive delimiter extraction payload: Blocked by boundary shield.',
        'Tested system instruction override vector: Sanitized by LLM gateway filter.',
      ],
    },
  ];

  registerAdminSecurityRoutes(app, {
    blockedIps,
    auditRecords,
    persistPlatformState: () => persistPlatformState(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });
  registerAdminSwarmQueueRoutes(app, {
    devSwarmWorkers,
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });



  // --- Workspace User Knowledge Endpoints ---
  let devKnowledgeDocs = [
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

  const devKnowledgeOwner = new Map<string, string>();

  app.get(
    ['/api/user/knowledge', '/api/v1/user/knowledge'],
    async (req: Request, res: Response) => {
      const owner = await resolveAuthenticatedEmail(req);
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
      const owner = await resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const payload = req.body || {};
      const newDoc = {
        id: `doc_${Date.now()}`,
        title: payload.title || 'Untitled Document',
        type: payload.type || 'markdown',
        sizeBytes: payload.sizeBytes || 1024,
        tokenCount: payload.tokenCount || 250,
        chunkCount: payload.chunkCount || 1,
        status: payload.status || 'indexed',
        lastIndexed: 'Just now',
        isGroundingActive: payload.isGroundingActive ?? true,
        contentPreview: payload.contentPreview || payload.title || 'New document content',
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
      const owner = await resolveAuthenticatedEmail(req);
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
      if (req.body?.isGroundingActive !== undefined) {
        doc.isGroundingActive = Boolean(req.body.isGroundingActive);
      }
      if (req.body?.title) {
        doc.title = req.body.title;
      }
      doc.lastIndexed = 'Just now';
      res.json({ success: true, document: doc });
    }
  );

  app.delete(
    ['/api/user/knowledge/:id', '/api/v1/user/knowledge/:id'],
    async (req: Request, res: Response) => {
      const owner = await resolveAuthenticatedEmail(req);
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

  // --- LLM Gateway Average Response Latency Endpoint (used by UserApiKeysView & Admin) ---
  app.get(
    ['/api/llm-gateway/latency', '/api/v1/llm-gateway/latency'],
    (_req: Request, res: Response) => {
      const updatedAt = new Date().toISOString();
      const providerMap: Record<
        string,
        {
          provider: string;
          displayName: string;
          avgLatencyMs: number;
          p95LatencyMs: number;
          successRate: number;
          sampleCount: number;
          status: 'healthy' | 'degraded' | 'unhealthy';
          updatedAt: string;
        }
      > = {
        supremeai: {
          provider: 'supremeai',
          displayName: 'SupremeAI Gateway Mesh',
          avgLatencyMs: 19,
          p95LatencyMs: 34,
          successRate: 99.98,
          sampleCount: 14820,
          status: 'healthy',
          updatedAt,
        },
      };

      for (const p of providerMesh) {
        const avg = p.avgLatencyMs ?? p.latencyMs;
        const p95 = p.p95LatencyMs ?? Math.round(avg * 1.45);
        const status: 'healthy' | 'degraded' | 'unhealthy' =
          p.status === 'unhealthy'
            ? 'unhealthy'
            : p.status === 'degraded' || avg > 250
              ? 'degraded'
              : 'healthy';

        if (!providerMap[p.provider]) {
          providerMap[p.provider] = {
            provider: p.provider,
            displayName: PROVIDER_DISPLAY_NAMES[p.provider] || p.displayName,
            avgLatencyMs: avg,
            p95LatencyMs: p95,
            successRate: status === 'healthy' ? 99.92 : status === 'degraded' ? 97.4 : 88.5,
            sampleCount:
              p.provider === 'google_ai_studio' ? 9420 : p.provider === 'openai' ? 4110 : 1850,
            status,
            updatedAt,
          };
        }
      }

      res.json({
        gatewayStatus: 'healthy',
        fetchedAt: updatedAt,
        providers: providerMap,
        list: Object.values(providerMap),
      });
    }
  );

  registerApiKeysRoutes(app, {
    get providerMesh() { return providerMesh; },
    PROVIDER_DISPLAY_NAMES,
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  // --- Provider Mesh & Infisical Vault Secrets Endpoints (Admin Dashboard) ---  // --- Provider Mesh & Infisical Vault Secrets Endpoints (Admin Dashboard) ---
  registerAdminProvidersRoutes(app, {
    get providerMesh(): any {
      return providerMesh;
    },
    set providerMesh(v: any) {
      providerMesh = v;
    },
    get infisicalExtraVaultKeys(): any {
      return infisicalExtraVaultKeys;
    },
    set infisicalExtraVaultKeys(v: any) {
      infisicalExtraVaultKeys = v;
    },
    PROVIDER_KEY_ENV,
    PROVIDER_DISPLAY_NAMES,
    maskServerSecret: (val) => maskServerSecret(val),
    probeProviderUpstream: (provider, apiKey) => probeProviderUpstream(provider, apiKey),
    buildInfisicalVaultKeys: () => buildInfisicalVaultKeys(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });



  // Dynamic User & Admin Workspace Stores (persistent for runtime lifecycle)
  interface UserWalletRecord {
    userId: string;
    balanceUsd: number;
    monthlyAllowanceUsd: number;
    totalSpent: number;
    totalSaved: number;
    cachedQueries: number;
  }

  const getRequestUserEmail = (req: Request): string => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return 'guest';
    const sessionUserId = activeAuthSessions.get(token);
    const matchedUser = sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined;
    if (matchedUser?.email) return matchedUser.email.toLowerCase();
    const verifiedPayload = verifyLocalSessionToken(token);
    return verifiedPayload?.email?.toLowerCase() || 'guest';
  };

  registerBillingRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    fetchGatewayJson: (p, t) => fetchGatewayJson(p, t),
    getRequestUserEmail: (req) => getRequestUserEmail(req),
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
    verifyBearerIdentity: (t) => verifyBearerIdentity(t),
    recordAudit: (a, b, c, d, r) => recordAudit(a, b, c, d, r),
    resolveAuditActor: (req, a) => resolveAuditActor(req, a as unknown),
  });

  registerWebhooksRoutes(app, {
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });

  registerProjectsRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerTeamRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerPreferencesRoutes(app, {
    getRequestUserEmail: (req) => getRequestUserEmail(req),
    verifyLocalSessionToken: (token) => verifyLocalSessionToken(token),
    get usersDb() { return usersDb; },
    activeAuthSessions,
  });

  // Admin Schema Parity Endpoints  // Admin Schema Parity Endpoints
  registerAdminSystemRoutes(app, {
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

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
      incomingMessagesPrecheck.some((m: any) => messageHasActualImage(m));
    const localKeyPrecheck = process.env.GEMINI_API_KEY?.trim() || '';
    const hasLocalGeminiKey = Boolean(localKeyPrecheck && localKeyPrecheck !== 'MY_GEMINI_API_KEY');
    let remoteVisionFailure: ClassifiedVisionError | null = null;

    // For Vision requests when GEMINI_API_KEY is available locally, use our free-only multimodal cascade directly
    // instead of risking a remote text-only provider failover that cannot read image_url pixels.
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
        const derivedEffort = resolveReasoningEffort(
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
          remoteVisionFailure = classifyVisionHttpError({
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
          remoteVisionFailure = classifyVisionHttpError({
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

    // Optional local Stealth Webhook relay if configured via STEALTH_WEBHOOK_URL
    const body = req.body || {};
    const messages =
      Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages
        : [{ role: 'user', content: String(body.prompt || body.message || '') }];
    const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
    const isValidKey = Boolean(activeApiKey && activeApiKey !== 'MY_GEMINI_API_KEY');
    const reqModel = String(body.model || 'supreme-spark');
    const resolvedModel = resolveServerAutoModel(reqModel, messages);
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

    const upstreamModel = resolveUpstreamGeminiModel(resolvedModel, runConfig);
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
      .map((m: any) => extractTextFromMessageContent(m.content).trim())
      .filter(Boolean);
    const systemMsg = systemMsgs.join('\n\n');
    const lastUserMsgObj = [...messages].reverse().find((m: any) => m.role === 'user');
    const lastUserMessageText = extractTextFromMessageContent(lastUserMsgObj?.content);
    const hasVisionAttachment = messages.some((m: any) => messageHasVisionOrAttachment(m));
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
    const userWroteBengali = detectBengaliOrBanglish(lastUserMessageText);
    const langDirective =
      body.language === 'bn' || userWroteBengali
        ? '\n\n[DEFAULT RESPONSE LANGUAGE]: Always reply in clear, natural Bengali (বাংলা script, not Romanized Banglish unless requested) by default, keeping code/technical identifiers in English unless the user explicitly asks for another language.'
        : '\n\n[DEFAULT RESPONSE LANGUAGE]: Reply in clear English by default unless the user writes in Bengali (বাংলা) or Romanized Bengali (Banglish), in which case reply in natural Bengali (বাংলা).';
    const combinedSystem = `${systemMsg || 'You are SupremeAI Studio, a helpful and authoritative AI assistant.'}${serverIntentDirective}${serverGroundingBlock}${langDirective}`;

    // Vision requests use the dedicated Free-Only Vision Cascade (Gemini configurable -> Groq -> OpenRouter :free -> Cloudflare)
    if (hasImageInRequest) {
      const imageCount = Math.max(1, countImagesInMessages(messages));
      await executeFreeVisionCascade({
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
            parts: buildGeminiPartsFromMessage(m),
          }));
        const streamConfig = buildGeminiGenerateConfig(
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
          latestUsage = collectGroundingSourcesAndUsage(chunk, sourcesMap, latestUsage);
          const textChunk = chunk.text || '';
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
      req: Request<Record<string, never>, Record<string, never>, ChatRequestBody>,
      res: Response
    ) => {
      try {
        if (isIpBlocked(req)) {
          res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
          return;
        }

        const {
          model = platformConfig.defaultModelId || 'supreme-spark',
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
        const verifiedIdentity = bearerToken ? await verifyBearerIdentity(bearerToken) : null;
        const adminAuth = verifiedIdentity?.isAdmin ? null : await verifyAdminAuthorization(req);
        const isVerifiedAdmin = Boolean(verifiedIdentity?.isAdmin || adminAuth?.ok);

        const callerRole = isVerifiedAdmin ? 'admin' : 'user';
        const callerEmail = verifiedIdentity?.email || (adminAuth?.ok ? adminAuth.email : '');
        const matchedCustomer = callerEmail
          ? customerDirectory.find((c) => c.email.toLowerCase() === callerEmail)
          : undefined;
        const callerTier: PlanTier = matchedCustomer?.tier || verifiedIdentity?.tier || 'Free';

        // Enforce Global Maintenance Mode
        if (platformConfig.maintenanceMode && callerRole !== 'admin') {
          res.status(503).json({
            error:
              platformConfig.maintenanceMessage || 'Platform is currently in maintenance mode.',
          });
          return;
        }

        // Enforce Customer Account Suspension & Quota
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

        const resolvedModel = resolveServerAutoModel(model, messages);
        const validatedModel = SUPPORTED_MODELS[resolvedModel] ? resolvedModel : 'supreme-spark';
        const upstreamModel = resolveUpstreamGeminiModel(validatedModel, runConfig);

        // Enforce Model Policy (enabled & minTier)
        const modelPolicy = platformConfig.modelPolicies[validatedModel];
        if (modelPolicy) {
          if (!modelPolicy.enabled) {
            res.status(403).json({
              error: `Model "${SUPPORTED_MODELS[validatedModel]?.name || validatedModel}" is currently disabled by administrator policy.`,
            });
            return;
          }
          if (callerRole !== 'admin' && TIER_RANK[callerTier] < TIER_RANK[modelPolicy.minTier]) {
            res.status(403).json({
              error: `Model "${SUPPORTED_MODELS[validatedModel]?.name || validatedModel}" requires a ${modelPolicy.minTier} plan or higher.`,
            });
            return;
          }
        }

        // Enforce Multimodal Vision Feature Flag
        const hasAttachment = messages.some((m) => messageHasVisionOrAttachment(m));
        if (hasAttachment && !runtimeFeatureFlags.enable_multimodal_vision) {
          res.status(403).json({
            error:
              'Multimodal image & file attachments are currently disabled by platform feature flags.',
          });
          return;
        }

        const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
        const isValidKey = activeApiKey && activeApiKey !== 'MY_GEMINI_API_KEY';

        // Enforce RAG Grounding Feature Flag
        const effectiveGrounding = runtimeFeatureFlags.enable_rag_grounding
          ? groundingContext
          : undefined;

        // Update customer telemetry on server
        if (matchedCustomer) {
          const promptChars =
            extractTextFromMessageContent(messages[messages.length - 1]?.content).length || 120;
          matchedCustomer.tokensUsed += Math.max(120, Math.ceil(promptChars / 3) + 180);
          matchedCustomer.lastActive = 'Just now';
        }

        const defaultSystemInstruction =
          'You are SupremeAI, the premier intelligent AI engineering partner created by Supremeai-bd. You provide sharp, concise, authoritative code solutions, architectural insight, and deep reasoning with clean formatting.';

        let activeSystemInstruction = (systemInstruction || '').trim() || defaultSystemInstruction;

        const lastChatUserText = extractTextFromMessageContent(
          [...messages].reverse().find((m) => m.role === 'user')?.content
        );
        if (language === 'bn' || detectBengaliOrBanglish(lastChatUserText)) {
          activeSystemInstruction +=
            '\n\n[DEFAULT RESPONSE LANGUAGE]: Respond naturally and fluently in Bengali (বাংলা script, not Romanized Banglish unless requested) by default, keeping code/technical identifiers in English unless the user explicitly asks for another language.';
        } else {
          activeSystemInstruction +=
            '\n\n[DEFAULT RESPONSE LANGUAGE]: Respond in clear English by default unless the user writes in Bengali (বাংলা) or Romanized Bengali (Banglish), in which case respond in natural Bengali (বাংলা).';
        }

        // Inject Knowledge Base RAG grounding context if provided & enabled by runtime flags
        if (effectiveGrounding && effectiveGrounding.trim()) {
          activeSystemInstruction += `\n\n[RETRIEVED KNOWLEDGE BASE CONTEXT (RAG)]:\n${effectiveGrounding.trim()}\n\nUse the above engineering knowledge context as primary truth and reference when answering.`;
        }

        // When a valid GEMINI_API_KEY is present, perform real Gemini inference via @google/genai SDK
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
            .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
            .map((msg) => ({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: buildGeminiPartsFromMessage(msg),
            }));

          if (contents.length === 0) {
            res.status(400).json({ error: 'No user or assistant messages found.' });
            return;
          }

          const generateConfig = buildGeminiGenerateConfig(
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
              latestUsage = collectGroundingSourcesAndUsage(chunk, sourcesMap, latestUsage);
              const textChunk = chunk.text || '';
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
            const tokenUsage = collectGroundingSourcesAndUsage(response, sourcesMap, null);
            const groundingSources = Array.from(sourcesMap.values());

            res.json({
              text: response.text ?? '',
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

        // If GEMINI_API_KEY is not yet injected into the environment:
        const lastUserMessage =
          [...messages].reverse().find((m) => m.role === 'user')?.content || 'Inquiry';
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

        // Parse JSON formatted error messages for clean client display
        try {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error?.message) {
            errorMessage = parsed.error.message;
          }
        } catch {
          // Keep original string if not JSON
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

  const requireAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const keyHeader = String(req.headers['x-supremeai-key'] || '').trim();
    const candidate = bearerToken || keyHeader;
    if (!candidate) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const identity = await verifyBearerIdentity(candidate);
    if (!identity) {
      res.status(401).json({ error: 'Valid session or API key is required.' });
      return;
    }
    (req as any).authIdentity = identity;
    next();
  };

  app.use('/api/workspace', requireAuthMiddleware);
  registerWorkspaceTerminalRoutes(app, {
    get mcpClusterServices() { return mcpClusterServices; },
    get PORT() { return PORT; },
    get apiKey() { return apiKey; },
  });

  registerWorkspaceBrowserProxyRoutes(app, {
    get PORT() { return PORT; },
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });

  registerWorkspaceBrowserVaultRoutes(app, {
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerWorkspaceGmailSessionRoutes(app, {
    isHttpsRequest: (req) => isHttpsRequest(req),
  });

  registerWorkspaceBrowserSchedulesRoutes(app, {
    get APP_VERSION() { return APP_VERSION; },
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });

  const studioDataDir = path.join(process.cwd(), '.studio-data');

  registerGitOauthRoutes(app, { PORT });

  registerGraphRoutes(app, {
    get mcpClusterServices() { return mcpClusterServices; },
  });

  registerMediaRoutes(app, {
    isIpBlocked: (req) => isIpBlocked(req),
    get platformConfig() { return platformConfig; },
  });

  registerTtsRoutes(app, {
    isIpBlocked: (req) => isIpBlocked(req),
  });

  // ---------------------------------------------------------------------------
  // Federation Living Proxy (fail-open)
  //
  // Every `/api/*` route implemented by this Studio edge is registered above.
  // Anything else is a real `Supremeai-bd/supremeai` surface (ecosystem,
  // agents, memory, telemetry, HITL, ...). Instead of letting the SPA fallback
  // answer those requests with HTML (which silently poisoned client services),
  // forward them upstream with auth headers preserved and SSE left unbuffered.
  // The live-data fabric in `src/services/federationSyncService.ts` depends on
  // this contract: JSON or an explicit 5xx, never a 200 text/html response.
  registerConversationsRoutes(app, {
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  // ---------------------------------------------------------------------------
  const FEDERATION_PROXY_HOP_HEADERS = new Set([
    'host',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'content-length',
    'accept-encoding',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-proto',
    'x-real-ip',
  ]);

  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/mock')) {
      next();
      return;
    }

    const originalUrl = req.originalUrl || req.url;
    const targetUrl = `${GATEWAY_BASE}${originalUrl}`;
    const upstreamHeaders: Record<string, string> = { Accept: 'application/json' };

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value !== 'string') continue;
      const lower = key.toLowerCase();
      if (FEDERATION_PROXY_HOP_HEADERS.has(lower)) continue;
      upstreamHeaders[key] = value;
    }
    if (!upstreamHeaders.accept || upstreamHeaders.accept === '*/*') {
      upstreamHeaders.accept = 'application/json';
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let body: string | undefined;
    if (hasBody) {
      if (typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
        upstreamHeaders['content-type'] = upstreamHeaders['content-type'] || 'application/json';
      }
    }

    const controller = new AbortController();
    let responseStarted = false;
    const timeout = setTimeout(() => {
      if (!responseStarted) controller.abort();
    }, 9_000);

    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
      responseStarted = true;
      clearTimeout(timeout);

      const responseHeaders = new Headers(upstream.headers);
      for (const header of [
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection',
        'keep-alive',
      ]) {
        responseHeaders.delete(header);
      }
      responseHeaders.forEach((value, key) => {
        res.setHeader(key, value);
      });
      if ((responseHeaders.get('content-type') || '').includes('text/event-stream')) {
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
      }
      res.setHeader('X-SupremeAI-Proxy', 'federation');

      res.status(upstream.status);
      if (!upstream.body) {
        res.end();
        return;
      }
      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch (error: unknown) {
      clearTimeout(timeout);
      if (res.writableEnded) return;
      const detail = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof Error && error.name === 'AbortError';
      res.status(timedOut ? 504 : 502).json({
        success: false,
        error: timedOut ? 'Federation upstream timeout' : 'Federation upstream unreachable',
        detail,
        upstreamPath: originalUrl,
        retryable: true,
      });
    }
  });

  // Register Unified Central Control Center Proxy & MCP Tower Routes
  registerControlPlaneRoutes(app, { recordAudit, isIpBlocked });

  // Express Vite Dev Server or Production Static Serving
  let viteServerPromise: Promise<Awaited<ReturnType<typeof createViteServer>>> | null = null;
  if (isProduction) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    // Express 5-compatible SPA fallback (avoids path-to-regexp v8 wildcard TypeError)
    app.use((req: Request, res: Response, next: NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Initialize Vite asynchronously so Express binds PORT 3000 and /api/health immediately.
    // Disable Vite's standalone WebSocket server (ws: false) to avoid port 24678 collisions on restart.
    viteServerPromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch:
          process.env.DISABLE_HMR === 'true'
            ? null
            : {
                ignored: [
                  '**/.git/**',
                  '**/dist/**',
                  '**/.aistudio/**',
                  '**/node_modules/**',
                  '**/functions/**',
                ],
              },
      },
      appType: 'spa',
    });
    viteServerPromise.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });
    app.use(async (req: Request, res: Response, next) => {
      try {
        const vite = await viteServerPromise;
        if (!vite) {
          next();
          return;
        }
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }

  // Centralized 4-arg Express error handler (prevents stack trace leakage in production)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (res.headersSent) return;
    res.status(status).json({
      error:
        status < 500
          ? String(err?.message || 'Bad request')
          : isProduction
            ? 'Internal server error.'
            : String(err?.message || 'Internal server error.'),
    });
  });

  // Create HTTP server & mount /api/live WebSocket bridge for Gemini Live API (gemini-3.8-live)
  const server = http.createServer(app);
  const liveWss = new WebSocketServer({ noServer: true });
  const broadcasterWss = new WebSocketServer({ noServer: true });
  const VALID_LIVE_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

  const MAX_CONCURRENT_LIVE_WS = 50;
  const MAX_LIVE_WS_PER_IP = 6;
  const activeLiveSocketsByIp = new Map<string, number>();
  const liveWsRateBuckets = new Map<string, number[]>();
  const broadcasterClientMeta = new WeakMap<WebSocket, { email: string; isAdmin: boolean }>();

  const extractWsToken = (request: http.IncomingMessage, reqUrl: URL): string => {
    const queryToken = String(reqUrl.searchParams.get('token') || '').trim();
    if (queryToken) return queryToken;
    const authHeader = String(request.headers.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
    const cookies = parseCookieHeader(request.headers.cookie);
    return (cookies['supremeai_admin_session'] || '').trim();
  };

  server.on('upgrade', async (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      const wsToken = extractWsToken(request, reqUrl);

      if (reqUrl.pathname === '/api/live') {
        const clientIp = String(request.socket.remoteAddress || '127.0.0.1');
        const now = Date.now();
        const hits = (liveWsRateBuckets.get(clientIp) || []).filter((t) => now - t < 60_000);
        if (hits.length >= 20) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        hits.push(now);
        liveWsRateBuckets.set(clientIp, hits);

        const activeForIp = activeLiveSocketsByIp.get(clientIp) || 0;
        if (liveWss.clients.size >= MAX_CONCURRENT_LIVE_WS || activeForIp >= MAX_LIVE_WS_PER_IP) {
          socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        if (isProduction) {
          const isGuest =
            wsToken.startsWith('tok_guest_') || wsToken.startsWith('sk-supreme-guest');
          const identity = wsToken && !isGuest ? await verifyBearerIdentity(wsToken) : null;
          if (!identity && !isGuest) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        liveWss.handleUpgrade(request, socket, head, (ws) => {
          liveWss.emit('connection', ws, request);
        });
      } else if (
        reqUrl.pathname === '/ws' ||
        reqUrl.pathname === '/ws/live' ||
        reqUrl.pathname === '/api/ws'
      ) {
        const identity = wsToken ? await verifyBearerIdentity(wsToken) : null;
        if (!identity) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        broadcasterWss.handleUpgrade(request, socket, head, (ws) => {
          broadcasterClientMeta.set(ws, { email: identity.email, isAdmin: identity.isAdmin });
          broadcasterWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  const broadcasterClients = new Set<WebSocket>();

  broadcasterWss.on('connection', (clientWs: WebSocket) => {
    broadcasterClients.add(clientWs);
    clientWs.send(
      JSON.stringify({
        type: 'connection_ack',
        status: 'connected',
        mode: 'authenticated_broadcaster',
      })
    );

    clientWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping' || msg.command === 'ping') {
          clientWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (msg.type === 'customer_updated' || msg.type === 'mcp_service_updated') {
          const senderMeta = broadcasterClientMeta.get(clientWs);
          if (!senderMeta?.isAdmin) return;
          const payload = JSON.stringify(msg);
          broadcasterClients.forEach((otherWs) => {
            const receiverMeta = broadcasterClientMeta.get(otherWs);
            if (
              otherWs !== clientWs &&
              receiverMeta?.isAdmin &&
              otherWs.readyState === WebSocket.OPEN
            ) {
              otherWs.send(payload);
            }
          });
        }
      } catch {}
    });

    clientWs.on('close', () => {
      broadcasterClients.delete(clientWs);
    });

    clientWs.on('error', () => {
      broadcasterClients.delete(clientWs);
    });
  });

  liveWss.on('connection', (clientWs: WebSocket, req: http.IncomingMessage) => {
    const clientIp = String(req.socket.remoteAddress || '127.0.0.1').trim();
    activeLiveSocketsByIp.set(clientIp, (activeLiveSocketsByIp.get(clientIp) || 0) + 1);
    const decrementIpCounter = () => {
      const nextCount = (activeLiveSocketsByIp.get(clientIp) || 1) - 1;
      if (nextCount <= 0) activeLiveSocketsByIp.delete(clientIp);
      else activeLiveSocketsByIp.set(clientIp, nextCount);
    };

    if (blockedIps.some((entry) => entry.ip === clientIp)) {
      decrementIpCounter();
      clientWs.send(
        JSON.stringify({ type: 'error', message: 'Access blocked by platform WAF firewall.' })
      );
      clientWs.close(1008, 'Blocked');
      return;
    }

    if (platformConfig.maintenanceMode) {
      decrementIpCounter();
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            platformConfig.maintenanceMessage || 'Platform is currently in maintenance mode.',
        })
      );
      clientWs.close(1013, 'Maintenance');
      return;
    }

    const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
    if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
      decrementIpCounter();
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            'API key is not configured. Please check the key in the Settings > Secrets panel.',
        })
      );
      clientWs.close(1011, 'API key missing');
      return;
    }

    let sessionPromise: Promise<Awaited<ReturnType<GoogleGenAI['live']['connect']>>> | null = null;
    let isClientClosed = false;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (!isClientClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const startLiveSession = (
      voiceRaw?: string,
      systemInstructionRaw?: string,
      languageRaw?: string,
      pitchRaw?: unknown,
      accentRaw?: unknown
    ) => {
      if (sessionPromise) return;

      const voiceName = voiceRaw && VALID_LIVE_VOICES.has(voiceRaw) ? voiceRaw : 'Zephyr';
      const preferredLang = languageRaw === 'bn' ? 'bn' : 'en';
      const pitch = clampVoicePitch(
        typeof pitchRaw === 'number' ? pitchRaw : Number.parseFloat(String(pitchRaw ?? '1'))
      );
      const accent = normalizeBanglaAccent(accentRaw);
      const accentStyleDirective =
        accent === 'bn-in'
          ? 'When speaking Bengali (বাংলা), use natural standard Kolkata West Bengal Bengali pronunciation and cadence.'
          : 'When speaking Bengali (বাংলা), use an authentic, natural Bangladeshi Standard Bengali (প্রমিত ঢাকা / বাংলাদেশি বাংলা) accent—crisp ড়/ঢ় retroflex sounds, natural nasal vowels, warm Bangladeshi sentence melody, and seamless pronunciation of inline English tech terms.';
      const pitchDirective =
        pitch <= 0.85
          ? 'Keep your vocal tone noticeably deeper and warmer.'
          : pitch >= 1.15
            ? 'Keep your vocal tone bright and crisp.'
            : '';
      const langDirective =
        preferredLang === 'bn'
          ? `Default spoken language: Bengali (বাংলা). Speak warmly and clearly in natural Bengali unless the user speaks or asks in another language. ${accentStyleDirective} ${pitchDirective} When reading or mixing Bengali (বাংলা) and English terms, pronounce EVERY Bengali word and EVERY English word audibly—never skip, silence, or drop the Bengali portion.`
          : `You are fluent in both English and Bengali (বাংলা). Default to English unless the user speaks or writes in Bengali or Romanized Bengali (Banglish), in which case respond in warm, natural Bengali (বাংলা). ${accentStyleDirective} ${pitchDirective} When speaking or reading mixed English and Bengali (বাংলা), pronounce BOTH English and Bengali portions clearly and audibly—never skip or drop Bengali words.`;
      const baseInstruction = `You are SupremeAI Live, a real-time conversational voice engineering partner in SupremeAI Studio. Respond naturally, concisely, and clearly in spoken dialogue without markdown formatting symbols.\n\n${langDirective}`;
      const effectiveSystemInstruction = systemInstructionRaw?.trim()
        ? `${baseInstruction}\n\nActive Persona Context:\n${systemInstructionRaw.trim()}`
        : baseInstruction;

      const liveAi = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      sessionPromise = liveAi.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: effectiveSystemInstruction,
        },
        callbacks: {
          onopen: () => {
            sendToClient({
              type: 'connected',
              model: 'gemini-3.8-live',
              voice: voiceName,
            });
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.setupComplete) {
              sendToClient({ type: 'setup_complete', model: 'gemini-3.8-live', voice: voiceName });
            }

            const serverContent = message.serverContent;
            if (!serverContent) return;

            if (serverContent.inputTranscription?.text) {
              sendToClient({
                type: 'input_transcript',
                text: serverContent.inputTranscription.text,
              });
            }

            if (serverContent.outputTranscription?.text) {
              sendToClient({
                type: 'output_transcript',
                text: serverContent.outputTranscription.text,
              });
            }

            for (const part of serverContent.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendToClient({
                  type: 'audio',
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                });
              }
            }

            if (serverContent.interrupted) {
              sendToClient({ type: 'interrupted' });
            }

            if (serverContent.turnComplete) {
              sendToClient({ type: 'turn_complete' });
            }
          },
          onerror: (event: any) => {
            const msg = event?.message || event?.error?.message || 'Live API WebSocket error.';
            sendToClient({ type: 'error', message: msg });
          },
          onclose: (event: any) => {
            if (!isClientClosed) {
              sendToClient({
                type: 'closed',
                reason: event?.reason || 'Live API session ended.',
              });
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            }
          },
        },
      });

      sessionPromise.catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to connect to Gemini Live API.';
        sendToClient({ type: 'error', message: msg });
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, 'Live API connection failed');
        }
      });
    };

    clientWs.on('message', (raw) => {
      let parsed: any;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (parsed?.type === 'init') {
        startLiveSession(
          parsed.voiceName,
          parsed.systemInstruction,
          parsed.language,
          parsed.pitch,
          parsed.accent
        );
        return;
      }

      if (!sessionPromise) {
        startLiveSession(
          parsed?.voiceName,
          parsed?.systemInstruction,
          parsed?.language,
          parsed?.pitch,
          parsed?.accent
        );
      }

      if (parsed?.type === 'audio' && typeof parsed.data === 'string' && parsed.data.length > 0) {
        sessionPromise
          ?.then((session) => {
            if (!isClientClosed) {
              session.sendRealtimeInput({
                audio: { data: parsed.data, mimeType: 'audio/pcm;rate=16000' },
              });
            }
          })
          .catch(() => {});
      } else if (parsed?.type === 'audio_end') {
        sessionPromise
          ?.then((session) => {
            if (!isClientClosed) {
              session.sendRealtimeInput({ audioStreamEnd: true });
            }
          })
          .catch(() => {});
      } else if (parsed?.type === 'text' && typeof parsed.text === 'string' && parsed.text.trim()) {
        sessionPromise
          ?.then((session) => {
            if (!isClientClosed) {
              session.sendRealtimeInput({ text: parsed.text.trim() });
            }
          })
          .catch(() => {});
      }
    });

    clientWs.on('close', () => {
      if (!isClientClosed) {
        isClientClosed = true;
        decrementIpCounter();
      }
      sessionPromise
        ?.then((session) => {
          try {
            session.close();
          } catch {
            // Ignore close errors
          }
        })
        .catch(() => {});
    });
  });

  server.on('error', (err) => {
    console.error('SupremeAI Studio Server listen error:', err);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SupremeAI Studio Server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async () => {
    try {
      server.close();
      if (viteServerPromise) {
        const vite = await viteServerPromise.catch(() => null);
        await vite?.close();
      }
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
});

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
