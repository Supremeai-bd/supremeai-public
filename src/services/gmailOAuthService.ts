import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'] as const;

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  isUnread: boolean;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  to: string;
  htmlBody: string;
  textBody: string;
}

const resolvedConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  oAuthClientId:
    import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
    firebaseConfig.oAuthClientId ||
    '',
};

const GMAIL_SESSION_ENDPOINT = '/api/workspace/gmail-session';

// Keep OAuth token strictly in memory (never localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedSessionEmail: string | null = null;
let cachedCurrentUser: User | null = null;
let authCheckSeq = 0;

/** Minimal Google Identity Services (GIS) token-client surface used by this service. */
interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void | Promise<void>;
    error_callback?: (err: { message?: string; type?: string } | undefined) => void;
  }): { requestAccessToken(options?: { prompt?: string }): void };
}

function getGisOauth2(): GisOauth2 | undefined {
  return (window as Window & { google?: { accounts?: { oauth2?: GisOauth2 } } }).google?.accounts
    ?.oauth2;
}

interface FirebaseAuthBundle {
  auth: Auth;
  provider: InstanceType<typeof import('firebase/auth').GoogleAuthProvider>;
  GoogleAuthProvider: typeof import('firebase/auth').GoogleAuthProvider;
  onAuthStateChanged: typeof import('firebase/auth').onAuthStateChanged;
  signInWithPopup: typeof import('firebase/auth').signInWithPopup;
}

let firebaseAuthBundlePromise: Promise<FirebaseAuthBundle> | null = null;

async function ensureFirebaseAuth(): Promise<FirebaseAuthBundle> {
  if (!resolvedConfig.apiKey) {
    throw new Error(
      'Firebase API key is not configured. Set VITE_FIREBASE_API_KEY in your environment.'
    );
  }
  if (!firebaseAuthBundlePromise) {
    firebaseAuthBundlePromise = (async () => {
      const [firebaseAppMod, firebaseAuthMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const app: FirebaseApp =
        firebaseAppMod.getApps().length > 0
          ? firebaseAppMod.getApps()[0]
          : firebaseAppMod.initializeApp(resolvedConfig);
      const auth = firebaseAuthMod.getAuth(app);
      const provider = new firebaseAuthMod.GoogleAuthProvider();
      for (const scope of GMAIL_SCOPES) {
        provider.addScope(scope);
      }
      cachedCurrentUser = auth.currentUser;
      return {
        auth,
        provider,
        GoogleAuthProvider: firebaseAuthMod.GoogleAuthProvider,
        onAuthStateChanged: firebaseAuthMod.onAuthStateChanged,
        signInWithPopup: firebaseAuthMod.signInWithPopup,
      };
    })().catch((err) => {
      firebaseAuthBundlePromise = null;
      throw err;
    });
  }
  return firebaseAuthBundlePromise;
}

interface RestoredGmailSession {
  accessToken: string;
  email: string;
  uid: string;
}

function getWorkspaceAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (typeof window !== 'undefined') {
    const token = (localStorage.getItem('supremeai_access_token') || '').trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

async function persistGmailSessionToServer(accessToken: string, user: User): Promise<void> {
  try {
    await fetch(GMAIL_SESSION_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        accessToken,
        uid: user.uid,
        email: user.email || '',
      }),
    });
  } catch {
    // Non-fatal: in-memory token remains active for the current session
  }
}

async function restoreGmailSessionFromServer(
  user: User | null
): Promise<RestoredGmailSession | null> {
  try {
    const query = user?.uid ? `?uid=${encodeURIComponent(user.uid)}` : '';
    const res = await fetch(`${GMAIL_SESSION_ENDPOINT}${query}`, {
      method: 'GET',
      credentials: 'include',
      headers: getWorkspaceAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      authenticated?: boolean;
      accessToken?: string;
      email?: string;
      uid?: string;
    };
    if (!data?.authenticated || typeof data.accessToken !== 'string' || !data.accessToken.trim()) {
      return null;
    }
    if (user?.uid && data.uid && data.uid !== user.uid) {
      return null;
    }
    return {
      accessToken: data.accessToken.trim(),
      email: typeof data.email === 'string' ? data.email : '',
      uid: typeof data.uid === 'string' ? data.uid : '',
    };
  } catch {
    return null;
  }
}

async function clearGmailSessionFromServer(): Promise<void> {
  try {
    await fetch(GMAIL_SESSION_ENDPOINT, {
      method: 'DELETE',
      credentials: 'include',
      headers: getWorkspaceAuthHeaders(),
    });
  } catch {
    // Ignore network errors when clearing session cookie
  }
}

// বাংলা মন্তব্য: Firebase API Key অনুপস্থিত থাকলেও কনফিগার করা oAuthClientId দিয়ে সরাসরি Google Identity Services (GIS) OAuth টোকেন ক্লায়েন্ট চালানো হয়।
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GIS_LOAD_TIMEOUT_MS = 15_000;

/**
 * বাংলা মন্তব্য: GIS স্ক্রিপট লোড। আগে একবার ব্যর্থ হলে পরের ক্লিকে পুরনো (ব্যর্থ) <script>
 * পেয়ে তার 'load' ইভেন্টের জন্য চিরকাল অপেক্ষা করত — বাটন "Signing in..."-এ আটকে যেত।
 * এখন ব্যর্থ ট্যাগ সরিয়ে নতুন করে লোড হয়, আর ১৫ সেকেন্ডের টাইমআউট আছে।
 */
export function loadGoogleIdentityScript(timeoutMs: number = GIS_LOAD_TIMEOUT_MS): Promise<void> {
  if (getGisOauth2()) return Promise.resolve();
  document.querySelectorAll(`script[src="${GIS_SRC}"]`).forEach((el) => el.remove());
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error('Google sign-in took too long to load. Please try again.'));
    }, timeoutMs);
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(
        new Error(
          'Google sign-in could not load (blocked by the browser, an extension, or the network). Please try again.'
        )
      );
    };
    document.head.appendChild(script);
  });
}

async function connectWithGoogleIdentityServices(clientId: string): Promise<{
  user: User;
  accessToken: string;
}> {
  if (typeof window === 'undefined') {
    throw new Error('Google OAuth is only available in browser environments.');
  }

  await loadGoogleIdentityScript();

  const googleOauth = getGisOauth2();
  if (!googleOauth?.initTokenClient) {
    throw new Error('Google Identity Services SDK failed to initialize.');
  }

  return new Promise((resolve, reject) => {
    const tokenClient = googleOauth.initTokenClient({
      client_id: clientId,
      scope:
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      callback: async (resp: GisTokenResponse) => {
        if (resp.error) {
          reject(
            new Error(
              resp.error_description || resp.error || 'Google sign-in was cancelled or failed.'
            )
          );
          return;
        }
        const token = resp.access_token;
        if (!token) {
          reject(new Error('No access token returned by Google OAuth.'));
          return;
        }
        try {
          let email = '';
          let name = 'Gmail User';
          let uid = `g_${Date.now()}`;
          try {
            const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (uRes.ok) {
              const uData = (await uRes.json()) as Partial<Record<'email' | 'name' | 'sub', unknown>>;
              email = typeof uData.email === 'string' ? uData.email : '';
              name =
                (typeof uData.name === 'string' && uData.name) ||
                (email ? email.split('@')[0] : name);
              uid = (typeof uData.sub === 'string' && uData.sub) || uid;
            }
          } catch {
            // Non-fatal profile enrichment fallback
          }

          const mockFirebaseUser = {
            uid,
            email,
            displayName: name,
            photoURL: null,
            emailVerified: true,
            isAnonymous: false,
            providerData: [],
          } as unknown as User;

          cachedCurrentUser = mockFirebaseUser;
          cachedAccessToken = token;
          cachedSessionEmail = email || null;
          await persistGmailSessionToServer(token, mockFirebaseUser);
          resolve({ user: mockFirebaseUser, accessToken: token });
        } catch (err) {
          reject(
            err instanceof Error
              ? err
              : new Error('Failed to complete Google OAuth session setup.')
          );
        }
      },
      error_callback: (err) => {
        reject(new Error(err?.message || 'Google OAuth prompt failed to open.'));
      },
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export function subscribeGmailAuthState(
  onAuthSuccess?: (user: User | null, token: string, restoredEmail?: string) => void,
  onAuthFailure?: (signedInUser?: User | null) => void,
  onRestoringChange?: (restoring: boolean) => void
): () => void {
  let disposed = false;
  let unsubscribeInner: (() => void) | null = null;

  onRestoringChange?.(true);

  if (!resolvedConfig.apiKey) {
    // বাংলা মন্তব্য: Firebase API key না থাকলে ensureFirebaseAuth কল না করে সার্ভার-সাইড সেভ করা পূর্বের সেশন রিকভারি চেষ্টা করা হবে
    void restoreGmailSessionFromServer(null)
      .then((restored) => {
        if (disposed) return;
        onRestoringChange?.(false);
        if (restored?.accessToken) {
          cachedAccessToken = restored.accessToken;
          cachedSessionEmail = restored.email || null;
          onAuthSuccess?.(null, restored.accessToken, cachedSessionEmail || undefined);
        } else {
          onAuthFailure?.(null);
        }
      })
      .catch(() => {
        if (disposed) return;
        onRestoringChange?.(false);
        onAuthFailure?.(null);
      });

    return () => {
      disposed = true;
    };
  }

  void ensureFirebaseAuth()
    .then(({ auth, onAuthStateChanged }) => {
      if (disposed) return;
      unsubscribeInner = onAuthStateChanged(auth, (user: User | null) => {
        if (disposed) return;
        cachedCurrentUser = user;
        const seq = ++authCheckSeq;

        if (user && cachedAccessToken) {
          cachedSessionEmail = user.email || cachedSessionEmail;
          onRestoringChange?.(false);
          onAuthSuccess?.(user, cachedAccessToken, cachedSessionEmail || undefined);
          return;
        }

        if (isSigningIn) {
          return;
        }

        onRestoringChange?.(true);
        void restoreGmailSessionFromServer(user).then((restored) => {
          if (disposed || seq !== authCheckSeq || isSigningIn) return;
          if (restored?.accessToken) {
            cachedAccessToken = restored.accessToken;
            cachedSessionEmail = user?.email || restored.email || null;
            onRestoringChange?.(false);
            onAuthSuccess?.(user, restored.accessToken, cachedSessionEmail || undefined);
            return;
          }
          cachedAccessToken = null;
          cachedSessionEmail = null;
          onRestoringChange?.(false);
          onAuthFailure?.(user);
        });
      });
    })
    .catch(() => {
      if (disposed) return;
      onRestoringChange?.(false);
      onAuthFailure?.(null);
    });

  return () => {
    disposed = true;
    unsubscribeInner?.();
  };
}

export function getGmailCachedToken(): string | null {
  return cachedAccessToken;
}

export function getGmailCachedEmail(): string | null {
  return cachedSessionEmail || cachedCurrentUser?.email || null;
}

export function notifyGmailBrowserRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('supremeai-gmail-refresh'));
  }
}

export async function clearExpiredGmailSession(): Promise<void> {
  cachedAccessToken = null;
  cachedSessionEmail = null;
  await clearGmailSessionFromServer();
}

export async function connectGmailWithGooglePopup(): Promise<{
  user: User;
  accessToken: string;
} | null> {
  try {
    isSigningIn = true;
    // বাংলা মন্তব্য: যদি Firebase API key কনফিগার করা থাকে তবে Firebase Auth পপআপ ব্যবহার হবে
    if (resolvedConfig.apiKey) {
      const { auth, provider, GoogleAuthProvider, signInWithPopup } = await ensureFirebaseAuth();
      const result = await signInWithPopup(auth, provider);
      cachedCurrentUser = result.user;
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Could not obtain Gmail access token from Google sign-in.');
      }
      const token = credential.accessToken;
      cachedAccessToken = token;
      cachedSessionEmail = result.user.email || null;
      await persistGmailSessionToServer(token, result.user);
      return { user: result.user, accessToken: token };
    }

    // বাংলা মন্তব্য: Firebase API key না থাকলে সরাসরি Google Identity Services (GIS) OAuth চালানো হবে
    if (resolvedConfig.oAuthClientId) {
      return await connectWithGoogleIdentityServices(resolvedConfig.oAuthClientId);
    }

    throw new Error(
      'Google OAuth is not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID or VITE_FIREBASE_API_KEY in your environment.'
    );
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGmailAccount(): Promise<void> {
  cachedAccessToken = null;
  cachedSessionEmail = null;
  cachedCurrentUser = null;
  await clearGmailSessionFromServer();
  if (resolvedConfig.apiKey) {
    try {
      const { auth } = await ensureFirebaseAuth();
      await auth.signOut();
    } catch {
      // Ignore if firebase auth wasn't initialized
    }
  }
}

function getHeaderValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  headerName: string
): string {
  if (!Array.isArray(headers)) return '';
  const target = headerName.toLowerCase();
  const found = headers.find((h) => (h.name || '').toLowerCase() === target);
  return found?.value || '';
}

function decodeBase64UrlUtf8(encoded?: string): string {
  if (!encoded) return '';
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

interface GmailMimePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMimePart[];
}

function extractGmailBodies(part?: GmailMimePart): { htmlBody: string; textBody: string } {
  let htmlBody = '';
  let textBody = '';
  if (!part) return { htmlBody, textBody };

  const mime = (part.mimeType || '').toLowerCase();
  if (mime === 'text/html' && part.body?.data) {
    htmlBody = decodeBase64UrlUtf8(part.body.data);
  } else if (mime === 'text/plain' && part.body?.data) {
    textBody = decodeBase64UrlUtf8(part.body.data);
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const nested = extractGmailBodies(child);
      if (!htmlBody && nested.htmlBody) htmlBody = nested.htmlBody;
      if (!textBody && nested.textBody) textBody = nested.textBody;
    }
  }

  return { htmlBody, textBody };
}

export async function fetchGmailInbox(
  accessToken: string,
  options?: { maxResults?: number; query?: string }
): Promise<GmailMessageSummary[]> {
  const maxResults = options?.maxResults ?? 15;
  const query = (options?.query || '').trim();
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('maxResults', String(maxResults));
  if (query) {
    listUrl.searchParams.set('q', query);
  } else {
    listUrl.searchParams.set('labelIds', 'INBOX');
  }

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => '');
    throw new Error(
      listRes.status === 401
        ? 'Gmail session expired. Please sign in with Google again.'
        : `Gmail API error (${listRes.status}): ${errText.slice(0, 180)}`
    );
  }

  const listData = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  const items = Array.isArray(listData.messages) ? listData.messages : [];
  if (items.length === 0) return [];

  const details = await Promise.all(
    items.map(async (item) => {
      const msgUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}`
      );
      msgUrl.searchParams.set('format', 'metadata');
      msgUrl.searchParams.append('metadataHeaders', 'Subject');
      msgUrl.searchParams.append('metadataHeaders', 'From');
      msgUrl.searchParams.append('metadataHeaders', 'Date');

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!msgRes.ok) return null;

      const msgJson = (await msgRes.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };
      const headers = msgJson.payload?.headers;
      return {
        id: msgJson.id,
        threadId: msgJson.threadId,
        subject: getHeaderValue(headers, 'Subject') || '(No subject)',
        from: getHeaderValue(headers, 'From') || 'Unknown sender',
        date: getHeaderValue(headers, 'Date') || '',
        snippet: msgJson.snippet || '',
        isUnread: Array.isArray(msgJson.labelIds) && msgJson.labelIds.includes('UNREAD'),
      } satisfies GmailMessageSummary;
    })
  );

  return details.filter((item): item is GmailMessageSummary => item !== null);
}

export async function fetchGmailMessageDetail(
  accessToken: string,
  messageId: string
): Promise<GmailMessageDetail> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Could not load message (${res.status}).`);
  }
  const msgJson = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    payload?: GmailMimePart & { headers?: Array<{ name?: string; value?: string }> };
  };
  const headers = msgJson.payload?.headers;
  const { htmlBody, textBody } = extractGmailBodies(msgJson.payload);

  return {
    id: msgJson.id,
    threadId: msgJson.threadId,
    subject: getHeaderValue(headers, 'Subject') || '(No subject)',
    from: getHeaderValue(headers, 'From') || 'Unknown sender',
    to: getHeaderValue(headers, 'To') || '',
    date: getHeaderValue(headers, 'Date') || '',
    snippet: msgJson.snippet || '',
    isUnread: Array.isArray(msgJson.labelIds) && msgJson.labelIds.includes('UNREAD'),
    htmlBody,
    textBody,
  };
}
