import { mockEdgePreferences, testEdgeEnv, testSessionHeaders } from '../test/edgePreferences';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBrowserSystemContext,
  detectBrowserNavigationIntent,
  isBrowserRefusalResponse,
  rewriteBrowserRefusalIfNeeded,
  toBrowserNavigationMetadata,
} from './chatBrowserIntent';
import { onRequest as artifactShareHandler } from '../../functions/api/share/artifact';
import { onRequest as gitOAuthHandler } from '../../functions/api/git/oauth/[[path]]';
import { onRequest as totpHandler } from '../../functions/api/auth/totp/[[path]]';
import { onRequest as teamHandler } from '../../functions/api/user/team/[[path]]';

describe('chatBrowserIntent', () => {
  it('detects explicit navigation prompts for auth-walled and open websites', () => {
    const fb = detectBrowserNavigationIntent('go to facebook.com');
    expect(fb).not.toBeNull();
    expect(fb?.url).toBe('https://facebook.com/');
    expect(fb?.hostname).toBe('facebook.com');
    expect(fb?.isAuthWalled).toBe(true);

    const wiki = detectBrowserNavigationIntent('open wikipedia.com');
    expect(wiki).not.toBeNull();
    expect(wiki?.url).toBe('https://wikipedia.com/');
    expect(wiki?.isAuthWalled).toBe(false);

    const wikiShortcut = detectBrowserNavigationIntent('visit wikipedia');
    expect(wikiShortcut?.url).toBe('https://en.wikipedia.org/');

    const bnPrompt = detectBrowserNavigationIntent('wikipedia.com এ যাও');
    expect(bnPrompt).not.toBeNull();
    expect(bnPrompt?.hostname).toBe('wikipedia.com');

    const bareDomain = detectBrowserNavigationIntent('https://github.com/Supremeai-bd/supremeai');
    expect(bareDomain?.url).toBe('https://github.com/Supremeai-bd/supremeai');
    expect(bareDomain?.hostname).toBe('github.com');
  });

  it('ignores local code filenames and debugging prompts without nav verbs', () => {
    expect(detectBrowserNavigationIntent('App.tsx')).toBeNull();
    expect(detectBrowserNavigationIntent('server.ts')).toBeNull();
    expect(
      detectBrowserNavigationIntent(
        'explain why CORS happens when calling facebook.com API in Express'
      )
    ).toBeNull();
  });

  it('grounds system context and rewrites legacy AI refusal boilerplate in Bengali and English', () => {
    const intent = detectBrowserNavigationIntent('go to wikipedia.com')!;
    const snapshot = {
      status: 'loaded' as const,
      url: 'https://en.wikipedia.org/wiki/Main_Page',
      title: 'Wikipedia, the free encyclopedia',
      statusCode: 200,
      textPreview: 'Welcome to Wikipedia, the free encyclopedia that anyone can edit.',
      error: null,
    };

    const sysCtx = buildBrowserSystemContext(intent, snapshot);
    expect(sysCtx).toContain('[VIRTUAL BROWSER ACTIVE');
    expect(sysCtx).toContain('Wikipedia, the free encyclopedia');
    expect(sysCtx).toContain('NEVER say "I am unable to navigate"');

    const refusalSample =
      "I'm unable to navigate to or browse external websites like Wikipedia.com in real time. My capabilities are centered on technical codebases.";
    expect(isBrowserRefusalResponse(refusalSample)).toBe(true);

    const rewrittenBn = rewriteBrowserRefusalIfNeeded(refusalSample, intent, snapshot, 'bn');
    expect(rewrittenBn).toContain('Virtual Browser');
    expect(rewrittenBn).toContain('Wikipedia, the free encyclopedia');
    expect(rewrittenBn).not.toContain('unable to navigate');

    const rewrittenEn = rewriteBrowserRefusalIfNeeded(refusalSample, intent, snapshot, 'en');
    expect(rewrittenEn).toContain('Virtual Browser');
    expect(rewrittenEn).toContain('Wikipedia, the free encyclopedia');

    const meta = toBrowserNavigationMetadata(intent, snapshot);
    expect(meta.proxyStatus).toBe('loaded');
    expect(meta.statusCode).toBe(200);
  });
});

describe('Cloudflare Pages Edge Parity Functions', () => {
  it('handles /api/share/artifact POST cleanly without 404', async () => {
    const req = new Request('https://supremeai-studio.pages.dev/api/share/artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '<h1>Hi</h1>', lang: 'html', title: 'Demo' }),
    });
    const res = await artifactShareHandler({ request: req });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { share_url?: string };
    expect(json.share_url).toContain('https://supremeai-studio.pages.dev/?artifact=');
  });

  it('handles /api/git/oauth/status cleanly without 404', async () => {
    const req = new Request('https://supremeai-studio.pages.dev/api/git/oauth/status');
    const res = await gitOAuthHandler({ request: req, env: {} });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { githubCallbackUrl?: string; githubConfigured?: boolean };
    expect(json.githubConfigured).toBe(false);
    expect(json.githubCallbackUrl).toBe(
      'https://supremeai-studio.pages.dev/api/git/oauth/github/callback'
    );
  });

  it('handles /api/auth/totp/status and /api/auth/totp/setup via WebCrypto', async () => {
    using _fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(mockEdgePreferences());
    const statusReq = new Request(
      'https://supremeai-studio.pages.dev/api/auth/totp/status?userEmail=admin@supremeai.bd',
      { headers: testSessionHeaders }
    );
    const statusRes = await totpHandler({ request: statusReq, env: testEdgeEnv });
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as { accountName?: string; issuer?: string };
    expect(statusJson.accountName).toBe('admin@supremeai.bd');
    expect(statusJson.issuer).toBe('SupremeAI Studio');

    const setupReq = new Request('https://supremeai-studio.pages.dev/api/auth/totp/setup', {
      method: 'POST',
      headers: { ...testSessionHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: 'admin@supremeai.bd' }),
    });
    const setupRes = await totpHandler({ request: setupReq, env: testEdgeEnv });
    expect(setupRes.status).toBe(200);
    const setupJson = (await setupRes.json()) as {
      success?: boolean;
      secret?: string;
      otpauthUrl?: string;
    };
    expect(setupJson.success).toBe(true);
    expect(setupJson.secret?.length).toBeGreaterThan(16);
    expect(setupJson.otpauthUrl).toContain('otpauth://totp/');
  });

  it('fails closed on /api/user/team without a verified Supabase-backed session', async () => {
    // বাংলা মন্তব্য: রোস্টার এখন Supabase-এ (4.4) — অপরিচিত কলার আর পড়তে/লিখতে পারে না।
    const getReq = new Request('https://supremeai-studio.pages.dev/api/user/team');
    const getRes = await teamHandler({ request: getReq, env: {} });
    expect(getRes.status).toBe(401);

    const postReq = new Request('https://supremeai-studio.pages.dev/api/user/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@supremeai.bd', role: 'Developer' }),
    });
    const postRes = await teamHandler({ request: postReq, env: {} });
    expect(postRes.status).toBe(401);

    const chatReq = new Request('https://supremeai-studio.pages.dev/api/user/team/chat');
    const chatRes = await teamHandler({ request: chatReq, env: {} });
    expect(chatRes.status).toBe(401);
  });
});
