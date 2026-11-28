import {
  ChatAttachment,
  KnowledgeDoc,
  ModelDetail,
  PlatformConfig,
  PlanTier,
  UserRole,
  WorkbenchThinkingLevel,
} from '../types';
import type { ProjectRuntime } from './artifactStreamParser';

const TIER_RANK: Record<PlanTier, number> = {
  Free: 0,
  Pro: 1,
  Enterprise: 2,
};

const BUILD_OR_CODE_ASCII =
  /\b(build|create|make|design|generate|refactor|debug|fix|component|dashboard|landing\s*page|ecommerce|e-commerce|website|web\s*app|project|portfolio|todo|saas|game|backend|server|calculator|cms|crm|php|laravel|flask|django|express|node|react|tsx|jsx|html|css|tailwind|typescript|javascript|python|sql|api|endpoint|schema|database|chart|diagram|mermaid|app|ui|ux)\b/i;

const BUILD_OR_CODE_BN = /(প্রজেক্ট|অ্যাপ|ওয়েবসাইট|ড্যাশবোর্ড|কোড|বানাও|তৈরি\s*করো|ডিজাইন|পোর্টফোলিও)/;

const PROJECT_BUILD_ASCII =
  /\b(project|multi-file|full-stack|ecommerce|e-commerce|dashboard|web\s*app|website|saas|portfolio|php|laravel|flask|django|express|todo|calculator|cms|crm|backend\s*app|game|app)\b/i;

const PROJECT_BUILD_BN = /(প্রজেক্ট|অ্যাপ|ড্যাশবোর্ড|ওয়েবসাইট|পোর্টফোলিও)/;

const EXPLICIT_CODE_ACTION =
  /\b(build|create|make|design|generate|refactor|debug|fix|write\s+code|implement)\b|(বানাও|তৈরি\s*করো|কোড|ডিজাইন)/i;

const DEEP_REASONING_ASCII =
  /\b(architect(?:ure)?|security\s*audit|vulnerabilit(?:y|ies)|proof|theorem|algorithm|complexity|root\s*cause|multi-file|distributed|race\s*condition|invariant|benchmark)\b/i;

const DEEP_REASONING_BN = /(আর্কিটেকচার|অডিট|নিরাপত্তা|রুট\s*কজ)/;

const HIGH_THINKING_ANALYTICAL_ASCII =
  /\b(analyze|analyse|trade-?offs?|compare|step[\s-]+by[\s-]+step|why\s+does|optimize|diagnose|debug|refactor|system\s+design|evaluate|critique|strategy|deep\s*dive|reasoning)\b/i;

const HIGH_THINKING_ANALYTICAL_BN = /(বিশ্লেষণ|তুলনা|ধাপে\s*ধাপে|অপটিমাইজ|ডিবাগ|কৌশল|কেন\s*এমন|যুক্তি)/;

const LIVE_WEB_ASCII =
  /\b(latest|today|current(?:ly)?|news|price|prices|weather|stock|stocks|score|scores|live|browse|recent|now|latest\s+version|new\s+release|open\s+https?:\/\/|visit\s+[a-z0-9.-]+\.[a-z]{2,})\b/i;

const LIVE_WEB_BN = /(সর্বশেষ|আজকের|আজ|খবর|দাম|আবহাওয়া|ভার্সন|রিলিজ|এখনকার)/;

const DEEP_RESEARCH_ASCII =
  /\b(deep\s*research|comprehensive\s*(?:research\s*)?report|in-depth\s*(?:research|market|competitive)\s*analysis|citation(?:-ready)?\s*report|literature\s*review)\b/i;

const DEEP_RESEARCH_BN = /(গভীর\s*রিসার্চ|রিসার্চ\s*রিপোর্ট|বিস্তারিত\s*গবেষণা|তুলনামূলক\s*গবেষণা)/;

const KNOWLEDGE_REFERENCE_ASCII =
  /\b(knowledge\s*base|rag|uploaded\s*(?:file|doc|document|pdf)|my\s*(?:docs?|files?|notes?)|company\s*(?:policy|handbook|docs?)|internal\s*(?:spec|docs?)|based\s+on\s+(?:our|the|my)\s+(?:docs?|files?|playbook|spec|guide))\b/i;

const KNOWLEDGE_REFERENCE_BN = /(ডকুমেন্ট|ফাইল\s*থেকে|নথি|আমাদের\s*ডক|জ্ঞানভাণ্ডার)/;

const JSON_OUTPUT_ASCII =
  /\b(respond\s+(?:only\s+)?in\s+json|return\s+(?:only\s+|a\s+)?(?:valid\s+)?json|output\s+(?:only\s+|valid\s+)?json|json\s+schema\s+output|strict\s+json(?:\s+format)?|json\s+format\s+only)\b/i;

const JSON_OUTPUT_BN = /(শুধু\s*JSON|JSON\s*ফরম্যাটে|JSON\s*আকারে\s*(?:দাও|উত্তর))/i;

export interface SmartIntentResult {
  enableRag: boolean;
  matchedDocs: KnowledgeDoc[];
  ragReason: 'explicit-active' | 'title-match' | 'topic-match' | 'knowledge-query' | 'none';
  enableDeepResearch: boolean;
  enableLiveArtifactSync: boolean;
  enableProjectBuilder: boolean;
  projectRuntimeHint: Exclude<ProjectRuntime, 'static'> | null;
  recommendedModelId: string;
  recommendedThinkingLevel: WorkbenchThinkingLevel;
  enableSearchGrounding: boolean;
  enableJsonOutput: boolean;
}

function isModelAllowed(
  model: ModelDetail,
  config: PlatformConfig | undefined,
  userTier: PlanTier,
  currentRole: UserRole
): boolean {
  if (currentRole === 'admin') return true;
  const policy = config?.modelPolicies?.[model.id];
  if (!policy) return true;
  if (!policy.enabled) return false;
  return TIER_RANK[userTier] >= TIER_RANK[policy.minTier];
}

export function detectProjectRuntimeHint(
  promptText: string
): Exclude<ProjectRuntime, 'static'> | null {
  const t = promptText.toLowerCase();
  if (/\b(php|laravel|symfony|composer|wordpress)\b/.test(t)) return 'php';
  if (/\b(python|flask|fastapi|django|streamlit|pandas)\b/.test(t)) return 'python';
  if (/\b(node\.?js|express|nestjs|fastify)\b/.test(t)) return 'node';
  if (/\b(react|tsx|jsx|vite|next\.?js|tailwind\s*react)\b/.test(t)) return 'react';
  if (
    /\b(html|css|website|landing\s*page|web\s*app|dashboard|portfolio|ecommerce|e-commerce|todo|calculator|game|project)\b/.test(
      t
    ) ||
    PROJECT_BUILD_BN.test(promptText)
  ) {
    return 'web';
  }
  return null;
}

export function resolveAutoModel(params: {
  promptText: string;
  attachment?: ChatAttachment;
  models: ModelDetail[];
  platformConfig?: PlatformConfig;
  userTier?: PlanTier;
  currentRole?: UserRole;
  fallbackModel: ModelDetail;
}): ModelDetail {
  const {
    promptText,
    attachment,
    models,
    platformConfig,
    userTier = 'Pro',
    currentRole = 'user',
    fallbackModel,
  } = params;

  const allowed = models.filter((m) => isModelAllowed(m, platformConfig, userTier, currentRole));
  const pool = allowed.length > 0 ? allowed : models;
  const findFirstAvailable = (preferredIds: string[]): ModelDetail => {
    for (const id of preferredIds) {
      const match = pool.find((m) => m.id === id);
      if (match) return match;
    }
    return pool[0] || fallbackModel;
  };

  const trimmed = promptText.trim();
  const isDeepReasoning = DEEP_REASONING_ASCII.test(trimmed) || DEEP_REASONING_BN.test(trimmed);
  const isBuildOrCode = BUILD_OR_CODE_ASCII.test(trimmed) || BUILD_OR_CODE_BN.test(trimmed);
  const isLiveWeb = LIVE_WEB_ASCII.test(trimmed) || LIVE_WEB_BN.test(trimmed);

  if (isDeepReasoning) {
    return findFirstAvailable(['supreme-reason', 'supreme-deep', 'supreme-core', 'supreme-spark']);
  }

  if (isLiveWeb && !EXPLICIT_CODE_ACTION.test(trimmed) && !attachment) {
    return findFirstAvailable(['supremeai-web', 'supreme-core', 'supreme-spark']);
  }

  if (isBuildOrCode || attachment) {
    const isProjectBuild =
      PROJECT_BUILD_ASCII.test(trimmed) || PROJECT_BUILD_BN.test(trimmed) || trimmed.length > 160;
    if (isProjectBuild) {
      return findFirstAvailable([
        'supreme-deep',
        'supreme-core',
        'supreme-reason',
        'supreme-spark',
      ]);
    }
    return findFirstAvailable(['supreme-core', 'supreme-spark', 'supreme-deep']);
  }

  if (isLiveWeb) {
    return findFirstAvailable(['supremeai-web', 'supreme-core', 'supreme-spark']);
  }

  if (trimmed.length > 260) {
    return findFirstAvailable(['supreme-core', 'supreme-spark']);
  }

  return findFirstAvailable(['supreme-spark', 'supreme-core']);
}

export function shouldAutoTriggerDeepResearch(
  promptText: string,
  attachment?: ChatAttachment
): boolean {
  if (attachment) return false;
  const trimmed = promptText.trim();
  if (!trimmed) return false;
  if (BUILD_OR_CODE_ASCII.test(trimmed) && !DEEP_RESEARCH_ASCII.test(trimmed)) {
    return false;
  }
  return DEEP_RESEARCH_ASCII.test(trimmed) || DEEP_RESEARCH_BN.test(trimmed);
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'what',
  'when',
  'where',
  'which',
  'have',
  'will',
  'your',
  'our',
  'how',
  'can',
  'please',
  'create',
  'build',
  'make',
  'write',
  'explain',
  'check',
]);

function extractTopicTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0980-\u09ff]+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

export function resolveAutoGroundingDocs(
  promptText: string,
  docs: KnowledgeDoc[],
  enableKnowledgeGrounding = true
): KnowledgeDoc[] {
  if (!Array.isArray(docs) || docs.length === 0) return [];
  const explicitlyActive = docs.filter((d) => d.isGroundingActive);
  if (explicitlyActive.length > 0) {
    return explicitlyActive;
  }

  const trimmed = promptText.trim().toLowerCase();
  if (!trimmed) return [];

  const titleMatches = docs.filter((d) => {
    const cleanTitle = d.title.trim().toLowerCase();
    return cleanTitle.length >= 4 && trimmed.includes(cleanTitle);
  });
  if (titleMatches.length > 0) {
    return titleMatches;
  }

  if (
    enableKnowledgeGrounding &&
    (KNOWLEDGE_REFERENCE_ASCII.test(promptText) || KNOWLEDGE_REFERENCE_BN.test(promptText))
  ) {
    return docs.slice(0, 4);
  }

  // Semantic keyword overlap against document title + preview so RAG engages automatically on topic match
  if (enableKnowledgeGrounding) {
    const promptTokens = new Set(extractTopicTokens(trimmed));
    if (promptTokens.size > 0) {
      const scored = docs
        .map((doc) => {
          const docTokens = extractTopicTokens(`${doc.title} ${doc.contentPreview || ''}`);
          let overlap = 0;
          for (const tok of docTokens) {
            if (promptTokens.has(tok)) overlap++;
          }
          return { doc, overlap };
        })
        .filter((x) => x.overlap >= 2)
        .sort((a, b) => b.overlap - a.overlap);

      if (scored.length > 0) {
        return scored.slice(0, 3).map((s) => s.doc);
      }
    }
  }

  return [];
}

/**
 * Zero-Decision Smart Intent Parser: analyzes prompt text, attachments, and indexed docs
 * to automatically activate RAG grounding, Deep Research, Live Artifact Sync, and Project Building.
 */
export function parseSmartIntent(params: {
  promptText: string;
  attachment?: ChatAttachment;
  knowledgeDocs?: KnowledgeDoc[];
  enableKnowledgeGroundingPref?: boolean;
}): SmartIntentResult {
  const {
    promptText,
    attachment,
    knowledgeDocs = [],
    enableKnowledgeGroundingPref = true,
  } = params;

  const trimmed = promptText.trim();

  // 1. RAG matching
  const matchedDocs = resolveAutoGroundingDocs(
    trimmed,
    knowledgeDocs,
    enableKnowledgeGroundingPref
  );
  let ragReason: SmartIntentResult['ragReason'] = 'none';
  if (matchedDocs.length > 0) {
    if (matchedDocs.some((d) => d.isGroundingActive)) {
      ragReason = 'explicit-active';
    } else if (
      matchedDocs.some((d) => trimmed.toLowerCase().includes(d.title.trim().toLowerCase()))
    ) {
      ragReason = 'title-match';
    } else if (KNOWLEDGE_REFERENCE_ASCII.test(trimmed) || KNOWLEDGE_REFERENCE_BN.test(trimmed)) {
      ragReason = 'knowledge-query';
    } else {
      ragReason = 'topic-match';
    }
  }

  // 2. Deep Research
  const enableDeepResearch = shouldAutoTriggerDeepResearch(trimmed, attachment);

  // 3. Build / Live Artifact / Autonomous Project Builder
  const isBuildOrCode = BUILD_OR_CODE_ASCII.test(trimmed) || BUILD_OR_CODE_BN.test(trimmed);
  const projectRuntimeHint = detectProjectRuntimeHint(trimmed);
  const isProjectPhrase = PROJECT_BUILD_ASCII.test(trimmed) || PROJECT_BUILD_BN.test(trimmed);

  const enableProjectBuilder = Boolean(
    isProjectPhrase || (EXPLICIT_CODE_ACTION.test(trimmed) && projectRuntimeHint !== null)
  );
  const enableLiveArtifactSync = Boolean(
    isBuildOrCode || enableProjectBuilder || (attachment && EXPLICIT_CODE_ACTION.test(trimmed))
  );

  const isLiveWeb = LIVE_WEB_ASCII.test(trimmed) || LIVE_WEB_BN.test(trimmed);
  const isDeepReasoning = DEEP_REASONING_ASCII.test(trimmed) || DEEP_REASONING_BN.test(trimmed);
  const isAnalyticalHighThinking =
    HIGH_THINKING_ANALYTICAL_ASCII.test(trimmed) || HIGH_THINKING_ANALYTICAL_BN.test(trimmed);
  const enableJsonOutput = JSON_OUTPUT_ASCII.test(trimmed) || JSON_OUTPUT_BN.test(trimmed);
  const enableSearchGrounding = isLiveWeb && !enableJsonOutput && !enableDeepResearch;

  let recommendedThinkingLevel: WorkbenchThinkingLevel = 'LOW';
  if (isDeepReasoning) {
    recommendedThinkingLevel = 'XHIGH';
  } else if (
    enableDeepResearch ||
    enableProjectBuilder ||
    isBuildOrCode ||
    isAnalyticalHighThinking ||
    attachment
  ) {
    recommendedThinkingLevel = 'HIGH';
  } else if (isLiveWeb || trimmed.length > 140 || (trimmed.includes('?') && trimmed.length > 75)) {
    recommendedThinkingLevel = 'MEDIUM';
  }

  let recommendedModelId = 'supreme-spark';
  if (isDeepReasoning) {
    recommendedModelId = 'supreme-reason';
  } else if (isLiveWeb && !EXPLICIT_CODE_ACTION.test(trimmed) && !attachment) {
    recommendedModelId = 'supremeai-web';
  } else if (enableProjectBuilder || trimmed.length > 160) {
    recommendedModelId = isBuildOrCode || attachment ? 'supreme-deep' : 'supreme-core';
  } else if (isBuildOrCode || attachment || isAnalyticalHighThinking) {
    recommendedModelId = 'supreme-core';
  }

  return {
    enableRag: matchedDocs.length > 0,
    matchedDocs,
    ragReason,
    enableDeepResearch,
    enableLiveArtifactSync,
    enableProjectBuilder,
    projectRuntimeHint,
    recommendedModelId,
    recommendedThinkingLevel,
    enableSearchGrounding,
    enableJsonOutput,
  };
}

export interface ResolvedThinkingParams {
  thinkingLevel: WorkbenchThinkingLevel;
  reasoningEffort: 'low' | 'medium' | 'high';
  defaultThinkingBudget: number;
  highThinkingEnabled: boolean;
}

export function resolveThinkingParams(level: WorkbenchThinkingLevel): ResolvedThinkingParams {
  switch (level) {
    case 'XHIGH':
      return {
        thinkingLevel: 'XHIGH',
        reasoningEffort: 'high',
        defaultThinkingBudget: 16384,
        highThinkingEnabled: true,
      };
    case 'HIGH':
      return {
        thinkingLevel: 'HIGH',
        reasoningEffort: 'high',
        defaultThinkingBudget: 8192,
        highThinkingEnabled: true,
      };
    case 'MEDIUM':
      return {
        thinkingLevel: 'MEDIUM',
        reasoningEffort: 'medium',
        defaultThinkingBudget: 2048,
        highThinkingEnabled: false,
      };
    case 'LOW':
    default:
      return {
        thinkingLevel: 'LOW',
        reasoningEffort: 'low',
        defaultThinkingBudget: 0,
        highThinkingEnabled: false,
      };
  }
}

