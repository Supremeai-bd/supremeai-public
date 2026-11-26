/**
 * UniversalInboxPanel — Local-First Universal Executive Inbox (Wave 4).
 *
 * বাংলা মন্তব্য: কোনো ভুয়া/হার্ডকোডেড মেসেজ নেই (Zero Mock Theater)।
 * ১. অফিশিয়াল Google OAuth (`gmailOAuthService.ts`) দিয়ে আসল Gmail ইনবক্স লোড ও সার্চ করে।
 * ২. চ্যানেল ফিল্টার বাটন শুধু সেই চ্যানেলের জন্য দেখানো হয় যার adapter
 *    `adapters/inbox/registry.ts`-এ সত্যিই নিবন্ধিত। আগে Telegram/WhatsApp/Messenger/
 *    Instagram বাটন ছিল অথচ কোনো adapter ছিল না (web বা desktop কোথাও) — ক্লিক করলে
 *    খালি লিস্ট বা "Desktop Sandbox Required" দেখাত। নতুন adapter নিবন্ধন করলেই বাটন
 *    নিজে থেকে ফিরে আসবে।
 * ৩. "AI Draft Reply" আসল `/v1/chat/completions` কল করে উত্তর ড্রাফট করে — ইউজার নিজে না পাঠানো পর্যন্ত কিছুই অটো-সেন্ড হয় না।
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  LogOut,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DEFAULT_GATEWAY_URL } from '../../bridge/desktopBridge';
import {
  clearExpiredGmailSession,
  connectGmailWithGooglePopup,
  disconnectGmailAccount,
  getGmailCachedEmail,
  getGmailCachedToken,
  subscribeGmailAuthState,
  type GmailMessageDetail,
} from '../../services/gmailOAuthService';
import { getInboxAdapter, listRegisteredChannels } from '../../adapters/inbox/registry';
import { useI18n } from '../../utils/i18n';
import type { InboxItem } from '../../../packages/contracts/inbox-adapter';

export type ChannelType = 'gmail' | 'telegram' | 'whatsapp' | 'messenger' | 'instagram';

/** Contract-backed item shape (packages/contracts/inbox-adapter.ts). */
export type UnifiedInboxItem = InboxItem;

const CHANNEL_META: Record<ChannelType, { label: string; badgeClass: string }> = {
  gmail: {
    label: 'Gmail',
    badgeClass: 'bg-red-500/10 text-red-500 border-red-500/20',
  },
  telegram: {
    label: 'Telegram',
    badgeClass: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  },
  whatsapp: {
    label: 'WhatsApp',
    badgeClass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  },
  messenger: {
    label: 'Messenger',
    badgeClass: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  },
  instagram: {
    label: 'Instagram',
    badgeClass: 'bg-pink-500/10 text-pink-500 border-pink-500/20',
  },
};

function getGatewayBase(): string {
  const fromEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPREMEAI_GATEWAY_URL
      : undefined;
  return (fromEnv || DEFAULT_GATEWAY_URL || '').replace(/\/+$/, '');
}

export const UniversalInboxPanel: React.FC = () => {
  // বাংলা মন্তব্য: পুরনো GmailInboxPanel-এর বাংলা/ইংরেজি স্ট্রিং (wsGmail*) এখানে পুনর্ব্যবহার।
  const { t } = useI18n();
  // বাংলা মন্তব্য: শুধু নিবন্ধিত adapter-এর চ্যানেল — কোনো ভুয়া ফিল্টার বাটন নয়।
  const availableChannels = listRegisteredChannels();
  const [gmailToken, setGmailToken] = useState<string | null>(() => getGmailCachedToken());
  const [gmailEmail, setGmailEmail] = useState<string | null>(() => getGmailCachedEmail());
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);

  const [items, setItems] = useState<UnifiedInboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGmailDetail, setSelectedGmailDetail] = useState<GmailMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [activeFilter, setActiveFilter] = useState<'all' | ChannelType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [replyDraft, setReplyDraft] = useState('');
  const [isDraftingAi, setIsDraftingAi] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);

  const loadGmailMessages = useCallback(async (_token: string, query = '') => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const adapter = getInboxAdapter('gmail');
      if (!adapter) {
        throw new Error('Gmail adapter not registered.');
      }
      const mapped: UnifiedInboxItem[] = await adapter.list({ limit: 20, query });
      setItems(mapped);
      if (mapped.length > 0) {
        setSelectedId((prev) => prev || mapped[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load Gmail inbox.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('expired')) {
        await clearExpiredGmailSession();
        setGmailToken(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeGmailAuthState(
      (authedUser, token, restoredEmail) => {
        setGmailToken(token);
        setGmailEmail(authedUser?.email || restoredEmail || null);
      },
      () => {
        setGmailToken(null);
        setGmailEmail(null);
        setItems([]);
        setSelectedId(null);
        setSelectedGmailDetail(null);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (gmailToken) {
      void loadGmailMessages(gmailToken);
    }
  }, [gmailToken, loadGmailMessages]);

  // বাংলা মন্তব্য: Browser ট্যাবে Gmail URL-এ রিফ্রেশ চাপলে workspace store
  // `supremeai-gmail-refresh` ইভেন্ট পাঠায় (আগে পুরনো GmailInboxPanel শুনত)।
  useEffect(() => {
    const handleBrowserRefresh = () => {
      if (gmailToken) void loadGmailMessages(gmailToken, searchQuery);
    };
    window.addEventListener('supremeai-gmail-refresh', handleBrowserRefresh);
    return () => window.removeEventListener('supremeai-gmail-refresh', handleBrowserRefresh);
  }, [gmailToken, searchQuery, loadGmailMessages]);

  useEffect(() => {
    if (!selectedId || !gmailToken) {
      setSelectedGmailDetail(null);
      return;
    }
    const item = items.find((i) => i.id === selectedId);
    if (!item || item.channel !== 'gmail') {
      setSelectedGmailDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    const adapter = getInboxAdapter('gmail');
    if (!adapter) {
      setSelectedGmailDetail(null);
      setLoadingDetail(false);
      return;
    }
    adapter
      .detail(item.id)
      .then((d) => {
        if (!cancelled) {
          // Keep prior Gmail detail type for AI draft body fields.
          setSelectedGmailDetail({
            id: d.id,
            threadId: d.replyRef || d.id,
            subject: d.subject,
            from: d.sender,
            to: '',
            date: d.timestamp,
            snippet: d.snippet,
            isUnread: d.unread,
            htmlBody: '',
            textBody: d.body || d.snippet,
          } satisfies GmailMessageDetail);
        }
      })
      .catch(() => {
        if (!cancelled) setSelectedGmailDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, gmailToken, items]);

  const handleConnectGmail = async () => {
    setIsConnectingGmail(true);
    setErrorMsg(null);
    try {
      const res = await connectGmailWithGooglePopup();
      if (res) {
        setGmailToken(res.accessToken);
        setGmailEmail(res.user.email || null);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Google OAuth sign-in failed.');
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleDisconnectGmail = async () => {
    await disconnectGmailAccount();
    setGmailToken(null);
    setGmailEmail(null);
    setItems([]);
    setSelectedId(null);
    setSelectedGmailDetail(null);
  };

  const selectedItem = items.find((i) => i.id === selectedId) || null;

  const filteredItems = items.filter((m) => {
    if (activeFilter !== 'all' && m.channel !== activeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.sender.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.snippet.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleAiDraft = async () => {
    if (!selectedItem) return;
    setIsDraftingAi(true);
    setErrorMsg(null);
    try {
      const token =
        localStorage.getItem('supremeai_access_token') ||
        localStorage.getItem('supremeai_token') ||
        '';
      const bodyText = selectedGmailDetail?.textBody || selectedItem.snippet;
      // বাংলা মন্তব্য: Phase 1–2 — ড্রাফট রিপ্লাই তৈরির আগে প্রাসঙ্গিক মেমোরি (knowledge/search) থেকে রিকল করা
      let memoryContext = '';
      try {
        const memRes = await fetch(`${getGatewayBase()}/api/v1/knowledge/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            query: `${selectedItem.subject} ${bodyText.slice(0, 200)}`.trim(),
            limit: 3,
          }),
        });
        if (memRes.ok) {
          const memData = (await memRes.json()) as { results?: Array<{ content?: string }> };
          const snippets = (memData.results || [])
            .map((r) => r.content)
            .filter(Boolean)
            .slice(0, 3);
          if (snippets.length > 0) {
            memoryContext = `\n\nRelevant Memories:\n${snippets.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`;
          }
        }
      } catch {
        // মেমোরি রিকল ব্যর্থ হলেও মূল ড্রাফট রিপ্লাই চলবে
      }
      const res = await fetch(`${getGatewayBase()}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model: 'auto',
          temperature: 0.3,
          max_tokens: 320,
          messages: [
            {
              role: 'system',
              content:
                'You are SupremeAI Executive Drafter. Write a concise, polite, ready-to-send reply in the same language as the incoming message. Output ONLY the draft reply body.',
            },
            {
              role: 'user',
              content: `From: ${selectedItem.sender}\nSubject: ${selectedItem.subject}\nMessage:\n${bodyText.slice(0, 2000)}${memoryContext}`,
            },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`AI drafter returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const generated = data.choices?.[0]?.message?.content?.trim();
      if (generated) {
        setReplyDraft(generated);
      } else {
        setErrorMsg('AI drafter returned an empty response.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not generate AI reply draft.');
    } finally {
      setIsDraftingAi(false);
    }
  };

  const handleOpenMailtoReply = () => {
    if (!selectedItem || !replyDraft.trim()) return;
    const emailMatch = /<([^>]+@[^>]+)>|([^\s]+@[^\s]+)/.exec(selectedItem.sender);
    const toAddr = emailMatch?.[1] || emailMatch?.[2] || '';
    const subject = selectedItem.subject.startsWith('Re:')
      ? selectedItem.subject
      : `Re: ${selectedItem.subject}`;
    const mailto = `mailto:${encodeURIComponent(toAddr)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(replyDraft)}`;
    window.open(mailto, '_blank', 'noopener,noreferrer');
  };

  const handleCopyDraft = async () => {
    if (!replyDraft.trim()) return;
    await navigator.clipboard.writeText(replyDraft);
    setCopiedReply(true);
    setTimeout(() => setCopiedReply(false), 1800);
  };

  return (
    <div
      data-testid="universal-inbox-panel"
      className="w-full h-full flex flex-col bg-slate-50/60 dark:bg-slate-950/60 backdrop-blur-xl"
    >
      {/* Header & Zero-Cloud-Credential Guarantee */}
      <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 theme-accent-text" />
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Universal Executive Inbox
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>Zero-Cloud-Scraping: Official Google OAuth only — no social session scraping.</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {gmailToken ? (
            <>
              <span
                className="text-xs text-slate-600 dark:text-slate-300 hidden sm:inline"
                title={`${t.wsGmailConnectedAs} ${gmailEmail ?? ''}`}
              >
                {gmailEmail}
              </span>
              <button
                type="button"
                onClick={() => void loadGmailMessages(gmailToken, searchQuery)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{t.wsGmailRefreshBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnectGmail()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:text-rose-500 cursor-pointer"
                title={t.wsGmailDisconnectBtn}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleConnectGmail()}
              disabled={isConnectingGmail}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{isConnectingGmail ? t.wsGmailSigningIn : t.wsGmailSignInBtn}</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="mx-4 mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between gap-2">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5 text-base leading-none"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Split View */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Left List */}
        <div className="w-full md:w-80 lg:w-96 border-r border-slate-200/80 dark:border-slate-800/80 flex flex-col bg-white/40 dark:bg-slate-900/40">
          <div className="p-3 border-b border-slate-200/60 dark:border-slate-800/60 space-y-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (gmailToken) void loadGmailMessages(gmailToken, searchQuery);
              }}
              className="relative"
            >
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={t.wsGmailSearchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </form>

            {availableChannels.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {(['all', ...availableChannels] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setActiveFilter(filter)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                      activeFilter === filter
                        ? 'bg-[var(--theme-accent)] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {filter === 'all' ? 'All' : CHANNEL_META[filter].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
            {!gmailToken && filteredItems.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.wsGmailConnectTitle}
                </p>
                <button
                  type="button"
                  onClick={() => void handleConnectGmail()}
                  disabled={isConnectingGmail}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>{t.wsGmailSignInBtn}</span>
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                {isLoading ? t.wsGmailLoadingInbox : t.wsGmailEmptyInbox}
              </div>
            ) : (
              filteredItems.map((msg) => {
                const meta = CHANNEL_META[msg.channel];
                const active = msg.id === selectedId;
                return (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => setSelectedId(msg.id)}
                    className={`w-full p-3 text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[var(--theme-accent)]/10 border-l-2 border-[var(--theme-accent)]'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-slate-400 truncate max-w-[110px]">
                        {msg.timestamp}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {msg.sender}
                    </div>
                    <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate mt-0.5">
                      {msg.subject}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">{msg.snippet}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Detail & Real AI Reply Drafter */}
        <div className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
          {selectedItem ? (
            <div className="flex-1 flex flex-col h-full min-h-0">
              <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {selectedItem.subject}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">From: {selectedItem.sender}</p>
              </div>

              <div className="flex-1 p-5 overflow-y-auto text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                {loadingDetail ? (
                  <p className="text-slate-400">Loading full message body…</p>
                ) : (
                  <pre className="whitespace-pre-wrap font-sans">
                    {selectedGmailDetail?.textBody || selectedItem.snippet}
                  </pre>
                )}
              </div>

              <div className="p-4 border-t border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/50 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Human-Verified Reply Draft (Never auto-sent)
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleAiDraft()}
                    disabled={isDraftingAi}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--theme-accent)]/10 text-[var(--theme-accent)] cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isDraftingAi ? 'Generating via SupremeAI…' : 'AI Draft Reply'}</span>
                  </button>
                </div>

                <textarea
                  rows={3}
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Click 'AI Draft Reply' or compose your reply here…"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 resize-none"
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={!replyDraft.trim()}
                    onClick={() => void handleCopyDraft()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-40"
                  >
                    {copiedReply ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedReply ? 'Copied' : 'Copy Draft'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!replyDraft.trim()}
                    onClick={handleOpenMailtoReply}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer disabled:opacity-40"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Mail Client to Send</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-slate-400">
              Connect an account or select a message to inspect and generate an AI reply draft.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
