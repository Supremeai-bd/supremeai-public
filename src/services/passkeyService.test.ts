import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePasskeyDevice,
  describePasskeyError,
  fetchPasskeyDevices,
  mergePasskeyDevices,
  registerPasskey,
  waitForDocumentFocus,
} from './passkeyService';

const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeCredential() {
  const buf = (s: string) => new TextEncoder().encode(s).buffer;
  return {
    id: 'cred',
    rawId: buf('cred'),
    type: 'public-key',
    response: { clientDataJSON: buf('{"challenge":"c"}'), attestationObject: buf('att') },
  };
}

function focusError(): Error {
  const err = new Error(
    'The operation is not allowed at this time because the page does not have focus.'
  );
  err.name = 'NotAllowedError';
  return err;
}

const OPTIONS = {
  challenge: b64u('challenge'),
  rp: { name: 'SupremeAI', id: 'localhost' },
  user: { id: b64u('usr-abc'), name: 'a@b.c', displayName: 'A' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
};

describe('passkeyService registration', () => {
  let create: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn();
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    Object.defineProperty(navigator, 'credentials', {
      value: { create, get: vi.fn() },
      configurable: true,
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/register/options')) return jsonResponse(OPTIONS);
      if (String(url).endsWith('/register/verify')) {
        return jsonResponse({
          status: 'success',
          passkey: { credential_id: 'Y3JlZA', user_id: 'usr-abc', role: 'user', device_name: 'X' },
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const optionsCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/register/options')).length;

  it('is single-flight: a double click opens only one WebAuthn ceremony', async () => {
    create.mockResolvedValue(fakeCredential());
    const [a, b] = [registerPasskey('a@b.c', 'A'), registerPasskey('a@b.c', 'A')];
    expect(a).toBe(b);
    await expect(a).resolves.toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(optionsCalls()).toBe(1);
  });

  it('retries once after a "page does not have focus" rejection and sends verify', async () => {
    create.mockRejectedValueOnce(focusError()).mockResolvedValueOnce(fakeCredential());
    const res = await registerPasskey('a@b.c', 'A', 'Windows Hello (Chrome)');
    expect(res.ok).toBe(true);
    expect(res.device?.credential_id).toBe('Y3JlZA');
    expect(create).toHaveBeenCalledTimes(2);
    const verify = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/register/verify'));
    expect(JSON.parse(String(verify?.[1]?.body))).toMatchObject({
      device_name: 'Windows Hello (Chrome)',
    });
  });

  it('does not retry a user cancellation', async () => {
    const cancelled = new Error('The operation either timed out or was not allowed.');
    cancelled.name = 'NotAllowedError';
    create.mockRejectedValue(cancelled);
    const res = await registerPasskey('a@b.c', 'A');
    expect(res).toEqual({ ok: false, error: 'Passkey setup was cancelled or timed out.' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('surfaces the server detail when verify fails', async () => {
    create.mockResolvedValue(fakeCredential());
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/register/options')
        ? jsonResponse(OPTIONS)
        : jsonResponse({ detail: 'Invalid or expired passkey challenge' }, 400)
    );
    const res = await registerPasskey('a@b.c', 'A');
    expect(res).toEqual({ ok: false, error: 'Invalid or expired passkey challenge' });
  });

  it('waits for focus before opening the prompt', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    create.mockResolvedValue(fakeCredential());
    const pending = registerPasskey('a@b.c', 'A');
    await new Promise((r) => setTimeout(r, 20));
    expect(create).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('passkeyService devices + helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a 401 instead of silently returning an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 401))
    );
    const res = await fetchPasskeyDevices('a@b.c');
    expect(res.ok).toBe(false);
    expect(res.devices).toEqual([]);
    expect(res.error).toMatch(/sign in again/i);
  });

  it('returns the devices from the server', async () => {
    const devices = [{ credential_id: 'x', user_id: 'u', role: 'user', device_name: 'Mac' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ devices }))
    );
    await expect(fetchPasskeyDevices('a@b.c')).resolves.toEqual({ ok: true, devices });
  });

  it('merges a just-registered device without duplicates', () => {
    const d = { credential_id: 'x', user_id: 'u', role: 'user', device_name: 'Mac' };
    const e = { ...d, credential_id: 'y' };
    expect(mergePasskeyDevices([d], d)).toEqual([d]);
    expect(mergePasskeyDevices([d], e)).toEqual([e, d]);
    expect(mergePasskeyDevices([d])).toEqual([d]);
  });

  it('labels devices from the user agent', () => {
    expect(
      describePasskeyDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'
      )
    ).toBe('Windows Hello (Chrome)');
    expect(
      describePasskeyDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
      )
    ).toBe('Touch ID (Mac) (Safari)');
    expect(describePasskeyDevice('')).toBe('Biometric device');
  });

  it('explains focus errors in plain words', () => {
    expect(describePasskeyError(focusError())).toMatch(/lost focus/);
  });

  it('waitForDocumentFocus resolves immediately when focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await expect(waitForDocumentFocus(10)).resolves.toBe(true);
  });
});
