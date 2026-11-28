import type http from 'node:http';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { parseCookieHeader } from '../shared/serverSecurity';
import { clampVoicePitch, normalizeBanglaAccent } from '../utils/speechUtils';

export interface WsBridgeContext {
  isProduction: boolean;
  blockedIps: Array<{ ip: string }>;
  platformConfig: { maintenanceMode: boolean; maintenanceMessage?: string };
  // বাংলা মন্তব্য: প্রক্সি-সচেতন ক্লায়েন্ট IP নির্ণয়ের ঐচ্ছিক হুক (Render/Cloudflare প্রক্সির পেছনে সঠিক বাকেটিং নিশ্চিত করে)
  getClientIp?: (req: http.IncomingMessage) => string;
  verifyBearerIdentity: (
    rawToken: string
  ) => Promise<{ email: string; isAdmin: boolean } | null>;
}

const DEFAULT_WS_ALLOWED_ORIGINS = new Set([
  'https://supremeai-studio.pages.dev',
  'https://supremeai.studio',
  'https://www.supremeai.studio',
  'https://tauri.localhost',
  'http://tauri.localhost',
  'tauri://localhost',
]);

// বাংলা মন্তব্য: প্রক্সি হেডার ও সকেট অ্যাড্রেস থেকে প্রকৃত ক্লায়েন্ট IP বের করা হচ্ছে
export function resolveWsClientIp(request: http.IncomingMessage, ctx?: Pick<WsBridgeContext, 'getClientIp'>): string {
  if (ctx?.getClientIp) {
    const resolved = ctx.getClientIp(request).trim();
    if (resolved) return resolved.replace(/^::ffff:/, '');
  }
  const xff = request.headers['x-forwarded-for'];
  const rawXff = Array.isArray(xff) ? xff[0] : xff;
  if (typeof rawXff === 'string' && rawXff.trim()) {
    const firstHop = rawXff.split(',')[0]?.trim();
    if (firstHop) return firstHop.replace(/^::ffff:/, '');
  }
  return String(request.socket?.remoteAddress || '127.0.0.1').trim().replace(/^::ffff:/, '');
}

// বাংলা মন্তব্য: Cross-Site WebSocket Hijacking প্রতিরোধে ব্রাউজারের Origin হেডার যাচাই করা হচ্ছে
export function isAllowedWsOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  isProduction: boolean
): boolean {
  const origin = String(originHeader || '').trim();
  if (!origin) return true;
  if (DEFAULT_WS_ALLOWED_ORIGINS.has(origin) || origin.startsWith('vscode-webview://')) {
    return true;
  }
  const extraAllowed = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (extraAllowed.includes(origin)) return true;

  try {
    const parsedOrigin = new URL(origin);
    const cleanHost = String(hostHeader || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (cleanHost && parsedOrigin.host.toLowerCase() === cleanHost) {
      return true;
    }
    const hostname = parsedOrigin.hostname.toLowerCase();
    if (!isProduction && (hostname === 'localhost' || hostname === '127.0.0.1')) {
      return true;
    }
    if (
      parsedOrigin.protocol === 'https:' &&
      (hostname.endsWith('.supremeai-studio.pages.dev') || hostname.endsWith('.supremeai.studio'))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function attachWebSocketBridges(server: http.Server, ctx: WsBridgeContext): void {
  const liveWss = new WebSocketServer({ noServer: true });
  const broadcasterWss = new WebSocketServer({ noServer: true });
  const VALID_LIVE_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

  const MAX_CONCURRENT_LIVE_WS = 50;
  const MAX_LIVE_WS_PER_IP = 6;
  const activeLiveSocketsByIp = new Map<string, number>();
  const liveWsRateBuckets = new Map<string, number[]>();
  const broadcasterClientMeta = new WeakMap<WebSocket, { email: string; isAdmin: boolean }>();

  const extractWsToken = (request: http.IncomingMessage, reqUrl: URL): string => {
    const queryToken = String(reqUrl.searchParams.get('token') || '').trim();
    if (queryToken) return queryToken;
    const authHeader = String(request.headers.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
    const cookies = parseCookieHeader(request.headers.cookie);
    return (cookies['supremeai_admin_session'] || '').trim();
  };

  server.on('upgrade', async (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      const wsToken = extractWsToken(request, reqUrl);
      const clientIp = resolveWsClientIp(request, ctx);
      const forwardedHost = Array.isArray(request.headers['x-forwarded-host'])
        ? request.headers['x-forwarded-host'][0]
        : request.headers['x-forwarded-host'];

      if (
        !isAllowedWsOrigin(
          request.headers.origin,
          forwardedHost || request.headers.host,
          ctx.isProduction
        )
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      if (ctx.blockedIps.some((entry) => entry.ip === clientIp)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      if (reqUrl.pathname === '/api/live') {
        const now = Date.now();
        const hits = (liveWsRateBuckets.get(clientIp) || []).filter((t) => now - t < 60_000);
        if (hits.length >= 20) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        hits.push(now);
        liveWsRateBuckets.set(clientIp, hits);

        const activeForIp = activeLiveSocketsByIp.get(clientIp) || 0;
        if (liveWss.clients.size >= MAX_CONCURRENT_LIVE_WS || activeForIp >= MAX_LIVE_WS_PER_IP) {
          socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        // বাংলা মন্তব্য: প্রোডাকশনে ভুয়া tok_guest_* টোকেন বাইপাস বন্ধ করা হয়েছে; কেবল অনুমোদিত সেশন গ্রহণযোগ্য
        if (ctx.isProduction && process.env.ALLOW_PUBLIC_LIVE_VOICE !== 'true') {
          const identity = wsToken ? await ctx.verifyBearerIdentity(wsToken) : null;
          if (!identity) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        liveWss.handleUpgrade(request, socket, head, (ws) => {
          liveWss.emit('connection', ws, request);
        });
      } else if (
        reqUrl.pathname === '/ws' ||
        reqUrl.pathname === '/ws/live' ||
        reqUrl.pathname === '/api/ws'
      ) {
        const identity = wsToken ? await ctx.verifyBearerIdentity(wsToken) : null;
        if (!identity) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        broadcasterWss.handleUpgrade(request, socket, head, (ws) => {
          broadcasterClientMeta.set(ws, { email: identity.email, isAdmin: identity.isAdmin });
          broadcasterWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  const broadcasterClients = new Set<WebSocket>();

  broadcasterWss.on('connection', (clientWs: WebSocket) => {
    broadcasterClients.add(clientWs);
    clientWs.send(
      JSON.stringify({
        type: 'connection_ack',
        status: 'connected',
        mode: 'authenticated_broadcaster',
      })
    );

    clientWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping' || msg.command === 'ping') {
          clientWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (msg.type === 'customer_updated' || msg.type === 'mcp_service_updated') {
          const senderMeta = broadcasterClientMeta.get(clientWs);
          if (!senderMeta?.isAdmin) return;
          const payload = JSON.stringify(msg);
          broadcasterClients.forEach((otherWs) => {
            const receiverMeta = broadcasterClientMeta.get(otherWs);
            if (
              otherWs !== clientWs &&
              receiverMeta?.isAdmin &&
              otherWs.readyState === WebSocket.OPEN
            ) {
              otherWs.send(payload);
            }
          });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    clientWs.on('close', () => {
      broadcasterClients.delete(clientWs);
    });

    clientWs.on('error', () => {
      broadcasterClients.delete(clientWs);
    });
  });

  liveWss.on('connection', (clientWs: WebSocket, req: http.IncomingMessage) => {
    const clientIp = resolveWsClientIp(req, ctx);
    activeLiveSocketsByIp.set(clientIp, (activeLiveSocketsByIp.get(clientIp) || 0) + 1);
    const decrementIpCounter = () => {
      const nextCount = (activeLiveSocketsByIp.get(clientIp) || 1) - 1;
      if (nextCount <= 0) activeLiveSocketsByIp.delete(clientIp);
      else activeLiveSocketsByIp.set(clientIp, nextCount);
    };

    if (ctx.blockedIps.some((entry) => entry.ip === clientIp)) {
      decrementIpCounter();
      clientWs.send(
        JSON.stringify({ type: 'error', message: 'Access blocked by platform WAF firewall.' })
      );
      clientWs.close(1008, 'Blocked');
      return;
    }

    if (ctx.platformConfig.maintenanceMode) {
      decrementIpCounter();
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            ctx.platformConfig.maintenanceMessage || 'Platform is currently in maintenance mode.',
        })
      );
      clientWs.close(1013, 'Maintenance');
      return;
    }

    const activeApiKey = process.env.GEMINI_API_KEY?.trim() || '';
    if (!activeApiKey || activeApiKey === 'MY_GEMINI_API_KEY') {
      decrementIpCounter();
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            'API key is not configured. Please check the key in the Settings > Secrets panel.',
        })
      );
      clientWs.close(1011, 'API key missing');
      return;
    }

    let sessionPromise: Promise<Awaited<ReturnType<GoogleGenAI['live']['connect']>>> | null = null;
    let isClientClosed = false;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (!isClientClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const startLiveSession = (
      voiceRaw?: string,
      systemInstructionRaw?: string,
      languageRaw?: string,
      pitchRaw?: unknown,
      accentRaw?: unknown
    ) => {
      if (sessionPromise) return;

      const voiceName = voiceRaw && VALID_LIVE_VOICES.has(voiceRaw) ? voiceRaw : 'Zephyr';
      const preferredLang = languageRaw === 'bn' ? 'bn' : 'en';
      const pitch = clampVoicePitch(
        typeof pitchRaw === 'number' ? pitchRaw : Number.parseFloat(String(pitchRaw ?? '1'))
      );
      const accent = normalizeBanglaAccent(accentRaw);
      const accentStyleDirective =
        accent === 'bn-in'
          ? 'When speaking Bengali (বাংলা), use natural standard Kolkata West Bengal Bengali pronunciation and cadence.'
          : 'When speaking Bengali (বাংলা), use an authentic, natural Bangladeshi Standard Bengali (প্রমিত ঢাকা / বাংলাদেশি বাংলা) accent—crisp ড়/ঢ় retroflex sounds, natural nasal vowels, warm Bangladeshi sentence melody, and seamless pronunciation of inline English tech terms.';
      const pitchDirective =
        pitch <= 0.85
          ? 'Keep your vocal tone noticeably deeper and warmer.'
          : pitch >= 1.15
            ? 'Keep your vocal tone bright and crisp.'
            : '';
      const langDirective =
        preferredLang === 'bn'
          ? `Default spoken language: Bengali (বাংলা). Speak warmly and clearly in natural Bengali unless the user speaks or asks in another language. ${accentStyleDirective} ${pitchDirective} When reading or mixing Bengali (বাংলা) and English terms, pronounce EVERY Bengali word and EVERY English word audibly—never skip, silence, or drop the Bengali portion.`
          : `You are fluent in both English and Bengali (বাংলা). Default to English unless the user speaks or writes in Bengali or Romanized Bengali (Banglish), in which case respond in warm, natural Bengali (বাংলা). ${accentStyleDirective} ${pitchDirective} When speaking or reading mixed English and Bengali (বাংলা), pronounce BOTH English and Bengali portions clearly and audibly—never skip or drop Bengali words.`;
      const baseInstruction = `You are SupremeAI Live, a real-time conversational voice engineering partner in SupremeAI Studio. Respond naturally, concisely, and clearly in spoken dialogue without markdown formatting symbols.\n\n${langDirective}`;
      const effectiveSystemInstruction = systemInstructionRaw?.trim()
        ? `${baseInstruction}\n\nActive Persona Context:\n${systemInstructionRaw.trim()}`
        : baseInstruction;

      const liveAi = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          apiVersion: 'v1beta',
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      sessionPromise = liveAi.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: effectiveSystemInstruction,
        },
        callbacks: {
          onopen: () => {
            sendToClient({
              type: 'connected',
              model: 'gemini-3.8-live',
              voice: voiceName,
            });
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.setupComplete) {
              sendToClient({ type: 'setup_complete', model: 'gemini-3.8-live', voice: voiceName });
            }

            const serverContent = message.serverContent;
            if (!serverContent) return;

            if (serverContent.inputTranscription?.text) {
              sendToClient({
                type: 'input_transcript',
                text: serverContent.inputTranscription.text,
              });
            }

            if (serverContent.outputTranscription?.text) {
              sendToClient({
                type: 'output_transcript',
                text: serverContent.outputTranscription.text,
              });
            }

            for (const part of serverContent.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendToClient({
                  type: 'audio',
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                });
              }
            }

            if (serverContent.interrupted) {
              sendToClient({ type: 'interrupted' });
            }

            if (serverContent.turnComplete) {
              sendToClient({ type: 'turn_complete' });
            }
          },
          onerror: (event: { message?: string; error?: { message?: string } }) => {
            const msg = event?.message || event?.error?.message || 'Live API WebSocket error.';
            sendToClient({ type: 'error', message: msg });
          },
          onclose: (event: { reason?: string }) => {
            if (!isClientClosed) {
              sendToClient({
                type: 'closed',
                reason: event?.reason || 'Live API session ended.',
              });
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            }
          },
        },
      });

      sessionPromise.catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to connect to Gemini Live API.';
        sendToClient({ type: 'error', message: msg });
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, 'Live API connection failed');
        }
      });
    };

    clientWs.on('message', (raw) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (parsed?.type === 'init') {
        startLiveSession(
          typeof parsed.voiceName === 'string' ? parsed.voiceName : undefined,
          typeof parsed.systemInstruction === 'string' ? parsed.systemInstruction : undefined,
          typeof parsed.language === 'string' ? parsed.language : undefined,
          parsed.pitch,
          parsed.accent
        );
        return;
      }

      if (!sessionPromise) {
        startLiveSession(
          typeof parsed?.voiceName === 'string' ? parsed.voiceName : undefined,
          typeof parsed?.systemInstruction === 'string' ? parsed.systemInstruction : undefined,
          typeof parsed?.language === 'string' ? parsed.language : undefined,
          parsed?.pitch,
          parsed?.accent
        );
      }

      if (parsed?.type === 'audio' && typeof parsed.data === 'string' && parsed.data.length > 0) {
        const audioData = parsed.data;
        sessionPromise
          ?.then((session) => {
            if (!isClientClosed) {
              session.sendRealtimeInput({
                audio: { data: audioData, mimeType: 'audio/pcm;rate=16000' },
              });
            }
          })
          .catch(() => {});
      } else if (parsed?.type === 'audio_end') {
        sessionPromise
          ?.then((session) => {
            if (!isClientClosed) {
              session.sendRealtimeInput({ audioStreamEnd: true });
            }
          })
          .catch(() => {});
      } else if (parsed?.type === 'text' && typeof parsed.text === 'string' && parsed.text.trim()) {
        const textMsg = parsed.text.trim();
        sessionPromise
          ?.then((session) => {
            if (!isClientClosed) {
              session.sendRealtimeInput({ text: textMsg });
            }
          })
          .catch(() => {});
      }
    });

    clientWs.on('close', () => {
      if (!isClientClosed) {
        isClientClosed = true;
        decrementIpCounter();
      }
      sessionPromise
        ?.then((session) => {
          try {
            session.close();
          } catch {
            // Ignore close errors
          }
        })
        .catch(() => {});
    });
  });
}
