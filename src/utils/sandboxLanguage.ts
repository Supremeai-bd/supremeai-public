/**
 * বাংলা মন্তব্য: স্যান্ডবক্সে আর "ভাষা বাছাই" ড্রপডাউন নেই। কোড-ব্লকের ট্যাগ (AI যা দিয়েছে)
 * আর কোডের ভেতরের চিহ্ন দেখে সিস্টেম নিজেই ঠিক রানটাইম বেছে নেয়। ইউজার শুধু কোড লেখে/পেস্ট করে।
 */
export type SandboxRuntime = 'javascript' | 'typescript' | 'tsx' | 'html' | 'json';

export interface SandboxLangResolution {
  runtime: SandboxRuntime | 'unsupported';
  originalLang: string;
}

const TAG_TO_RUNTIME: Record<string, SandboxRuntime> = {
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  mts: 'typescript',
  tsx: 'tsx',
  jsx: 'tsx',
  react: 'tsx',
  html: 'html',
  htm: 'html',
  svg: 'html',
  xml: 'html',
  json: 'json',
};

const GENERIC_TAGS = new Set(['', 'code', 'text', 'plaintext', 'txt']);

export const SANDBOX_RUNTIME_LABELS: Record<SandboxRuntime, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  tsx: 'React / TSX',
  html: 'HTML',
  json: 'JSON',
};

function looksLikeJson(code: string): boolean {
  if (!(code.startsWith('{') || code.startsWith('['))) return false;
  try {
    JSON.parse(code);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(code: string): boolean {
  return /^<(!doctype\s+html|html|head|body|div|section|main|svg|p|h[1-6]|ul|ol|table|form|button|span|style|script|canvas|img|a|nav|header|footer|article)\b/i.test(
    code
  );
}

function looksLikeReactComponent(code: string): boolean {
  return (
    /return\s*\(?\s*<[A-Za-z>]/.test(code) &&
    /(export\s+default|function\s+[A-Z]\w*\s*\(|const\s+[A-Z]\w*\s*=|React|use(State|Effect|Memo|Ref)\s*\()/.test(
      code
    )
  );
}

function looksLikeTypeScript(code: string): boolean {
  return /(\binterface\s+[A-Z]\w*\s*\{|\btype\s+[A-Z]\w*\s*=|:\s*(string|number|boolean|void|unknown|any|never)(\[\])?\s*[,)=;{]|\bas\s+(const|string|number|unknown)\b|<[A-Z]\w*>\s*\()/.test(
    code
  );
}

/** কোডের ভেতরের শক্ত চিহ্ন দেখে রানটাইম অনুমান — কিছু নিশ্চিত না হলে null। */
export function sniffSandboxRuntime(code: string): SandboxRuntime | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (looksLikeJson(trimmed)) return 'json';
  if (looksLikeHtml(trimmed)) return 'html';
  if (looksLikeReactComponent(trimmed)) return 'tsx';
  return null;
}

/**
 * ট্যাগ + কোড → স্যান্ডবক্স রানটাইম। কোডের শক্ত চিহ্ন ট্যাগের চেয়ে অগ্রাধিকার পায়, যাতে
 * ইউজার হাতে কোড বদলালেও (যেমন JS-এর জায়গায় HTML পেস্ট) ঠিক রানটাইমে চলে।
 * Python/PHP-এর মতো সার্ভার-ভাষা ব্রাউজার স্যান্ডবক্সে চলে না → 'unsupported'।
 */
export function resolveSandboxLanguage(lang: string, code: string): SandboxLangResolution {
  const raw = (lang || '').toLowerCase().trim();
  const tagRuntime = TAG_TO_RUNTIME[raw];
  const sniffed = sniffSandboxRuntime(code);

  if (sniffed) return { runtime: sniffed, originalLang: sniffed };

  if (tagRuntime) {
    if (tagRuntime === 'javascript' && looksLikeTypeScript(code)) {
      return { runtime: 'typescript', originalLang: 'typescript' };
    }
    return { runtime: tagRuntime, originalLang: raw };
  }

  if (GENERIC_TAGS.has(raw)) {
    return looksLikeTypeScript(code)
      ? { runtime: 'typescript', originalLang: 'typescript' }
      : { runtime: 'javascript', originalLang: 'javascript' };
  }

  return { runtime: 'unsupported', originalLang: raw };
}
