import { Hono } from 'hono';
import type { ApiDeps, ApiEnv } from '../app';
import { readEnv } from '../app';
import { EN_DICT } from '../../locales/en';

const LANG_CODE_RE = /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,4})?$/;

async function fetchFromSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  lang: string,
  fetchFn: typeof fetch
): Promise<Record<string, string> | null> {
  try {
    const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/ui_translations?lang_code=eq.${encodeURIComponent(lang)}&select=translations&limit=1`;
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ translations?: Record<string, string> }>;
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.translations) {
      return rows[0].translations;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveToSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  lang: string,
  translations: Record<string, string>,
  fetchFn: typeof fetch
): Promise<void> {
  try {
    const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/ui_translations`;
    await fetchFn(url, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        lang_code: lang,
        translations,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-fatal: still return the translated dictionary to the client
  }
}

async function translateViaLlm(
  dict: Record<string, string>,
  targetLang: string,
  apiKey: string,
  endpoint: string,
  model: string,
  fetchFn: typeof fetch
): Promise<Record<string, string> | null> {
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a UI localization engine. Translate the JSON values from English to language code "${targetLang}". Preserve all JSON keys, placeholders (like {count}, {{name}}), and markdown/emoji intact. Return ONLY valid JSON.`,
          },
          {
            role: 'user',
            content: JSON.stringify(dict),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged: Record<string, string> = { ...dict };
    for (const key of Object.keys(dict)) {
      if (typeof parsed[key] === 'string' && parsed[key].trim()) {
        merged[key] = parsed[key] as string;
      }
    }
    return merged;
  } catch {
    return null;
  }
}

export function createI18nRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const router = new Hono<ApiEnv>();
  const fetchFn = deps.fetch ?? fetch;

  router.get('/api/i18n/:lang', async (c) => {
    const lang = (c.req.param('lang') || 'en').trim().toLowerCase();
    if (!LANG_CODE_RE.test(lang)) {
      return c.json({ error: 'Invalid language code' }, 400);
    }

    if (lang === 'en') {
      return c.json({ lang: 'en', translations: EN_DICT, source: 'builtin' });
    }

    const supabaseUrl = readEnv(c, 'SUPABASE_URL') || readEnv(c, 'VITE_SUPABASE_URL');
    const supabaseKey =
      readEnv(c, 'SUPABASE_SERVICE_ROLE_KEY') ||
      readEnv(c, 'SUPABASE_ANON_KEY') ||
      readEnv(c, 'VITE_SUPABASE_ANON_KEY');

    // 1. Check Supabase DB cache first
    if (supabaseUrl && supabaseKey) {
      const cached = await fetchFromSupabase(supabaseUrl, supabaseKey, lang, fetchFn);
      if (cached) {
        return c.json({
          lang,
          translations: { ...EN_DICT, ...cached },
          source: 'database',
        });
      }
    }

    // 2. Auto-translate via LLM if not in DB
    const groqKey = readEnv(c, 'GROQ_API_KEY');
    const openaiKey = readEnv(c, 'OPENAI_API_KEY');
    let translated: Record<string, string> | null = null;

    if (groqKey) {
      translated = await translateViaLlm(
        EN_DICT,
        lang,
        groqKey,
        'https://api.groq.com/openai/v1/chat/completions',
        'llama-3.3-70b-versatile',
        fetchFn
      );
    } else if (openaiKey) {
      translated = await translateViaLlm(
        EN_DICT,
        lang,
        openaiKey,
        'https://api.openai.com/v1/chat/completions',
        'gpt-4o-mini',
        fetchFn
      );
    }

    if (translated) {
      if (supabaseUrl && supabaseKey) {
        await saveToSupabase(supabaseUrl, supabaseKey, lang, translated, fetchFn);
      }
      return c.json({
        lang,
        translations: translated,
        source: 'auto-translated',
      });
    }

    // 3. Fallback to English if no LLM key is configured
    return c.json({
      lang,
      translations: EN_DICT,
      source: 'fallback-en',
    });
  });

  return router;
}
