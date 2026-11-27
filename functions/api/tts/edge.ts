/**
 * Cloudflare Pages Edge Function: `/api/tts/edge`
 * Provides zero-backend-dependency Bengali + English neural & MP3 speech synthesis
 * directly on Cloudflare's Edge Network (eliminates 404s on static Pages deploys
 * like `supremeai-studio.pages.dev` and keeps Windows PC Chrome speaking Bengali).
 */

import {
  EDGE_TTS_ORIGIN,
  EDGE_TTS_USER_AGENT,
  computeEdgeTtsSecMsGecInput,
  resolveEdgeTtsClientConfig,
} from '../../../src/shared/edgeTtsConfig';
import {
  TTS_INTL_VOICES,
  googleTlForLocale,
  normalizeTtsLanguage,
} from '../../../src/shared/ttsLanguages';

interface PagesContext {
  request: Request;
  env?: Record<string, string | undefined>;
}

interface TtsAudioChunk {
  audioBase64: string;
  mimeType: string;
  /** bn-BD | bn-IN | en-US | hi-IN | es-ES | … */
  lang: string;
}

type BanglaAccentId = 'bn-bd' | 'bn-in';

function clampPitch(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? '1'));
  if (!Number.isFinite(num)) return 1.0;
  return Math.min(1.6, Math.max(0.6, Math.round(num * 100) / 100));
}

function pitchToSsml(pitch: number): string {
  const deltaPct = Math.max(-35, Math.min(35, Math.round((clampPitch(pitch) - 1.0) * 50)));
  if (deltaPct === 0) return '+0%';
  return deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`;
}

type EdgeWorkerSocket = WebSocket & { accept?: () => void };

const BANGLISH_MARKER_REGEX =
  /\b(kemon|kmn|acho|aso|accho|tumi|apni|tui|amake|tomake|apnake|kothay|kivabe|kibhabe|bhalo|valo|dhonnobad|nomoshkar|korbo|korte|korchi|koro|parbo|parchi|parce|parbe|hocche|hobe|hoye|geche|amader|tomader|apnar|tomar|bolen|bolun|bolte|bolchi|likho|lekho|shuno|janau|jano|lagbe|parina|janina|bujhi|bujhte|achha|accha|khobor|obostha|bangla|bengali|banglate|banglay|banglai)\b/i;

function hasBengaliOrBanglish(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text) || BANGLISH_MARKER_REGEX.test(text);
}

function splitUnifiedSentences(text: string): Array<{ text: string; lang: 'bn-BD' | 'en-US' }> {
  const clean = text.trim();
  if (!clean) return [];
  if (!hasBengaliOrBanglish(clean)) {
    return [{ text: clean, lang: 'en-US' }];
  }

  const sentences = clean
    .split(/\n+|(?<=[।.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const segments: Array<{ text: string; lang: 'bn-BD' | 'en-US' }> = [];
  for (const sentence of sentences) {
    const sentenceHasBn = hasBengaliOrBanglish(sentence);
    const latinWords = (sentence.match(/[A-Za-z]{2,}/g) || []).length;
    const isLongPureEnglish = !sentenceHasBn && sentence.length >= 100 && latinWords >= 12;
    const lang: 'bn-BD' | 'en-US' = isLongPureEnglish ? 'en-US' : 'bn-BD';
    const prev = segments[segments.length - 1];
    if (prev && prev.lang === lang) {
      prev.text = `${prev.text} ${sentence}`;
    } else {
      segments.push({ text: sentence, lang });
    }
  }
  return segments.length > 0 ? segments : [{ text: clean, lang: 'bn-BD' }];
}

function chunkText(text: string, maxChars: number = 175): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    let splitAt = Math.max(
      slice.lastIndexOf('।'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf(', ')
    );
    if (splitAt < maxChars * 0.4) {
      splitAt = slice.lastIndexOf(' ');
    }
    splitAt = splitAt <= 0 ? maxChars : splitAt + 1;
    const piece = remaining.slice(0, splitAt).trim();
    if (piece) chunks.push(piece);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return merged;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function applyCorsHeaders(headers: Headers, requestOrigin: string): void {
  headers.set('Access-Control-Allow-Origin', requestOrigin || '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-SupremeAI-Key, Accept'
  );
  headers.set('Vary', 'Origin');
}

async function computeSecMsGec(trustedToken: string): Promise<string> {
  // বাংলা মন্তব্য: শেয়ার্ড কনফিগ থেকে Sec-MS-GEC পে-লোড তৈরি করে SHA-256 হ্যাশ করা হচ্ছে
  const payload = new TextEncoder().encode(computeEdgeTtsSecMsGecInput(trustedToken));
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function synthesizeViaEdgeWs(
  text: string,
  edgeVoice: string,
  edgeLang: string,
  ssmlPitch: string,
  env?: Record<string, string | undefined>
): Promise<Uint8Array> {
  const { trustedClientToken, gecVersion } = resolveEdgeTtsClientConfig(env);
  const secMsGec = await computeSecMsGec(trustedClientToken);
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const muidBytes = new Uint8Array(16);
  crypto.getRandomValues(muidBytes);
  const muid = Array.from(muidBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const edgeHttpsUrl =
    `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${trustedClientToken}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${encodeURIComponent(gecVersion)}` +
    `&ConnectionId=${requestId}`;

  const upgradeResp = await fetch(edgeHttpsUrl, {
    headers: {
      Upgrade: 'websocket',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': EDGE_TTS_USER_AGENT,
      Origin: EDGE_TTS_ORIGIN,
      Cookie: `muid=${muid};`,
    },
  });

  const ws = (upgradeResp as unknown as { webSocket?: EdgeWorkerSocket }).webSocket;
  if (!ws) {
    throw new Error('Workers WebSocket upgrade unavailable for Edge TTS');
  }

  ws.accept?.();
  try {
    ws.binaryType = 'arraybuffer';
  } catch {}

  return new Promise<Uint8Array>((resolve, reject) => {
    const audioParts: Uint8Array[] = [];
    let settled = false;

    const finish = (err: Error | null, data?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (err) reject(err);
      else resolve(data || new Uint8Array(0));
    };

    const timer = setTimeout(() => {
      finish(new Error('Edge Neural TTS timed out'));
    }, 2600);

    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          const merged = concatBytes(audioParts);
          if (merged.byteLength === 0) finish(new Error('Edge TTS returned empty audio'));
          else finish(null, merged);
        }
        return;
      }

      let bytes: Uint8Array | null = null;
      if (event.data instanceof ArrayBuffer) {
        bytes = new Uint8Array(event.data);
      } else if (ArrayBuffer.isView(event.data)) {
        bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      }
      if (!bytes || bytes.byteLength < 2) return;

      const headerLen = (bytes[0] << 8) | bytes[1];
      const payloadStart = 2 + headerLen;
      if (payloadStart < bytes.byteLength) {
        const headerText = new TextDecoder().decode(bytes.subarray(2, payloadStart));
        if (headerText.includes('Path:audio')) {
          audioParts.push(bytes.subarray(payloadStart));
        }
      }
    });

    ws.addEventListener('error', () => {
      finish(new Error('Edge TTS WebSocket error'));
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        const merged = concatBytes(audioParts);
        if (merged.byteLength > 0) finish(null, merged);
        else finish(new Error('Edge TTS closed before turn completion'));
      }
    });

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
    ws.send(configMsg);

    // Single unified voice SSML (zero mid-sentence voice/gender switching)
    const ssmlRate = edgeLang === 'bn-BD' ? '-3%' : '+0%';
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${edgeLang}'><voice name='${edgeVoice}'><prosody pitch='${ssmlPitch}' rate='${ssmlRate}' volume='+0%'>${escapeXml(
      text
    )}</prosody></voice></speak>`;
    const ssmlMsg =
      `X-RequestId:${requestId}\r\n` +
      `Content-Type:application/ssml+xml\r\n` +
      `X-Timestamp:${timestamp}\r\n` +
      `Path:ssml\r\n\r\n` +
      ssml;
    ws.send(ssmlMsg);
  });
}

async function synthesizeViaUnifiedMp3(
  text: string,
  otherLocale: string = 'en-US'
): Promise<TtsAudioChunk[]> {
  const segments = splitUnifiedSentences(text);
  const jobs: Array<{ text: string; tl: string; lang: string }> = [];
  for (const seg of segments) {
    // Non-Bangla text speaks in the selected language (hi-IN, es-ES …), not always English.
    const lang = seg.lang === 'bn-BD' ? 'bn-BD' : otherLocale;
    const tl = googleTlForLocale(lang);
    for (const piece of chunkText(seg.text, 175)) {
      jobs.push({ text: piece, tl, lang });
    }
  }
  if (jobs.length === 0) {
    throw new Error('No speakable text provided');
  }

  const buffers: Uint8Array[] = new Array(jobs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${job.tl}&q=${encodeURIComponent(
        job.text
      )}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          Referer: 'https://translate.google.com/',
        },
      });
      if (!resp.ok) {
        throw new Error(`TTS chunk HTTP ${resp.status}`);
      }
      buffers[idx] = new Uint8Array(await resp.arrayBuffer());
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, () => worker()));
  return buffers.map((buf, idx) => ({
    audioBase64: bytesToBase64(buf),
    mimeType: 'audio/mpeg',
    lang: jobs[idx].lang,
  }));
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request } = context;
  const requestOrigin = request.headers.get('Origin') || '*';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  applyCorsHeaders(headers, requestOrigin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: unknown;
      voiceName?: unknown;
      language?: unknown;
      pitch?: unknown;
      accent?: unknown;
    };
    const rawText = typeof body.text === 'string' ? body.text.trim() : '';
    if (!rawText) {
      return new Response(JSON.stringify({ error: 'Text is required for speech synthesis.' }), {
        status: 400,
        headers,
      });
    }

    const truncatedText = rawText.slice(0, 1400);
    const voicePersona = typeof body.voiceName === 'string' ? body.voiceName.trim() : 'Zephyr';
    // বাংলা মন্তব্য: hi/es/fr/… নিজস্ব ভয়েস; আঞ্চলিক বাংলা (bn-ctg …) → বাংলা ভয়েস।
    const language = normalizeTtsLanguage(body.language);
    const intlVoice = TTS_INTL_VOICES[language];
    const pitch = clampPitch(body.pitch);
    const accent: BanglaAccentId = body.accent === 'bn-in' ? 'bn-in' : 'bn-bd';
    const ssmlPitch = pitchToSsml(pitch);
    const isBn =
      hasBengaliOrBanglish(truncatedText) ||
      (language === 'bn' && !/[A-Za-z]{2,}/.test(truncatedText));
    const preferMale =
      voicePersona === 'Puck' || voicePersona === 'Charon' || voicePersona === 'Fenrir';

    const useIntl = Boolean(intlVoice) && !/[\u0980-\u09FF]/.test(truncatedText);
    const edgeVoice = useIntl
      ? preferMale
        ? intlVoice.male
        : intlVoice.female
      : isBn
        ? accent === 'bn-in'
          ? preferMale
            ? 'bn-IN-BashkarNeural'
            : 'bn-IN-TanishaaNeural'
          : preferMale
            ? 'bn-BD-PradeepNeural'
            : 'bn-BD-NabanitaNeural'
        : preferMale
          ? 'en-US-AndrewMultilingualNeural'
          : 'en-US-AvaMultilingualNeural';
    const edgeLang: string = useIntl
      ? intlVoice.lang
      : isBn
        ? accent === 'bn-in'
          ? 'bn-IN'
          : 'bn-BD'
        : 'en-US';

    try {
      const wsAudio = await synthesizeViaEdgeWs(
        truncatedText,
        edgeVoice,
        edgeLang,
        ssmlPitch,
        context.env
      );
      const base64 = bytesToBase64(wsAudio);
      return new Response(
        JSON.stringify({
          audioBase64: base64,
          chunks: [{ audioBase64: base64, mimeType: 'audio/mpeg', lang: edgeLang }],
          mimeType: 'audio/mpeg',
          voice: edgeVoice,
          lang: edgeLang,
          pitch,
          accent,
          ssmlPitch,
          pitchAppliedServerSide: true,
          engine: 'cf-edge-ws',
        }),
        { status: 200, headers }
      );
    } catch (wsErr) {
      console.warn('[edge/tts] Edge WebSocket TTS failed, falling back to unified MP3:', wsErr);
      const chunks = await synthesizeViaUnifiedMp3(
        truncatedText,
        useIntl ? intlVoice.lang : 'en-US'
      );
      return new Response(
        JSON.stringify({
          audioBase64: chunks[0]?.audioBase64 || '',
          chunks,
          mimeType: 'audio/mpeg',
          voice: edgeVoice,
          lang: edgeLang,
          pitch,
          accent,
          ssmlPitch,
          pitchAppliedServerSide: false,
          engine: 'cf-edge-mp3',
        }),
        { status: 200, headers }
      );
    }
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Edge TTS synthesis failed',
      }),
      { status: 502, headers }
    );
  }
}
