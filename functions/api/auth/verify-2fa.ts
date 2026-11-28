import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  fetchWithTimeout,
  verifyEdgeTotpTokenDetailed,
} from '../../_lib/edgeHelpers';

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const authHeader = (request.headers.get('Authorization') || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearer || bearer.startsWith('tok_guest_') || bearer.startsWith('sk-supreme-guest')) {
    return jsonEdgeResponse(
      {
        success: false,
        verified: false,
        error: 'Authentication is required for 2FA verification.',
      },
      401,
      request,
      undefined,
      env
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    method?: string;
    trustFor7Days?: boolean;
    userEmail?: string;
  };
  const code = String(body.token || '').trim();
  if (!code || !/^\d{6}$/.test(code)) {
    return jsonEdgeResponse(
      {
        success: false,
        error: 'Invalid request body: token — Enter the 6-digit code from your authenticator app.',
        issues: [{ path: 'token', message: 'Enter the 6-digit code from your authenticator app.' }],
      },
      400,
      request,
      undefined,
      env
    );
  }
  const upstreamOrigin = resolveUpstreamOrigin(env);

  // 1. Check user vault TOTP secret saved in preferences
  if (authHeader) {
    try {
      const prefRes = await fetchWithTimeout(
        `${upstreamOrigin}/api/v1/user/preferences`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } },
        4500
      );
      if (prefRes.ok) {
        const data = (await prefRes.json().catch(() => null)) as {
          preferences?: { security_totp?: { secret?: string; lastAcceptedStep?: number } };
          security_totp?: { secret?: string; lastAcceptedStep?: number };
        } | null;
        const totpPref = data?.preferences?.security_totp || data?.security_totp;
        const secret = totpPref?.secret;
        const lastAcceptedStep =
          typeof totpPref?.lastAcceptedStep === 'number' ? totpPref.lastAcceptedStep : null;
        if (typeof secret === 'string' && secret.trim()) {
          // বাংলা মন্তব্য: রিপ্লে অ্যাটাক প্রতিরোধে lastAcceptedStep সহ TOTP যাচাই করা হচ্ছে
          const check = await verifyEdgeTotpTokenDetailed(secret.trim(), code, 1, {
            lastAcceptedStep,
            replayKey: `user_vault:${secret.trim()}`,
          });
          if (check.reason === 'replayed_step') {
            return jsonEdgeResponse(
              {
                success: false,
                verified: false,
                error:
                  'This 6-digit TOTP code has already been used. Wait for the next 30-second code.',
              },
              401,
              request,
              undefined,
              env
            );
          }
          if (check.valid) {
            if (check.matchedStep !== null) {
              await fetchWithTimeout(
                `${upstreamOrigin}/api/v1/user/preferences`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: authHeader,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    security_totp: {
                      ...totpPref,
                      secret: secret.trim(),
                      enrolled: true,
                      lastAcceptedStep: check.matchedStep,
                      updatedAt: new Date().toISOString(),
                    },
                  }),
                },
                3500
              ).catch((err) => {
                console.warn('[edge/verify-2fa] Failed to persist lastAcceptedStep:', err);
              });
            }
            return jsonEdgeResponse(
              {
                success: true,
                verified: true,
                authMethod: 'totp',
                trustedBrowser: Boolean(body.trustFor7Days),
                trustedUntil: body.trustFor7Days ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null,
                deviceId: `cf_dev_${Date.now().toString(36)}`,
                message: '2FA verified via user vault.',
              },
              200,
              request
            );
          }
        }
      }
    } catch (err) {
      console.warn('[edge/verify-2fa] User preference TOTP lookup failed:', err);
    }
  }

  // 2. Check Cloudflare Pages env ADMIN_TOTP_SECRET if configured
  const envSecret = env?.ADMIN_TOTP_SECRET?.trim();
  if (envSecret) {
    const check = await verifyEdgeTotpTokenDetailed(envSecret, code, 1, {
      replayKey: `env_totp:${envSecret}`,
    });
    if (check.reason === 'replayed_step') {
      return jsonEdgeResponse(
        {
          success: false,
          verified: false,
          error: 'This 6-digit TOTP code has already been used. Wait for the next 30-second code.',
        },
        401,
        request,
        undefined,
        env
      );
    }
    if (check.valid) {
      return jsonEdgeResponse(
        {
          success: true,
          verified: true,
          authMethod: 'totp',
          trustedBrowser: Boolean(body.trustFor7Days),
          trustedUntil: body.trustFor7Days ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null,
          deviceId: `cf_dev_${Date.now().toString(36)}`,
          message: '2FA verified.',
        },
        200,
        request
      );
    }
  }

  // 3. Forward to Render /api/auth/verify-2fa or /api/admin/totp-verify
  for (const endpoint of ['/api/auth/verify-2fa', '/api/admin/totp-verify']) {
    try {
      const res = await fetchWithTimeout(
        `${upstreamOrigin}${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify({ ...body, code, totp_code: code }),
        },
        5000
      );
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          verified?: boolean;
          success?: boolean;
          valid?: boolean;
          deviceId?: string;
          message?: string;
        } | null;
        if (json?.verified || json?.success || json?.valid) {
          return jsonEdgeResponse(
            {
              success: true,
              verified: true,
              authMethod: 'totp',
              trustedBrowser: Boolean(body.trustFor7Days),
              trustedUntil: body.trustFor7Days ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null,
              deviceId: json?.deviceId || `cf_dev_${Date.now().toString(36)}`,
              message: json?.message || '2FA verified.',
            },
            200,
            request,
            undefined,
            env
          );
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  return jsonEdgeResponse(
    {
      success: false,
      verified: false,
      error: 'Invalid or expired 6-digit verification code.',
    },
    401,
    request
  );
}
