import type { BrowserNavigationMetadata } from '../types';

export interface BrowserNavigationIntent {
  url: string;
  hostname: string;
  isAuthWalled: boolean;
  isExplicitNavVerb: boolean;
}

export interface VirtualBrowserSnapshot {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  url: string;
  title: string;
  statusCode: number | null;
  textPreview: string;
  error: string | null;
}

const KNOWN_SITE_SHORTCUTS: Record<string, string> = {
  facebook: 'https://facebook.com',
  fb: 'https://facebook.com',
  wikipedia: 'https://en.wikipedia.org',
  wiki: 'https://en.wikipedia.org',
  github: 'https://github.com',
  youtube: 'https://youtube.com',
  yt: 'https://youtube.com',
  google: 'https://google.com',
  reddit: 'https://reddit.com',
  linkedin: 'https://linkedin.com',
  instagram: 'https://instagram.com',
  insta: 'https://instagram.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  hackernews: 'https://news.ycombinator.com',
  hn: 'https://news.ycombinator.com',
  stackoverflow: 'https://stackoverflow.com',
  mdn: 'https://developer.mozilla.org',
  prothomalo: 'https://prothomalo.com',
  bbc: 'https://bbc.com',
  cnn: 'https://cnn.com',
};

const AUTH_WALLED_HOST_PATTERN =
  /(?:^|\.)(?:facebook\.com|fb\.com|m\.facebook\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com|tiktok\.com|threads\.net|accounts\.google\.com|mail\.google\.com)$/i;

const EXPLICIT_NAV_VERB_PATTERN =
  /\b(?:go\s+to|goto|navigate\s+to|visit|open|browse|load|launch|take\s+me\s+to|pull\s+up|open\s+up|show\s+me|check\s+site|kholo|khulo|jao|dekho|dekhao|open\s+koro|visit\s+koro)\b|(?:যাও|খুলো|খোলো|ভিজিট|দেখো|দেখাও|ওপেন\s*করো|ব্রাউজ)/i;

const NON_BROWSE_TECHNICAL_PATTERN =
  /\b(?:cors|dns|nginx|cloudflare|ssl|tls|certificate|api\s+endpoint|fetch\s+error|scrape|scraping\s+script|write\s+code|debug|fix\s+the\s+bug|architecture)\b/i;

const REFUSAL_PATTERNS: RegExp[] = [
  /unable to navigate to or browse external websites/i,
  /unable to directly navigate to websites/i,
  /cannot (?:directly )?(?:navigate|browse|access|visit|open) (?:to )?(?:external )?websites/i,
  /don't have (?:the )?(?:ability|capability) to (?:browse|navigate|access|visit) (?:the )?(?:web|internet|external websites)/i,
  /recommend using a web browser to access/i,
  /you'll need to visit .* directly via your browser/i,
  /as an ai assistant focused on technical challenges/i,
];

export function isAuthWalledDomain(hostname: string): boolean {
  return AUTH_WALLED_HOST_PATTERN.test(hostname.trim().toLowerCase());
}

export function normalizeBrowserTargetUrl(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[<("'`[]+|[>),.;!?'"`\]।]+$/g, '');
  if (!cleaned) return null;

  const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const parsed = new URL(withProto);
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Ignore file extensions that look like filenames instead of web domains (e.g. App.tsx, server.ts)
    const tld = parsed.hostname.split('.').pop()?.toLowerCase() || '';
    const NON_WEB_EXT = new Set([
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'css',
      'scss',
      'html',
      'json',
      'md',
      'txt',
      'yml',
      'yaml',
      'env',
      'lock',
      'png',
      'jpg',
      'jpeg',
      'svg',
      'gif',
      'pdf',
    ]);
    if (NON_WEB_EXT.has(tld) && !/^https?:\/\//i.test(cleaned)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function detectBrowserNavigationIntent(input: string): BrowserNavigationIntent | null {
  const text = (input || '').trim();
  if (!text || text.length > 400) return null;
  if (text.includes('```')) return null;

  const hasExplicitNav = EXPLICIT_NAV_VERB_PATTERN.test(text);

  // 1. Direct URL or domain match (e.g., https://en.wikipedia.org or facebook.com)
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  const domainMatch = text.match(
    /(?:^|[\s(])((?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|bd|edu|gov|co|app|me|info|xyz|tv|uk|in|news|blog)(?:\/[^\s"'<>]*)?)/i
  );

  let resolvedUrl: string | null = null;
  if (urlMatch) {
    resolvedUrl = normalizeBrowserTargetUrl(urlMatch[0]);
  } else if (domainMatch) {
    resolvedUrl = normalizeBrowserTargetUrl(domainMatch[1]);
  } else if (hasExplicitNav) {
    // 2. Known site shortcut with explicit nav verb (e.g. "go to wikipedia", "facebook এ যাও")
    const shortcutMatch = text.match(
      /\b(facebook|fb|wikipedia|wiki|github|youtube|yt|google|reddit|linkedin|instagram|insta|twitter|hackernews|hn|stackoverflow|mdn|prothomalo|bbc|cnn)\b/i
    );
    if (shortcutMatch) {
      const candidate = KNOWN_SITE_SHORTCUTS[shortcutMatch[1].toLowerCase()];
      resolvedUrl = candidate ? normalizeBrowserTargetUrl(candidate) : null;
    }
  }

  if (!resolvedUrl) return null;

  // Bare URLs / very short prompts (<= 5 words) are unambiguous navigation requests
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (!hasExplicitNav) {
    if (wordCount > 4) return null;
    if (NON_BROWSE_TECHNICAL_PATTERN.test(text)) return null;
  }

  // If explicit nav verb is present alongside clearly non-browsing prompt, still respect explicit "go to X" / "open X"
  const hostname = new URL(resolvedUrl).hostname.replace(/^www\./i, '');
  return {
    url: resolvedUrl,
    hostname,
    isAuthWalled: isAuthWalledDomain(hostname),
    isExplicitNavVerb: hasExplicitNav,
  };
}

export function buildBrowserSystemContext(
  intent: BrowserNavigationIntent,
  snapshot?: Partial<VirtualBrowserSnapshot> | null
): string {
  const title = snapshot?.title?.trim() || intent.hostname;
  const status = snapshot?.status || 'loading';
  const statusCode = snapshot?.statusCode ?? null;
  const excerpt = (snapshot?.textPreview || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  const errorText = snapshot?.error?.trim() || '';

  return [
    '[VIRTUAL BROWSER ACTIVE — MANDATORY TOOL GROUNDING]',
    `SupremeAI Studio has ALREADY opened "${intent.url}" inside the integrated Virtual Browser Dock on the user's screen.`,
    `Host: ${intent.hostname}`,
    `Current Load State: ${status}${statusCode ? ` (HTTP ${statusCode})` : ''}`,
    `Page Title: ${title}`,
    intent.isAuthWalled
      ? 'Platform Notice: This domain enforces strict authentication/login walls and anti-bot checks on cloud proxy requests; the user can view the Virtual Browser frame and click "Open External Tab" for their full logged-in browser session.'
      : '',
    excerpt ? `Extracted Page Excerpt:\n"""\n${excerpt}\n"""` : '',
    errorText ? `Proxy Fetch Note: ${errorText}` : '',
    'CRITICAL RULES FOR YOUR RESPONSE:',
    '1. NEVER say "I am unable to navigate", "I cannot browse external websites", or tell the user that you lack web navigation capabilities.',
    '2. Confirm clearly that you opened the site in the Virtual Browser dock on the right.',
    '3. If Page Excerpt text is available above, briefly summarize what loaded. If it is behind a login/anti-bot wall (such as Facebook) or returned an HTTP status note, explain that clearly and remind them they can use the "Open External Tab" button directly below or in the Virtual Browser toolbar.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function isBrowserRefusalResponse(text: string): boolean {
  if (!text || !text.trim()) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildGroundedBrowserMessage(
  intent: BrowserNavigationIntent,
  snapshot: Partial<VirtualBrowserSnapshot> | null | undefined,
  language: 'en' | 'bn' = 'en'
): string {
  const isBn = language === 'bn';
  const title = snapshot?.title?.trim() || intent.hostname;
  const excerpt = (snapshot?.textPreview || '').replace(/\s+/g, ' ').trim().slice(0, 420);
  const statusCode = snapshot?.statusCode ?? null;
  const isLoadedOk = snapshot?.status === 'loaded' && (!statusCode || statusCode < 400);

  if (isBn) {
    if (intent.isAuthWalled || !isLoadedOk) {
      return [
        `**${intent.hostname}** এখনই আপনার স্ক্রিনের **Virtual Browser** ডকে ওপেন করা হয়েছে (${intent.url})।`,
        '',
        intent.isAuthWalled
          ? `দ্রষ্টব্য: **${intent.hostname}**-এ লগইন ও অ্যান্টি-বট সুরক্ষা থাকায় প্রক্সি প্রিভিউ সীমিত হতে পারে। আপনার নিজস্ব লগইন-করা ব্রাউজার সেশনে সম্পূর্ণ সাইটটি দেখতে নিচের **"Open External Tab"** বাটনে ক্লিক করুন অথবা ডানপাশের Virtual Browser টুলবার ব্যবহার করুন।`
          : snapshot?.error
            ? `প্রক্সি রেসপন্স নোট: \`${snapshot.error}\` — ডানপাশের Virtual Browser থেকে রিফ্রেশ করুন অথবা **"Open External Tab"** দিয়ে সরাসরি খুলুন।`
            : `পেজ স্ট্যাটাস: \`HTTP ${statusCode || 200}\` · **${title}**।`,
        excerpt ? `\n**প্রাপ্ত পেজ প্রিভিউ:**\n> ${excerpt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    return [
      `**${title}** এখন আপনার ডানপাশের **Virtual Browser** ডকে লোড হয়েছে (${intent.url})।`,
      excerpt ? `\n**পেজ সারসংক্ষেপ:**\n> ${excerpt}` : '',
      `\nআপনি ডানপাশের Virtual Browser থেকেই লিংক ব্রাউজ করতে পারবেন অথবা চাইলে নিচের বাটন থেকে মূল ট্যাবে খুলতে পারবেন।`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (intent.isAuthWalled || !isLoadedOk) {
    return [
      `**${intent.hostname}** is now open in the **Virtual Browser** dock on the right (${intent.url}).`,
      '',
      intent.isAuthWalled
        ? `Because **${intent.hostname}** enforces strict login and anti-bot protections on headless proxies, click **"Open External Tab"** below (or in the Virtual Browser bar) to interact with your authenticated session directly.`
        : snapshot?.error
          ? `Proxy status note: \`${snapshot.error}\`. You can retry inside the Virtual Browser or open it directly in a new tab below.`
          : `Loaded status: \`HTTP ${statusCode || 200}\` · **${title}**.`,
      excerpt ? `\n**Page Preview:**\n> ${excerpt}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `**${title}** has been opened in your **Virtual Browser** dock (${intent.url}).`,
    excerpt ? `\n**Page Summary:**\n> ${excerpt}` : '',
    `\nYou can click links interactively inside the Virtual Browser pane or open it externally below.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function rewriteBrowserRefusalIfNeeded(
  aiText: string,
  intent: BrowserNavigationIntent | null,
  snapshot: Partial<VirtualBrowserSnapshot> | null | undefined,
  language: 'en' | 'bn' = 'en'
): string {
  if (!intent) return aiText;
  if (!aiText.trim() || isBrowserRefusalResponse(aiText)) {
    return buildGroundedBrowserMessage(intent, snapshot, language);
  }
  return aiText;
}

export function toBrowserNavigationMetadata(
  intent: BrowserNavigationIntent,
  snapshot?: Partial<VirtualBrowserSnapshot> | null
): BrowserNavigationMetadata {
  const statusCode = snapshot?.statusCode ?? null;
  let proxyStatus: BrowserNavigationMetadata['proxyStatus'] = 'loading';
  if (snapshot?.status === 'error') {
    proxyStatus = 'error';
  } else if (snapshot?.status === 'loaded') {
    proxyStatus = statusCode && statusCode >= 400 ? 'blocked' : 'loaded';
  }

  return {
    url: snapshot?.url?.trim() || intent.url,
    hostname: intent.hostname,
    title: snapshot?.title?.trim() || intent.hostname,
    statusCode,
    isAuthWalled: intent.isAuthWalled,
    proxyStatus,
    textPreview: snapshot?.textPreview?.trim().slice(0, 260) || undefined,
  };
}
