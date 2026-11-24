import type { KnowledgeDoc } from '../types';
import {
  detectDirectDashboardActionWithPayload,
  detectPromptLanguage,
  type DashboardActionMatch,
} from '../services/intentOrchestrator';
import { parseSmartIntent } from './chatAutoIntent';
import { shouldRouteToAutonomousAgent } from '../shared/agentTypes';

/**
 * বাংলা মন্তব্য: JARVIS বাটন ও ভয়েস-কমান্ড রাউটিংয়ের একক ও বিশুদ্ধ লজিক (Pure Module)।
 *
 * এখানে দুইটি মূল সমস্যার স্থায়ী সমাধান করা হয়েছে:
 *   ১. JARVIS অন/অফ বাটন ডিসিঙ্ক বাগ: আগে `jarvisEnabled` (localStorage) এবং
 *      `isLiveVoiceOpen` (RAM) আলাদা ছিল। ফলে পেজ রিলোডের পর `jarvisEnabled=true`
 *      থাকলেও `isLiveVoiceOpen=false` থাকায় অফ ক্লিকেও লাইভ ভয়েস অন হয়ে যেত!
 *      এখন দুটোই একটিমাত্র state machine (`computeJarvisToggleState`) দিয়ে চলে।
 *   ২. মুখে বললে টাস্ক এক্সিকিউশন: শুধু চ্যাট নয় — ব্যবহারকারী মুখে কোনো ড্যাশবোর্ড
 *      কমান্ড বা কাজ ("অ্যাপ বানাও", "সার্চ করো", "ডার্ক মোড দাও", "শিডিউল করো") বললে
 *      স্বয়ংক্রিয়ভাবে আসল টাস্ক এক্সিকিউশন পাইপলাইনে রাউট হয়।
 */

export interface JarvisToggleTransition {
  nextJarvisEnabled: boolean;
  nextLiveVoiceOpen: boolean;
  action: 'enable' | 'disable';
}

export function computeJarvisToggleState(
  currentJarvisEnabled: boolean,
  currentLiveVoiceOpen: boolean
): JarvisToggleTransition {
  // বাংলা মন্তব্য: যেকোনো একটি চালু থাকলেই ক্লিক করলে সম্পূর্ণ বন্ধ (OFF) হবে;
  // সম্পূর্ণ বন্ধ থাকলে ক্লিক করলে উভয়ই একসাথে চালু (ON) হবে।
  const isAnyActive = Boolean(currentJarvisEnabled || currentLiveVoiceOpen);
  const next = !isAnyActive;
  return {
    nextJarvisEnabled: next,
    nextLiveVoiceOpen: next,
    action: next ? 'enable' : 'disable',
  };
}

export type SpokenCommandKind = 'dashboard_action' | 'autonomous_task' | 'live_chat';

export interface SpokenCommandClassification {
  kind: SpokenCommandKind;
  cleanedTranscript: string;
  language: 'en' | 'bn' | 'banglish';
  dashboardMatch: DashboardActionMatch;
  primaryGoal:
    | 'chat'
    | 'build_app'
    | 'deep_research'
    | 'live_web'
    | 'file_analysis'
    | 'schedule_task'
    | 'dashboard_action';
  autoOpenDockTab: 'none' | 'preview' | 'code' | 'browser' | 'schedule';
  shouldInterruptLiveReply: boolean;
}

const WAKE_PREFIX_REGEX =
  /^(?:(?:hey|ok|okay|hi|hello)\s+)?(?:jarvis|জার্ভিস|সুপ্রিম|supreme)(?:[,:\-\s]+|$)/i;

const SPOKEN_BUILD_REGEX =
  /\b(build|create|make|design|develop|generate)\s+(?:me\s+)?(?:a|an|the)?\s*(?:\w+\s+){0,3}(?:app|website|site|web\s*app|dashboard|page|tool|calculator|game|portal|store|shop|form|bot|component)\b|\b(?:app|website|site|dashboard|hisab|dokan|store|portfolio|software|calculator)\b.*\b(banao|banabo|banai|create|build|make|dao|chai|lagbe)\b|(?:অ্যাপ|ওয়েবসাইট|সাইট|ড্যাশবোর্ড|সফটওয়্যার|টুল|ফর্ম|ক্যালকুলেটর).*(?:বানাও|তৈরি|দাও|করো)/i;

const SPOKEN_SEARCH_OR_NEWS_REGEX =
  /\b(search|look\s*up|find\s+out|google|weather|forecast|latest\s+(?:news|version|release|updates?)|today'?s?\s+(?:news|weather|price|score)|news\s+about|stock\s+price|gold\s+price|live\s+score|browse|open\s+https?:\/\/)\b|\b(ajker|ekhonkar|khobor|abohawa|dam|price|search\s*koro|khuje\s*dao)\b|(?:আজকের|এখনকার|সর্বশেষ|খবর|আবহাওয়া|দাম|সার্চ\s*করো|খুঁজে\s*দাও)/i;

const SPOKEN_DEEP_RESEARCH_REGEX =
  /\b(deep\s*research|comprehensive\s+research|detailed\s+report|market\s+analysis|in[\s-]depth\s+study)\b|(?:ডিপ\s*রিসার্চ|বিস্তারিত\s*রিপোর্ট|গবেষণা\s*করো)/i;

const CASUAL_CONVERSATION_REGEX =
  /^(?:how\s+are\s+you(?:\s+doing)?|what'?s\s+up|good\s+(?:morning|afternoon|evening|night)|hello|hi|hey|thank\s*you|thanks|কেমন\s*আছো|ভালো\s*আছো|ধন্যবাদ)\b/i;

/**
 * বাংলা মন্তব্য: ভয়েস থেকে আসা ট্রান্সক্রিপ্ট বিশ্লেষণ করে সিদ্ধান্ত নেয় এটি কি:
 *   - 'dashboard_action' (সাথে সাথে UI/সেটিংস/থিম পরিবর্তন)
 *   - 'autonomous_task' (অ্যাপ বিল্ড, ওয়েব সার্চ, শিডিউল বা অটোনমাস এজেন্ট টাস্ক)
 *   - 'live_chat' (সাধারণ কথোপকথন — Gemini Live নিজ থেকেই কথা বলে উত্তর দেবে)
 */
export function classifySpokenJarvisCommand(params: {
  transcript: string;
  isAdmin?: boolean;
  workspaceFileCount?: number;
  knowledgeDocs?: KnowledgeDoc[];
}): SpokenCommandClassification {
  const raw = (params.transcript || '').trim();
  const stripped = raw.replace(WAKE_PREFIX_REGEX, '').trim();
  const cleanedTranscript = stripped.length >= 2 ? stripped : raw;
  const language = detectPromptLanguage(cleanedTranscript);
  const isAdmin = Boolean(params.isAdmin);

  const dashboardMatch = detectDirectDashboardActionWithPayload(cleanedTranscript, isAdmin);
  if (dashboardMatch.action !== 'none') {
    return {
      kind: 'dashboard_action',
      cleanedTranscript,
      language,
      dashboardMatch,
      primaryGoal: 'dashboard_action',
      autoOpenDockTab: dashboardMatch.action === 'open_workspace_dock' ? 'preview' : 'none',
      shouldInterruptLiveReply: true,
    };
  }

  if (CASUAL_CONVERSATION_REGEX.test(cleanedTranscript)) {
    return {
      kind: 'live_chat',
      cleanedTranscript,
      language,
      dashboardMatch,
      primaryGoal: 'chat',
      autoOpenDockTab: 'none',
      shouldInterruptLiveReply: false,
    };
  }

  const smartIntent = parseSmartIntent({
    promptText: cleanedTranscript,
    knowledgeDocs: params.knowledgeDocs || [],
    enableKnowledgeGroundingPref: true,
  });

  const isBuild = smartIntent.enableProjectBuilder || SPOKEN_BUILD_REGEX.test(cleanedTranscript);
  const isResearch = smartIntent.enableDeepResearch || SPOKEN_DEEP_RESEARCH_REGEX.test(cleanedTranscript);
  const isSearch = SPOKEN_SEARCH_OR_NEWS_REGEX.test(cleanedTranscript);
  const isMultiStep = shouldRouteToAutonomousAgent({
    promptText: cleanedTranscript,
    hasAttachments: false,
    deepResearch: isResearch,
    workspaceFileCount: params.workspaceFileCount || 0,
  });
  const isSchedule = /\b(schedule|remind\s*me|every\s*day|daily|weekly|cron|protidin|প্রতিদিন|শিডিউল|রিমাইন্ডার)\b/i.test(
    cleanedTranscript
  );

  if (isSchedule || isMultiStep || isBuild || isResearch || isSearch) {
    const primaryGoal = isSchedule
      ? 'schedule_task'
      : isResearch
        ? 'deep_research'
        : isBuild
          ? 'build_app'
          : isSearch
            ? 'live_web'
            : 'chat';

    const autoOpenDockTab = isSchedule
      ? 'schedule'
      : isBuild
        ? 'preview'
        : smartIntent.enableLiveArtifactSync
          ? 'code'
          : 'none';

    return {
      kind: 'autonomous_task',
      cleanedTranscript,
      language,
      dashboardMatch,
      primaryGoal,
      autoOpenDockTab,
      shouldInterruptLiveReply: true,
    };
  }

  return {
    kind: 'live_chat',
    cleanedTranscript,
    language,
    dashboardMatch,
    primaryGoal: 'chat',
    autoOpenDockTab: 'none',
    shouldInterruptLiveReply: false,
  };
}
