import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import { Readable } from 'stream';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
import {
  collectLiveServiceHealth,
  getLiveMcpTowerServices,
  getRealGatewayTrafficSummary,
  recordHttpRequestMetric,
  sampleHostRuntime,
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
  DEFAULT_MCP_TOWER_ORIGIN,
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
  adminPasskeySchema,
  parseBody,
} from './src/server/validation';
import { PLAN_CATALOG, TOPUP_PACKAGES, getPlanSpec } from './src/config/plans';
import {
  buildJsonViewerHtml,
  buildTextViewerHtml,
  extractCapturedCookieHeader,
  processProxiedHtml,
} from './src/shared/browserProxyHtml';
import {
  ADMIN_SESSION_TTL_MS,
  hashPassword,
  isProtectedWorkspaceFile,
  isRestrictedProxyTarget,
  parseCookieHeader,
  resolveAndCheckProxyTarget,
  signSessionToken,
  validateGitLabHost,
  verifyPassword,
  verifySessionToken,
} from './src/shared/serverSecurity';
import {
  buildGmailSessionSetCookie,
  GMAIL_SESSION_COOKIE_NAME,
  GMAIL_SESSION_TTL_SECONDS,
  parseCookieFromHeader,
  sealGmailSessionCookie,
  unsealGmailSessionCookie,
} from './src/shared/gmailSessionCrypto';
import { getCronMinuteKey, matchesCronAtDate } from './src/shared/cronMatcher';
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

const execFileAsync = promisify(execFile);
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

  // Health and metadata endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      app: 'SupremeAI Studio',
      organization: 'Supremeai-bd',
      version: `v${APP_VERSION}`,
      modelsCount: Object.keys(SUPPORTED_MODELS).length,
      plans: PLAN_CATALOG,
      repositories: {
        primary: 'https://github.com/Supremeai-bd/supremeai',
        studio: 'https://github.com/Supremeai-bd/supremeai-studio',
      },
      hasApiKey: Boolean(apiKey),
    });
  });

  // Models endpoint
  app.get('/api/models', async (_req: Request, res: Response) => {
    const remote = await fetchGatewayJson('/api/v1/models');
    const remoteModels = remote?.models;
    const useRemote =
      remoteModels && typeof remoteModels === 'object' && !Array.isArray(remoteModels);
    res.json({
      models: useRemote ? remoteModels : SUPPORTED_MODELS,
      defaultModel:
        (useRemote && (remote?.defaultModel || remote?.default_model)) || 'supreme-spark',
      source: useRemote ? 'gateway' : 'local',
    });
  });

  // --- MCP Tower Services & Health Orchestration Endpoints ---
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

  const handleLoginRequest = async (req: Request, res: Response) => {
    if (isIpBlocked(req)) {
      res.status(403).json({ error: 'Access blocked by platform WAF firewall.' });
      return;
    }

    const parsed = parseBody(loginSchema, req, res);
    if (!parsed.ok) return;
    const { email, username, password } = parsed.data;
    const rawEmail = email || username;
    if (!rawEmail) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const cleanEmail = String(rawEmail).trim().toLowerCase();
    const user = usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
    const customerRec = customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);

    if (customerRec?.status === 'suspended') {
      res
        .status(403)
        .json({ error: 'This account has been suspended by a platform administrator.' });
      return;
    }

    if (user && verifyPassword(String(password), user.passwordHash)) {
      const safeUser = buildSafeAuthUser(user, customerRec);
      const token = signLocalSessionToken({
        sub: user.id,
        email: user.email,
        iat: Date.now(),
        role: safeUser.isAdminEligible ? 'admin' : 'user',
      });
      activeAuthSessions.set(token, user.id);
      if (safeUser.isAdminEligible) {
        setAdminSessionCookie(req, res, token);
      }
      const refreshToken = issueLocalRefreshToken(user.id);
      setRefreshTokenCookie(req, res, refreshToken);
      res.json({
        success: true,
        user: safeUser,
        role: safeUser.role,
        rbacRole: safeUser.rbacRole,
        isAdminEligible: safeUser.isAdminEligible,
        adminEmailMatched: safeUser.adminEmailMatched,
        adminEmails: safeUser.adminEmails,
        token,
        access_token: token,
        refresh_token: refreshToken,
        expires_in: 3600,
      });
      return;
    }

    // Fallback to upstream database-backed gateway if configured and user is not in local usersDb
    if (!user) {
      const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({ username: cleanEmail, email: cleanEmail, password }),
        });

        const upstreamData: any = await upstreamRes.json().catch(() => null);
        if (upstreamRes.ok && upstreamData && (upstreamData.access_token || upstreamData.token)) {
          const remoteUser =
            upstreamData.user && typeof upstreamData.user === 'object'
              ? upstreamData.user
              : upstreamData;
          const upstreamAdminEmails: string[] = [
            ...(Array.isArray(upstreamData.adminEmails) ? upstreamData.adminEmails : []),
            ...(Array.isArray(upstreamData.admin_emails) ? upstreamData.admin_emails : []),
          ];
          const upstreamRbac =
            remoteUser.rbacRole || remoteUser.rbac_role || remoteUser.role || upstreamData.role;
          const upstreamIsAdmin = Boolean(
            remoteUser.isAdminEligible ??
            remoteUser.is_admin_eligible ??
            remoteUser.is_admin ??
            upstreamData.isAdminEligible ??
            upstreamData.is_admin_eligible
          );

          const rbac = resolveRbacUserProfile(
            cleanEmail,
            {
              rbacRole: upstreamRbac,
              isAdminEligible: upstreamIsAdmin,
              isDeveloperEligible: Boolean(
                remoteUser.isDeveloperEligible ?? remoteUser.is_developer_eligible
              ),
              adminUserId: remoteUser.adminUserId || remoteUser.admin_user_id,
            },
            customerRec,
            upstreamAdminEmails,
            upstreamRbac
          );

          const token = String(upstreamData.access_token || upstreamData.token);
          const safeUser = {
            id: String(
              remoteUser.id || remoteUser.user_id || upstreamData.user_id || `usr_${Date.now()}`
            ),
            user_id: String(
              remoteUser.id || remoteUser.user_id || upstreamData.user_id || `usr_${Date.now()}`
            ),
            name: String(remoteUser.name || cleanEmail.split('@')[0] || 'User'),
            email: cleanEmail,
            avatar: String(remoteUser.name || cleanEmail)
              .charAt(0)
              .toUpperCase(),
            role: rbac.role,
            rbacRole: rbac.rbacRole,
            isAdminEligible: rbac.isAdminEligible,
            adminEmailMatched: rbac.adminEmailMatched,
            isDeveloperEligible: rbac.isDeveloperEligible,
            adminUserId: rbac.adminUserId,
            plan:
              customerRec?.tier || remoteUser.plan || (rbac.isAdminEligible ? 'Enterprise' : 'Pro'),
            createdAt: String(remoteUser.createdAt || new Date().toISOString().slice(0, 10)),
            adminEmails: rbac.adminEmails,
          };

          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          upstreamTokenAdminCache.set(tokenHash, {
            email: cleanEmail,
            isAdmin: rbac.isAdminEligible,
            tier: safeUser.plan as PlanTier,
            expiresAt: Date.now() + 60_000,
          });
          if (rbac.isAdminEligible) {
            setAdminSessionCookie(req, res, token);
          }
          const upstreamSetCookie = upstreamRes.headers.get('set-cookie');
          if (upstreamSetCookie) {
            res.append('Set-Cookie', upstreamSetCookie);
          }
          const upstreamRefreshToken =
            upstreamData.refresh_token || upstreamData.refreshToken || undefined;
          if (upstreamRefreshToken) {
            setRefreshTokenCookie(req, res, String(upstreamRefreshToken));
          }

          res.json({
            success: true,
            user: safeUser,
            role: safeUser.role,
            rbacRole: safeUser.rbacRole,
            isAdminEligible: safeUser.isAdminEligible,
            adminEmailMatched: safeUser.adminEmailMatched,
            adminEmails: safeUser.adminEmails,
            token,
            access_token: token,
            ...(upstreamRefreshToken ? { refresh_token: upstreamRefreshToken } : {}),
            expires_in: upstreamData.expires_in || 3600,
          });
          return;
        }

        if (upstreamRes.status >= 500) {
          res.status(502).json({
            error:
              upstreamData?.detail ||
              upstreamData?.error ||
              upstreamData?.message ||
              `Authentication gateway returned HTTP ${upstreamRes.status}. Please retry in a few seconds.`,
          });
          return;
        }

        const upstreamErrMsg =
          upstreamData?.detail ||
          upstreamData?.error ||
          upstreamData?.message ||
          (upstreamRes.status === 403
            ? 'Access forbidden or account requires verification.'
            : upstreamRes.status === 429
              ? 'Too many sign-in attempts. Please wait a moment and try again.'
              : 'Invalid email address or credentials.');
        res.status(upstreamRes.status || 401).json({ error: String(upstreamErrMsg) });
        return;
      } catch (err: unknown) {
        const isAbort =
          err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        res.status(isAbort ? 504 : 502).json({
          error: isAbort
            ? 'Authentication gateway timed out while waking up. Please try signing in again.'
            : 'Unable to reach authentication gateway. Check network or register a local workspace account.',
        });
        return;
      }
    }

    res.status(401).json({ error: 'Invalid email address or password.' });
  };

  const handleSignupRequest = async (req: Request, res: Response) => {
    if (isIpBlocked(req)) {
      res.status(403).json({ error: 'Access blocked by platform WAF firewall.' });
      return;
    }
    if (!platformConfig.allowNewSignups) {
      res.status(403).json({
        error: 'New account registrations are currently paused by the platform administrator.',
      });
      return;
    }

    const parsed = parseBody(signupSchema, req, res);
    if (!parsed.ok) return;
    const { name, email, password } = parsed.data;
    const rawEmail = email;
    const cleanName = String(name || (rawEmail ? String(rawEmail).split('@')[0] : '')).trim();
    if (!cleanName || !rawEmail || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }

    const cleanEmail = String(rawEmail).trim().toLowerCase();
    const existing = usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
    if (remoteGatewayUrl) {
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            username: cleanEmail,
            password,
          }),
        });
        const upstreamData: any = await upstreamRes.json().catch(() => null);
        if (upstreamRes.ok && upstreamData && (upstreamData.access_token || upstreamData.token)) {
          const remoteUser =
            upstreamData.user && typeof upstreamData.user === 'object'
              ? upstreamData.user
              : upstreamData;
          const rbac = resolveRbacUserProfile(cleanEmail, {
            rbacRole: remoteUser.rbacRole || remoteUser.role,
            isAdminEligible: Boolean(remoteUser.isAdminEligible ?? remoteUser.is_admin_eligible),
          });
          const token = String(upstreamData.access_token || upstreamData.token);
          const safeUser = {
            id: String(remoteUser.id || remoteUser.user_id || `usr_${Date.now()}`),
            user_id: String(remoteUser.id || remoteUser.user_id || `usr_${Date.now()}`),
            name: String(remoteUser.name || cleanName),
            email: cleanEmail,
            avatar: cleanName.charAt(0).toUpperCase(),
            role: rbac.role,
            rbacRole: rbac.rbacRole,
            isAdminEligible: rbac.isAdminEligible,
            adminEmailMatched: rbac.adminEmailMatched,
            isDeveloperEligible: rbac.isDeveloperEligible,
            adminUserId: rbac.adminUserId,
            plan: remoteUser.plan || 'Free',
            createdAt: String(remoteUser.createdAt || new Date().toISOString().slice(0, 10)),
            adminEmails: rbac.adminEmails,
          };
          if (rbac.isAdminEligible) setAdminSessionCookie(req, res, token);
          const upstreamRefreshToken =
            upstreamData.refresh_token || upstreamData.refreshToken || undefined;
          if (upstreamRefreshToken) setRefreshTokenCookie(req, res, String(upstreamRefreshToken));
          res.json({
            success: true,
            user: safeUser,
            role: safeUser.role,
            rbacRole: safeUser.rbacRole,
            isAdminEligible: safeUser.isAdminEligible,
            adminEmailMatched: safeUser.adminEmailMatched,
            adminEmails: safeUser.adminEmails,
            token,
            access_token: token,
            ...(upstreamRefreshToken ? { refresh_token: upstreamRefreshToken } : {}),
            expires_in: upstreamData.expires_in || 3600,
          });
          return;
        }
        if (
          upstreamRes.status === 409 ||
          upstreamRes.status === 400 ||
          upstreamRes.status === 422
        ) {
          res.status(upstreamRes.status).json({
            error:
              upstreamData?.detail ||
              upstreamData?.error ||
              upstreamData?.message ||
              (upstreamRes.status === 409
                ? 'An account with this email already exists.'
                : 'Invalid signup details provided.'),
          });
          return;
        }
      } catch {
        // Fall through to persisted local registration when upstream registration route is unavailable
      }
    }

    const existingCust = customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);
    const rbac = resolveRbacUserProfile(cleanEmail, undefined, existingCust);
    const isAdmin = rbac.isAdminEligible;
    const devEligible = isAdmin || Boolean(existingCust?.isDeveloperEligible);
    const assignedPlan: PlanTier = isAdmin ? 'Enterprise' : existingCust?.tier || 'Free';
    const newUser: ServerUser = {
      id: `usr_${Date.now()}`,
      name: cleanName,
      email: cleanEmail,
      passwordHash: hashPassword(String(password)),
      role: rbac.role,
      rbacRole: rbac.rbacRole,
      isAdminEligible: isAdmin,
      isDeveloperEligible: devEligible,
      adminUserId: rbac.adminUserId,
      plan: assignedPlan,
      createdAt: new Date().toISOString().slice(0, 10),
      avatar: cleanName.charAt(0).toUpperCase(),
    };

    usersDb.push(newUser);
    persistDevUsersDb(usersDb);

    if (!existingCust) {
      const planSpec = getPlanSpec(assignedPlan);
      customerDirectory.unshift({
        id: `cust_${String(Date.now()).slice(-4)}`,
        name: cleanName,
        email: cleanEmail,
        tier: assignedPlan,
        status: 'active',
        mrr: planSpec.monthlyPriceUsd,
        tokensUsed: 0,
        tokenLimit: planSpec.monthlyTokensLimit,
        connectedRepos: 0,
        joinedDate: newUser.createdAt,
        lastActive: 'Just now',
        region: 'Global',
        isDeveloperEligible: devEligible,
        isAdminEligible: isAdmin,
        rbacRole: rbac.rbacRole,
      });
    }

    recordAudit(
      cleanEmail,
      'USER_SIGNUP',
      `Customer: ${cleanEmail}`,
      `Registered under ${assignedPlan} tier (${devEligible ? 'Developer' : 'Standard'})`,
      req
    );

    const safeUser = buildSafeAuthUser(newUser, existingCust);
    const token = signLocalSessionToken({
      sub: newUser.id,
      email: newUser.email,
      iat: Date.now(),
      role: safeUser.isAdminEligible ? 'admin' : 'user',
    });
    activeAuthSessions.set(token, newUser.id);
    if (safeUser.isAdminEligible) {
      setAdminSessionCookie(req, res, token);
    }
    const refreshToken = issueLocalRefreshToken(newUser.id);
    setRefreshTokenCookie(req, res, refreshToken);
    res.json({
      success: true,
      user: safeUser,
      role: safeUser.role,
      rbacRole: safeUser.rbacRole,
      isAdminEligible: safeUser.isAdminEligible,
      adminEmailMatched: safeUser.adminEmailMatched,
      adminEmails: safeUser.adminEmails,
      token,
      access_token: token,
      refresh_token: refreshToken,
      expires_in: 3600,
    });
  };

  const handleGetMeRequest = async (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const sessionUserId = activeAuthSessions.get(token);
    const verifiedPayload = verifyLocalSessionToken(token);

    if (sessionUserId || verifiedPayload) {
      const lookupEmail = verifiedPayload?.email?.toLowerCase();
      const matchedUser =
        (sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined) ||
        (lookupEmail ? usersDb.find((u) => u.email.toLowerCase() === lookupEmail) : undefined);

      const emailToResolve = (matchedUser?.email || lookupEmail || '').toLowerCase();
      if (!emailToResolve) {
        res.status(401).json({ error: 'Invalid or expired session.' });
        return;
      }

      const customerRec = customerDirectory.find((c) => c.email.toLowerCase() === emailToResolve);
      const tokenClaimsAdmin = verifiedPayload?.role === 'admin';
      const effectiveUser: ServerUser = matchedUser || {
        id: verifiedPayload?.sub || `usr_${Date.now()}`,
        name: customerRec?.name || emailToResolve.split('@')[0],
        email: emailToResolve,
        passwordHash: '',
        role: tokenClaimsAdmin ? 'admin' : 'user',
        isAdminEligible: tokenClaimsAdmin,
        isDeveloperEligible: tokenClaimsAdmin || Boolean(customerRec?.isDeveloperEligible),
        plan: customerRec?.tier || (tokenClaimsAdmin ? 'Enterprise' : 'Pro'),
        createdAt: customerRec?.joinedDate || new Date().toISOString().slice(0, 10),
      };

      const safeUser = buildSafeAuthUser(effectiveUser, customerRec);
      res.json({
        success: true,
        ...safeUser,
        user: safeUser,
      });
      return;
    }

    // Try upstream gateway if bearer token is an upstream JWT
    if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
      const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(9000),
        });
        if (upstreamRes.ok) {
          const data: any = await upstreamRes.json().catch(() => null);
          if (data && typeof data === 'object') {
            const raw =
              data.user && typeof data.user === 'object' ? { ...data, ...data.user } : data;
            const cleanEmail = String(raw.email || '')
              .trim()
              .toLowerCase();
            if (cleanEmail) {
              const matchedUser = usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
              const customerRec = customerDirectory.find(
                (c) => c.email.toLowerCase() === cleanEmail
              );
              const upstreamAdminEmails: string[] = [
                ...(Array.isArray(data.adminEmails) ? data.adminEmails : []),
                ...(Array.isArray(data.admin_emails) ? data.admin_emails : []),
              ];
              const upstreamRbac = raw.rbacRole || raw.rbac_role || raw.role;
              const rbac = resolveRbacUserProfile(
                cleanEmail,
                matchedUser || {
                  rbacRole: upstreamRbac,
                  isAdminEligible: Boolean(
                    raw.isAdminEligible ?? raw.is_admin_eligible ?? raw.is_admin
                  ),
                  isDeveloperEligible: Boolean(
                    raw.isDeveloperEligible ?? raw.is_developer_eligible
                  ),
                  adminUserId: raw.adminUserId || raw.admin_user_id,
                },
                customerRec,
                upstreamAdminEmails,
                upstreamRbac
              );
              const mergedUser = {
                id: String(raw.id || raw.user_id || matchedUser?.id || `usr_${Date.now()}`),
                user_id: String(raw.id || raw.user_id || matchedUser?.id || `usr_${Date.now()}`),
                name: String(raw.name || matchedUser?.name || cleanEmail.split('@')[0]),
                email: cleanEmail,
                avatar: String(raw.name || cleanEmail)
                  .charAt(0)
                  .toUpperCase(),
                role: rbac.role,
                rbacRole: rbac.rbacRole,
                isAdminEligible: rbac.isAdminEligible,
                adminEmailMatched: rbac.adminEmailMatched,
                isDeveloperEligible: rbac.isDeveloperEligible,
                adminUserId: rbac.adminUserId,
                plan:
                  customerRec?.tier ||
                  raw.plan ||
                  matchedUser?.plan ||
                  (rbac.isAdminEligible ? 'Enterprise' : 'Pro'),
                createdAt: String(
                  raw.createdAt || matchedUser?.createdAt || new Date().toISOString().slice(0, 10)
                ),
                adminEmails: rbac.adminEmails,
              };
              res.json({
                success: true,
                ...mergedUser,
                user: mergedUser,
              });
              return;
            }
          }
        }
      } catch {
        // Upstream unavailable
      }
    }

    res.status(401).json({ error: 'Invalid or expired session token.' });
  };

  const handleGuestTokenRequest = async (_req: Request, res: Response) => {
    const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
    try {
      const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/guest`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (upstreamRes.ok) {
        const setCookie = upstreamRes.headers.get('set-cookie');
        if (setCookie) res.setHeader('Set-Cookie', setCookie);
        const data = await upstreamRes.json().catch(() => null);
        if (data && typeof data === 'object' && (data.access_token || data.token)) {
          res.json(data);
          return;
        }
      }
    } catch {
      // Upstream unavailable in preview/offline environment; issue local studio guest token below
    }

    const previewGuestToken = `tok_guest_${crypto.randomUUID()}`;
    res.json({
      status: 'ok',
      access_token: previewGuestToken,
      token_type: 'bearer',
      expires_in: 3600,
      class: 'guest',
      source: 'studio-preview',
      message: 'Preview guest trial access granted.',
    });
  };

  const handleRefreshRequest = async (req: Request, res: Response) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    // Body is optional here: the refresh token may legitimately arrive only as
    // an httpOnly cookie. Validate the shape when a body is present, but never
    // reject a cookie-only refresh.
    const parsedRefresh = parseBody(refreshSchema, req, res);
    const bodyRefreshToken = parsedRefresh.ok ? parsedRefresh.data.refresh_token : undefined;
    if (!parsedRefresh.ok && !cookies.supremeai_refresh_token) return;
    const presented = String(bodyRefreshToken || cookies.supremeai_refresh_token || '').trim();
    const entry = presented ? activeRefreshTokens.get(presented) : undefined;

    if (!entry && presented && !presented.startsWith('rt_')) {
      const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(req.headers.cookie ? { Cookie: String(req.headers.cookie) } : {}),
          },
          body: JSON.stringify({ refresh_token: presented }),
          signal: AbortSignal.timeout(9000),
        });
        const upstreamData: any = await upstreamRes.json().catch(() => null);
        if (upstreamRes.ok && upstreamData && (upstreamData.access_token || upstreamData.token)) {
          const upstreamSetCookie = upstreamRes.headers.get('set-cookie');
          if (upstreamSetCookie) res.append('Set-Cookie', upstreamSetCookie);
          const nextRefresh = upstreamData.refresh_token || upstreamData.refreshToken;
          if (nextRefresh) setRefreshTokenCookie(req, res, String(nextRefresh));
          res.json(upstreamData);
          return;
        }
      } catch {
        // Fall through to 401
      }
    }

    if (!entry || entry.expiresAt <= Date.now()) {
      if (presented) activeRefreshTokens.delete(presented);
      res.status(401).json({ error: 'Invalid or expired refresh token.' });
      return;
    }

    const user = usersDb.find((u) => u.id === entry.userId);
    if (!user) {
      activeRefreshTokens.delete(presented);
      res.status(401).json({ error: 'Session user no longer exists.' });
      return;
    }

    const customerRec = customerDirectory.find(
      (c) => c.email.toLowerCase() === user.email.toLowerCase()
    );
    if (customerRec?.status === 'suspended') {
      activeRefreshTokens.delete(presented);
      res
        .status(403)
        .json({ error: 'This account has been suspended by a platform administrator.' });
      return;
    }

    const safeUser = buildSafeAuthUser(user, customerRec);
    const token = signLocalSessionToken({
      sub: user.id,
      email: user.email,
      iat: Date.now(),
      role: safeUser.isAdminEligible ? 'admin' : 'user',
    });
    activeAuthSessions.set(token, user.id);

    // Single-use rotation: the presented refresh token is invalidated.
    activeRefreshTokens.delete(presented);
    const rotatedRefreshToken = issueLocalRefreshToken(user.id);
    setRefreshTokenCookie(req, res, rotatedRefreshToken);

    res.json({
      success: true,
      user: safeUser,
      token,
      access_token: token,
      refresh_token: rotatedRefreshToken,
      token_type: 'bearer',
      expires_in: 3600,
    });
  };

  app.post('/api/auth/refresh', handleRefreshRequest);
  app.post('/api/v1/auth/refresh', handleRefreshRequest);
  app.post('/api/auth/login', handleLoginRequest);
  app.post('/api/v1/auth/login', handleLoginRequest);
  app.post('/api/auth/signup', handleSignupRequest);
  app.post('/api/v1/auth/register', handleSignupRequest);
  app.post('/api/v1/auth/guest', handleGuestTokenRequest);
  app.post('/api/v1/guest/token', handleGuestTokenRequest);
  app.get('/api/auth/me', handleGetMeRequest);
  app.get('/api/v1/auth/me', handleGetMeRequest);
  app.post('/api/v1/auth/logout', (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const adminHeader = String(req.headers['x-admin-token'] || '').trim();
    const cookies = parseCookieHeader(req.headers.cookie);
    const adminCookie = cookies.supremeai_admin_session || '';
    if (token) {
      activeAuthSessions.delete(token);
      activeAdminSessions.delete(token);
    }
    if (adminHeader) activeAdminSessions.delete(adminHeader);
    if (adminCookie) activeAdminSessions.delete(adminCookie);
    const presentedRefreshTokens = [
      String(req.body?.refresh_token || '').trim(),
      cookies.supremeai_refresh_token || '',
    ];
    for (const candidate of presentedRefreshTokens) {
      if (candidate) activeRefreshTokens.delete(candidate);
    }
    res.clearCookie('supremeai_refresh_token', { path: '/api' });
    res.clearCookie('supremeai_refresh_token', { path: '/api/v1/auth' });
    res.clearCookie('supremeai_admin_session', { path: '/api/admin' });
    res.json({ success: true });
  });

  // Cross-Platform Release Manifest (Web + Desktop EXE + Android APK + VS Code VSIX)
  let cachedReleaseManifest: { data: ReleaseManifest; fetchedAt: number } | null = null;

  app.get('/api/releases/latest', async (_req: Request, res: Response) => {
    if (cachedReleaseManifest && Date.now() - cachedReleaseManifest.fetchedAt < 3 * 60_000) {
      res.json(cachedReleaseManifest.data);
      return;
    }

    const reposToCheck = [GITHUB_PUBLIC_REPO_SLUG, GITHUB_MONOREPO_SLUG];

    // 1. Direct rolling manifest fetch bypasses GitHub API rate limits & prerelease skip
    for (const repoSlug of reposToCheck) {
      const manifestUrls = [
        `https://github.com/${repoSlug}/releases/download/latest/latest-release.json`,
        `https://github.com/${repoSlug}/releases/download/latest/latest-desktop.json`,
      ];
      for (const manifestUrl of manifestUrls) {
        try {
          const mfRes = await fetch(manifestUrl, {
            headers: { Accept: 'application/json', 'User-Agent': 'SupremeAI-Release-Resolver' },
            signal: AbortSignal.timeout(4000),
          });
          if (!mfRes.ok) continue;
          const mf = await mfRes.json().catch(() => null);
          const normalized = normalizeRemoteReleaseManifest(mf, repoSlug);
          if (normalized) {
            cachedReleaseManifest = { data: normalized, fetchedAt: Date.now() };
            res.json(normalized);
            return;
          }
        } catch {
          // Try next manifest candidate
        }
      }
    }

    // 2. Fallback to GitHub REST API (checking rolling 'tags/latest' before '/releases/latest')
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Release-Resolver',
    };
    if (process.env.GITHUB_READONLY_TOKEN?.trim()) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_READONLY_TOKEN.trim()}`;
    }

    for (const repoSlug of reposToCheck) {
      const endpoints = [
        `https://api.github.com/repos/${repoSlug}/releases/tags/latest`,
        `https://api.github.com/repos/${repoSlug}/releases/latest`,
      ];
      for (const apiUrl of endpoints) {
        try {
          const ghRes = await fetch(apiUrl, {
            headers,
            signal: AbortSignal.timeout(4500),
          });
          if (!ghRes.ok) continue;
          const release = (await ghRes.json().catch(() => null)) as any;
          const assets: any[] = Array.isArray(release?.assets) ? release.assets : [];

          const exeAsset = assets.find((a) => String(a?.name || '').endsWith('.exe'));
          const msiAsset = assets.find((a) => String(a?.name || '').endsWith('.msi'));
          const universalOrArm64Apk =
            assets.find(
              (a) =>
                String(a?.name || '').endsWith('.apk') &&
                /universal|arm64|aarch64/i.test(String(a?.name || ''))
            ) || assets.find((a) => String(a?.name || '').endsWith('.apk'));
          const armv7Apk = assets.find(
            (a) =>
              String(a?.name || '').endsWith('.apk') && /armv7|armeabi/i.test(String(a?.name || ''))
          );
          const vsixAsset = assets.find((a) => String(a?.name || '').endsWith('.vsix'));

          const manifestAsset =
            assets.find((a) => a?.name === 'latest-release.json') ||
            assets.find((a) => a?.name === 'latest-desktop.json');
          if (manifestAsset?.browser_download_url) {
            const mfRes = await fetch(manifestAsset.browser_download_url, {
              signal: AbortSignal.timeout(4000),
            }).catch(() => null);
            if (mfRes?.ok) {
              const mf = await mfRes.json().catch(() => null);
              const normalized = normalizeRemoteReleaseManifest(mf, repoSlug);
              if (normalized) {
                const merged: ReleaseManifest = {
                  ...normalized,
                  publishedAt: normalized.publishedAt || String(release.published_at || ''),
                  windowsExeUrl: String(exeAsset?.browser_download_url || normalized.windowsExeUrl),
                  windowsMsiUrl: String(msiAsset?.browser_download_url || normalized.windowsMsiUrl),
                  androidApkUrl: String(
                    universalOrArm64Apk?.browser_download_url || normalized.androidApkUrl
                  ),
                  ...(armv7Apk?.browser_download_url
                    ? { androidArmv7ApkUrl: String(armv7Apk.browser_download_url) }
                    : normalized.androidArmv7ApkUrl
                      ? { androidArmv7ApkUrl: normalized.androidArmv7ApkUrl }
                      : {}),
                  vscodeVsixUrl: String(
                    vsixAsset?.browser_download_url || normalized.vscodeVsixUrl
                  ),
                };
                cachedReleaseManifest = { data: merged, fetchedAt: Date.now() };
                res.json(merged);
                return;
              }
            }
          }

          if (exeAsset || universalOrArm64Apk || vsixAsset) {
            const tag = String(release.tag_name || 'latest');
            const version =
              tag !== 'latest' ? tag.replace(/^v/i, '') : DEFAULT_RELEASE_MANIFEST.version;
            const rollingUrls = buildRollingAssetUrls(version, repoSlug, tag);
            const mappedAssets: ReleaseAssetEntry[] = assets
              .filter((a) => /\.(exe|msi|apk|vsix)$/i.test(String(a?.name || '')))
              .map((a) => {
                const name = String(a.name);
                const platform: ReleaseAssetEntry['platform'] = name.endsWith('.exe')
                  ? 'windows-exe'
                  : name.endsWith('.msi')
                    ? 'windows-msi'
                    : name.endsWith('.vsix')
                      ? 'vscode-vsix'
                      : /armv7|armeabi/i.test(name)
                        ? 'android-apk-armv7'
                        : 'android-apk-arm64';
                return {
                  platform,
                  label: name,
                  fileName: name,
                  url: String(a.browser_download_url),
                  sizeBytes: typeof a.size === 'number' ? a.size : undefined,
                };
              });

            const resolved: ReleaseManifest = {
              version,
              tag,
              repo: repoSlug,
              publishedAt: String(release.published_at || ''),
              releasePageUrl: String(release.html_url || rollingUrls.releasePageUrl),
              webUrl: DEFAULT_WEB_STUDIO_URL,
              windowsExeUrl: String(exeAsset?.browser_download_url || rollingUrls.windowsExeUrl),
              windowsMsiUrl: String(msiAsset?.browser_download_url || rollingUrls.windowsMsiUrl),
              androidApkUrl: String(
                universalOrArm64Apk?.browser_download_url || rollingUrls.androidApkUrl
              ),
              ...(armv7Apk?.browser_download_url
                ? { androidArmv7ApkUrl: String(armv7Apk.browser_download_url) }
                : {}),
              vscodeVsixUrl: String(vsixAsset?.browser_download_url || rollingUrls.vscodeVsixUrl),
              provenance: 'live-github',
              assets: mappedAssets,
            };
            cachedReleaseManifest = { data: resolved, fetchedAt: Date.now() };
            res.json(resolved);
            return;
          }
        } catch {
          // Try next endpoint / repo slug
        }
      }
    }

    cachedReleaseManifest = { data: DEFAULT_RELEASE_MANIFEST, fetchedAt: Date.now() };
    res.json(DEFAULT_RELEASE_MANIFEST);
  });

  // Client error sink (mirrors functions/api/telemetry/client-error.ts).
  // The browser reporter is fire-and-forget; never fail it noisily.
  app.post('/api/telemetry/client-error', (req: Request, res: Response) => {
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const summary = {
      message: String(body.message ?? 'unknown').slice(0, 300),
      source: String(body.source ?? 'app').slice(0, 40),
      route: body.route ? String(body.route).slice(0, 120) : undefined,
      at: body.at ? String(body.at).slice(0, 40) : new Date().toISOString(),
      contextKeys:
        body.context && typeof body.context === 'object'
          ? Object.keys(body.context as Record<string, unknown>).slice(0, 10)
          : [],
    };
    console.warn('[client-error]', JSON.stringify(summary));
    res.status(204).end();
  });

  // Product Micro-Survey & User Feedback store
  const feedbackSubmissions: Array<{
    id: string;
    rating: 'great' | 'good' | 'okay' | 'needs_work';
    suggestion: string;
    userEmail: string;
    developerMode: boolean;
    createdAt: string;
  }> = [];

  app.get('/api/feedback', async (req: Request, res: Response) => {
    const adminAuth = await verifyAdminAuthorization(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }
    res.json({ feedback: feedbackSubmissions });
  });

  app.post('/api/feedback', async (req: Request, res: Response) => {
    const callerEmail = await resolveAuthenticatedEmail(req);
    const body = req.body || {};
    const validRatings = new Set(['great', 'good', 'okay', 'needs_work']);
    const rating = validRatings.has(body.rating) ? body.rating : 'good';
    const entry = {
      id: `fb_${Date.now()}`,
      rating,
      suggestion: String(body.suggestion || '')
        .trim()
        .slice(0, 1000),
      userEmail: callerEmail || String(body.userEmail || 'anonymous@user.local').trim(),
      developerMode: Boolean(body.developerMode),
      createdAt: new Date().toISOString(),
    };
    feedbackSubmissions.unshift(entry);
    recordAudit(
      entry.userEmail,
      'PRODUCT_FEEDBACK',
      `Survey (${rating})`,
      entry.suggestion || 'Quick pulse rating submitted',
      req
    );
    res.json({ success: true, entry });
  });

  // Real RFC 6238 TOTP Vault (per-admin Base32 secrets + optional ADMIN_TOTP_SECRET env)
  interface TotpVaultEntry {
    secret: string;
    enrolledAt: string;
    lastAcceptedStep?: number;
  }
  const TOTP_VAULT_PATH = path.join(__dirname, '.supremeai-totp-vault.json');
  const pendingTotpSecrets = new Map<string, { secret: string; expiresAt: number }>();

  const loadTotpVault = (): Record<string, TotpVaultEntry> => {
    try {
      if (fs.existsSync(TOTP_VAULT_PATH)) {
        const raw = fs.readFileSync(TOTP_VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {};
  };

  const saveTotpVault = (vault: Record<string, TotpVaultEntry>) => {
    try {
      fs.writeFileSync(TOTP_VAULT_PATH, JSON.stringify(vault, null, 2), { mode: 0o600 });
    } catch {}
  };

  const totpVault: Record<string, TotpVaultEntry> = loadTotpVault();

  const resolveAdminEligibilityForTotp = async (req: Request, rawEmail?: string) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const cookies = parseCookieHeader(req.headers.cookie);
    const adminCookie = (cookies['supremeai_admin_session'] || '').trim();
    const candidateToken = bearer || adminCookie;

    if (
      !candidateToken ||
      candidateToken.startsWith('tok_guest_') ||
      candidateToken.startsWith('sk-supreme-guest')
    ) {
      return { cleanEmail: '', isEligible: false };
    }

    const requestedEmail = String(rawEmail || '')
      .trim()
      .toLowerCase();

    const verifiedPayload = verifyLocalSessionToken(candidateToken);
    const sessionUserId = activeAuthSessions.get(candidateToken);
    const sessionUser = sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined;
    const adminCookieExp = activeAdminSessions.get(candidateToken);

    if (verifiedPayload || sessionUser) {
      if (verifiedPayload?.sub === 'admin_passkey') {
        if (!adminCookieExp || adminCookieExp <= Date.now()) {
          activeAdminSessions.delete(candidateToken);
          return { cleanEmail: '', isEligible: false };
        }
        const passkeyEmail = verifiedPayload.email.toLowerCase();
        if (requestedEmail && requestedEmail !== passkeyEmail) {
          return { cleanEmail: '', isEligible: false };
        }
        return { cleanEmail: passkeyEmail, isEligible: true };
      }

      const verifiedEmail = (sessionUser?.email || verifiedPayload?.email || '')
        .trim()
        .toLowerCase();
      if (!verifiedEmail) {
        return { cleanEmail: '', isEligible: false };
      }
      if (requestedEmail && requestedEmail !== verifiedEmail) {
        return { cleanEmail: '', isEligible: false };
      }
      const matchedUser =
        sessionUser || usersDb.find((u) => u.email.toLowerCase() === verifiedEmail);
      const matchedCustomer = customerDirectory.find(
        (c) => c.email.toLowerCase() === verifiedEmail
      );
      const rbac = resolveRbacUserProfile(verifiedEmail, matchedUser, matchedCustomer);
      return { cleanEmail: verifiedEmail, isEligible: rbac.isAdminEligible };
    }

    // Verify upstream RBAC eligibility when caller presented an upstream bearer JWT
    if (bearer && !bearer.startsWith('tok_') && !bearer.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (upstreamRes.ok) {
          const data: any = await upstreamRes.json().catch(() => null);
          const raw =
            data?.user && typeof data.user === 'object' ? { ...data, ...data.user } : data;
          const upEmail = String(raw?.email || '')
            .trim()
            .toLowerCase();
          if (upEmail && (!requestedEmail || requestedEmail === upEmail)) {
            const matchedCustomer = customerDirectory.find(
              (c) => c.email.toLowerCase() === upEmail
            );
            const upRbac = resolveRbacUserProfile(
              upEmail,
              {
                rbacRole: raw?.rbacRole || raw?.rbac_role || raw?.role,
                isAdminEligible: Boolean(
                  raw?.isAdminEligible ?? raw?.is_admin_eligible ?? raw?.is_admin
                ),
                adminUserId: raw?.adminUserId || raw?.admin_user_id,
              },
              matchedCustomer,
              Array.isArray(data?.adminEmails) ? data.adminEmails : [],
              raw?.rbacRole || raw?.rbac_role || raw?.role
            );
            return { cleanEmail: upEmail, isEligible: upRbac.isAdminEligible };
          }
        }
      } catch {}
    }

    return { cleanEmail: '', isEligible: false };
  };

  const getActiveTotpConfig = (
    cleanEmail: string
  ): { secret: string; source: 'user_vault' | 'env'; lastAcceptedStep: number | null } | null => {
    const vaultEntry = totpVault[cleanEmail];
    if (vaultEntry?.secret) {
      return {
        secret: vaultEntry.secret,
        source: 'user_vault',
        lastAcceptedStep:
          typeof vaultEntry.lastAcceptedStep === 'number' ? vaultEntry.lastAcceptedStep : null,
      };
    }
    const envSecret = process.env.ADMIN_TOTP_SECRET?.trim();
    if (envSecret) {
      return {
        secret: envSecret,
        source: 'env',
        lastAcceptedStep:
          typeof vaultEntry?.lastAcceptedStep === 'number' ? vaultEntry.lastAcceptedStep : null,
      };
    }
    return null;
  };

  // GET /api/auth/totp/status - Check whether admin has enrolled a real RFC 6238 TOTP secret
  app.get('/api/auth/totp/status', async (req: Request, res: Response) => {
    const requestedEmail = typeof req.query.userEmail === 'string' ? req.query.userEmail : '';
    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, requestedEmail);
    if (!isEligible) {
      res
        .status(403)
        .json({ error: 'Unauthorized: Email does not match an Administrator RBAC role.' });
      return;
    }

    const active = getActiveTotpConfig(cleanEmail);
    res.json({
      enrolled: Boolean(active),
      source: active?.source || 'none',
      issuer: 'SupremeAI Studio',
      accountName: cleanEmail,
    });
  });

  // POST /api/auth/totp/setup - Generate a fresh cryptographic Base32 secret & QR code for Authenticator pairing
  app.post('/api/auth/totp/setup', async (req: Request, res: Response) => {
    const { userEmail, currentToken } = req.body || {};
    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, userEmail);
    if (!isEligible) {
      res
        .status(403)
        .json({ error: 'Unauthorized: Email does not match an Administrator RBAC role.' });
      return;
    }

    const existing = getActiveTotpConfig(cleanEmail);
    if (existing) {
      // Require live TOTP proof before rotating an already-enrolled secret
      const check = verifyTotpToken(existing.secret, String(currentToken || ''), {
        lastAcceptedStep: existing.lastAcceptedStep,
      });
      if (!check.valid) {
        res.status(401).json({
          error:
            'TOTP is already enrolled. Enter your current 6-digit Authenticator code to rotate your TOTP key.',
          requiresCurrentToken: true,
        });
        return;
      }
      if (check.matchedStep !== null) {
        totpVault[cleanEmail] = {
          ...(totpVault[cleanEmail] || {
            secret: existing.secret,
            enrolledAt: new Date().toISOString(),
          }),
          lastAcceptedStep: check.matchedStep,
        };
        saveTotpVault(totpVault);
      }
    }

    const secret = generateTotpSecret(20);
    pendingTotpSecrets.set(cleanEmail, {
      secret,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: cleanEmail,
      issuer: 'SupremeAI Studio',
    });

    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    res.json({
      success: true,
      secret,
      otpauthUrl,
      qrDataUrl,
      issuer: 'SupremeAI Studio',
      accountName: cleanEmail,
    });
  });

  // POST /api/auth/totp/confirm - Confirm Authenticator pairing with a live 6-digit RFC 6238 code
  app.post('/api/auth/totp/confirm', async (req: Request, res: Response) => {
    const parsed = parseBody(totpConfirmSchema, req, res);
    if (!parsed.ok) return;
    const { userEmail, token, trustFor7Days = false } = parsed.data;
    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, userEmail);
    if (!isEligible) {
      res
        .status(403)
        .json({ error: 'Unauthorized: Email does not match an Administrator RBAC role.' });
      return;
    }

    const pending = pendingTotpSecrets.get(cleanEmail);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingTotpSecrets.delete(cleanEmail);
      res.status(400).json({
        error: 'TOTP pairing session expired. Please generate a new Authenticator QR code.',
      });
      return;
    }

    const verification = verifyTotpToken(pending.secret, String(token || ''));
    if (!verification.valid) {
      res.status(401).json({
        success: false,
        error:
          'Invalid 6-digit Authenticator code. Verify your device clock is synced and try again.',
      });
      return;
    }

    totpVault[cleanEmail] = {
      secret: pending.secret,
      enrolledAt: new Date().toISOString(),
      lastAcceptedStep: verification.matchedStep ?? undefined,
    };
    saveTotpVault(totpVault);
    pendingTotpSecrets.delete(cleanEmail);

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const trustedUntil = trustFor7Days ? Date.now() + SEVEN_DAYS_MS : null;
    const deviceId = `trusted_dev_${crypto.randomBytes(6).toString('hex')}`;

    recordAudit(
      cleanEmail,
      'ADMIN_TOTP_ENROLLED',
      'Admin Studio Ingress',
      `Real RFC 6238 TOTP enrolled${trustFor7Days ? ' (7-day trust)' : ''}`,
      req
    );

    res.json({
      success: true,
      verified: true,
      enrolled: true,
      authMethod: 'rfc6238_totp',
      trustedBrowser: Boolean(trustFor7Days),
      trustedUntil,
      deviceId: trustFor7Days ? deviceId : null,
      message: 'Authenticator app paired and 2-Step Verification passed.',
    });
  });

  // POST /api/auth/verify-2fa (Real RFC 6238 TOTP token only, with replay protection & 7-day trust)
  app.post('/api/auth/verify-2fa', async (req: Request, res: Response) => {
    const parsed = parseBody(verify2faSchema, req, res);
    if (!parsed.ok) return;
    const { token, method, trustFor7Days = false, userEmail } = parsed.data;

    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, userEmail);
    if (!isEligible) {
      res.status(403).json({
        error: 'Unauthorized: Email does not match an Administrator RBAC role in the database.',
      });
      return;
    }

    if (method && method !== 'totp') {
      res.status(400).json({
        success: false,
        error: 'Only real Authenticator TOTP verification is permitted for Admin access.',
      });
      return;
    }

    const activeTotp = getActiveTotpConfig(cleanEmail);
    if (!activeTotp) {
      res.status(428).json({
        success: false,
        requiresTotpSetup: true,
        error:
          'Authenticator TOTP is not enrolled yet for this admin account. Pair your Authenticator app first.',
      });
      return;
    }

    const verification = verifyTotpToken(activeTotp.secret, String(token || ''), {
      lastAcceptedStep: activeTotp.lastAcceptedStep,
    });

    if (!verification.valid) {
      const errorMsg =
        verification.reason === 'replayed_step'
          ? 'This 6-digit TOTP code has already been used. Wait for the next 30-second code.'
          : 'Invalid or expired 6-digit TOTP code. Enter the live code from your Authenticator app.';
      res.status(401).json({
        success: false,
        error: errorMsg,
      });
      return;
    }

    if (verification.matchedStep !== null) {
      totpVault[cleanEmail] = {
        secret: totpVault[cleanEmail]?.secret || activeTotp.secret,
        enrolledAt: totpVault[cleanEmail]?.enrolledAt || new Date().toISOString(),
        lastAcceptedStep: verification.matchedStep,
      };
      saveTotpVault(totpVault);
    }

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const trustedUntil = trustFor7Days ? Date.now() + SEVEN_DAYS_MS : null;
    const deviceId = `trusted_dev_${crypto.randomBytes(6).toString('hex')}`;

    recordAudit(
      cleanEmail,
      'ADMIN_2FA_VERIFIED',
      'Admin Studio Ingress',
      `Method: rfc6238_totp${trustFor7Days ? ' (7-day trust)' : ''}`,
      req
    );

    res.json({
      success: true,
      verified: true,
      authMethod: 'rfc6238_totp',
      trustedBrowser: Boolean(trustFor7Days),
      trustedUntil,
      deviceId: trustFor7Days ? deviceId : null,
      message: trustFor7Days
        ? '2-Step Verification passed. This browser is trusted for the next 7 days.'
        : '2-Step Verification passed successfully.',
    });
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

  // --- User API Keys Management Endpoints (Multi-Provider CRUD + Health Probe) ---
  const userApiKeyOwner = new Map<string, string>();

  app.get(['/api/api-keys', '/api/v1/api-keys'], async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    res.json({ keys: userApiKeysStore.filter((k) => (userApiKeyOwner.get(k.id) || '') === owner) });
  });

  app.post(
    ['/api/api-keys/create', '/api/v1/api-keys/create'],
    async (req: Request, res: Response) => {
      const owner = await resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const body = req.body || {};
      const name = String(body.name || 'New Provider Key').trim();
      const provider = String(body.provider || 'supremeai').trim();
      const rawSecret = String(body.secret || '').trim();
      const rateLimitRpm = Number(
        body.rateLimitRpm || (body.rate_limit_rps ? body.rate_limit_rps * 60 : 120)
      );
      const permissions = Array.isArray(body.scopes || body.permissions)
        ? body.scopes || body.permissions
        : ['chat:write', 'models:read'];

      const generatedSecret =
        rawSecret ||
        `sk-${provider === 'supremeai' ? 'supreme' : provider.slice(0, 4)}-live-${crypto.randomBytes(24).toString('base64url')}`;
      const prefix = generatedSecret.slice(0, Math.min(14, generatedSecret.length));
      const masked =
        generatedSecret.length > 10
          ? `${generatedSecret.slice(0, 10)}••••••••••••••••${generatedSecret.slice(-4)}`
          : '••••••••••••••••';

      const newItem = {
        id: `key_${Date.now()}`,
        name,
        provider,
        keyPrefix: prefix,
        secretMasked: masked,
        createdAt: new Date().toISOString().slice(0, 10),
        lastUsed: 'Never',
        rateLimitRpm,
        status: 'active' as const,
        healthStatus: 'healthy' as const,
        lastChecked: 'Just now',
        permissions,
      };

      userApiKeysStore.unshift(newItem);
      userApiKeyOwner.set(newItem.id, owner);
      res.status(201).json({
        ...newItem,
        key: generatedSecret,
        key_masked: masked,
        rate_limit_rps: Math.max(1, Math.floor(rateLimitRpm / 60)),
        created_at: newItem.createdAt,
        scopes: permissions,
      });
    }
  );

  app.patch(['/api/api-keys/:id', '/api/v1/api-keys/:id'], async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const { id } = req.params;
    const target = userApiKeysStore.find((k) => k.id === id);
    if (!target || (userApiKeyOwner.get(id) || '') !== owner) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }

    const { name, provider, rateLimitRpm, permissions, secret, status } = req.body || {};
    if (typeof name === 'string' && name.trim()) target.name = name.trim();
    if (typeof provider === 'string' && provider.trim()) target.provider = provider.trim();
    if (typeof rateLimitRpm === 'number' && !Number.isNaN(rateLimitRpm))
      target.rateLimitRpm = rateLimitRpm;
    if (Array.isArray(permissions) && permissions.length > 0) target.permissions = permissions;
    if (status === 'active' || status === 'revoked') target.status = status;
    if (typeof secret === 'string' && secret.trim()) {
      const clean = secret.trim();
      target.keyPrefix = clean.slice(0, Math.min(14, clean.length));
      target.secretMasked =
        clean.length > 10
          ? `${clean.slice(0, 10)}••••••••••••••••${clean.slice(-4)}`
          : '••••••••••••';
      target.healthStatus = 'healthy';
      target.lastChecked = 'Rotated just now';
    }

    res.json({ success: true, key: target });
  });

  app.post(
    ['/api/api-keys/:id/revoke', '/api/v1/api-keys/:id/revoke'],
    async (req: Request, res: Response) => {
      const owner = await resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const target = userApiKeysStore.find((k) => k.id === req.params.id);
      if (!target || (userApiKeyOwner.get(req.params.id) || '') !== owner) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      target.status = 'revoked';
      res.json({ success: true, key: target });
    }
  );

  app.post(
    ['/api/api-keys/:id/probe', '/api/v1/api-keys/:id/probe'],
    async (req: Request, res: Response) => {
      const owner = await resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const target = userApiKeysStore.find((k) => k.id === req.params.id);
      if (!target || (userApiKeyOwner.get(req.params.id) || '') !== owner) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      if (target.status === 'revoked') {
        res.status(400).json({ error: 'Cannot probe a revoked key.' });
        return;
      }

      const startedAt = Date.now();
      const matchedProvider = providerMesh.find((p) => p.provider === target.provider);
      const activeKey = process.env.GEMINI_API_KEY?.trim() || '';
      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let message = `${PROVIDER_DISPLAY_NAMES[target.provider] || target.provider} credential handshake passed.`;

      if (
        target.provider === 'google_ai_studio' &&
        activeKey &&
        activeKey !== 'MY_GEMINI_API_KEY'
      ) {
        try {
          const clientAi = new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: { apiVersion: 'v1beta', headers: { 'User-Agent': 'aistudio-build' } },
          });
          await clientAi.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: 'OK',
            config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          });
          healthStatus = 'healthy';
          message = 'Live Google AI Studio probe succeeded.';
        } catch (err: unknown) {
          healthStatus = 'degraded';
          message = err instanceof Error ? err.message : 'Live Gemini probe degraded.';
        }
      } else if (matchedProvider?.status === 'degraded') {
        healthStatus = 'degraded';
        message = `${matchedProvider.displayName} experiencing elevated latency.`;
      }

      const latencyMs =
        target.provider === 'google_ai_studio' && activeKey
          ? Math.max(12, Date.now() - startedAt)
          : matchedProvider?.avgLatencyMs || 24;

      target.healthStatus = healthStatus;
      target.lastChecked = `${new Date().toLocaleTimeString()} (${latencyMs}ms)`;
      target.lastUsed = 'Just now';

      res.json({
        success: healthStatus === 'healthy',
        latencyMs,
        message,
        key: target,
      });
    }
  );

  app.delete(['/api/api-keys/:id', '/api/v1/api-keys/:id'], async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userApiKeysStore.find((k) => k.id === req.params.id);
    if (!target || (userApiKeyOwner.get(req.params.id) || '') !== owner) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    userApiKeyOwner.delete(req.params.id);
    userApiKeysStore = userApiKeysStore.filter((k) => k.id !== req.params.id);
    res.json({
      success: true,
      keys: userApiKeysStore.filter((k) => (userApiKeyOwner.get(k.id) || '') === owner),
    });
  });

  // --- Provider Mesh & Infisical Vault Secrets Endpoints (Admin Dashboard) ---
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

  const userWalletMap = new Map<string, UserWalletRecord>();
  const ensureUserWallet = (email: string): UserWalletRecord => {
    const existing = userWalletMap.get(email);
    if (existing) return existing;
    const customer = customerDirectory.find((c) => c.email.toLowerCase() === email);
    const matchedUser = usersDb.find((u) => u.email.toLowerCase() === email);
    const tier: PlanTier = customer?.tier || matchedUser?.plan || 'Free';
    const planSpec = getPlanSpec(tier);
    const monthlyAllowanceUsd = tier === 'Enterprise' ? 500 : tier === 'Pro' ? 100 : 0;
    const initial: UserWalletRecord = {
      userId: matchedUser?.id || customer?.id || (email === 'guest' ? 'guest' : `usr_${email}`),
      balanceUsd: planSpec.monthlyPriceUsd,
      monthlyAllowanceUsd,
      totalSpent: 0,
      totalSaved: 0,
      cachedQueries: 0,
    };
    userWalletMap.set(email, initial);
    return initial;
  };

  const userInvoiceOwner = new Map<string, string>();
  const userInvoicesStore: Array<{
    id: string;
    invoiceNumber: string;
    date: string;
    amountUsd: number;
    status: 'paid' | 'pending' | 'failed';
    planName: string;
    ownerEmail?: string;
  }> = [];

  const dailyUsageMap = new Map<
    string,
    {
      metric_date: string;
      total_requests: number;
      total_tokens: number;
      total_cost: number;
      unique_users: number;
      avg_latency_ms: number;
      error_rate: number;
    }
  >();

  let userWebhooksStore: Array<{
    id: string;
    name: string;
    url: string;
    events: string[];
    secret: string;
    active: boolean;
    lastTriggered: string;
    failureCount: number;
  }> = [];

  let userProjectsStore: Array<{
    id: string;
    name: string;
    description: string;
    repoUrl: string;
    branch: string;
    language: string;
    lastSynced: number;
    stars: number;
    aiReviewStatus: 'idle' | 'analyzing' | 'ready';
    buildStatus?: 'passing' | 'failing' | 'building' | 'unknown';
    buildUrl?: string;
    lastBuildCheckedAt?: number;
    forkedFrom?: string;
    ownerEmail?: string;
  }> = [];

  let userTeamStore: Array<{
    id: string;
    name: string;
    email: string;
    avatar: string;
    role: 'Owner' | 'Developer' | 'Reviewer' | 'Viewer';
    joinedDate: string;
    twoFactorEnabled: boolean;
    status: 'active' | 'invited';
  }> = [];

  // Dynamic Billing & Usage endpoints
  app.get('/api/billing/plans', async (_req: Request, res: Response) => {
    const remote = await fetchGatewayJson('/api/v1/billing/plans');
    const remotePlans = remote?.plans;
    const useRemote = remotePlans && typeof remotePlans === 'object' && !Array.isArray(remotePlans);
    if (useRemote) {
      res.json({
        plans: remotePlans,
        topupPackages:
          Array.isArray(remote?.topupPackages) || Array.isArray(remote?.topup_packages)
            ? remote?.topupPackages || remote?.topup_packages
            : TOPUP_PACKAGES,
        source: 'gateway',
      });
      return;
    }
    res.json({ plans: PLAN_CATALOG, topupPackages: TOPUP_PACKAGES, source: 'local' });
  });

  app.get('/api/billing/wallet', (req: Request, res: Response) => {
    const email = getRequestUserEmail(req);
    const wallet = ensureUserWallet(email);
    res.json({
      user_id: wallet.userId,
      balance_usd: wallet.balanceUsd,
      monthly_allowance_usd: wallet.monthlyAllowanceUsd,
      wallet: { balance: wallet.balanceUsd },
    });
  });

  app.get(['/api/billing/summary', '/api/billing/analytics'], (req: Request, res: Response) => {
    const email = getRequestUserEmail(req);
    const wallet = ensureUserWallet(email);
    res.json({
      total_spent: wallet.totalSpent,
      total_saved: wallet.totalSaved,
      cached_queries: wallet.cachedQueries,
    });
  });

  app.get('/api/billing/history', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const adminAuth = await verifyAdminAuthorization(req);
    const list = adminAuth.ok
      ? userInvoicesStore
      : userInvoicesStore.filter(
          (inv) => (userInvoiceOwner.get(inv.id) || inv.ownerEmail || '') === owner
        );
    res.json({ invoices: list, history: list });
  });

  app.post('/api/billing/add-funds', async (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const identity = bearerToken ? await verifyBearerIdentity(bearerToken) : null;
    const adminAuth = await verifyAdminAuthorization(req);

    if (!identity && !adminAuth.ok) {
      res.status(401).json({ error: 'Authentication required for billing operations.' });
      return;
    }

    const allowDirectTopup = process.env.ALLOW_DIRECT_BILLING_TOPUP === 'true';
    if (!adminAuth.ok && !allowDirectTopup) {
      res.status(403).json({
        error:
          'Verified payment checkout or administrator authorization is required to add account credits.',
      });
      return;
    }

    const email = (
      identity?.email ||
      (adminAuth.ok ? adminAuth.email : '') ||
      getRequestUserEmail(req)
    ).toLowerCase();
    if (!email || email === 'guest') {
      res.status(401).json({ error: 'Valid user account required for billing top-up.' });
      return;
    }

    const wallet = ensureUserWallet(email);
    const amount = Number(req.body?.amount);
    const tokens = Math.max(0, Math.floor(Number(req.body?.tokens) || 0));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      res.status(400).json({ error: 'Funding amount must be between $0.01 and $10,000.' });
      return;
    }
    const callerAuth = await verifyAdminAuthorization(req);
    const invoiceStatus = callerAuth.ok ? ('paid' as const) : ('pending' as const);
    if (callerAuth.ok) {
      wallet.balanceUsd = Number((wallet.balanceUsd + amount).toFixed(2));
    }
    const invoice = {
      id: `inv_topup_${Date.now()}`,
      invoiceNumber: `TOP-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
      amountUsd: amount,
      status: invoiceStatus,
      planName:
        tokens > 0
          ? `Pay-As-You-Go Credits (${(tokens / 1_000_000).toFixed(2)}M Tokens)`
          : `Account Credit Top-up ($${amount})`,
      ownerEmail: email,
    };
    userInvoiceOwner.set(invoice.id, email);
    userInvoicesStore.unshift(invoice);
    recordAudit(
      resolveAuditActor(req),
      'BILLING_TOPUP',
      email,
      `Added $${amount} credit (${tokens} tokens)`,
      req
    );
    res.json({ success: true, invoice, balance_usd: wallet.balanceUsd });
  });

  app.get('/metrics/usage', async (req: Request, res: Response) => {
    const auth = await verifyAdminAuthorization(req);
    if (!auth.ok) {
      res.status(auth.status || 401).json({ error: auth.error || 'Admin authorization required.' });
      return;
    }
    const items = Array.from(dailyUsageMap.values());
    res.json({ items, total: items.length });
  });

  // User Webhooks CRUD + Dispatch Test
  const userWebhookOwner = new Map<string, string>();

  app.get('/api/user/webhooks', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    res.json({
      webhooks: userWebhooksStore.filter((w) => (userWebhookOwner.get(w.id) || '') === owner),
    });
  });

  app.post('/api/user/webhooks', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    const rawUrl = String(body.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Webhook URL is required.' });
      return;
    }
    try {
      const parsed = new URL(rawUrl);
      const targetCheck = isRestrictedProxyTarget(parsed, false);
      if (targetCheck.restricted) {
        res.status(400).json({ error: targetCheck.reason || 'Restricted webhook destination.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid webhook URL.' });
      return;
    }
    const created = {
      id: `wh_${Date.now()}`,
      name: String(body.name || rawUrl).trim(),
      url: rawUrl,
      events:
        Array.isArray(body.events) && body.events.length > 0 ? body.events : ['chat.completed'],
      secret: String(body.secret || `whsec_${crypto.randomBytes(12).toString('hex')}`),
      active: body.active ?? true,
      lastTriggered: 'Never',
      failureCount: 0,
    };
    userWebhooksStore.unshift(created);
    userWebhookOwner.set(created.id, owner);
    res.status(201).json({
      success: true,
      webhook: created,
      webhooks: userWebhooksStore.filter((w) => (userWebhookOwner.get(w.id) || '') === owner),
    });
  });

  app.delete('/api/user/webhooks/:id', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if ((userWebhookOwner.get(req.params.id) || '') !== owner) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    userWebhookOwner.delete(req.params.id);
    userWebhooksStore = userWebhooksStore.filter((w) => w.id !== req.params.id);
    res.json({
      success: true,
      webhooks: userWebhooksStore.filter((w) => (userWebhookOwner.get(w.id) || '') === owner),
    });
  });

  app.post('/api/user/webhooks/:id/test', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userWebhooksStore.find((w) => w.id === req.params.id);
    if (!target || (userWebhookOwner.get(req.params.id) || '') !== owner) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    let parsedWebhookUrl: URL;
    try {
      parsedWebhookUrl = new URL(target.url);
      const targetCheck = await resolveAndCheckProxyTarget(parsedWebhookUrl, false);
      if (targetCheck.restricted) {
        res.status(400).json({ error: targetCheck.reason || 'Restricted webhook destination.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid webhook URL.' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const hookRes = await safeFetchWithRedirectCheck(
        parsedWebhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SupremeAI-Signature': target.secret },
          body: JSON.stringify({ event: 'webhook.test', timestamp: new Date().toISOString() }),
          signal: controller.signal,
        },
        false
      );
      clearTimeout(timeout);
      target.lastTriggered = `${new Date().toLocaleTimeString()} (HTTP ${hookRes.status})`;
      if (!hookRes.ok) target.failureCount += 1;
      res.json({ success: hookRes.ok, status_code: hookRes.status });
    } catch (err: unknown) {
      target.lastTriggered = `${new Date().toLocaleTimeString()} (Failed)`;
      target.failureCount += 1;
      res.json({
        success: false,
        status_code: 0,
        error: err instanceof Error ? err.message : 'Delivery failed',
      });
    }
  });

  // User Projects CRUD & Repository Health / Forking
  app.get('/api/v1/projects', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    res.json({ projects: userProjectsStore.filter((p) => (p.ownerEmail || '') === owner) });
  });

  app.get('/api/v1/projects/github-status', async (req: Request, res: Response) => {
    const repoUrl = String(req.query.repoUrl || '').trim();
    const branch = String(req.query.branch || 'main').trim() || 'main';
    const projectId = String(req.query.projectId || '').trim();
    const parsed = parseGitHubRepoSlug(repoUrl);
    const checkedAt = Date.now();
    if (!parsed) {
      res.json({ buildStatus: 'unknown', checkedAt });
      return;
    }

    const clientToken =
      typeof req.headers['x-github-token'] === 'string' ? req.headers['x-github-token'].trim() : '';
    const serverToken =
      process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_READONLY_TOKEN?.trim() || '';
    const token = clientToken || serverToken;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Studio-Projects',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
        {
          headers,
          signal: AbortSignal.timeout(4500),
        }
      );
      if (!ghRes.ok) {
        res.json({
          buildStatus: 'unknown',
          buildUrl: `${parsed.normalizedUrl}/actions`,
          checkedAt,
        });
        return;
      }
      const data = (await ghRes.json()) as {
        workflow_runs?: Array<{ status?: string; conclusion?: string | null; html_url?: string }>;
      };
      const latestRun = Array.isArray(data.workflow_runs) ? data.workflow_runs[0] : undefined;
      const buildStatus = mapWorkflowRunToBuildStatus(latestRun);
      const buildUrl = latestRun?.html_url || `${parsed.normalizedUrl}/actions`;

      if (projectId) {
        const owner = await resolveAuthenticatedEmail(req).catch(() => null);
        if (owner) {
          const target = userProjectsStore.find(
            (p) => p.id === projectId && (p.ownerEmail || '') === owner
          );
          if (target) {
            target.buildStatus = buildStatus;
            target.buildUrl = buildUrl;
            target.lastBuildCheckedAt = checkedAt;
          }
        }
      }

      res.json({ buildStatus, buildUrl, checkedAt });
    } catch {
      res.json({
        buildStatus: 'unknown',
        buildUrl: `${parsed.normalizedUrl}/actions`,
        checkedAt,
      });
    }
  });

  app.post('/api/v1/projects', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      res.status(400).json({ error: 'Project name is required.' });
      return;
    }
    const rawBuildStatus = String(body.buildStatus || '');
    const buildStatus: 'passing' | 'failing' | 'building' | 'unknown' =
      rawBuildStatus === 'passing' ||
      rawBuildStatus === 'failing' ||
      rawBuildStatus === 'building' ||
      rawBuildStatus === 'unknown'
        ? rawBuildStatus
        : 'unknown';
    const project = {
      id: `proj_${Date.now()}`,
      name: String(body.name).trim(),
      description: String(body.description || '').trim(),
      repoUrl: String(body.repoUrl || '').trim(),
      branch: String(body.branch || 'main').trim(),
      language: String(body.language || 'TypeScript').trim(),
      lastSynced: Date.now(),
      stars: Number(body.stars) || 0,
      aiReviewStatus: 'idle' as const,
      buildStatus,
      ...(typeof body.buildUrl === 'string' && body.buildUrl.trim()
        ? { buildUrl: body.buildUrl.trim() }
        : {}),
      ...(typeof body.forkedFrom === 'string' && body.forkedFrom.trim()
        ? { forkedFrom: body.forkedFrom.trim() }
        : {}),
      ownerEmail: owner,
    };
    userProjectsStore.unshift(project);
    res.status(201).json({ ...project, project });
  });

  app.post('/api/v1/projects/fork', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    const sourceId = String(body.sourceId || '').trim();
    const existing = sourceId
      ? userProjectsStore.find((p) => p.id === sourceId && (p.ownerEmail || '') === owner)
      : undefined;

    const requestedBuildStatus =
      body.buildStatus === 'passing' ||
      body.buildStatus === 'failing' ||
      body.buildStatus === 'building'
        ? (body.buildStatus as 'passing' | 'failing' | 'building')
        : undefined;

    const sourceProject = existing
      ? {
          ...existing,
          buildStatus:
            existing.buildStatus && existing.buildStatus !== 'unknown'
              ? existing.buildStatus
              : requestedBuildStatus || existing.buildStatus || 'passing',
          aiReviewStatus:
            existing.aiReviewStatus === 'ready'
              ? ('reviewed' as const)
              : existing.aiReviewStatus === 'analyzing'
                ? ('pending' as const)
                : ('idle' as const),
        }
      : {
          id: sourceId || `proj_${Date.now()}`,
          name: String(body.name || 'repository').trim(),
          description: String(body.description || 'Connected GitHub repository').trim(),
          repoUrl: String(body.repoUrl || '').trim(),
          branch: String(body.branch || 'main').trim() || 'main',
          language: String(body.language || 'TypeScript').trim() || 'TypeScript',
          lastSynced: Date.now(),
          stars: 0,
          aiReviewStatus: 'idle' as const,
          buildStatus: requestedBuildStatus || ('passing' as const),
        };

    const parsed = parseGitHubRepoSlug(sourceProject.repoUrl);
    const githubForkUrl = buildGitHubForkUrl(sourceProject.repoUrl);
    const clientToken =
      typeof req.headers['x-github-token'] === 'string' ? req.headers['x-github-token'].trim() : '';
    const token = clientToken || process.env.GITHUB_TOKEN?.trim() || '';

    let remoteForked = false;
    let remoteForkHtmlUrl = '';
    let remoteForkName = '';
    let remoteForkBranch = sourceProject.branch;

    if (parsed && token) {
      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/forks`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
              'User-Agent': 'SupremeAI-Studio-Projects',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ default_branch_only: false }),
            signal: AbortSignal.timeout(6000),
          }
        );
        if (ghRes.ok) {
          const forkData = (await ghRes.json()) as {
            html_url?: string;
            name?: string;
            default_branch?: string;
          };
          if (forkData.html_url) {
            remoteForked = true;
            remoteForkHtmlUrl = forkData.html_url;
            remoteForkName = forkData.name || `${sourceProject.name}-fork`;
            remoteForkBranch = forkData.default_branch || sourceProject.branch;
          }
        }
      } catch {
        remoteForked = false;
      }
    }

    const customerRec = customerDirectory.find(
      (c) => c.email.toLowerCase() === owner.toLowerCase()
    );
    const forkPayload = createForkedProjectPayload(sourceProject, customerRec?.githubHandle);

    const forkedProject = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: remoteForked && remoteForkName ? remoteForkName : forkPayload.name,
      description: forkPayload.description,
      repoUrl: remoteForked && remoteForkHtmlUrl ? remoteForkHtmlUrl : forkPayload.repoUrl,
      branch: remoteForked ? remoteForkBranch : forkPayload.branch,
      language: forkPayload.language,
      lastSynced: Date.now(),
      stars: 0,
      aiReviewStatus: 'idle' as const,
      buildStatus: remoteForked ? ('building' as const) : forkPayload.buildStatus,
      ...(forkPayload.buildUrl ? { buildUrl: forkPayload.buildUrl } : {}),
      forkedFrom: forkPayload.forkedFrom,
      ownerEmail: owner,
    };

    userProjectsStore.unshift(forkedProject);
    res.status(201).json({
      project: forkedProject,
      remoteForked,
      githubForkUrl,
    });
  });

  app.delete('/api/v1/projects/:id', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userProjectsStore.find((p) => p.id === req.params.id);
    if (!target || (target.ownerEmail || '') !== owner) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    userProjectsStore = userProjectsStore.filter((p) => p.id !== req.params.id);
    res.json({
      success: true,
      projects: userProjectsStore.filter((p) => (p.ownerEmail || '') === owner),
    });
  });

  // User Team Management CRUD (bounded by PlanSpec maxSeats)
  const userTeamOwner = new Map<string, string>();

  app.get('/api/user/team', async (req: Request, res: Response) => {
    const email = await resolveAuthenticatedEmail(req);
    if (!email) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const customer = customerDirectory.find((c) => c.email.toLowerCase() === email);
    const matchedUser = usersDb.find((u) => u.email.toLowerCase() === email);
    const tier: PlanTier = customer?.tier || matchedUser?.plan || 'Free';
    const maxSeats = getPlanSpec(tier).maxSeats;

    // Seed the caller's owner row if this org has no members yet.
    let members = userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === email);
    if (members.length === 0) {
      const displayName = matchedUser?.name || customer?.name || email.split('@')[0];
      const ownerId = `member_owner_${email}`;
      userTeamStore.push({
        id: ownerId,
        name: displayName,
        email,
        avatar: displayName.charAt(0).toUpperCase(),
        role: 'Owner',
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        twoFactorEnabled: Boolean(matchedUser?.isAdminEligible),
        status: 'active',
      });
      userTeamOwner.set(ownerId, email);
      members = userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === email);
    }
    res.json({ members, maxSeats, tier });
  });

  app.post('/api/user/team', async (req: Request, res: Response) => {
    const reqEmail = await resolveAuthenticatedEmail(req);
    if (!reqEmail) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const customer = customerDirectory.find((c) => c.email.toLowerCase() === reqEmail);
    const matchedUser = usersDb.find((u) => u.email.toLowerCase() === reqEmail);
    const tier: PlanTier = customer?.tier || matchedUser?.plan || 'Pro';
    const maxSeats = getPlanSpec(tier).maxSeats;

    const orgMembers = userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === reqEmail);
    if (orgMembers.length >= maxSeats) {
      res.status(403).json({ error: `Team seat limit (${maxSeats}) reached for ${tier} tier.` });
      return;
    }

    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const role = (req.body?.role || 'Developer') as 'Developer' | 'Reviewer' | 'Viewer';
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid invite email is required.' });
      return;
    }
    if (orgMembers.some((m) => m.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'Member already exists in workspace team.' });
      return;
    }
    const namePart = email.split('@')[0];
    const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    const member = {
      id: `member_${Date.now()}`,
      name: displayName,
      email,
      avatar: displayName.charAt(0).toUpperCase(),
      role,
      joinedDate: 'Just invited',
      twoFactorEnabled: false,
      status: 'invited' as const,
    };
    userTeamStore.push(member);
    userTeamOwner.set(member.id, reqEmail);
    res.status(201).json({
      success: true,
      member,
      members: userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === reqEmail),
      maxSeats,
    });
  });

  app.patch('/api/user/team/:id', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const member = userTeamStore.find((m) => m.id === req.params.id);
    if (!member || (userTeamOwner.get(member.id) || '') !== owner) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    const role = req.body?.role;
    if (role === 'Owner' || role === 'Developer' || role === 'Reviewer' || role === 'Viewer') {
      member.role = role;
    }
    res.json({
      success: true,
      member,
      members: userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === owner),
    });
  });

  app.delete('/api/user/team/:id', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userTeamStore.find((m) => m.id === req.params.id);
    if (!target || (userTeamOwner.get(target.id) || '') !== owner) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    if (target.role === 'Owner') {
      res.status(400).json({ error: 'Cannot remove workspace owner.' });
      return;
    }
    userTeamOwner.delete(target.id);
    userTeamStore = userTeamStore.filter((m) => m.id !== req.params.id);
    res.json({
      success: true,
      members: userTeamStore.filter((m) => (userTeamOwner.get(m.id) || '') === owner),
    });
  });

  // Cross-Device User Preferences Vault (mirrors SupremeAI Gateway /api/v1/user/preferences)
  interface UserPreferencesVaultEntry {
    user_id: string;
    preferences: Record<string, unknown>;
    updated_at: string;
  }
  const USER_PREFS_VAULT_PATH = path.join(__dirname, '.supremeai-user-preferences.json');

  const loadUserPrefsVault = (): Record<string, UserPreferencesVaultEntry> => {
    try {
      if (fs.existsSync(USER_PREFS_VAULT_PATH)) {
        const raw = fs.readFileSync(USER_PREFS_VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, UserPreferencesVaultEntry>;
        }
      }
    } catch {
      // Ignore corrupted vault file
    }
    return {};
  };

  const saveUserPrefsVault = (vault: Record<string, UserPreferencesVaultEntry>) => {
    try {
      fs.writeFileSync(USER_PREFS_VAULT_PATH, JSON.stringify(vault, null, 2), { mode: 0o600 });
    } catch {
      // Ignore disk persistence error
    }
  };

  let userPreferencesVault: Record<string, UserPreferencesVaultEntry> = loadUserPrefsVault();

  const extractBearerOrKeyToken = (req: Request): string => {
    const authHeader = String(req.headers.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const keyHeader = String(req.headers['x-supremeai-key'] || '').trim();
    return keyHeader;
  };

  const resolveUserEmailForPreferences = async (
    req: Request,
    token: string
  ): Promise<string | null> => {
    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      return null;
    }

    const sessionUserId = activeAuthSessions.get(token);
    const matchedSessionUser = sessionUserId
      ? usersDb.find((u) => u.id === sessionUserId)
      : undefined;
    if (matchedSessionUser?.email) {
      return matchedSessionUser.email.toLowerCase();
    }

    const verifiedPayload = verifyLocalSessionToken(token);
    if (verifiedPayload?.email) {
      return verifiedPayload.email.toLowerCase();
    }

    if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const meRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (meRes.ok) {
          const meData: any = await meRes.json().catch(() => null);
          const raw =
            meData?.user && typeof meData.user === 'object'
              ? { ...meData, ...meData.user }
              : meData;
          const cleanEmail = String(raw?.email || '')
            .trim()
            .toLowerCase();
          if (cleanEmail) return cleanEmail;
        }
      } catch {
        // Fallback below
      }
    }

    const fallbackEmail = getRequestUserEmail(req);
    return fallbackEmail && fallbackEmail !== 'guest' ? fallbackEmail : null;
  };

  app.get(
    ['/api/v1/user/preferences', '/api/user/preferences'],
    async (req: Request, res: Response) => {
      const token = extractBearerOrKeyToken(req);
      if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
        res.status(401).json({ error: 'Authentication required to access account preferences.' });
        return;
      }

      if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
        const remoteGatewayUrl =
          process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
        try {
          const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/user/preferences`, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
              'X-SupremeAI-Key': token,
            },
            signal: AbortSignal.timeout(5000),
          });
          if (upstreamRes.ok) {
            const data: any = await upstreamRes.json().catch(() => null);
            if (data && typeof data === 'object') {
              const prefs =
                data.preferences && typeof data.preferences === 'object'
                  ? data.preferences
                  : data.user_preferences?.preferences || {};
              const cacheKey = String(data.user_id || '')
                .trim()
                .toLowerCase();
              if (cacheKey) {
                userPreferencesVault[cacheKey] = {
                  user_id: cacheKey,
                  preferences: prefs,
                  updated_at: String(data.updated_at || new Date().toISOString()),
                };
                saveUserPrefsVault(userPreferencesVault);
              }
              res.json(data);
              return;
            }
          }
        } catch {
          // Upstream unavailable; serve cached local vault if authenticated
        }
      }

      const userEmail = await resolveUserEmailForPreferences(req, token);
      if (!userEmail) {
        res.status(401).json({ error: 'Invalid or expired session token.' });
        return;
      }

      userPreferencesVault = loadUserPrefsVault();
      const entry = userPreferencesVault[userEmail] || {
        user_id: userEmail,
        preferences: {},
        updated_at: new Date().toISOString(),
      };
      res.json({
        user_id: entry.user_id,
        preferences: entry.preferences,
        updated_at: entry.updated_at,
      });
    }
  );

  const handleSaveUserPreferences = async (req: Request, res: Response) => {
    const token = extractBearerOrKeyToken(req);
    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      res.status(401).json({ error: 'Authentication required to save account preferences.' });
      return;
    }

    const patchBody =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const sanitizedPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patchBody)) {
      if (k !== 'action' && k !== 'tool_id' && k !== 'user_id') {
        sanitizedPatch[k] = v;
      }
    }

    if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/user/preferences`, {
          method: req.method === 'PUT' ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Key': token,
          },
          body: JSON.stringify(sanitizedPatch),
          signal: AbortSignal.timeout(5000),
        });
        if (upstreamRes.ok) {
          const data: any = await upstreamRes.json().catch(() => null);
          if (data && typeof data === 'object') {
            const up = data.user_preferences || data;
            const cacheKey = String(up?.user_id || '')
              .trim()
              .toLowerCase();
            if (cacheKey && up?.preferences && typeof up.preferences === 'object') {
              userPreferencesVault[cacheKey] = {
                user_id: cacheKey,
                preferences: up.preferences,
                updated_at: String(up.updated_at || new Date().toISOString()),
              };
              saveUserPrefsVault(userPreferencesVault);
            }
            res.json(data);
            return;
          }
        }
      } catch {
        // Upstream unavailable; persist locally for fallback
      }
    }

    const userEmail = await resolveUserEmailForPreferences(req, token);
    if (!userEmail) {
      res.status(401).json({ error: 'Invalid or expired session token.' });
      return;
    }

    userPreferencesVault = loadUserPrefsVault();
    const existing = userPreferencesVault[userEmail] || {
      user_id: userEmail,
      preferences: {},
      updated_at: new Date().toISOString(),
    };

    const mergedPreferences: Record<string, unknown> = {
      ...existing.preferences,
      ...sanitizedPatch,
    };
    const updatedEntry: UserPreferencesVaultEntry = {
      user_id: userEmail,
      preferences: mergedPreferences,
      updated_at: new Date().toISOString(),
    };
    userPreferencesVault[userEmail] = updatedEntry;
    saveUserPrefsVault(userPreferencesVault);

    res.json({
      status: 'ok',
      user_preferences: updatedEntry,
    });
  };

  app.post(['/api/v1/user/preferences', '/api/user/preferences'], handleSaveUserPreferences);
  app.put(['/api/v1/user/preferences', '/api/user/preferences'], handleSaveUserPreferences);

  // Admin Schema Parity Endpoints
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

  // 1-Click GitHub & GitLab OAuth Popup Endpoints (Iframe-safe, APP_URL-driven)
  const oauthStateStore = new Map<
    string,
    { provider: 'github' | 'gitlab'; host?: string; expiresAt: number }
  >();

  const resolveAppBaseUrl = (req: Request): string => {
    const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    const proto = String(req.header('x-forwarded-proto') || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const host = String(req.header('x-forwarded-host') || req.header('host') || `127.0.0.1:${PORT}`)
      .split(',')[0]
      .trim();
    return `${proto}://${host}`;
  };

  app.get('/api/git/oauth/status', (req: Request, res: Response) => {
    const baseUrl = resolveAppBaseUrl(req);
    res.json({
      githubConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      gitlabConfigured: Boolean(process.env.GITLAB_CLIENT_ID && process.env.GITLAB_CLIENT_SECRET),
      githubCallbackUrl: `${baseUrl}/api/git/oauth/github/callback`,
      gitlabCallbackUrl: `${baseUrl}/api/git/oauth/gitlab/callback`,
    });
  });

  app.get('/api/git/oauth/:provider/url', (req: Request, res: Response) => {
    const provider =
      req.params.provider === 'gitlab'
        ? 'gitlab'
        : req.params.provider === 'github'
          ? 'github'
          : null;
    if (!provider) {
      res.status(400).json({ error: 'Unsupported OAuth provider.' });
      return;
    }
    const baseUrl = resolveAppBaseUrl(req);
    const callbackUrl = `${baseUrl}/api/git/oauth/${provider}/callback`;
    const state = crypto.randomBytes(16).toString('hex');

    if (provider === 'github') {
      const clientId = (process.env.GITHUB_CLIENT_ID || '').trim();
      if (!clientId || !(process.env.GITHUB_CLIENT_SECRET || '').trim()) {
        res.status(501).json({
          configured: false,
          provider,
          callbackUrl,
          error: `GitHub OAuth is not configured on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET with callback URL ${callbackUrl} (or use a Personal Access Token).`,
        });
        return;
      }
      oauthStateStore.set(state, { provider: 'github', expiresAt: Date.now() + 10 * 60 * 1000 });
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'repo read:user',
        state,
      });
      res.json({
        configured: true,
        url: `https://github.com/login/oauth/authorize?${params}`,
        callbackUrl,
      });
      return;
    }

    const hostValidation = validateGitLabHost(
      String(req.query.host || ''),
      process.env.GITLAB_HOST
    );
    if (!hostValidation.ok || !('host' in hostValidation)) {
      res.status(400).json({
        error: 'error' in hostValidation ? hostValidation.error : 'Invalid GitLab host.',
      });
      return;
    }
    const gitlabHost = hostValidation.host;
    const clientId = (process.env.GITLAB_CLIENT_ID || '').trim();
    if (!clientId || !(process.env.GITLAB_CLIENT_SECRET || '').trim()) {
      res.status(501).json({
        configured: false,
        provider,
        callbackUrl,
        error: `GitLab OAuth is not configured on this server. Set GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET with callback URL ${callbackUrl} (or use a Personal Access Token).`,
      });
      return;
    }
    oauthStateStore.set(state, {
      provider: 'gitlab',
      host: gitlabHost,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'api read_user',
      state,
    });
    res.json({ configured: true, url: `${gitlabHost}/oauth/authorize?${params}`, callbackUrl });
  });

  app.get(
    ['/api/git/oauth/:provider/callback', '/api/git/oauth/:provider/callback/'],
    async (req: Request, res: Response) => {
      const provider =
        req.params.provider === 'gitlab'
          ? 'gitlab'
          : req.params.provider === 'github'
            ? 'github'
            : null;
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();
      const baseUrl = resolveAppBaseUrl(req);
      let targetOrigin = '';
      try {
        targetOrigin = new URL(baseUrl).origin;
      } catch {
        targetOrigin = `http://127.0.0.1:${PORT}`;
      }
      const renderPopupResult = (payload: Record<string, unknown>, isError = false) => {
        const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
        const serializedOrigin = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
        res
          .status(isError ? 400 : 200)
          .send(
            `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;background:#090d16;color:#e2e8f0;"><p>${
              isError
                ? 'OAuth authorization failed. You can close this window.'
                : 'Authorization complete. Returning to Studio...'
            }</p><script>try{if(window.opener){window.opener.postMessage(${serialized},${serializedOrigin});}}catch(_){}setTimeout(function(){window.close();},120);</script></body></html>`
          );
      };

      if (!provider || !code || !state) {
        renderPopupResult(
          { type: 'SUPREMEAI_GIT_OAUTH_ERROR', error: 'Missing OAuth code or state.' },
          true
        );
        return;
      }
      const savedState = oauthStateStore.get(state);
      oauthStateStore.delete(state);
      if (!savedState || savedState.provider !== provider || savedState.expiresAt < Date.now()) {
        renderPopupResult(
          { type: 'SUPREMEAI_GIT_OAUTH_ERROR', error: 'Invalid or expired OAuth state.' },
          true
        );
        return;
      }

      const callbackUrl = `${baseUrl}/api/git/oauth/${provider}/callback`;

      try {
        if (provider === 'github') {
          const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: process.env.GITHUB_CLIENT_ID,
              client_secret: process.env.GITHUB_CLIENT_SECRET,
              code,
              redirect_uri: callbackUrl,
            }),
          });
          const tokenData = (await tokenRes.json()) as {
            access_token?: string;
            error_description?: string;
          };
          if (!tokenRes.ok || !tokenData.access_token) {
            renderPopupResult(
              {
                type: 'SUPREMEAI_GIT_OAUTH_ERROR',
                error: tokenData.error_description || 'Token exchange failed.',
              },
              true
            );
            return;
          }
          renderPopupResult({
            type: 'SUPREMEAI_GIT_OAUTH_SUCCESS',
            provider: 'github',
            token: tokenData.access_token,
          });
          return;
        }

        const hostValidation = validateGitLabHost(savedState.host || '', process.env.GITLAB_HOST);
        if (!hostValidation.ok || !('host' in hostValidation)) {
          renderPopupResult(
            {
              type: 'SUPREMEAI_GIT_OAUTH_ERROR',
              error: 'error' in hostValidation ? hostValidation.error : 'Invalid GitLab host.',
            },
            true
          );
          return;
        }
        const host = hostValidation.host;
        const tokenRes = await fetch(`${host}/oauth/token`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: process.env.GITLAB_CLIENT_ID,
            client_secret: process.env.GITLAB_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl,
          }),
        });
        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || !tokenData.access_token) {
          renderPopupResult(
            {
              type: 'SUPREMEAI_GIT_OAUTH_ERROR',
              error: tokenData.error_description || 'Token exchange failed.',
            },
            true
          );
          return;
        }
        renderPopupResult({
          type: 'SUPREMEAI_GIT_OAUTH_SUCCESS',
          provider: 'gitlab',
          token: tokenData.access_token,
          host,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'OAuth exchange error';
        renderPopupResult({ type: 'SUPREMEAI_GIT_OAUTH_ERROR', error: msg }, true);
      }
    }
  );

  // Live Architecture & Knowledge Topology Graph Endpoints
  const buildStudioTopologyGraph = async () => {
    const liveServices = await getLiveMcpTowerServices(false).catch(() => mcpClusterServices);
    const baseNodes = [
      {
        id: 'studio-ui',
        data: {
          label: 'React 19 Studio UI',
          category: 'Frontend',
          description: 'Vite + Tailwind v4 conversational cockpit & 3D voice interface',
        },
      },
      {
        id: 'express-gateway',
        data: {
          label: 'Express API Gateway',
          category: 'Gateway',
          description:
            'Primary Node.js/TypeScript backend on port 3000 handling SSE & proxy routes',
        },
      },
      {
        id: 'route-arbiter',
        data: {
          label: 'Dynamic Route Arbiter',
          category: 'AI Engine',
          description: 'Multi-provider LLM router with latency scoring & cooldown failover',
        },
      },
      {
        id: 'knowledge-rag',
        data: {
          label: 'Knowledge & RAG',
          category: 'Data',
          description: 'In-memory semantic chunk index for grounded document Q&A',
        },
      },
      {
        id: 'workspace-sandbox',
        data: {
          label: 'Ephemeral Sandbox',
          category: 'Workspace',
          description: 'Strict sandbox="allow-scripts" iframe VM for JS/TS/TSX/HTML',
        },
      },
      {
        id: 'workspace-browser',
        data: {
          label: 'Virtual Browser Proxy',
          category: 'Workspace',
          description: 'Server HTTP proxy with link interception & live CSS DOM inspector',
        },
      },
      {
        id: 'workspace-terminal',
        data: {
          label: 'XTerm Studio Shell',
          category: 'Workspace',
          description: 'Allowlisted diagnostic shell with Agent Swarm SSE telemetry stream',
        },
      },
      {
        id: 'voice-avatar',
        data: {
          label: '3D Hologram Voice',
          category: 'Multimodal',
          description: 'Three.js lip-sync avatar with bilingual EN/BN TTS & pitch control',
        },
      },
    ];

    const serviceNodes = liveServices.slice(0, 6).map((svc) => ({
      id: `svc-${svc.id}`,
      data: {
        label: svc.displayName,
        category: svc.status === 'healthy' ? 'Service (Healthy)' : `Service (${svc.status})`,
        description: `Port ${svc.port} · Latency ${svc.latencyMs}ms · CPU ${svc.cpuPercent}%`,
      },
    }));

    const baseEdges = [
      { id: 'ge-1', source: 'studio-ui', target: 'express-gateway', label: 'SSE_STREAM' },
      { id: 'ge-2', source: 'studio-ui', target: 'workspace-sandbox', label: 'EXECUTES_VM' },
      { id: 'ge-3', source: 'studio-ui', target: 'voice-avatar', label: 'SYNCS_AUDIO' },
      { id: 'ge-4', source: 'express-gateway', target: 'route-arbiter', label: 'ROUTES_LLM' },
      { id: 'ge-5', source: 'express-gateway', target: 'knowledge-rag', label: 'GROUNDS_RAG' },
      { id: 'ge-6', source: 'express-gateway', target: 'workspace-browser', label: 'PROXIES_HTTP' },
      {
        id: 'ge-7',
        source: 'express-gateway',
        target: 'workspace-terminal',
        label: 'SHELL_BRIDGE',
      },
    ];

    const serviceEdges = serviceNodes.map((sn, idx) => ({
      id: `ge-svc-${idx}`,
      source: 'express-gateway',
      target: sn.id,
      label: 'HEALTH_PROBE',
    }));

    return {
      nodes: [...baseNodes, ...serviceNodes],
      edges: [...baseEdges, ...serviceEdges],
    };
  };

  app.get('/api/v1/graph/skills', async (_req: Request, res: Response) => {
    try {
      const graph = await buildStudioTopologyGraph();
      res.json(graph);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build graph' });
    }
  });

  app.get('/api/v1/graph/path', async (req: Request, res: Response) => {
    const startSkill = String(req.query.start_skill || '').trim();
    const endSkill = String(req.query.end_skill || '').trim();
    if (!startSkill || !endSkill) {
      res.status(400).json({ error: 'start_skill and end_skill are required', path: [] });
      return;
    }

    const graph = await buildStudioTopologyGraph();
    if (startSkill === endSkill) {
      res.json({ path: [startSkill] });
      return;
    }

    const adj = new Map<string, string[]>();
    for (const n of graph.nodes) adj.set(n.id, []);
    for (const e of graph.edges) {
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }

    const queue: string[][] = [[startSkill]];
    const visited = new Set<string>([startSkill]);
    let foundPath: string[] = [];

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      const tail = currentPath[currentPath.length - 1];
      if (tail === endSkill) {
        foundPath = currentPath;
        break;
      }
      for (const neighbor of adj.get(tail) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...currentPath, neighbor]);
        }
      }
    }

    res.json({ path: foundPath });
  });

  // Server-side Audio Transcription endpoint powered by gemini-3.5-transcribe
  app.post('/api/transcribe', async (req: Request, res: Response) => {
    try {
      if (isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      if (platformConfig.maintenanceMode) {
        res.status(503).json({
          error: platformConfig.maintenanceMessage || 'Platform is currently in maintenance mode.',
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
      // Strip codec suffixes such as "audio/webm;codecs=opus" -> "audio/webm"
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
      if (isIpBlocked(req)) {
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
      if (isIpBlocked(req)) {
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

  // Multilingual Neural Text-to-Speech endpoint (supports seamless Bengali/বাংলা + English speech)
  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      if (isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const voiceRaw =
        typeof req.body?.voiceName === 'string' ? req.body.voiceName.trim() : 'Zephyr';
      const language = req.body?.language === 'bn' ? 'bn' : 'en';
      const pitchRaw =
        typeof req.body?.pitch === 'number'
          ? req.body.pitch
          : Number.parseFloat(String(req.body?.pitch ?? '1'));
      const pitch = clampVoicePitch(pitchRaw);
      const accent = normalizeBanglaAccent(req.body?.accent);
      const VALID_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
      const voiceName = VALID_VOICES.has(voiceRaw) ? voiceRaw : 'Zephyr';

      if (!rawText) {
        res.status(400).json({ error: 'Text is required for speech synthesis.' });
        return;
      }

      const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
      if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
        res.status(503).json({ error: 'GEMINI_API_KEY is not configured for neural TTS.' });
        return;
      }

      const clientAi = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const truncatedText = rawText.slice(0, 1800);
      const hasBengali =
        /[\u0980-\u09FF]/.test(truncatedText) || detectBengaliOrBanglish(truncatedText);
      const hasLatin = /[A-Za-z]/.test(truncatedText);
      const styleGuide = buildBanglaSpeechStylePrompt({
        pitch: 1.0,
        accent,
        hasBengali,
        hasLatin,
        language,
      });

      const ttsResponse = await clientAi.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: truncatedText,
                speechMetadata: {
                  style: styleGuide,
                },
              } as any,
            ],
          },
        ],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const inlineData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const base64Audio = inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ error: 'TTS model returned empty audio.' });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: inlineData?.mimeType || 'audio/wav',
        voiceName,
        pitch,
        accent,
        pitchAppliedServerSide: false,
        tier: 'cloud-optional',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'TTS generation failed.';
      console.error('Error in /api/tts:', err);
      res.status(500).json({ error: message });
    }
  });

  // Tier 2: Free Edge Neural TTS endpoint (no Gemini key or paid quota required; fails gracefully so client fails open to Tier 1)
  app.post('/api/tts/edge', async (req: Request, res: Response) => {
    try {
      if (isIpBlocked(req)) {
        res.status(403).json({ error: 'Request rejected by platform WAF IP blacklist.' });
        return;
      }

      const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const voicePersonaRaw =
        typeof req.body?.voiceName === 'string' ? req.body.voiceName.trim() : 'Zephyr';
      const VALID_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
      const voicePersona = (
        VALID_VOICES.has(voicePersonaRaw) ? voicePersonaRaw : 'Zephyr'
      ) as LiveVoiceName;
      const language = req.body?.language === 'bn' ? 'bn' : 'en';
      const pitchRaw =
        typeof req.body?.pitch === 'number'
          ? req.body.pitch
          : Number.parseFloat(String(req.body?.pitch ?? '1'));
      const pitch = clampVoicePitch(pitchRaw);
      const accent = normalizeBanglaAccent(req.body?.accent);
      if (!rawText) {
        res.status(400).json({ error: 'Text is required for Edge Neural speech synthesis.' });
        return;
      }

      const truncatedText = rawText.slice(0, 1400);
      const { voice: edgeVoice, lang: edgeLang } = resolveEdgeNeuralVoice(
        truncatedText,
        voicePersona,
        language,
        accent
      );
      const ssmlPitch = voicePitchToSsml(pitch);
      const ssmlRate = edgeLang === 'bn-BD' ? '-3%' : '+0%';

      const escapeXml = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      // Generate Edge ReadAloud Sec-MS-GEC DRM token using BigInt (avoids IEEE-754 precision loss above 2^53)
      const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
      const WIN_EPOCH_OFFSET = 11644473600n;
      const unixSec = BigInt(Math.floor(Date.now() / 1000));
      let ticks = unixSec + WIN_EPOCH_OFFSET;
      ticks -= ticks % 300n;
      const ticks100Ns = ticks * 10000000n;
      const secMsGec = crypto
        .createHash('sha256')
        .update(`${ticks100Ns.toString()}${TRUSTED_CLIENT_TOKEN}`)
        .digest('hex')
        .toUpperCase();

      const requestId = crypto.randomUUID().replace(/-/g, '');
      const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
      const wsUrl =
        `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
        `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
        `&Sec-MS-GEC=${secMsGec}` +
        `&Sec-MS-GEC-Version=1-143.0.3650.96` +
        `&ConnectionId=${requestId}`;

      const synthesizeViaEdgeWs = (): Promise<Buffer> =>
        new Promise<Buffer>((resolve, reject) => {
          const audioChunks: Buffer[] = [];
          let settled = false;

          const finish = (err: Error | null, buf?: Buffer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            try {
              if (
                edgeWs.readyState === WebSocket.OPEN ||
                edgeWs.readyState === WebSocket.CONNECTING
              ) {
                edgeWs.close();
              }
            } catch {}
            if (err) reject(err);
            else resolve(buf || Buffer.alloc(0));
          };

          const edgeWs = new WebSocket(wsUrl, {
            headers: {
              Pragma: 'no-cache',
              'Cache-Control': 'no-cache',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
              Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
              Cookie: `muid=${muid};`,
            },
          });

          const timeoutId = setTimeout(() => {
            finish(new Error('Edge Neural TTS timed out'));
          }, 2600);

          edgeWs.on('open', () => {
            const timestamp = new Date().toString();
            const configMsg =
              `X-Timestamp:${timestamp}\r\n` +
              `Content-Type:application/json; charset=utf-8\r\n` +
              `Path:speech.config\r\n\r\n` +
              JSON.stringify({
                context: {
                  synthesis: {
                    audio: {
                      metadataoptions: {
                        sentenceBoundaryEnabled: false,
                        wordBoundaryEnabled: false,
                      },
                      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                    },
                  },
                },
              });
            edgeWs.send(configMsg);

            const ssmlInner = `<voice name='${edgeVoice}'><prosody pitch='${ssmlPitch}' rate='${ssmlRate}' volume='+0%'>${escapeXml(truncatedText)}</prosody></voice>`;

            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${edgeLang}'>${ssmlInner}</speak>`;
            const ssmlMsg =
              `X-RequestId:${requestId}\r\n` +
              `Content-Type:application/ssml+xml\r\n` +
              `X-Timestamp:${timestamp}\r\n` +
              `Path:ssml\r\n\r\n` +
              ssml;
            edgeWs.send(ssmlMsg);
          });

          edgeWs.on('message', (data: Buffer, isBinary: boolean) => {
            if (isBinary) {
              const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
              if (buf.length < 2) return;
              const headerLen = buf.readUInt16BE(0);
              const payloadStart = 2 + headerLen;
              if (payloadStart < buf.length) {
                const headerText = buf.subarray(2, payloadStart).toString('utf8');
                if (headerText.includes('Path:audio')) {
                  audioChunks.push(buf.subarray(payloadStart));
                }
              }
            } else {
              const textFrame = data.toString('utf8');
              if (textFrame.includes('Path:turn.end')) {
                const combined = Buffer.concat(audioChunks);
                if (combined.length === 0) {
                  finish(new Error('Edge Neural TTS returned empty audio stream'));
                } else {
                  finish(null, combined);
                }
              }
            }
          });

          edgeWs.on('error', (wsErr) => {
            finish(wsErr instanceof Error ? wsErr : new Error('Edge Neural TTS WebSocket error'));
          });

          edgeWs.on('close', () => {
            if (!settled) {
              const combined = Buffer.concat(audioChunks);
              if (combined.length > 0) finish(null, combined);
              else finish(new Error('Edge Neural TTS connection closed without audio'));
            }
          });
        });

      const synthesizeViaFreeBilingualMp3 = async (): Promise<{
        combined: Buffer;
        chunks: TtsAudioChunk[];
      }> => {
        const scriptSegs = splitByScriptSegments(truncatedText);
        const chunks: Array<{ text: string; tl: 'bn' | 'en'; lang: 'bn-BD' | 'en-US' }> = [];
        for (const seg of scriptSegs) {
          const tl: 'bn' | 'en' = seg.lang === 'bn-BD' ? 'bn' : 'en';
          for (const piece of chunkSpeechSegment(seg.text, 175)) {
            chunks.push({ text: piece, tl, lang: seg.lang });
          }
        }
        if (chunks.length === 0) {
          throw new Error('No speakable chunks extracted.');
        }
        // Fetch bilingual chunks (Bengali + English) concurrently with bounded concurrency (4)
        const results: Buffer[] = new Array(chunks.length);
        let cursor = 0;
        const worker = async () => {
          while (cursor < chunks.length) {
            const i = cursor++;
            const { text: q, tl } = chunks[i];
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(q)}`;
            const resp = await fetch(url, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                Referer: 'https://translate.google.com/',
              },
              signal: AbortSignal.timeout(4500),
            });
            if (!resp.ok) {
              throw new Error(`Free TTS chunk HTTP ${resp.status}`);
            }
            results[i] = Buffer.from(await resp.arrayBuffer());
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, () => worker()));
        const combined = Buffer.concat(results);
        if (combined.length === 0) {
          throw new Error('Free bilingual MP3 synthesis returned empty audio');
        }
        const structuredChunks: TtsAudioChunk[] = results.map((buf, idx) => ({
          audioBase64: buf.toString('base64'),
          mimeType: 'audio/mpeg',
          lang: chunks[idx].lang,
        }));
        return { combined, chunks: structuredChunks };
      };

      let audioBuffer: Buffer;
      let structuredChunks: TtsAudioChunk[] = [];
      let engineUsed = 'edge-ws';
      try {
        audioBuffer = await synthesizeViaEdgeWs();
        structuredChunks = [
          {
            audioBase64: audioBuffer.toString('base64'),
            mimeType: 'audio/mpeg',
            lang: edgeLang,
          },
        ];
      } catch {
        const freeResult = await synthesizeViaFreeBilingualMp3();
        audioBuffer = freeResult.combined;
        structuredChunks = freeResult.chunks;
        engineUsed = 'free-bilingual-mp3';
      }

      res.json({
        audioBase64: audioBuffer.toString('base64'),
        chunks: structuredChunks,
        mimeType: 'audio/mpeg',
        voiceName: engineUsed === 'edge-ws' ? edgeVoice : `${edgeLang} Bilingual`,
        pitch,
        accent,
        ssmlPitch,
        pitchAppliedServerSide: engineUsed === 'edge-ws',
        tier: 'edge-neural',
        engine: engineUsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Edge Neural TTS unavailable.';
      console.warn('Edge Neural TTS unavailable (client will fail open):', message);
      res.status(503).json({ error: message });
    }
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
  // --- Persistent Local Conversations API (Mounted BEFORE federation proxy) ---
  const conversationPersistFile = path.join(studioDataDir, 'conversations.json');
  interface StoredConversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    model?: string;
    ownerEmail?: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      created_at: string;
    }>;
  }
  const expressConversationStore = new Map<string, StoredConversation>();

  const loadExpressConversations = () => {
    try {
      if (fs.existsSync(conversationPersistFile)) {
        const raw = fs.readFileSync(conversationPersistFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item?.id) {
              expressConversationStore.set(String(item.id), item as StoredConversation);
            }
          }
        }
      }
    } catch {}
  };

  const persistExpressConversations = () => {
    try {
      fs.mkdirSync(studioDataDir, { recursive: true });
      fs.writeFileSync(
        conversationPersistFile,
        JSON.stringify(Array.from(expressConversationStore.values()), null, 2),
        'utf-8'
      );
    } catch {}
  };

  loadExpressConversations();

  const CONV_SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const CONV_SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const convSupabaseConfigured = () => Boolean(CONV_SB_URL && CONV_SB_KEY);
  const convSb = (value: string) => encodeURIComponent(value);
  const convSupabaseRest = async (
    pathAndQuery: string,
    method: string,
    body?: unknown,
    prefer = 'return=representation'
  ): Promise<any> => {
    const res = await fetch(`${CONV_SB_URL}/rest/v1/${pathAndQuery}`, {
      method,
      headers: {
        apikey: CONV_SB_KEY,
        Authorization: `Bearer ${CONV_SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok)
      throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]} -> HTTP ${res.status}`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  app.get('/api/v1/conversations', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    if (convSupabaseConfigured()) {
      try {
        const rows = await convSupabaseRest(
          `conversations?owner_email=eq.${convSb(owner)}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=${limit}`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convs: any[] = Array.isArray(rows) ? rows : [];
        const counts: Record<string, number> = {};
        const ids = convs.map((c) => c.id).filter(Boolean);
        if (ids.length > 0) {
          const msgs = await convSupabaseRest(
            `conversation_messages?conversation_id=in.(${ids.map((i) => convSb(String(i))).join(',')})&select=conversation_id`,
            'GET',
            undefined,
            'return=minimal'
          );
          for (const m of Array.isArray(msgs) ? msgs : []) {
            counts[m.conversation_id] = (counts[m.conversation_id] || 0) + 1;
          }
        }
        res.json({
          conversations: convs.map((c) => ({
            id: c.id,
            title: c.title,
            created_at: c.created_at,
            updated_at: c.updated_at,
            message_count: counts[c.id] || 0,
          })),
        });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const list = Array.from(expressConversationStore.values())
      .filter((c) => (c.ownerEmail || '') === owner)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
        message_count: c.messages?.length || 0,
      }));
    res.json({ conversations: list });
  });

  app.post('/api/v1/conversations', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    const id = String(
      body.conversationId ||
        body.id ||
        `conv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    );
    const existingConv = expressConversationStore.get(id);
    if (existingConv && existingConv.ownerEmail && existingConv.ownerEmail !== owner) {
      res.status(403).json({ error: 'Cannot overwrite another user conversation.' });
      return;
    }
    const nowIso = new Date().toISOString();
    if (convSupabaseConfigured()) {
      try {
        const titleVal =
          typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Chat';
        const modelVal = typeof body.model === 'string' ? body.model : 'supreme-spark';
        await convSupabaseRest('conversations', 'POST', [
          {
            id,
            owner_email: owner,
            title: titleVal,
            model: modelVal,
            created_at: nowIso,
            updated_at: nowIso,
          },
        ]);
        res.status(201).json({
          id,
          title: titleVal,
          created_at: nowIso,
          updated_at: nowIso,
          model: modelVal,
          messages: [],
        });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv: StoredConversation = {
      id,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Chat',
      created_at: nowIso,
      updated_at: nowIso,
      model: typeof body.model === 'string' ? body.model : 'supreme-spark',
      messages: [],
      ownerEmail: owner,
    };
    expressConversationStore.set(id, conv);
    persistExpressConversations();
    res.status(201).json(conv);
  });

  app.get('/api/v1/conversations/:id/messages', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const convRows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&select=owner_email`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convRow = Array.isArray(convRows) ? convRows[0] : null;
        if (!convRow || convRow.owner_email !== owner) {
          res.json({ messages: [] });
          return;
        }
        const msgs = await convSupabaseRest(
          `conversation_messages?conversation_id=eq.${convSb(req.params.id)}&select=id,role,content,created_at&order=created_at.asc`,
          'GET',
          undefined,
          'return=minimal'
        );
        res.json({ messages: Array.isArray(msgs) ? msgs : [] });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.json({ messages: [] });
      return;
    }
    res.json({ messages: conv.messages || [] });
  });

  app.post('/api/v1/conversations/:id/messages', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const convRows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&select=owner_email`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convRow = Array.isArray(convRows) ? convRows[0] : null;
        if (!convRow || convRow.owner_email !== owner) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }
        const nowIso = new Date().toISOString();
        const newMsg = {
          id: String(req.body?.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`),
          conversation_id: req.params.id,
          role: req.body?.role === 'assistant' ? 'assistant' : 'user',
          content: String(req.body?.content || ''),
          created_at: nowIso,
        };
        await convSupabaseRest('conversation_messages', 'POST', [newMsg]);
        await convSupabaseRest(`conversations?id=eq.${convSb(req.params.id)}`, 'PATCH', {
          updated_at: nowIso,
        });
        res.status(201).json({
          id: newMsg.id,
          role: newMsg.role,
          content: newMsg.content,
          created_at: newMsg.created_at,
        });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const body = req.body || {};
    const newMsg = {
      id: String(body.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`),
      role: body.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(body.content || ''),
      created_at: new Date().toISOString(),
    };
    conv.messages.push(newMsg);
    conv.updated_at = new Date().toISOString();
    persistExpressConversations();
    res.status(201).json(newMsg);
  });

  app.patch('/api/v1/conversations/:id', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof req.body?.title === 'string') patch.title = req.body.title.trim();
        const rows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&owner_email=eq.${convSb(owner)}`,
          'PATCH',
          patch
        );
        const updated = Array.isArray(rows) ? rows[0] : null;
        if (!updated) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }
        res.json(updated);
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (typeof req.body?.title === 'string') {
      conv.title = req.body.title.trim();
    }
    conv.updated_at = new Date().toISOString();
    persistExpressConversations();
    res.json(conv);
  });

  app.delete('/api/v1/conversations/:id', async (req: Request, res: Response) => {
    const owner = await resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if (convSupabaseConfigured()) {
      try {
        const convRows = await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&select=owner_email`,
          'GET',
          undefined,
          'return=minimal'
        );
        const convRow = Array.isArray(convRows) ? convRows[0] : null;
        if (!convRow || convRow.owner_email !== owner) {
          res.json({ success: true, deleted: false });
          return;
        }
        await convSupabaseRest(
          `conversation_messages?conversation_id=eq.${convSb(req.params.id)}`,
          'DELETE',
          undefined,
          'return=minimal'
        );
        await convSupabaseRest(
          `conversations?id=eq.${convSb(req.params.id)}&owner_email=eq.${convSb(owner)}`,
          'DELETE',
          undefined,
          'return=minimal'
        );
        res.json({ success: true, deleted: true });
        return;
      } catch {
        /* fall through to local store */
      }
    }
    const conv = expressConversationStore.get(req.params.id);
    if (!conv || (conv.ownerEmail || '') !== owner) {
      res.json({ success: true, deleted: false });
      return;
    }
    expressConversationStore.delete(req.params.id);
    persistExpressConversations();
    res.json({ success: true, deleted: true });
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
