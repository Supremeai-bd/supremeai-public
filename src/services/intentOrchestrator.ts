import type { ChatAttachment, ChatMessage, KnowledgeDoc, WorkbenchThinkingLevel } from '../types';
import { parseSmartIntent, type SmartIntentResult } from '../utils/chatAutoIntent';
import { getWorkspaceAuthHeaders } from '../utils/workspaceAuth';

export type IntentPrimaryGoal =
  | 'chat'
  | 'build_app'
  | 'deep_research'
  | 'live_web'
  | 'file_analysis'
  | 'schedule_task'
  | 'dashboard_action';

export type AutoDockTab = 'none' | 'preview' | 'code' | 'browser' | 'schedule';

export type DashboardActionType =
  | 'none'
  | 'toggle_dark_mode'
  | 'toggle_light_mode'
  | 'switch_lang_bn'
  | 'switch_lang_en'
  | 'set_live_theme'
  | 'toggle_theme_motion'
  | 'new_chat'
  | 'open_projects'
  | 'open_workspace_dock'
  | 'run_last_code'
  | 'disable_jarvis'
  | 'open_usage'
  | 'open_settings'
  | 'open_knowledge'
  | 'open_history'
  | 'open_admin_health'
  | 'open_admin_ai'
  | 'open_admin_security'
  | 'open_admin_releases'
  | 'toggle_voice';

export interface DashboardActionMatch {
  action: DashboardActionType;
  payload?: string;
}

export interface PendingClarification {
  id: string;
  originalPrompt: string;
  question: string;
  options: string[];
  language: 'en' | 'bn' | 'banglish';
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
}

export interface IntentOrchestrationResult extends SmartIntentResult {
  primaryGoal: IntentPrimaryGoal;
  autoOpenDockTab: AutoDockTab;
  dashboardAction: DashboardActionType;
  actionPayload?: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
  planSummary: string;
  inferredLanguage: 'en' | 'bn' | 'banglish';
  inferredTopic?: string;
  source: 'gemini' | 'heuristic';
}

export interface UserMemoryProfile {
  preferredLanguage: 'en' | 'bn' | 'banglish';
  recentTopics: string[];
  interactionCount: number;
  // বাংলা মন্তব্য: ব্যবহারকারীর কাজের ধরন ও কমান্ড থেকে স্বয়ংক্রিয়ভাবে শেখা প্রবণতা
  developerAffinityScore: number;
  preferredThemeId?: string;
  preferredResponseStyle?: 'concise' | 'detailed';
  updatedAt: number;
}

const USER_MEMORY_STORAGE_KEY = 'supremeai_user_memory_v1';

const BANGLISH_PATTERNS =
  /\b(ami|amar|amader|tumi|tomar|ekta|akta|koro|korbo|korte|lagbe|chai|chao|banao|banabo|dekhao|bolo|thik|kivabe|keno|ajker|dokan|hisab|kaj|shuru|chalu|bondho)\b/i;

const BENGALI_SCRIPT_REGEX = /[\u0980-\u09FF]/;

const BANGLISH_BUILD_PATTERNS =
  /\b(app|website|site|dashboard|hisab|shop|dokan|store|portfolio|landing\s*page|software|tool|system|calculator|form|page|bot)\b.*\b(banao|banabo|banai|lagbe|chai|create|build|make|design)\b|\b(banao|banabo|create|build|make|design)\b.*\b(app|website|site|dashboard|hisab|shop|dokan|store|portfolio|software|tool|system)\b/i;

const BANGLISH_WEB_PATTERNS =
  /\b(ajker|ekhonkar|latest|today|khobor|news|dam|price|weather|abohawa|score|stock|dollar\s*rate|gold\s*price|search\s*koro|khuje\s*dao)\b/i;

const BANGLISH_SCHEDULE_PATTERNS =
  /\b(protidin|everyday|every\s*day|daily|weekly|remind\s*me|reminder|schedule|shokal|ratre|sokal)\b/i;

const DEVELOPER_WORKFLOW_REGEX =
  /\b(typescript|javascript|python|rust|react|vite|next\.?js|tailwind|docker|kubernetes|api\s*key|webhook|github|gitlab|git\s+push|branch|pull\s*request|terminal|cli|regex|sql|database|schema|refactor|debug|stack\s*trace|npm\s+run|tsconfig|package\.json)\b/i;

export function detectPromptLanguage(text: string): 'en' | 'bn' | 'banglish' {
  if (BENGALI_SCRIPT_REGEX.test(text)) return 'bn';
  if (BANGLISH_PATTERNS.test(text)) return 'banglish';
  return 'en';
}

export function loadUserMemory(): UserMemoryProfile {
  const empty: UserMemoryProfile = {
    preferredLanguage: 'en',
    recentTopics: [],
    interactionCount: 0,
    developerAffinityScore: 0,
    updatedAt: Date.now(),
  };
  if (typeof localStorage === 'undefined') {
    return empty;
  }
  try {
    const raw = localStorage.getItem(USER_MEMORY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserMemoryProfile>;
      return {
        preferredLanguage:
          parsed.preferredLanguage === 'bn' || parsed.preferredLanguage === 'banglish'
            ? parsed.preferredLanguage
            : 'en',
        recentTopics: Array.isArray(parsed.recentTopics)
          ? parsed.recentTopics.filter((t): t is string => typeof t === 'string').slice(0, 6)
          : [],
        interactionCount: typeof parsed.interactionCount === 'number' ? parsed.interactionCount : 0,
        developerAffinityScore:
          typeof parsed.developerAffinityScore === 'number' ? parsed.developerAffinityScore : 0,
        preferredThemeId:
          typeof parsed.preferredThemeId === 'string' ? parsed.preferredThemeId : undefined,
        preferredResponseStyle:
          parsed.preferredResponseStyle === 'concise' || parsed.preferredResponseStyle === 'detailed'
            ? parsed.preferredResponseStyle
            : undefined,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    }
  } catch {
    // Ignore storage read issues
  }
  return empty;
}

export const USER_MEMORY_UPDATED_EVENT = 'supremeai-user-memory-updated';

export function recordUserMemory(update: {
  language?: 'en' | 'bn' | 'banglish';
  topic?: string;
  promptText?: string;
  preferredThemeId?: string;
}): UserMemoryProfile {
  const current = loadUserMemory();
  const nextTopics = [...current.recentTopics];
  const cleanTopic = update.topic?.trim().slice(0, 48);
  if (cleanTopic && cleanTopic.length >= 3) {
    const filtered = nextTopics.filter((t) => t.toLowerCase() !== cleanTopic.toLowerCase());
    filtered.unshift(cleanTopic);
    nextTopics.splice(0, nextTopics.length, ...filtered.slice(0, 6));
  }

  const promptSignal = update.promptText || '';
  const devDelta = DEVELOPER_WORKFLOW_REGEX.test(promptSignal) ? 1 : 0;
  const conciseSignal = /\b(short|brief|concise|tldr|সংক্ষেপে|ছোট\s*করে)\b/i.test(promptSignal);
  const detailedSignal = /\b(detailed|step[\s-]+by[\s-]+step|deep\s+dive|বিস্তারিত)\b/i.test(
    promptSignal
  );

  const next: UserMemoryProfile = {
    preferredLanguage: update.language || current.preferredLanguage,
    recentTopics: nextTopics,
    interactionCount: current.interactionCount + 1,
    developerAffinityScore: Math.min(20, current.developerAffinityScore + devDelta),
    preferredThemeId: update.preferredThemeId || current.preferredThemeId,
    preferredResponseStyle: conciseSignal
      ? 'concise'
      : detailedSignal
        ? 'detailed'
        : current.preferredResponseStyle,
    updatedAt: Date.now(),
  };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota issues
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USER_MEMORY_UPDATED_EVENT, { detail: next }));
  }
  return next;
}

/** Remove one remembered topic (case-insensitive). বাংলা: একটা বিষয় ভুলে যাও। */
export function forgetUserMemoryTopic(topic: string): UserMemoryProfile {
  const current = loadUserMemory();
  const needle = topic.trim().toLowerCase();
  const next: UserMemoryProfile = {
    ...current,
    recentTopics: current.recentTopics.filter((t) => t.toLowerCase() !== needle),
    updatedAt: Date.now(),
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota issues
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USER_MEMORY_UPDATED_EVENT, { detail: next }));
  }
  return next;
}

export function clearUserMemory(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(USER_MEMORY_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USER_MEMORY_UPDATED_EVENT));
  }
}

export function buildMemoryContextPrompt(memory: UserMemoryProfile): string {
  if (memory.interactionCount === 0 && memory.recentTopics.length === 0) return '';
  const langNote =
    memory.preferredLanguage === 'bn'
      ? 'User frequently communicates in Bengali (বাংলা); mirror their language naturally.'
      : memory.preferredLanguage === 'banglish'
        ? 'User often writes in Banglish (Bengali in Latin script); respond clearly in natural Bengali or Banglish matching their tone.'
        : 'User prefers clear, concise English responses.';
  const styleNote =
    memory.preferredResponseStyle === 'concise'
      ? 'User favors brief, direct answers without unnecessary technical clutter.'
      : memory.preferredResponseStyle === 'detailed'
        ? 'User appreciates thorough explanations with clear structure.'
        : '';
  const topicsNote =
    memory.recentTopics.length > 0
      ? `Recent user focus areas: ${memory.recentTopics.join(', ')}.`
      : '';
  return `\n[USER MEMORY CONTEXT]\n${langNote}${styleNote ? `\n${styleNote}` : ''}${topicsNote ? `\n${topicsNote}` : ''}`;
}

const LIVE_THEME_VOICE_ALIASES: Array<{ id: string; pattern: RegExp }> = [
  { id: 'alpine-dunes', pattern: /\b(alpine|dunes|snow)\b/i },
  { id: 'misty-fjords', pattern: /\b(fjord|misty|lake)\b/i },
  { id: 'emerald-highlands', pattern: /\b(emerald|highlands|forest)\b/i },
  { id: 'amber-canyon', pattern: /\b(amber|canyon|desert)\b/i },
  { id: 'midnight-peaks', pattern: /\b(midnight|peaks|starlight|obsidian)\b/i },
  { id: 'nebula', pattern: /\b(nebula|cosmos|space)\b/i },
  { id: 'cyberpunk', pattern: /\b(cyberpunk|matrix|neon)\b/i },
  { id: 'aurora-borealis', pattern: /\b(aurora|northern\s*lights|borealis)\b/i },
  { id: 'oceanic-horizon', pattern: /\b(ocean|oceanic|sea|waves)\b/i },
  { id: 'solar-meadow', pattern: /\b(solar|meadow|sunrise|dawn)\b/i },
  { id: 'cyber-studio', pattern: /\b(cyber\s*studio|neural\s*mesh|studio\s*grid)\b/i },
];

const RUN_LAST_CODE_EN =
  /^(?:(?:please|pls|now|ok(?:ay)?|hey\s+\w+)[,\s]+)?(?:(?:run|execute|preview|test)(?:\s+(?:it|this|that|again|the\s+(?:code|app|project|site|website|page|script)|my\s+(?:code|app|project)|code|app|project))?|(?:open|show|launch|start)(?:\s+me)?\s+(?:it|this|that|the\s+(?:preview|app|project|site|website|result|output)|(?:the\s+)?preview))(?:\s+(?:again|now|please|pls))?[.!?]*$/i;
const RUN_LAST_CODE_BN =
  /^(?:(?:এটা|এটি|ওটা|কোডটা|কোডটি|অ্যাপটা|অ্যাপটি|প্রজেক্টটা|সাইটটা)\s*)?(?:চালাও|চালিয়ে\s*দেখাও|চালু\s*করো|রান\s*করো?|প্রিভিউ\s*(?:দেখাও|খোলো|দাও|করো)|আউটপুট\s*দেখাও)(?:\s*(?:তো|এখন|আবার|প্লিজ))?[।.!?]*$/;
const RUN_LAST_CODE_BANGLISH =
  /^(?:(?:eta|eita|code\s*ta|app\s*ta|project\s*ta|site\s*ta)\s+)?(?:chalao|chalaw|chaliye\s*dekhao|run\s*(?:koro|kor|dao)|preview\s*(?:dekhao|koro|kor|dao|kholo)|output\s*dekhao)(?:\s+(?:to|ekhon|abar|plz|please))?[.!?]*$/i;

/** বাংলা মন্তব্য: ছোট, সরাসরি "চালাও/run it" কমান্ড কিনা — নতুন কোড লেখার অনুরোধ নয়। */
export function isRunLastCodeCommand(promptText: string): boolean {
  const text = promptText.trim();
  if (!text || text.split(/\s+/).length > 6) return false;
  return (
    RUN_LAST_CODE_EN.test(text) || RUN_LAST_CODE_BN.test(text) || RUN_LAST_CODE_BANGLISH.test(text)
  );
}

export function detectDirectDashboardActionWithPayload(
  promptText: string,
  isAdmin: boolean
): DashboardActionMatch {
  const t = promptText.trim().toLowerCase();
  if (!t || t.length > 120) return { action: 'none' };

  // Language switches via command or speech
  if (
    /\b(speak|reply|talk|switch|change|use)\s+(to\s+|in\s+)?(bangla|bengali)\b/i.test(t) ||
    /(বাংলায়\s*(কথা\s*বলো|বলো|চালু|দাও|করো)|বাংলা\s*(মোড|ভাষা|করো|দাও)|bangla\s*(koro|bolo|te\s*kotha))/i.test(
      promptText
    )
  ) {
    return { action: 'switch_lang_bn' };
  }
  if (
    /\b(speak|reply|talk|switch|change|use)\s+(to\s+|in\s+)?english\b/i.test(t) ||
    /(ইংরেজিতে\s*(বলো|কথা\s*বলো|দাও)|ইংরেজি\s*(করো|চালু)|english\s*(koro|bolo))/i.test(promptText)
  ) {
    return { action: 'switch_lang_en' };
  }

  // Theme switches (Dark / Light + Live Screen backdrops + Motion)
  if (
    /\b(dark\s*mode|dark\s*theme)\b/i.test(t) ||
    /(ডার্ক\s*(মোড|থিম)|dark\s*(koro|kor|on|enable))/i.test(promptText)
  ) {
    if (!/\b(build|create|code|css|tailwind|component|app)\b/i.test(t)) {
      return { action: 'toggle_dark_mode' };
    }
  }
  if (
    /\b(light\s*mode|light\s*theme)\b/i.test(t) ||
    /(লাইট\s*(মোড|থিম)|light\s*(koro|kor|on|enable))/i.test(promptText)
  ) {
    if (!/\b(build|create|code|css|tailwind|component|app)\b/i.test(t)) {
      return { action: 'toggle_light_mode' };
    }
  }
  if (
    /\b(still\s*background|pause\s*(backdrop|theme|motion|animation)|stop\s*(backdrop|theme)\s*animation|motion\s*(on|off))\b/i.test(
      t
    ) ||
    /(ব্যাকগ্রাউন্ড\s*(স্থির|বন্ধ|চালু)|অ্যানিমেশন\s*(বন্ধ|চালু))/i.test(promptText)
  ) {
    return { action: 'toggle_theme_motion' };
  }
  if (/\b(theme|backdrop|screen|wallpaper|থিম|ব্যাকগ্রাউন্ড)\b/i.test(promptText)) {
    for (const candidate of LIVE_THEME_VOICE_ALIASES) {
      if (candidate.pattern.test(t) && !/\b(build|create|code|css)\b/i.test(t)) {
        return { action: 'set_live_theme', payload: candidate.id };
      }
    }
  } else {
    // Allow concise speech like "Switch to Aurora"
    for (const candidate of LIVE_THEME_VOICE_ALIASES) {
      if (
        new RegExp(`^(?:switch|change|use|set|apply)\\s+(?:to\\s+)?${candidate.pattern.source}`, 'i').test(t)
      ) {
        return { action: 'set_live_theme', payload: candidate.id };
      }
    }
  }

  // JARVIS / Voice explicit stop vs start
  if (
    /\b(stop|turn\s*off|disable|close|exit|quit)\s+(jarvis|(?:live\s+)?voice(?:\s+mode)?)\b/i.test(
      t
    ) ||
    /^(?:jarvis\s+)?(?:stop|off|bye|goodbye)$/i.test(t) ||
    /(জার্ভিস\s*(বন্ধ|অফ|থামাও)|ভয়েস\s*(মোড\s*)?(বন্ধ|অফ)|jarvis\s*(bandho|bondho|off))/i.test(
      promptText
    )
  ) {
    return { action: 'disable_jarvis' };
  }
  if (
    /\b(open|start|enable|turn\s*on|toggle)\s+(jarvis|(?:live\s+)?voice(?:\s+mode)?)\b/i.test(t) ||
    /(জার্ভিস\s*(চালু|অন)|ভয়েস\s*(মোড\s*)?(চালু|অন)|voice\s*(mode\s*)?(on|chalu))/i.test(
      promptText
    )
  ) {
    return { action: 'toggle_voice' };
  }

  // বাংলা মন্তব্য: আর কোনো Developer Mode নেই — সব টুল সবার জন্য খোলা। "developer tools খোলো"
  // বললে শুধু ওয়ার্কস্পেস ডক খুলে যায় (Sandbox/Terminal/Graph সেখানেই আছে)।
  if (
    /\b(enable|turn\s*on|show|open)\s+(dev|developer)\s*(mode|tools?)\b/i.test(t) ||
    /(ডেভেলপার\s*(মোড|টুলস?)\s*(চালু|অন|দেখাও|খোলো))/i.test(promptText)
  ) {
    return { action: 'open_workspace_dock' };
  }

  // বাংলা মন্তব্য: "চালাও / run it / preview dekhao" — কোড-ব্লকের নিচে আর কোনো Run/Preview
  // বাটন নেই; ইউজার মুখে বা চ্যাটে বললেই শেষ উত্তরের কোড/প্রজেক্ট ওয়ার্কস্পেসে চলে।
  if (isRunLastCodeCommand(promptText)) {
    return { action: 'run_last_code' };
  }

  // Quick Workspace actions
  if (
    /\b(start|open|create)\s+(a\s+)?new\s+chat\b/i.test(t) ||
    /(নতুন\s*চ্যাট\s*(খোলো|শুরু)|new\s*chat\s*koro)/i.test(promptText)
  ) {
    return { action: 'new_chat' };
  }
  if (
    /\b(open|show|check|view)\s+(my\s+)?projects?\b/i.test(t) ||
    /(আমার\s*প্রজেক্ট|প্রজেক্ট\s*(দেখাও|খোলো))/i.test(promptText)
  ) {
    return { action: 'open_projects' };
  }
  if (
    /\b(open|show)\s+(live\s+)?(preview|workspace)\s+dock\b/i.test(t) ||
    /(প্রিভিউ\s*ডক\s*খোলো)/i.test(promptText)
  ) {
    return { action: 'open_workspace_dock' };
  }

  // User workspace navigation
  if (
    /\b(show|open|check|view)\s+(my\s+)?(usage|billing|plan|tokens?|quota)\b/i.test(t) ||
    /(ইউসেজ|বিলিং|প্ল্যান|usage\s*dekhao)/i.test(promptText)
  ) {
    return { action: 'open_usage' };
  }
  if (
    /\b(open|show|go\s+to)\s+(my\s+)?settings\b/i.test(t) ||
    /(সেটিংস\s*(খোলো|দেখাও)|settings\s*(open|dekhao))/i.test(promptText)
  ) {
    return { action: 'open_settings' };
  }
  if (
    /\b(open|show|manage)\s+(my\s+)?(knowledge\s*base|uploaded\s*files?|rag\s*docs?)\b/i.test(t) ||
    /(নলেজ\s*বেস|আমার\s*ফাইল\s*দেখাও)/i.test(promptText)
  ) {
    return { action: 'open_knowledge' };
  }
  if (
    /\b(open|show)\s+(all\s+)?(chat\s+)?history\b/i.test(t) ||
    /(সব\s*চ্যাট|চ্যাট\s*হিস্ট্রি\s*দেখাও)/i.test(promptText)
  ) {
    return { action: 'open_history' };
  }

  // Admin Ops navigation via natural language
  if (isAdmin) {
    if (
      /\b(check|show|open)\s+(server|system|live|cpu|latency)?\s*(health|status|ops|nodes|alerts?)\b/i.test(
        t
      ) ||
      /(সার্ভার\s*(হেলথ|স্ট্যাটাস)|health\s*(check|dekhao))/i.test(promptText)
    ) {
      return { action: 'open_admin_health' };
    }
    if (
      /\b(open|show|check)\s+(llm\s*gateway|gpu\s*fleet|ai\s*compute|models?\s*matrix)\b/i.test(t)
    ) {
      return { action: 'open_admin_ai' };
    }
    if (/\b(open|show|check)\s+(customers?|security|audit\s*log|hitl)\b/i.test(t)) {
      return { action: 'open_admin_security' };
    }
    if (
      /\b(open|show|check)\s+(github\s*pipeline|release\s*gate|releases?|ci\/cd|schema\s*parity)\b/i.test(
        t
      )
    ) {
      return { action: 'open_admin_releases' };
    }
  }

  return { action: 'none' };
}

function buildHeuristicClarification(
  promptText: string,
  lang: 'en' | 'bn' | 'banglish',
  hasAttachment: boolean,
  hasConversationHistory: boolean
): { question: string; options: string[] } | null {
  if (hasAttachment || hasConversationHistory) return null;
  const trimmed = promptText.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  // Only clarify genuinely short & underspecified broad creation requests (<= 6 words)
  if (wordCount > 6) return null;

  const isVagueWebsite =
    /^(build|create|make|design)\s+(me\s+)?(a\s+|an\s+)?(website|web\s*app|landing\s*page|site)\.?$/i.test(
      trimmed
    ) ||
    /^(একটা\s*)?(ওয়েবসাইট|সাইট|ল্যান্ডিং\s*পেজ)\s*(বানাও|তৈরি\s*করো|দাও)\.?$/i.test(trimmed) ||
    /^(ekta|akta)\s+(website|site|web\s*app)\s+(banao|banabo|lagbe|dao)\.?$/i.test(trimmed);

  if (isVagueWebsite) {
    if (lang === 'bn') {
      return {
        question: 'কোন ধরনের ওয়েবসাইট বানাতে চান?',
        options: [
          'ব্যবসা বা অনলাইন শপ (E-commerce)',
          'পার্সোনাল পোর্টফোলিও সাইট',
          'সার্ভিস বা এজেন্সি ল্যান্ডিং পেজ',
          'ড্যাশবোর্ড / ম্যানেজমেন্ট ওয়েব অ্যাপ',
        ],
      };
    }
    if (lang === 'banglish') {
      return {
        question: 'Kon dhoroner website banate chan?',
        options: [
          'Online shop / E-commerce site',
          'Personal portfolio website',
          'Business / Agency landing page',
          'Dashboard / Management web app',
        ],
      };
    }
    return {
      question: 'What type of website would you like to build?',
      options: [
        'Online store / E-commerce',
        'Personal portfolio',
        'Business or SaaS landing page',
        'Interactive management dashboard',
      ],
    };
  }

  const isVagueApp =
    /^(build|create|make|design)\s+(me\s+)?(a\s+|an\s+)?(app|application|dashboard|project|software)\.?$/i.test(
      trimmed
    ) ||
    /^(একটা\s*)?(অ্যাপ|ড্যাশবোর্ড|প্রজেক্ট|সফটওয়্যার)\s*(বানাও|তৈরি\s*করো|দাও)\.?$/i.test(trimmed) ||
    /^(ekta|akta)\s+(app|dashboard|project|software)\s+(banao|banabo|lagbe|dao)\.?$/i.test(trimmed);

  if (isVagueApp) {
    if (lang === 'bn') {
      return {
        question: 'এই অ্যাপটির মূল কাজ কী হবে?',
        options: [
          'দোকান / ব্যবসার হিসাব ও ইনভয়েস',
          'দৈনন্দিন টাস্ক ও নোট ম্যানেজার',
          'বিজনেস অ্যানালিটিক্স ড্যাশবোর্ড',
          'বুকিং বা কাস্টমার ম্যানেজমেন্ট',
        ],
      };
    }
    if (lang === 'banglish') {
      return {
        question: 'App-tir mul kaj ki hobe?',
        options: [
          'Dokan / Business hisab & invoice',
          'Daily task & note manager',
          'Analytics & sales dashboard',
          'Booking / Customer tracker',
        ],
      };
    }
    return {
      question: 'What should this app focus on?',
      options: [
        'Business inventory & invoicing',
        'Personal tasks & notes tracker',
        'Sales & analytics dashboard',
        'Client booking & CRM tool',
      ],
    };
  }

  return null;
}

function buildPlanSummary(params: {
  primaryGoal: IntentPrimaryGoal;
  enableSearchGrounding: boolean;
  enableRag: boolean;
  thinkingLevel: WorkbenchThinkingLevel;
  autoOpenDockTab: AutoDockTab;
  lang: 'en' | 'bn' | 'banglish';
}): string {
  const parts: string[] = [];
  const bn = params.lang === 'bn';

  if (params.primaryGoal === 'build_app') {
    parts.push(bn ? 'অ্যাপ ও কোড বিল্ডার' : 'App & Code Builder');
  } else if (params.primaryGoal === 'deep_research') {
    parts.push(bn ? 'গভীর রিসার্চ' : 'Deep Research');
  } else if (params.primaryGoal === 'live_web' || params.enableSearchGrounding) {
    parts.push(bn ? 'লাইভ ওয়েব সার্চ' : 'Live Web Search');
  } else if (params.primaryGoal === 'file_analysis') {
    parts.push(bn ? 'ফাইল ও ইমেজ বিশ্লেষণ' : 'File & Vision Analysis');
  } else if (params.primaryGoal === 'schedule_task') {
    parts.push(bn ? 'অটো শিডিউলার' : 'Smart Scheduler');
  } else {
    parts.push(bn ? 'স্মার্ট অ্যাসিস্ট্যান্ট' : 'Smart Assistant');
  }

  if (params.enableRag) {
    parts.push(bn ? 'নলেজ বেস যুক্ত' : 'Knowledge Grounded');
  }
  if (params.autoOpenDockTab === 'preview') {
    parts.push(bn ? 'লাইভ প্রিভিউ' : 'Live Preview');
  } else if (params.autoOpenDockTab === 'browser') {
    parts.push(bn ? 'লাইভ ব্রাউজার' : 'Live Browser');
  }
  if (params.thinkingLevel === 'XHIGH' || params.thinkingLevel === 'HIGH') {
    parts.push(bn ? 'গভীর বিশ্লেষণ' : 'Deep Reasoning');
  } else if (params.thinkingLevel === 'LOW') {
    parts.push(bn ? 'দ্রুত উত্তর' : 'Fast Response');
  }

  return parts.slice(0, 3).join(' · ');
}

export async function orchestrateUserIntent(params: {
  promptText: string;
  attachment?: ChatAttachment;
  knowledgeDocs?: KnowledgeDoc[];
  recentMessages?: ChatMessage[];
  isAdmin?: boolean;
  skipClarification?: boolean;
}): Promise<IntentOrchestrationResult> {
  const {
    promptText,
    attachment,
    knowledgeDocs = [],
    recentMessages = [],
    isAdmin = false,
    skipClarification = false,
  } = params;

  const trimmed = promptText.trim();
  const inferredLanguage = detectPromptLanguage(trimmed);
  const base = parseSmartIntent({
    promptText: trimmed,
    attachment,
    knowledgeDocs,
    enableKnowledgeGroundingPref: true,
  });

  // 1. Direct instant check for Chat-Driven Dashboard Actions (0ms latency)
  const directMatch = !attachment
    ? detectDirectDashboardActionWithPayload(trimmed, isAdmin)
    : { action: 'none' as DashboardActionType };
  if (directMatch.action !== 'none') {
    recordUserMemory({
      language: inferredLanguage,
      preferredThemeId:
        directMatch.action === 'set_live_theme' ? directMatch.payload : undefined,
      promptText: trimmed,
    });
    return {
      ...base,
      primaryGoal: 'dashboard_action',
      autoOpenDockTab: directMatch.action === 'open_workspace_dock' ? 'preview' : 'none',
      dashboardAction: directMatch.action,
      actionPayload: directMatch.payload,
      needsClarification: false,
      planSummary: inferredLanguage === 'bn' ? 'ড্যাশবোর্ড অ্যাকশন' : 'Workspace Action',
      inferredLanguage,
      source: 'heuristic',
    };
  }

  // 2. Enhanced Banglish / Bilingual local heuristics
  const isBanglishBuild = BANGLISH_BUILD_PATTERNS.test(trimmed);
  const isBanglishWeb = BANGLISH_WEB_PATTERNS.test(trimmed);
  const isBanglishSchedule = BANGLISH_SCHEDULE_PATTERNS.test(trimmed);

  const enableProjectBuilder = base.enableProjectBuilder || isBanglishBuild;
  const enableLiveArtifactSync = base.enableLiveArtifactSync || isBanglishBuild;
  const enableSearchGrounding =
    (base.enableSearchGrounding || isBanglishWeb) &&
    !base.enableJsonOutput &&
    !base.enableDeepResearch;

  let primaryGoal: IntentPrimaryGoal = 'chat';
  let autoOpenDockTab: AutoDockTab = 'none';
  if (attachment) {
    primaryGoal = enableProjectBuilder ? 'build_app' : 'file_analysis';
    if (enableProjectBuilder) autoOpenDockTab = 'preview';
  } else if (base.enableDeepResearch) {
    primaryGoal = 'deep_research';
  } else if (enableProjectBuilder) {
    primaryGoal = 'build_app';
    autoOpenDockTab = 'preview';
  } else if (isBanglishSchedule) {
    primaryGoal = 'schedule_task';
    autoOpenDockTab = 'schedule';
  } else if (enableSearchGrounding) {
    primaryGoal = 'live_web';
  } else if (base.enableLiveArtifactSync) {
    primaryGoal = 'build_app';
    autoOpenDockTab = 'code';
  }

  const heuristicClarification = !skipClarification
    ? buildHeuristicClarification(
        trimmed,
        inferredLanguage,
        Boolean(attachment),
        recentMessages.length > 0
      )
    : null;

  let result: IntentOrchestrationResult = {
    ...base,
    enableProjectBuilder,
    enableLiveArtifactSync,
    enableSearchGrounding,
    recommendedModelId:
      enableProjectBuilder && base.recommendedModelId === 'supreme-spark'
        ? 'supreme-deep'
        : enableSearchGrounding && base.recommendedModelId === 'supreme-spark'
          ? 'supremeai-web'
          : base.recommendedModelId,
    recommendedThinkingLevel:
      enableProjectBuilder && base.recommendedThinkingLevel === 'LOW'
        ? 'HIGH'
        : base.recommendedThinkingLevel,
    primaryGoal,
    autoOpenDockTab,
    dashboardAction: 'none',
    needsClarification: Boolean(heuristicClarification),
    clarificationQuestion: heuristicClarification?.question,
    clarificationOptions: heuristicClarification?.options,
    planSummary: buildPlanSummary({
      primaryGoal,
      enableSearchGrounding,
      enableRag: base.enableRag,
      thinkingLevel:
        enableProjectBuilder && base.recommendedThinkingLevel === 'LOW'
          ? 'HIGH'
          : base.recommendedThinkingLevel,
      autoOpenDockTab,
      lang: inferredLanguage,
    }),
    inferredLanguage,
    source: 'heuristic',
  };

  // 3. Fast server-side Semantic Intent Orchestrator call (2.2s timeout, never blocks chat)
  if (typeof fetch !== 'undefined' && trimmed.length >= 6 && !heuristicClarification) {
    try {
      const memory = loadUserMemory();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      // বাংলা মন্তব্য: ইনটেন্ট অ্যানালাইজারে বিদ্যমান টোকেন পাঠালে এজ ফাংশনে নতুন গেস্ট টোকেন মিন্ট করতে হয় না।
      const res = await fetch('/api/intent/analyze', {
        method: 'POST',
        headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
        signal: controller.signal,
        body: JSON.stringify({
          prompt: trimmed,
          hasAttachment: Boolean(attachment),
          isAdmin,
          memorySummary: buildMemoryContextPrompt(memory),
          recentTurns: recentMessages.slice(-4).map((m) => ({
            role: m.role,
            content: m.content.slice(0, 200),
          })),
        }),
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as {
          source?: 'gemini' | 'heuristic';
          intent?: Partial<{
            primaryGoal: IntentPrimaryGoal;
            recommendedModelId: string;
            recommendedThinkingLevel: WorkbenchThinkingLevel;
            enableSearchGrounding: boolean;
            enableDeepResearch: boolean;
            enableProjectBuilder: boolean;
            autoOpenDockTab: AutoDockTab;
            dashboardAction: DashboardActionType;
            needsClarification: boolean;
            clarificationQuestion: string;
            clarificationOptions: string[];
            planSummary: string;
            inferredLanguage: 'en' | 'bn' | 'banglish';
            inferredTopic: string;
          }>;
        };

        if (data.source === 'gemini' && data.intent) {
          const ai = data.intent;
          const allowClarify =
            !skipClarification &&
            !attachment &&
            recentMessages.length === 0 &&
            Boolean(ai.needsClarification) &&
            Boolean(ai.clarificationQuestion?.trim()) &&
            Array.isArray(ai.clarificationOptions) &&
            ai.clarificationOptions.length >= 2;

          result = {
            ...result,
            primaryGoal: ai.primaryGoal || result.primaryGoal,
            recommendedModelId: ai.recommendedModelId || result.recommendedModelId,
            recommendedThinkingLevel:
              ai.recommendedThinkingLevel || result.recommendedThinkingLevel,
            enableSearchGrounding:
              typeof ai.enableSearchGrounding === 'boolean'
                ? ai.enableSearchGrounding
                : result.enableSearchGrounding,
            enableDeepResearch:
              typeof ai.enableDeepResearch === 'boolean'
                ? ai.enableDeepResearch
                : result.enableDeepResearch,
            enableProjectBuilder:
              typeof ai.enableProjectBuilder === 'boolean'
                ? ai.enableProjectBuilder
                : result.enableProjectBuilder,
            enableLiveArtifactSync:
              result.enableLiveArtifactSync || Boolean(ai.enableProjectBuilder),
            autoOpenDockTab: ai.autoOpenDockTab || result.autoOpenDockTab,
            dashboardAction: ai.dashboardAction || 'none',
            needsClarification: allowClarify,
            clarificationQuestion: allowClarify ? ai.clarificationQuestion?.trim() : undefined,
            clarificationOptions: allowClarify ? ai.clarificationOptions?.slice(0, 4) : undefined,
            planSummary: ai.planSummary?.trim() || result.planSummary,
            inferredLanguage: ai.inferredLanguage || result.inferredLanguage,
            inferredTopic: ai.inferredTopic?.trim(),
            source: 'gemini',
          };
        }
      }
    } catch {
      // Fall back cleanly to instant bilingual heuristics
    }
  }

  recordUserMemory({
    language: result.inferredLanguage,
    topic: result.inferredTopic,
    promptText: trimmed,
  });

  return result;
}
