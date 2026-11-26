import React, { useState, useEffect, useRef } from 'react';
import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Lock,
  ExternalLink,
  AlertCircle,
  AlertTriangle,
  Star,
  Plus,
  X,
  Search,
  ShieldCheck,
  KeyRound,
  Trash2,
  Download,
  Upload,
  Cookie,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { normalizeProxyInputUrl, useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { toast } from '../../stores/useToastStore';
import {
  BrowserVaultEntry,
  deleteVaultEntry,
  exportEncryptedVaultBackup,
  extractVaultDomain,
  getVaultEntriesForUrl,
  importEncryptedVaultBackup,
  loadVaultEntries,
  markDomainNeverSave,
  resolveDomainCredentialsForAutofill,
  saveDomainCredentials,
  saveSessionSnapshot,
  shouldPromptSaveSubmittedPassword,
} from '../../services/browserVaultService';
import { isGoogleStrictAuthUrl, setDomainLiveCookies } from '../../services/browserSessionJar';
import { UniversalInboxPanel } from '../inbox/UniversalInboxPanel';
import { MobileDeviceFrame } from './MobileDeviceFrame';
import { useI18n } from '../../utils/i18n';

export interface BrowserBookmark {
  id: string;
  label: string;
  url: string;
}

export const BROWSER_BOOKMARKS_STORAGE_KEY = 'supremeai_browser_bookmarks_v1';

function deriveBookmarkLabel(url: string, explicitLabel?: string): string {
  const cleaned = (explicitLabel || '').trim();
  if (cleaned) return cleaned.slice(0, 48);
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || url;
  } catch {
    return url.slice(0, 40);
  }
}

export function loadBrowserBookmarks(): BrowserBookmark[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BROWSER_BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is BrowserBookmark =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          typeof item.url === 'string' &&
          item.url.trim().length > 0
      )
      .map((item) => ({
        id: item.id,
        label: deriveBookmarkLabel(item.url, item.label),
        url: item.url.trim(),
      }));
  } catch {
    return [];
  }
}

export function saveBrowserBookmarks(bookmarks: BrowserBookmark[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BROWSER_BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // Ignore quota or storage restriction errors
  }
}

export function upsertBrowserBookmark(
  bookmarks: BrowserBookmark[],
  rawUrl: string,
  explicitLabel?: string
): BrowserBookmark[] {
  const normalized = normalizeProxyInputUrl(rawUrl);
  if (!normalized) return bookmarks;
  const label = deriveBookmarkLabel(normalized, explicitLabel);
  const existingIdx = bookmarks.findIndex((b) => b.url === normalized);
  if (existingIdx >= 0) {
    const next = [...bookmarks];
    next[existingIdx] = { ...next[existingIdx], label };
    saveBrowserBookmarks(next);
    return next;
  }
  const next = [
    ...bookmarks,
    {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      url: normalized,
    },
  ];
  saveBrowserBookmarks(next);
  return next;
}

export function removeBrowserBookmark(
  bookmarks: BrowserBookmark[],
  urlOrId: string
): BrowserBookmark[] {
  const next = bookmarks.filter((b) => b.id !== urlOrId && b.url !== urlOrId);
  saveBrowserBookmarks(next);
  return next;
}

function isBotChallengeResponse(statusCode: number | null, url: string, html: string): boolean {
  if (statusCode === 429 || statusCode === 403 || statusCode === 400) return true;
  if (/\/sorry\/|\/cdn-cgi\/challenge-platform/i.test(url)) return true;
  if (
    /anomaly-modal|g-recaptcha|Our systems have detected unusual traffic|Sorry,\s*something went wrong/i.test(
      html
    )
  ) {
    return true;
  }
  return false;
}

export const WorkspaceBrowserTab: React.FC = () => {
  const {
    browserTabs,
    activeBrowserTabId,
    browserUrl,
    browserTitle,
    browserStatus,
    browserHtml,
    browserError,
    browserLatencyMs,
    browserStatusCode,
    browserTextPreview,
    browserHistoryStack,
    browserHistoryIndex,
    browserCapturedCookies,
    browserActiveVaultId,
    browserViewportDevice,
    mobileOrientation,
    createBrowserTab,
    switchBrowserTab,
    closeBrowserTab,
    navigateBrowser,
    submitBrowserForm,
    executeBrowserProxyRpc,
    browserBack,
    browserForward,
    refreshBrowser,
    resetBrowserHome,
    setBrowserActiveVaultId,
    setBrowserViewportDevice,
    toggleMobileOrientation,
  } = useWorkspaceStore();

  const { t } = useI18n();
  const [urlInput, setUrlInput] = useState(browserUrl);
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>(() => loadBrowserBookmarks());
  const [isAddingBookmark, setIsAddingBookmark] = useState(false);
  const [newBmLabel, setNewBmLabel] = useState('');
  const [newBmUrl, setNewBmUrl] = useState('');

  // Simplified Web Vault state
  const [showVaultPanel, setShowVaultPanel] = useState(false);
  const [vaultTab, setVaultTab] = useState<'credentials' | 'cookies'>('credentials');
  const [vaultEntries, setVaultEntries] = useState<BrowserVaultEntry[]>(() => loadVaultEntries());
  const [vaultDomainInput, setVaultDomainInput] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultStatusMsg, setVaultStatusMsg] = useState<string | null>(null);

  // Chrome-style automatic Save Password prompt + In-Page Autofill state
  const [loginFormDetected, setLoginFormDetected] = useState(false);
  const [autofillAppliedMsg, setAutofillAppliedMsg] = useState<string | null>(null);
  const [liveIframeCookies, setLiveIframeCookies] = useState('');
  const [autoSavePrompt, setAutoSavePrompt] = useState<{
    domain: string;
    username: string;
    password: string;
    mode: 'new' | 'update';
  } | null>(null);
  const [revealPromptPassword, setRevealPromptPassword] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUrlInput(browserUrl);
  }, [browserUrl]);

  // Automatically fetch initial webpage on mount if in idle state
  useEffect(() => {
    if (browserStatus === 'idle' && browserUrl) {
      navigateBrowser(browserUrl);
    }
  }, [browserStatus, browserUrl, navigateBrowser]);

  // Intercept link clicks & login-form/autofill/cookie messages inside rendered proxy iframe
  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const data = event.data;
      if (!data || data.channel !== 'supremeai-browser') return;
      if (data.type === 'navigate') {
        const href = typeof data.href === 'string' ? data.href.trim() : '';
        if (!href) return;
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/')) {
          navigateBrowser(href);
        }
        return;
      }
      if (data.type === 'login-form-detected' && data.hasPassword) {
        setLoginFormDetected(true);
        return;
      }
      if (data.type === 'login-credentials-submitted') {
        const submittedUser = typeof data.username === 'string' ? data.username.trim() : '';
        const submittedPass = typeof data.password === 'string' ? data.password : '';
        const submittedDomain = extractVaultDomain(
          typeof data.domain === 'string' && data.domain ? data.domain : browserUrl
        );
        if (submittedUser && submittedPass && submittedDomain) {
          void shouldPromptSaveSubmittedPassword({
            urlOrDomain: submittedDomain,
            username: submittedUser,
            password: submittedPass,
          }).then((decision) => {
            if (decision === 'new' || decision === 'update') {
              setRevealPromptPassword(false);
              setAutoSavePrompt({
                domain: submittedDomain,
                username: submittedUser,
                password: submittedPass,
                mode: decision,
              });
            }
          });
        }
        return;
      }
      if (data.type === 'submit-form') {
        const action = typeof data.action === 'string' ? data.action.trim() : '';
        if (!action) return;
        const method = typeof data.method === 'string' ? data.method : 'POST';
        const contentType = typeof data.contentType === 'string' ? data.contentType : undefined;
        const body = typeof data.body === 'string' ? data.body : undefined;
        void submitBrowserForm({ action, method, contentType, body });
        return;
      }
      if (data.type === 'proxy-rpc') {
        const requestId = typeof data.requestId === 'string' ? data.requestId : '';
        const targetUrl = typeof data.url === 'string' ? data.url : '';
        if (!requestId || !targetUrl) return;
        const method = typeof data.method === 'string' ? data.method : 'GET';
        const headers =
          data.headers && typeof data.headers === 'object'
            ? (data.headers as Record<string, string>)
            : {};
        const body = typeof data.body === 'string' ? data.body : undefined;
        void executeBrowserProxyRpc({ url: targetUrl, method, headers, body })
          .then((result) => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                channel: 'supremeai-browser-host',
                type: 'proxy-rpc-response',
                requestId,
                ...result,
              },
              '*'
            );
          })
          .catch((err: unknown) => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                channel: 'supremeai-browser-host',
                type: 'proxy-rpc-response',
                requestId,
                error: err instanceof Error ? err.message : 'Proxy RPC failed',
              },
              '*'
            );
          });
        return;
      }
      if (
        data.type === 'cookies-captured' &&
        typeof data.cookies === 'string' &&
        data.cookies.trim()
      ) {
        const cleanedCookies = data.cookies.trim();
        setLiveIframeCookies(cleanedCookies);
        if (browserUrl) {
          setDomainLiveCookies(browserUrl, cleanedCookies);
        }
        return;
      }
      if (data.type === 'autofill-applied') {
        const count = Number(data.filledFields || 0);
        setAutofillAppliedMsg(`${t.wsAutofillApplied} (${count})`);
      }
    };
    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, [navigateBrowser, submitBrowserForm, executeBrowserProxyRpc, browserUrl, t.wsAutofillApplied]);

  useEffect(() => {
    setAutofillAppliedMsg(null);
    setLiveIframeCookies('');
    if (browserHtml && /<input[^>]+type=["']?password["']?/i.test(browserHtml)) {
      setLoginFormDetected(true);
    } else {
      setLoginFormDetected(false);
    }
  }, [browserUrl, activeBrowserTabId, browserHtml]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    navigateBrowser(urlInput);
  };

  const canGoBack = browserHistoryIndex > 0;
  const canGoForward = browserHistoryIndex < browserHistoryStack.length - 1;
  const isExternalHttpUrl = browserUrl.startsWith('https://') || browserUrl.startsWith('http://');
  const isCurrentBookmarked = Boolean(browserUrl && bookmarks.some((b) => b.url === browserUrl));
  const isGoogleStrictAuth = isGoogleStrictAuthUrl(browserUrl);
  const isBotBlocked =
    !isGoogleStrictAuth &&
    browserStatus === 'loaded' &&
    isBotChallengeResponse(browserStatusCode, browserUrl, browserHtml);

  const handleOpenExternalSafe = () => {
    if (!isExternalHttpUrl) return;
    const anchor = document.createElement('a');
    anchor.href = browserUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleToggleCurrentBookmark = () => {
    if (!browserUrl) return;
    if (isCurrentBookmarked) {
      setBookmarks((prev) => removeBrowserBookmark(prev, browserUrl));
    } else {
      const preferredLabel =
        browserTitle && browserTitle !== browserUrl && browserTitle !== 'New Tab'
          ? browserTitle
          : undefined;
      setBookmarks((prev) => upsertBrowserBookmark(prev, browserUrl, preferredLabel));
    }
  };

  const handleSaveNewBookmark = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBmUrl.trim()) return;
    setBookmarks((prev) => upsertBrowserBookmark(prev, newBmUrl, newBmLabel));
    setNewBmLabel('');
    setNewBmUrl('');
    setIsAddingBookmark(false);
  };

  const resolvedStatusCode = browserStatusCode ?? 200;
  const isErrorHttpStatus = resolvedStatusCode >= 400;

  const effectiveVaultTarget = (browserUrl || vaultDomainInput || urlInput).trim();
  const activeVaultDomain = extractVaultDomain(effectiveVaultTarget);
  const domainVaultEntries = effectiveVaultTarget
    ? getVaultEntriesForUrl(vaultEntries, effectiveVaultTarget)
    : [];
  const activeDomainSessionEntry = domainVaultEntries.find(
    (entry) =>
      entry.mode === 'session' && (browserActiveVaultId ? entry.id === browserActiveVaultId : true)
  );
  const isDomainSessionBound = Boolean(activeDomainSessionEntry);
  const domainCredentialEntries = browserUrl
    ? getVaultEntriesForUrl(vaultEntries, browserUrl).filter((e) => e.mode === 'credentials')
    : [];
  const savedCredentials = vaultEntries.filter((e) => e.mode === 'credentials');
  const savedCookieSessions = vaultEntries.filter((e) => e.mode === 'session');
  const detectedCookieHeader = (browserCapturedCookies || liveIframeCookies).trim();

  const notifyVaultUpdated = () => {
    window.dispatchEvent(new CustomEvent('supremeai-vault-updated'));
  };

  const handleOneClickSaveCookies = async () => {
    if (!effectiveVaultTarget || !activeVaultDomain) {
      toast.info(t.wsBrowserSaveCookiesBtn, t.wsVaultNoUrlHint);
      return;
    }
    const rawToSave = detectedCookieHeader;
    if (!rawToSave) {
      toast.info(t.wsBrowserSaveCookiesBtn, t.wsBrowserNoCookiesYet);
      return;
    }
    setVaultBusy(true);
    setVaultStatusMsg(null);
    try {
      const { entries, created } = await saveSessionSnapshot({
        url: effectiveVaultTarget,
        rawSessionInput: rawToSave,
      });
      setVaultEntries(entries);
      setBrowserActiveVaultId(created.id);
      notifyVaultUpdated();
      setVaultStatusMsg(`${created.domain} · ${created.cookieCount ?? 1} cookies`);
      toast.success(t.wsBrowserSaveCookiesBtn, `${created.domain} · AES-256-GCM`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save session cookies.';
      setVaultStatusMsg(msg);
      toast.error(t.wsBrowserSaveCookiesBtn, msg);
    } finally {
      setVaultBusy(false);
    }
  };

  const handleConfirmAutoSavePassword = async () => {
    if (!autoSavePrompt) return;
    setVaultBusy(true);
    try {
      const { entries, created } = await saveDomainCredentials({
        url: autoSavePrompt.domain,
        username: autoSavePrompt.username,
        password: autoSavePrompt.password,
      });
      setVaultEntries(entries);
      notifyVaultUpdated();
      setAutoSavePrompt(null);
      toast.success(t.wsBrowserSavePasswordBtn, `${created.domain} · AES-256-GCM`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save credentials.';
      toast.error(t.wsBrowserSavePasswordBtn, msg);
    } finally {
      setVaultBusy(false);
    }
  };

  const handleNeverSaveDomain = () => {
    if (!autoSavePrompt) return;
    markDomainNeverSave(autoSavePrompt.domain);
    setAutoSavePrompt(null);
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveVaultTarget || !activeVaultDomain) {
      setVaultStatusMsg(t.wsVaultNoUrlHint);
      return;
    }
    setVaultBusy(true);
    setVaultStatusMsg(null);
    try {
      const { entries, created } = await saveDomainCredentials({
        url: effectiveVaultTarget,
        username: credUsername,
        password: credPassword,
      });
      setVaultEntries(entries);
      notifyVaultUpdated();
      setCredUsername('');
      setCredPassword('');
      setVaultStatusMsg(`${created.domain} (${created.usernameHint})`);
      toast.success(t.wsBrowserSavePasswordBtn, `${created.domain} · AES-256-GCM`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save credentials.';
      setVaultStatusMsg(msg);
      toast.error(t.wsBrowserSavePasswordBtn, msg);
    } finally {
      setVaultBusy(false);
    }
  };

  const handleAutofillCredentials = async (entryId?: string, targetUrlOverride?: string) => {
    const targetUrl = targetUrlOverride || browserUrl;
    if (!targetUrl) return;
    try {
      const creds = await resolveDomainCredentialsForAutofill(targetUrl, entryId);
      if (!creds) {
        toast.error(t.wsAutofillTitle, t.wsVaultEmptyDomain);
        return;
      }
      iframeRef.current?.contentWindow?.postMessage(
        {
          channel: 'supremeai-browser-host',
          type: 'autofill-credentials',
          username: creds.username,
          password: creds.password,
        },
        '*'
      );
      setAutofillAppliedMsg(`${t.wsAutofillApplied} (${creds.entry.domain})`);
      toast.success(t.wsAutofillTitle, `${creds.entry.label} · ${creds.entry.domain}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Autofill decryption failed.';
      toast.error(t.wsAutofillTitle, msg);
    }
  };

  const handleExportVaultBackup = () => {
    const json = exportEncryptedVaultBackup();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `supremeai-vault-backup-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(t.wsVaultExportBackup, 'AES-256-GCM');
  };

  const handleImportVaultBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const { entries, importedCount } = importEncryptedVaultBackup(text);
      setVaultEntries(entries);
      notifyVaultUpdated();
      toast.success(t.wsVaultImportBackup, `+${importedCount}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid encrypted backup JSON.';
      toast.error(t.wsVaultImportBackup, msg);
    }
  };

  const handleToggleSessionBinding = (entry: BrowserVaultEntry) => {
    if (entry.mode !== 'session') return;
    const isCurrentlyBound = browserActiveVaultId === entry.id;
    setBrowserActiveVaultId(isCurrentlyBound ? null : entry.id);
    if (!isCurrentlyBound && browserUrl && extractVaultDomain(browserUrl) === entry.domain) {
      refreshBrowser();
    }
  };

  const handleDeleteVaultEntry = async (id: string) => {
    const next = await deleteVaultEntry(id);
    setVaultEntries(next);
    notifyVaultUpdated();
    if (browserActiveVaultId === id) {
      setBrowserActiveVaultId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-[#070a12]">
      {/* Multi-Tab Virtual Browser Strip */}
      <div
        data-testid="browser-tabs-strip"
        className="flex items-center gap-1 px-2 pt-1.5 pb-1 border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/90 dark:bg-[#070b14] overflow-x-auto no-scrollbar"
      >
        {browserTabs.map((tab) => {
          const isActiveTab = tab.id === activeBrowserTabId;
          const displayTitle =
            tab.title && tab.title !== 'New Tab'
              ? tab.title
              : tab.url
                ? extractVaultDomain(tab.url) || tab.url
                : t.wsBrowserHome;
          return (
            <div
              key={tab.id}
              data-testid={`browser-tab-${tab.id}`}
              className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg border text-[11px] max-w-[170px] shrink-0 transition-colors ${
                isActiveTab
                  ? 'bg-white dark:bg-[#0b101b] border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-medium shadow-2xs'
                  : 'bg-transparent border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-400'
              }`}
            >
              <button
                type="button"
                onClick={() => switchBrowserTab(tab.id)}
                title={tab.url || t.wsBrowserHome}
                className="flex items-center gap-1.5 min-w-0 cursor-pointer"
              >
                <Globe
                  className={`w-3 h-3 shrink-0 ${
                    tab.status === 'loading'
                      ? 'text-cyan-500 animate-spin'
                      : isActiveTab
                        ? 'text-cyan-500'
                        : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{displayTitle}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeBrowserTab(tab.id);
                }}
                aria-label={t.wsBrowserCloseTab}
                title={t.wsBrowserCloseTab}
                data-testid={`browser-close-tab-${tab.id}`}
                className="p-0.5 rounded opacity-60 group-hover:opacity-100 hover:bg-rose-500/15 hover:text-rose-500 cursor-pointer shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          data-testid="browser-new-tab-btn"
          onClick={() => createBrowserTab()}
          title={t.wsBrowserNewTab}
          aria-label={t.wsBrowserNewTab}
          className="inline-flex items-center justify-center p-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:text-cyan-500 hover:border-cyan-500/50 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Browser Address & Navigation Bar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0b101b] space-y-2">
        <div className="flex items-center gap-1.5">
          {/* Navigation Controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={browserBack}
              disabled={!canGoBack}
              title="Back"
              className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-500 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={browserForward}
              disabled={!canGoForward}
              title="Forward"
              className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-500 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={refreshBrowser}
              disabled={!browserUrl}
              title="Reload"
              className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-500 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RotateCw
                className={`w-3.5 h-3.5 ${
                  browserStatus === 'loading' ? 'animate-spin text-cyan-500' : ''
                }`}
              />
            </button>
            <button
              type="button"
              onClick={resetBrowserHome}
              title={t.wsBrowserHome}
              className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Home className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* URL / Search Input */}
          <form onSubmit={handleSubmit} className="flex-1 flex items-center relative min-w-0">
            <Lock
              className={`w-3 h-3 absolute left-3 pointer-events-none ${
                isBotBlocked || isErrorHttpStatus ? 'text-amber-500' : 'text-emerald-500'
              }`}
            />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t.wsBrowserAddressPlaceholder}
              className="w-full pl-8 pr-20 py-1.5 text-xs font-mono rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 focus:border-cyan-500 text-slate-800 dark:text-slate-100 outline-none"
            />
            <div className="absolute right-1 flex items-center gap-1">
              {browserUrl && (
                <button
                  type="button"
                  onClick={handleToggleCurrentBookmark}
                  title={isCurrentBookmarked ? t.wsBrowserSavedPage : t.wsBrowserSavePage}
                  aria-label={isCurrentBookmarked ? t.wsBrowserSavedPage : t.wsBrowserSavePage}
                  data-testid="browser-bookmark-toggle"
                  className={`p-1 rounded-lg transition-colors cursor-pointer ${
                    isCurrentBookmarked
                      ? 'text-amber-400 hover:text-amber-300'
                      : 'text-slate-400 hover:text-amber-400'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${isCurrentBookmarked ? 'fill-amber-400' : ''}`} />
                </button>
              )}
              <button
                type="submit"
                className="px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-[10px] font-semibold transition-colors cursor-pointer"
              >
                {t.wsBrowserGo}
              </button>
            </div>
          </form>

          {/* 1-Click Chrome-style Save Cookies (for proxy-rendered sites) */}
          {!isGoogleStrictAuth && (
            <button
              type="button"
              data-testid="browser-save-cookies-btn"
              onClick={handleOneClickSaveCookies}
              disabled={vaultBusy}
              title={t.wsBrowserSaveCookiesTooltip}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 ${
                detectedCookieHeader
                  ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 text-slate-600 dark:text-slate-300 hover:text-cyan-400'
              }`}
            >
              <Cookie className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">{t.wsBrowserSaveCookiesBtn}</span>
            </button>
          )}

          {/* Streamlined Web Vault Toggle */}
          <button
            type="button"
            data-testid="browser-vault-toggle"
            onClick={() => setShowVaultPanel((prev) => !prev)}
            title={t.wsVaultTitle}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
              showVaultPanel || isDomainSessionBound
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 text-slate-600 dark:text-slate-300 hover:text-cyan-400'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{t.wsVaultBtn}</span>
            {vaultEntries.length > 0 && (
              <span className="font-mono text-[10px] tabular-nums opacity-85">
                {vaultEntries.length}
              </span>
            )}
          </button>

          {/* Desktop / Mobile Browser Viewport Switch */}
          <div className="shrink-0 flex items-center bg-slate-100 dark:bg-slate-900 rounded-xl p-0.5 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              data-testid="browser-viewport-desktop"
              onClick={() => setBrowserViewportDevice('desktop')}
              title={t.wsBrowserDesktopView}
              aria-label={t.wsBrowserDesktopView}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                browserViewportDevice === 'desktop'
                  ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="browser-viewport-mobile"
              onClick={() => setBrowserViewportDevice('mobile')}
              title={t.wsBrowserMobileView}
              aria-label={t.wsBrowserMobileView}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                browserViewportDevice === 'mobile'
                  ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Direct External Open Action */}
          {isExternalHttpUrl && (
            <a
              href={browserUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={t.wsBrowserOpenExternal}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 text-slate-600 dark:text-slate-300 hover:text-cyan-400 text-[11px] font-medium whitespace-nowrap transition-colors"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="hidden sm:inline">{t.wsBrowserOpenExternal}</span>
            </a>
          )}
        </div>

        {/* User Bookmarks Strip */}
        <div className="flex items-center justify-between gap-2 text-[11px] overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              data-testid="browser-add-bookmark-btn"
              onClick={() => {
                setNewBmUrl(browserUrl || '');
                setNewBmLabel(browserTitle && browserTitle !== 'New Tab' ? browserTitle : '');
                setIsAddingBookmark((prev) => !prev);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-slate-300 dark:border-slate-700 hover:border-cyan-500/50 text-slate-500 dark:text-slate-400 hover:text-cyan-400 whitespace-nowrap transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>{t.wsBrowserAddBookmark}</span>
            </button>

            {bookmarks.map((bm) => (
              <div
                key={bm.id}
                className={`group inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border transition-colors whitespace-nowrap ${
                  browserUrl === bm.url
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300 font-semibold'
                    : 'bg-slate-100 dark:bg-slate-900 hover:bg-cyan-500/10 border-slate-200/70 dark:border-slate-800 hover:border-cyan-500/40 text-slate-600 dark:text-slate-300 hover:text-cyan-400'
                }`}
              >
                <button
                  type="button"
                  onClick={() => navigateBrowser(bm.url)}
                  title={bm.url}
                  className="inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />
                  <span className="max-w-[130px] truncate">{bm.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBookmarks((prev) => removeBrowserBookmark(prev, bm.id))}
                  aria-label={t.wsBrowserRemoveBookmark}
                  title={t.wsBrowserRemoveBookmark}
                  className="p-0.5 rounded opacity-60 group-hover:opacity-100 hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>

          {browserStatus === 'loaded' && (
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 shrink-0">
              <span
                className={isErrorHttpStatus ? 'text-amber-500 font-semibold' : 'text-emerald-500'}
              >
                {resolvedStatusCode}
              </span>
              <span>·</span>
              <span>{browserLatencyMs ?? 0}ms</span>
            </div>
          )}
        </div>

        {/* Inline Add Bookmark Form */}
        {isAddingBookmark && (
          <form
            onSubmit={handleSaveNewBookmark}
            className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-800"
          >
            <input
              type="text"
              value={newBmLabel}
              onChange={(e) => setNewBmLabel(e.target.value)}
              placeholder={t.wsBrowserBookmarkLabelPlaceholder}
              className="w-36 px-2.5 py-1 text-xs rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
            />
            <input
              type="text"
              value={newBmUrl}
              onChange={(e) => setNewBmUrl(e.target.value)}
              placeholder={t.wsBrowserBookmarkUrlPlaceholder}
              className="flex-1 min-w-[160px] px-2.5 py-1 text-xs font-mono rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold cursor-pointer"
            >
              {t.wsBrowserSaveBookmark}
            </button>
            <button
              type="button"
              onClick={() => setIsAddingBookmark(false)}
              className="px-2 py-1 rounded-lg bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs cursor-pointer"
            >
              {t.wsBrowserCancel}
            </button>
          </form>
        )}
      </div>

      {/* Streamlined Web Vault Drawer (Credentials, Saved Cookies, Export/Import) */}
      {showVaultPanel && (
        <div
          data-testid="browser-vault-panel"
          className="px-3.5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-[#090e18] space-y-3 max-h-[55%] overflow-y-auto"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t.wsVaultTitle}
              </h4>
              {activeVaultDomain && (
                <span className="font-mono text-[11px] text-cyan-600 dark:text-cyan-400 truncate">
                  {activeVaultDomain}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <button
                type="button"
                data-testid="vault-export-backup-btn"
                onClick={handleExportVaultBackup}
                title={t.wsVaultExportBackup}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-cyan-500/40 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3 h-3 shrink-0" />
                <span>{t.wsVaultExportBackup}</span>
              </button>
              <button
                type="button"
                data-testid="vault-import-backup-btn"
                onClick={() => backupFileInputRef.current?.click()}
                title={t.wsVaultImportBackup}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-cyan-500/40 whitespace-nowrap cursor-pointer"
              >
                <Upload className="w-3 h-3 shrink-0" />
                <span>{t.wsVaultImportBackup}</span>
              </button>
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportVaultBackup}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => setShowVaultPanel(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                aria-label={t.wsBrowserCancel}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2-Tab Segmented Switch: Credentials | Saved Cookies */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit max-w-full">
            <button
              type="button"
              data-testid="vault-tab-credentials"
              onClick={() => setVaultTab('credentials')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                vaultTab === 'credentials'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-3 h-3 text-cyan-500" />
              <span>{t.wsVaultCredentialsTab}</span>
              <span className="font-mono text-[10px] tabular-nums opacity-70">
                {savedCredentials.length}
              </span>
            </button>
            <button
              type="button"
              data-testid="vault-tab-cookies"
              onClick={() => setVaultTab('cookies')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                vaultTab === 'cookies'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Cookie className="w-3 h-3 text-emerald-500" />
              <span>{t.wsVaultCookiesTab}</span>
              <span className="font-mono text-[10px] tabular-nums opacity-70">
                {savedCookieSessions.length}
              </span>
            </button>
          </div>

          {vaultTab === 'credentials' && (
            <div className="space-y-2.5">
              {/* Add New Credential Form */}
              <form
                onSubmit={handleSaveCredentials}
                className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
              >
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  {t.wsVaultAddCredTitle}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={browserUrl ? activeVaultDomain : vaultDomainInput}
                    onChange={(e) => {
                      if (!browserUrl) setVaultDomainInput(e.target.value);
                    }}
                    readOnly={Boolean(browserUrl)}
                    placeholder="github.com"
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    value={credUsername}
                    onChange={(e) => setCredUsername(e.target.value)}
                    placeholder={t.wsVaultUsernameLabel}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
                  />
                  <input
                    type="password"
                    value={credPassword}
                    onChange={(e) => setCredPassword(e.target.value)}
                    placeholder={t.wsVaultPasswordLabel}
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 font-mono truncate">
                    {vaultStatusMsg || 'AES-256-GCM · Domain Isolated'}
                  </span>
                  <button
                    type="submit"
                    disabled={
                      vaultBusy || !credUsername.trim() || !credPassword || !activeVaultDomain
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.wsVaultSaveCredsBtn}</span>
                  </button>
                </div>
              </form>

              {/* Saved Credentials List */}
              {savedCredentials.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {t.wsVaultEmptyDomain}
                </p>
              ) : (
                <div className="space-y-1">
                  {savedCredentials.map((entry) => {
                    const isCurrentSite = Boolean(
                      browserUrl && extractVaultDomain(browserUrl) === entry.domain
                    );
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <KeyRound className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                          <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {entry.domain}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {entry.usernameHint}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isCurrentSite && (
                            <button
                              type="button"
                              onClick={() => handleAutofillCredentials(entry.id)}
                              className="px-2 py-1 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 text-[10px] font-semibold whitespace-nowrap cursor-pointer"
                            >
                              {t.wsAutofillBtn}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteVaultEntry(entry.id)}
                            title={t.wsVaultRemoveCredBtn}
                            aria-label={t.wsVaultRemoveCredBtn}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {vaultTab === 'cookies' && (
            <div className="space-y-2.5">
              {savedCookieSessions.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {t.wsVaultCookiesEmpty}
                </p>
              ) : (
                <div className="space-y-1">
                  {savedCookieSessions.map((entry) => {
                    const isSessionBound = browserActiveVaultId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <Cookie className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {entry.domain}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {entry.cookieCount ?? 1} cookies
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleSessionBinding(entry)}
                            className={`px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                              isSessionBound
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-cyan-400'
                            }`}
                          >
                            {isSessionBound ? t.wsVaultActiveSessionBadge : t.wsVaultApplySession}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteVaultEntry(entry.id)}
                            title={t.wsVaultRemoveCredBtn}
                            aria-label={t.wsVaultRemoveCredBtn}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Browser Viewport */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {/* Chrome-style Automatic "Save password?" Top-Right Prompt */}
        {autoSavePrompt && (
          <div
            data-testid="auto-save-password-banner"
            className="absolute top-3 right-3 z-30 w-80 max-w-[calc(100%-1.5rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0f1624] shadow-xl p-3 space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-4 h-4 text-cyan-500 shrink-0" />
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {autoSavePrompt.mode === 'update'
                    ? t.wsBrowserSavePromptUpdate
                    : t.wsBrowserSavePasswordPromptTitle}{' '}
                  <span className="font-mono text-cyan-600 dark:text-cyan-400">
                    {autoSavePrompt.domain}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAutoSavePrompt(null)}
                aria-label={t.wsBrowserCancel}
                className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100 font-mono text-[11px] truncate">
                {autoSavePrompt.username}
              </div>
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-100 font-mono text-[11px]">
                <span className="truncate">
                  {revealPromptPassword ? autoSavePrompt.password : '••••••••••••'}
                </span>
                <button
                  type="button"
                  onClick={() => setRevealPromptPassword((prev) => !prev)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
                  aria-label="Toggle password preview"
                >
                  {revealPromptPassword ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                data-testid="auto-save-password-never"
                onClick={handleNeverSaveDomain}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium whitespace-nowrap cursor-pointer"
              >
                {t.wsBrowserSavePromptNever}
              </button>
              <button
                type="button"
                data-testid="auto-save-password-confirm"
                onClick={handleConfirmAutoSavePassword}
                disabled={vaultBusy}
                className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                {t.wsBrowserSavePromptSave}
              </button>
            </div>
          </div>
        )}

        {isGoogleStrictAuth ? (
          // বাংলা মন্তব্য: একটাই ইনবক্স — Gmail URL খুললে Universal Inbox (InboxAdapter-ভিত্তিক) দেখায়।
          <UniversalInboxPanel />
        ) : browserStatus === 'error' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t.wsBrowserNavError}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md font-mono break-all">
              {browserError}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshBrowser}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-semibold cursor-pointer"
              >
                {t.wsBrowserRetry}
              </button>
              {isExternalHttpUrl && (
                <a
                  href={browserUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-cyan-500/50"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{t.wsBrowserOpenExternal}</span>
                </a>
              )}
            </div>
          </div>
        ) : browserStatus === 'idle' && !browserHtml ? (
          <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-6 text-center">
            <div className="w-full max-w-md space-y-5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-500 mx-auto">
                <Globe className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  {t.wsBrowserHome}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.wsBrowserStartSubtitle}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder={t.wsBrowserAddressPlaceholder}
                  className="w-full pl-10 pr-16 py-2.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 focus:border-cyan-500 text-slate-800 dark:text-slate-100 shadow-xs outline-none"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-[11px] font-semibold cursor-pointer"
                >
                  {t.wsBrowserGo}
                </button>
              </form>

              <div className="pt-2 space-y-2 text-left">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {t.wsBrowserBookmarksTitle}
                </div>
                {bookmarks.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {bookmarks.map((bm) => (
                      <div
                        key={bm.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => navigateBrowser(bm.url)}
                          className="flex items-center gap-2 min-w-0 text-left cursor-pointer flex-1"
                        >
                          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
                              {bm.label}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              {bm.url}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBookmarks((prev) => removeBrowserBookmark(prev, bm.id))}
                          aria-label={t.wsBrowserRemoveBookmark}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {t.wsBrowserBookmarkEmpty}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col relative bg-white dark:bg-[#090d16]">
            {browserStatus === 'loading' && (
              <div className="absolute inset-x-0 top-0 h-0.5 bg-cyan-500/30 overflow-hidden z-10">
                <div className="h-full w-1/3 bg-cyan-400 animate-pulse" />
              </div>
            )}

            {isBotBlocked && isExternalHttpUrl && (
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-200">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="truncate">
                    HTTP {resolvedStatusCode} · {t.wsBrowserBlockedNotice}
                  </span>
                </div>
                <a
                  href={browserUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px]"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>{t.wsBrowserOpenExternal}</span>
                </a>
              </div>
            )}

            {browserHtml ? (
              <>
                {browserViewportDevice === 'mobile' ? (
                  <div
                    data-testid="browser-mobile-stage"
                    className="flex-1 min-h-0 flex items-center justify-center bg-slate-950/95 dark:bg-[#05080f] overflow-hidden"
                  >
                    <MobileDeviceFrame
                      orientation={mobileOrientation}
                      onRotate={toggleMobileOrientation}
                      onBack={browserBack}
                      canGoBack={canGoBack}
                      onHome={resetBrowserHome}
                      onReload={refreshBrowser}
                      onOpenExternal={isExternalHttpUrl ? handleOpenExternalSafe : undefined}
                    >
                      <iframe
                        ref={iframeRef}
                        title="SupremeAI Browser"
                        srcDoc={browserHtml}
                        sandbox="allow-scripts allow-forms"
                        className="w-full h-full border-0 bg-white"
                      />
                    </MobileDeviceFrame>
                  </div>
                ) : (
                  <iframe
                    ref={iframeRef}
                    title="SupremeAI Browser"
                    srcDoc={browserHtml}
                    sandbox="allow-scripts allow-forms"
                    className="flex-1 w-full h-full border-0 bg-white"
                  />
                )}
                {loginFormDetected &&
                  domainCredentialEntries.length > 0 &&
                  browserStatus === 'loaded' && (
                    <div
                      data-testid="browser-autofill-overlay"
                      className="absolute bottom-3 right-3 z-20 max-w-sm rounded-xl border border-cyan-500/40 bg-[#0b101b]/95 text-slate-100 shadow-xl px-3.5 py-2.5 space-y-2 backdrop-blur-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                            <KeyRound className="w-3.5 h-3.5 shrink-0" />
                            <span>{t.wsAutofillTitle}</span>
                            <span className="font-mono text-[10px] text-emerald-400 truncate">
                              {extractVaultDomain(browserUrl)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {autofillAppliedMsg || t.wsAutofillDetectedHint}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLoginFormDetected(false)}
                          aria-label={t.wsBrowserCancel}
                          className="p-0.5 rounded text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {domainCredentialEntries.map((credEntry) => (
                          <button
                            key={credEntry.id}
                            type="button"
                            data-testid="browser-autofill-btn"
                            onClick={() => handleAutofillCredentials(credEntry.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                          >
                            <KeyRound className="w-3 h-3 shrink-0" />
                            <span>
                              {t.wsAutofillBtn} · {credEntry.usernameHint || credEntry.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
              </>
            ) : (
              <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-slate-400 text-xs space-y-2">
                <Globe className="w-8 h-8 text-cyan-500/60" />
                <span>
                  {browserStatus === 'loaded'
                    ? browserTextPreview || t.wsBrowserNoText
                    : t.wsBrowserInitializing}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
