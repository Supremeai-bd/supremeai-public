/**
 * বাংলা মন্তব্য: AI Memory — কোন AI থেকে মেমরি আনা যায়, তাদের মেমরি পেজের সরাসরি লিংক, আর কী করতে হবে।
 *
 * এই AI-গুলোর মেমরি পড়ার পাবলিক API নেই, তাই দুটো পথ:
 *  ১) মেমরি পেজ খুলে তালিকা কপি করা, অথবা
 *  ২) ওই AI-কে `MEMORY_EXPORT_PROMPT` পাঠিয়ে উত্তরটা কপি করা।
 * দুটোই এখানে পেস্ট করলে লাইন ধরে আলাদা মেমরি হয়ে যায়।
 */

export interface MemorySource {
  id: string;
  label: string;
  icon: string;
  /** Tailwind classes for the source badge. */
  tone: string;
  /** Direct link to where that AI shows its memories (or the chat, if it has no memory page). */
  memoryPageUrl?: string;
  steps?: { bn: string; en: string }[];
  /** Can the user import from it? (`supremeai` / `mcp` rows are written by the system.) */
  importable: boolean;
}

/** Sent to the other AI so it answers with a clean one-per-line list we can parse. */
export const MEMORY_EXPORT_PROMPT =
  'List everything you remember about me (saved memories, preferences, facts about my work and life). ' +
  'One item per line, each a short complete sentence starting with "- ". No intro, no headings, no extra text.';

const PROMPT_STEPS = (where: string) => [
  { bn: `${where} খুলুন`, en: `Open ${where}` },
  {
    bn: 'নিচের "প্রম্পট কপি করুন" দিয়ে প্রম্পটটা পাঠান',
    en: 'Send it the prompt from "Copy prompt" below',
  },
  { bn: 'উত্তরটা পুরোটা কপি করে এখানে পেস্ট করুন', en: 'Copy the whole answer and paste it here' },
];

export const MEMORY_SOURCES: MemorySource[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    icon: '🟢',
    tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    memoryPageUrl: 'https://chatgpt.com/#settings/Personalization',
    importable: true,
    steps: [
      {
        bn: 'Settings → Personalization → "Manage memories" খুলুন',
        en: 'Open Settings → Personalization → "Manage memories"',
      },
      {
        bn: 'তালিকাটা সিলেক্ট করে কপি করুন — অথবা নিচের প্রম্পট ChatGPT-কে পাঠান',
        en: 'Select and copy the list — or send ChatGPT the prompt below',
      },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
  {
    id: 'claude',
    label: 'Claude',
    icon: '🟠',
    tone: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
    memoryPageUrl: 'https://claude.ai/settings/capabilities',
    importable: true,
    steps: [
      {
        bn: 'Settings → Capabilities → "View and edit memory" চাপুন',
        en: 'Go to Settings → Capabilities → "View and edit memory"',
      },
      {
        bn: 'লেখাটা কপি করুন — অথবা নিচের প্রম্পট Claude-কে পাঠান',
        en: 'Copy the text — or send Claude the prompt below',
      },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: '🔷',
    tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    memoryPageUrl: 'https://gemini.google.com/saved-info',
    importable: true,
    steps: [
      {
        bn: '"Saved info" পেজে আপনার সব এন্ট্রি দেখাবে',
        en: 'The "Saved info" page lists every entry',
      },
      {
        bn: 'এন্ট্রিগুলো কপি করুন — অথবা নিচের প্রম্পট Gemini-কে পাঠান',
        en: 'Copy the entries — or send Gemini the prompt below',
      },
      { bn: 'এখানে পেস্ট করুন', en: 'Paste it here' },
    ],
  },
  {
    id: 'copilot',
    label: 'Copilot',
    icon: '🌀',
    tone: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    memoryPageUrl: 'https://copilot.microsoft.com/',
    importable: true,
    steps: PROMPT_STEPS('Copilot'),
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    icon: '🔎',
    tone: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
    memoryPageUrl: 'https://www.perplexity.ai/',
    importable: true,
    steps: PROMPT_STEPS('Perplexity'),
  },
  {
    id: 'grok',
    label: 'Grok',
    icon: '✖️',
    tone: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
    memoryPageUrl: 'https://grok.com/',
    importable: true,
    steps: PROMPT_STEPS('Grok'),
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    icon: '🐋',
    tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    memoryPageUrl: 'https://chat.deepseek.com/',
    importable: true,
    steps: PROMPT_STEPS('DeepSeek'),
  },
  {
    id: 'meta',
    label: 'Meta AI',
    icon: '♾️',
    tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    memoryPageUrl: 'https://www.meta.ai/',
    importable: true,
    steps: PROMPT_STEPS('Meta AI'),
  },
  {
    id: 'other',
    label: 'Other AI',
    icon: '🤖',
    tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
    importable: true,
    steps: PROMPT_STEPS('that AI'),
  },
  {
    id: 'manual',
    label: 'Added by you',
    icon: '✍️',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    importable: false,
  },
  {
    id: 'supremeai',
    label: 'SupremeAI',
    icon: '⚡',
    tone: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    importable: false,
  },
  {
    id: 'mcp',
    label: 'SupremeAI agent',
    icon: '⚡',
    tone: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    importable: false,
  },
];

const BY_ID = new Map(MEMORY_SOURCES.map((s) => [s.id, s]));

/** Unknown sources already in the DB still get a readable badge. */
export function memorySourceFor(id: string): MemorySource {
  return (
    BY_ID.get(id) || {
      id,
      label: id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Other',
      icon: '🤖',
      tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
      importable: false,
    }
  );
}

export const IMPORTABLE_MEMORY_SOURCES = MEMORY_SOURCES.filter((s) => s.importable);

const BULLET = /^\s*(?:[-*•·▪◦‣–—]|\d{1,3}[.)]|\[[ x]\])\s*/i;
const HEADER =
  /^(here(?:'s| is| are)|sure[,!]|okay[,!]?|of course|below (?:is|are)|these are|i remember|based on (?:our|what)|memory\b|saved memories|my memories|summary).*?:\s*$/i;

/**
 * Turns pasted text (a memory page copy or an AI's answer) into separate memories:
 * one per line or bullet, markdown stripped, intros/headings dropped, duplicates removed.
 * A JSON array of strings (or of `{content}`) is accepted too.
 */
export function parseMemoryText(text: string, maxChars = 1000): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  let lines: string[] | null = null;
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        lines = parsed.map((v) =>
          typeof v === 'string'
            ? v
            : v && typeof v === 'object'
              ? String((v as Record<string, unknown>).content ?? '')
              : ''
        );
      }
    } catch {
      lines = null;
    }
  }
  lines ??= raw.split(/\r?\n/);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let item = line
      .replace(BULLET, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (item.length < 3 || HEADER.test(item) || /^[-=_*]{3,}$/.test(item)) continue;
    if (item.length > maxChars) item = item.slice(0, maxChars).trim();
    const key = item.toLowerCase().replace(/[.!?।\s]+$/u, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
