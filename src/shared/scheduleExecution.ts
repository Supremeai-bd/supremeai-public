/**
 * Shared HTML-to-text & AI prompt builders for scheduled web monitoring jobs.
 * Runs identically in Node Express and Cloudflare Pages Edge workers.
 */

export function extractHtmlTitle(rawHtml: string, fallback: string = ''): string {
  const match = String(rawHtml || '').match(/<title[^>]*>([\s\S]{1,160}?)<\/title>/i);
  if (!match) return fallback;
  return match[1].replace(/\s+/g, ' ').trim() || fallback;
}

export function extractReadablePageSnippet(rawBody: string, maxChars: number = 3500): string {
  const source = String(rawBody || '');
  if (!source.trim()) return '';
  const withoutBlocks = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const stripped = withoutBlocks
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  const collapsed = stripped
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  return collapsed.slice(0, maxChars);
}

export function buildScheduleEvaluationPrompt(params: {
  title: string;
  targetUrl: string;
  instruction: string;
  pageTitle: string;
  statusCode: number;
  pageText: string;
}): string {
  return [
    `Evaluate the scheduled web check below and execute the user's instruction accurately.`,
    `Job Title: ${params.title}`,
    `Target URL: ${params.targetUrl}`,
    `HTTP Status: ${params.statusCode}`,
    `Page Title: ${params.pageTitle}`,
    `User Instruction: ${params.instruction || 'Summarize key updates on this page.'}`,
    ``,
    `Extracted Page Content:`,
    `"""`,
    params.pageText.slice(0, 3200) || '(No readable text extracted from page)',
    `"""`,
    ``,
    `Respond strictly in JSON with:`,
    `- "headline": a single concise line (max 120 chars) summarizing the finding for logs`,
    `- "report": a clean factual summary (2-6 bullet lines or concise paragraph, max 900 chars) directly answering the user's instruction based only on the content above.`,
  ].join('\n');
}
