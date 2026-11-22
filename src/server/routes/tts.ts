import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { GoogleGenAI, Modality } from '@google/genai';
import { WebSocket } from 'ws';
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
} from '../../utils/speechUtils';
import type { LiveVoiceName } from '../../hooks/useLiveVoiceSession';
import {
  EDGE_TTS_ORIGIN,
  EDGE_TTS_USER_AGENT,
  computeEdgeTtsSecMsGecInput,
  resolveEdgeTtsClientConfig,
} from '../../shared/edgeTtsConfig';

/**
 * Multilingual Neural TTS — `POST /api/tts` + `POST /api/tts/edge`
 *
 * WHY THIS FILE EXISTS
 *   Two TTS endpoints (Gemini cloud + Edge Neural fallback) lived inline in
 *   `server.ts` (~360 lines). Cohesive (shared voice/pitch validation,
 *   Bengali detection, SSML helpers) and have no other consumer. Moving them
 *   keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - Both route handlers are OWNED here (no other route reads TTS state).
 *   - `isIpBlocked` (WAF check) is injected via ctx (closure over blockedIps).
 *   - Speech helpers (`clampVoicePitch`, `normalizeBanglaAccent`, etc.) are
 *     imported directly from `src/utils/speechUtils` (pure functions).
 *   - `GoogleGenAI`, `WebSocket`, `crypto` are imported directly.
 */

export interface TtsContext {
  isIpBlocked: (req: Request) => boolean;
}

export function registerTtsRoutes(app: Express, ctx: TtsContext): void {
  // Multilingual Neural Text-to-Speech endpoint (supports seamless Bengali/বাংলা + English speech)
  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      if (ctx.isIpBlocked(req)) {
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
      if (ctx.isIpBlocked(req)) {
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

      // বাংলা মন্তব্য: শেয়ার্ড কনফিগ ব্যবহার করে Edge ReadAloud Sec-MS-GEC টোকেন তৈরি করা হচ্ছে (DRY নীতি ও এনভায়রনমেন্ট ওভাররাইড সমর্থনসহ)
      const { trustedClientToken, gecVersion } = resolveEdgeTtsClientConfig(
        process.env as Record<string, string | undefined>
      );
      const secMsGec = crypto
        .createHash('sha256')
        .update(computeEdgeTtsSecMsGecInput(trustedClientToken))
        .digest('hex')
        .toUpperCase();

      const requestId = crypto.randomUUID().replace(/-/g, '');
      const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
      const wsUrl =
        `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
        `?TrustedClientToken=${trustedClientToken}` +
        `&Sec-MS-GEC=${secMsGec}` +
        `&Sec-MS-GEC-Version=${encodeURIComponent(gecVersion)}` +
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
              'User-Agent': EDGE_TTS_USER_AGENT,
              Origin: EDGE_TTS_ORIGIN,
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
      } catch (wsErr) {
        console.warn('[tts/edge] Edge WebSocket synthesis failed, falling back to bilingual MP3:', wsErr);
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
}
