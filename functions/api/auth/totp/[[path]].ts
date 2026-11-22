import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  fetchWithTimeout,
  generateEdgeBase32Secret,
  verifyEdgeTotpTokenDetailed,
} from '../../../_lib/edgeHelpers';

const TOTP_ISSUER = 'SupremeAI Studio';

async function loadTotpSecretFromPrefs(
  upstreamOrigin: string,
  authHeader: string
): Promise<{ secret: string; enrolled: boolean; lastAcceptedStep: number | null } | null> {
  if (!authHeader) return null;
  try {
    const res = await fetchWithTimeout(
      `${upstreamOrigin}/api/v1/user/preferences`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      },
      5000
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as any;
    const prefs = data?.preferences || data;
    const totp = prefs?.security_totp;
    if (totp && typeof totp.secret === 'string' && totp.secret.trim()) {
      return {
        secret: totp.secret.trim(),
        enrolled: Boolean(totp.enrolled),
        lastAcceptedStep: typeof totp.lastAcceptedStep === 'number' ? totp.lastAcceptedStep : null,
      };
    }
    return null;
  } catch (err) {
    console.warn('[edge/totp] Failed to load TOTP secret from preferences:', err);
    return null;
  }
}

async function saveTotpToPrefs(
  upstreamOrigin: string,
  authHeader: string,
  secret: string,
  enrolled: boolean,
  lastAcceptedStep?: number | null
): Promise<void> {
  if (!authHeader) return;
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
          secret,
          enrolled,
          ...(typeof lastAcceptedStep === 'number' ? { lastAcceptedStep } : {}),
          updatedAt: new Date().toISOString(),
        },
      }),
    },
    5000
  ).catch((err) => {
    console.warn('[edge/totp] Failed to save TOTP preferences:', err);
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const subPath = incomingUrl.pathname.replace(/^\/api\/auth\/totp\/?/, '').trim();
  const upstreamOrigin = resolveUpstreamOrigin(env);
  const authHeader = (request.headers.get('Authorization') || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const envSecret = env?.ADMIN_TOTP_SECRET?.trim() || '';

  if (!bearer || bearer.startsWith('tok_guest_') || bearer.startsWith('sk-supreme-guest')) {
    return jsonEdgeResponse(
      { error: 'Authenticated administrator session is required for TOTP operations.' },
      401,
      request,
      undefined,
      env
    );
  }

  if (subPath === 'status' && request.method === 'GET') {
    const userEmail =
      (incomingUrl.searchParams.get('userEmail') || '').trim().toLowerCase() ||
      'operator@supremeai.bd';
    const vaultEntry = await loadTotpSecretFromPrefs(upstreamOrigin, authHeader);
    const enrolled = Boolean(envSecret || vaultEntry?.enrolled);
    const source = envSecret ? 'env' : vaultEntry?.enrolled ? 'user_vault' : 'none';
    return jsonEdgeResponse(
      {
        enrolled,
        source,
        issuer: TOTP_ISSUER,
        accountName: userEmail,
      },
      200,
      request,
      undefined,
      env
    );
  }

  if (subPath === 'setup' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      userEmail?: string;
      currentToken?: string;
    };
    const existingVault = await loadTotpSecretFromPrefs(upstreamOrigin, authHeader);
    const existingSecret = envSecret || (existingVault?.enrolled ? existingVault.secret : '');
    if (existingSecret) {
      const currentCode = String(body.currentToken || '').trim();
      const checkCurrent = await verifyEdgeTotpTokenDetailed(existingSecret, currentCode, 1, {
        lastAcceptedStep: existingVault?.lastAcceptedStep ?? null,
        replayKey: `totp_rotate:${existingSecret}`,
      });
      if (!checkCurrent.valid) {
        return jsonEdgeResponse(
          {
            error:
              checkCurrent.reason === 'replayed_step'
                ? 'This 6-digit TOTP code has already been used. Wait for the next 30-second code.'
                : 'TOTP is already enrolled. Enter your current 6-digit Authenticator code to rotate your TOTP key.',
            requiresCurrentToken: true,
          },
          401,
          request,
          undefined,
          env
        );
      }
    }

    const userEmail = (body.userEmail || 'operator@supremeai.bd').trim().toLowerCase();
    const secret = generateEdgeBase32Secret(20);
    await saveTotpToPrefs(upstreamOrigin, authHeader, secret, false);

    fetchWithTimeout(
      `${upstreamOrigin}/api/admin/totp-setup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ userEmail }),
      },
      3500
    ).catch(() => {});

    const label = encodeURIComponent(`${TOTP_ISSUER}:${userEmail}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(
      TOTP_ISSUER
    )}&algorithm=SHA1&digits=6&period=30`;

    return jsonEdgeResponse(
      {
        success: true,
        secret,
        otpauthUrl,
        qrDataUrl: '',
        issuer: TOTP_ISSUER,
        accountName: userEmail,
      },
      200,
      request,
      undefined,
      env
    );
  }

  if (subPath === 'confirm' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      userEmail?: string;
      token?: string;
      trustFor7Days?: boolean;
    };
    const code = String(body.token || '').trim();
    if (!code || !/^\d{6}$/.test(code)) {
      return jsonEdgeResponse(
        {
          success: false,
          error:
            'Invalid request body: token — Enter the 6-digit code from your authenticator app.',
          issues: [
            { path: 'token', message: 'Enter the 6-digit code from your authenticator app.' },
          ],
        },
        400,
        request,
        undefined,
        env
      );
    }
    const vaultEntry = await loadTotpSecretFromPrefs(upstreamOrigin, authHeader);
    const activeSecret = envSecret || vaultEntry?.secret || '';

    if (!activeSecret) {
      return jsonEdgeResponse(
        { error: 'No pending TOTP setup secret found. Please initiate setup first.' },
        400,
        request,
        undefined,
        env
      );
    }

    const check = await verifyEdgeTotpTokenDetailed(activeSecret, code, 1, {
      lastAcceptedStep: vaultEntry?.lastAcceptedStep ?? null,
      replayKey: `totp_confirm:${activeSecret}`,
    });
    if (!check.valid) {
      return jsonEdgeResponse(
        {
          error:
            check.reason === 'replayed_step'
              ? 'This 6-digit TOTP code has already been used. Wait for the next 30-second code.'
              : 'Invalid 6-digit Authenticator verification code.',
        },
        401,
        request,
        undefined,
        env
      );
    }

    if (vaultEntry?.secret) {
      await saveTotpToPrefs(
        upstreamOrigin,
        authHeader,
        vaultEntry.secret,
        true,
        check.matchedStep
      );
    }

    const trustUntil = body.trustFor7Days ? Date.now() + 7 * 24 * 60 * 60 * 1000 : null;
    return jsonEdgeResponse(
      {
        success: true,
        verified: true,
        authMethod: 'totp',
        trustedBrowser: Boolean(body.trustFor7Days),
        trustedUntil: trustUntil,
        deviceId: `cf_dev_${Date.now().toString(36)}`,
        message: 'Two-factor authentication verified and enabled.',
      },
      200,
      request,
      undefined,
      env
    );
  }

  return jsonEdgeResponse({ error: 'Unknown TOTP endpoint' }, 404, request, undefined, env);
}
