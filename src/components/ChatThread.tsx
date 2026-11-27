import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ArrowDown,
  AlertCircle,
  Sparkles,
  Check,
  Loader2,
  Bot,
  Eye,
  FileText,
  Globe,
  Database,
  Brain,
  Cpu,
  Zap,
  ScanText,
  Copy,
  Send,
  X,
} from 'lucide-react';
import { ChatMessage, RolePersona, ModelDetail, VisionErrorCategory } from '../types';
import { ChatSearchBar } from './chat/ChatSearchBar';
import { ChatEmptyState } from './chat/ChatEmptyState';
import { ChatMessageItem } from './chat/ChatMessageItem';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useChatStore } from '../stores/useChatStore';
import { useI18n } from '../utils/i18n';
import { formatChatTimestampWithMs } from '../utils/chatTimestamp';
import { getMessageAttachments, isImageAttachment } from '../utils/imageAttachmentUtils';
import {
  buildOcrExplanationPrompt,
  extractTextFromImages,
  type OcrProgressUpdate,
} from '../utils/browserOcr';

interface ChatThreadProps {
  messages: ChatMessage[];
  activeRole: RolePersona;
  activeModel: ModelDetail;
  isStreaming: boolean;
  streamingContent: string;
  onSendPrompt: (promptText: string) => void;
  error: string | null;
  userName?: string;
  onSpeakText?: (text: string) => void;
  isSearchOpen?: boolean;
  onCloseSearch?: () => void;
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  activeRole,
  activeModel,
  isStreaming,
  streamingContent,
  onSendPrompt,
  error,
  userName,
  onSpeakText,
  isSearchOpen = false,
  onCloseSearch,
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'assistant'>('all');
  const [streamingStartedAt, setStreamingStartedAt] = useState<number | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgressUpdate | null>(null);
  const [ocrDraft, setOcrDraft] = useState('');
  const [ocrReady, setOcrReady] = useState(false);
  const [ocrEmptyNotice, setOcrEmptyNotice] = useState(false);
  const [ocrErrorMsg, setOcrErrorMsg] = useState<string | null>(null);
  const [ocrCopied, setOcrCopied] = useState(false);

  const streamingAgentSteps = useChatStore((s) => s.streamingAgentSteps);
  const streamingRouteMeta = useChatStore((s) => s.streamingRouteMeta);
  const lastPlanSummary = useChatStore((s) => s.lastPlanSummary);
  const inferenceErrorMeta = useChatStore((s) => s.inferenceErrorMeta);
  const clearInferenceError = useChatStore((s) => s.clearInferenceError);
  const { t, lang } = useI18n();
  const streamingPoolLabel =
    streamingRouteMeta?.poolType === 'webhook'
      ? t.routeWebhookLabel
      : streamingRouteMeta?.poolType === 'local'
        ? t.routeLocalEngineLabel
        : streamingRouteMeta?.poolType === 'api-pool'
          ? t.routeApiPoolLabel
          : null;

  useEffect(() => {
    if (isStreaming) {
      setStreamingStartedAt((prev) => prev ?? Date.now());
    } else {
      setStreamingStartedAt(null);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen]);

  // Auto-scroll internal message container only (never scroll ancestor/window/iframe)
  useEffect(() => {
    const el = containerRef.current;
    if (!searchQuery.trim() && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingContent, searchQuery]);

  // Scroll detection for "Scroll to bottom" button
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 160);
  };

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  };

  // Event delegation for code block copy, open-in-editor and schedule buttons inside markdown.
  // বাংলা মন্তব্য: Run/Preview/Terminal বাটন সরানো হয়েছে — কোড নিজে থেকেই চলে।
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const editBtn = (e.target as HTMLElement).closest('.edit-code-btn') as HTMLButtonElement | null;
    if (editBtn) {
      const encodedCode = editBtn.getAttribute('data-code');
      const lang = editBtn.getAttribute('data-lang') || 'html';
      if (encodedCode) {
        useWorkspaceStore
          .getState()
          .loadCodeIntoWorkspace(decodeURIComponent(encodedCode), lang, 'code');
      }
      return;
    }

    const openScheduleBtn = (e.target as HTMLElement).closest(
      '.open-schedule-tab-btn'
    ) as HTMLButtonElement | null;
    if (openScheduleBtn) {
      window.dispatchEvent(new CustomEvent('supremeai-open-schedule-tab'));
      return;
    }

    const target = (e.target as HTMLElement).closest('.copy-code-btn') as HTMLButtonElement | null;
    if (!target) return;

    const encodedCode = target.getAttribute('data-code');
    if (!encodedCode) return;

    const rawCode = decodeURIComponent(encodedCode);
    navigator.clipboard.writeText(rawCode);

    const spanText = target.querySelector('span');
    if (spanText) {
      const originalText = spanText.textContent;
      spanText.textContent = 'Copied!';
      target.classList.add('text-emerald-400');
      setTimeout(() => {
        spanText.textContent = originalText;
        target.classList.remove('text-emerald-400');
      }, 2000);
    }
  }, []);

  // Filter messages by search term and role
  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      const matchesRole = roleFilter === 'all' || m.role === roleFilter;
      const matchesSearch =
        !searchQuery.trim() || m.content.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchesRole && matchesSearch;
    });
  }, [messages, searchQuery, roleFilter]);

  // Map each assistant message ID to the preceding user message's send timestamp
  const sentTimestampByAssistantId = useMemo(() => {
    const map = new Map<string, number>();
    let lastUserTs: number | undefined;
    for (const msg of messages) {
      if (msg.role === 'user') {
        lastUserTs = msg.timestamp;
      } else if (msg.role === 'assistant' && lastUserTs !== undefined) {
        map.set(msg.id, lastUserTs);
      }
    }
    return map;
  }, [messages]);

  const { lastUserMsg, lastUserImages } = useMemo(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return { lastUserMsg: undefined, lastUserImages: [] };
    }
    const imgs = getMessageAttachments(lastUser).filter(
      (att) => isImageAttachment(att) && Boolean(att.data)
    );
    return { lastUserMsg: lastUser, lastUserImages: imgs };
  }, [messages]);

  const resolvedErrorTitle = useMemo(() => {
    const cat: VisionErrorCategory | undefined = inferenceErrorMeta?.category;
    if (!cat || cat === 'unknown') return t.modelNoticeTitle;
    switch (cat) {
      case 'quota_rate_limit':
        return t.visionErrQuotaTitle;
      case 'auth_forbidden':
        return t.visionErrAuthTitle;
      case 'model_not_found':
        return t.visionErrModelTitle;
      case 'bad_request':
        return t.visionErrBadRequestTitle;
      case 'timeout':
        return t.visionErrTimeoutTitle;
      case 'gateway_unavailable':
        return t.visionErrGatewayTitle;
      default:
        return t.modelNoticeTitle;
    }
  }, [inferenceErrorMeta?.category, t]);

  useEffect(() => {
    if (!error) {
      setOcrRunning(false);
      setOcrProgress(null);
      setOcrDraft('');
      setOcrReady(false);
      setOcrEmptyNotice(false);
      setOcrErrorMsg(null);
      setOcrCopied(false);
    }
  }, [error, messages.length]);

  const handleRunBrowserOcr = async () => {
    if (ocrRunning || lastUserImages.length === 0) return;
    setOcrRunning(true);
    setOcrEmptyNotice(false);
    setOcrErrorMsg(null);
    setOcrReady(false);
    setOcrProgress({
      status: 'initializing',
      progress: 5,
      currentImage: 1,
      totalImages: lastUserImages.length,
    });
    try {
      const result = await extractTextFromImages(lastUserImages, (upd) => {
        setOcrProgress(upd);
      });
      if (!result.hasReadableText) {
        setOcrDraft('');
        setOcrEmptyNotice(true);
        setOcrReady(false);
      } else {
        setOcrDraft(result.text);
        setOcrEmptyNotice(false);
        setOcrReady(true);
      }
    } catch (ocrErr: unknown) {
      setOcrErrorMsg(ocrErr instanceof Error ? ocrErr.message : 'Browser OCR failed');
    } finally {
      setOcrRunning(false);
    }
  };

  const handleCopyOcrText = () => {
    if (!ocrDraft.trim()) return;
    navigator.clipboard?.writeText(ocrDraft).catch(() => {});
    setOcrCopied(true);
    setTimeout(() => setOcrCopied(false), 2000);
  };

  const handleSendOcrToTextAi = () => {
    if (!ocrDraft.trim()) return;
    const prompt = buildOcrExplanationPrompt(
      ocrDraft,
      lastUserMsg?.content,
      lang === 'bn' ? 'bn' : 'en'
    );
    clearInferenceError();
    onSendPrompt(prompt);
  };

  const showVisionOcrFallback =
    Boolean(error) &&
    lastUserImages.length > 0 &&
    Boolean(
      inferenceErrorMeta?.ocrSuggested ??
      /vision|image|quota|rate|429|timeout|unavailable/i.test(error || '')
    );

  const isEmpty = messages.length === 0;
  const shouldShowSearchBar = !isEmpty && (isSearchOpen || searchQuery.trim().length > 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      {/* Search Bar (Toggled via the 3-dot chat menu for a cleaner thread viewport) */}
      {shouldShowSearchBar && (
        <ChatSearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          totalMatches={filteredMessages.length}
          totalMessages={messages.length}
          onClear={() => {
            setSearchQuery('');
            setRoleFilter('all');
          }}
          onClose={() => {
            setSearchQuery('');
            setRoleFilter('all');
            onCloseSearch?.();
          }}
          inputRef={searchInputRef}
        />
      )}

      {/* Main Messages Viewport */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onClick={handleContainerClick}
        className="flex-1 min-h-0 overflow-y-auto chat-scroll-clean p-4 sm:p-6 space-y-4"
      >
        {isEmpty ? (
          <ChatEmptyState activeRole={activeRole} activeModel={activeModel} userName={userName} />
        ) : (
          <div className="workspace-chat-container space-y-4">
            {filteredMessages.map((msg) => (
              <ChatMessageItem
                key={msg.id}
                message={msg}
                previousUserTimestamp={
                  msg.role === 'assistant' ? sentTimestampByAssistantId.get(msg.id) : undefined
                }
                activeRole={activeRole}
                activeModel={activeModel}
                searchQuery={searchQuery}
                onSpeakText={onSpeakText}
              />
            ))}

            {/* Live Streaming Assistant Output */}
            {isStreaming && (
              <div className="flex items-start gap-3.5 py-3.5 px-4 rounded-2xl chat-msg-surface-ai max-w-[92%]">
                <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-semibold theme-accent-active border">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold chat-theme-text">{activeRole.name}</span>
                    <span className="text-[10px] theme-accent-text font-medium">
                      {`${activeModel.name} · ${t.generatingLabel}`}
                    </span>
                    {lastPlanSummary && (
                      <span
                        data-testid="streaming-intent-plan"
                        className="text-[10px] font-medium chat-theme-text-muted"
                      >
                        · {lastPlanSummary}
                      </span>
                    )}
                    {streamingAgentSteps.some((s) => s.tool === 'vision_inspect') && (
                      <span
                        data-testid="streaming-vision-mode-badge"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-cyan-600 dark:text-cyan-400"
                      >
                        <Eye className="w-3 h-3 shrink-0" />
                        <span>{t.visionModeLabel}</span>
                      </span>
                    )}
                    {streamingPoolLabel && (
                      <span
                        data-testid="streaming-route-provenance"
                        className="text-[10px] font-medium chat-theme-text-muted tabular-nums"
                      >
                        · {streamingPoolLabel}
                        {streamingRouteMeta?.servedModel
                          ? ` (${streamingRouteMeta.servedModel})`
                          : ''}
                        {typeof streamingRouteMeta?.firstTokenMs === 'number'
                          ? ` · ${streamingRouteMeta.firstTokenMs}ms`
                          : ''}
                      </span>
                    )}
                    {(streamingRouteMeta?.thinkingLevel === 'HIGH' ||
                      streamingRouteMeta?.thinkingLevel === 'XHIGH') && (
                      <span
                        data-testid="streaming-high-thinking-tag"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-purple-600 dark:text-purple-400"
                      >
                        <Brain className="w-3 h-3 shrink-0" />
                        <span>{t.smartHighThinkingTitle}</span>
                      </span>
                    )}
                    {streamingStartedAt && (
                      <span className="text-[10px] chat-theme-text-muted font-mono tabular-nums">
                        {formatChatTimestampWithMs(streamingStartedAt)}
                      </span>
                    )}
                  </div>
                  {streamingAgentSteps.length > 0 && (
                    <div className="mb-2 space-y-1 border-b border-slate-200/70 dark:border-slate-800/80 pb-2">
                      {streamingAgentSteps.map((step) => (
                        <div
                          key={step.id}
                          className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300"
                        >
                          {step.status === 'running' ? (
                            <Loader2 className="w-3 h-3 text-cyan-500 animate-spin shrink-0" />
                          ) : step.status === 'error' ? (
                            <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
                          ) : (
                            <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                          )}
                          {step.tool === 'vision_inspect' ? (
                            <Eye className="w-3 h-3 text-cyan-500 shrink-0" />
                          ) : step.tool === 'file_inspect' ? (
                            <FileText className="w-3 h-3 text-cyan-500 shrink-0" />
                          ) : step.tool === 'google_search' ? (
                            <Globe className="w-3 h-3 text-cyan-500 shrink-0" />
                          ) : step.tool === 'knowledge_rag' ? (
                            <Database className="w-3 h-3 text-purple-500 shrink-0" />
                          ) : step.tool === 'high_thinking' ? (
                            <Brain className="w-3 h-3 text-purple-500 shrink-0" />
                          ) : step.tool === 'model_intelligence' ? (
                            <Cpu className="w-3 h-3 text-cyan-500 shrink-0" />
                          ) : step.tool === 'low_latency' ? (
                            <Zap className="w-3 h-3 text-amber-500 shrink-0" />
                          ) : (
                            <Bot className="w-3 h-3 text-slate-400 shrink-0" />
                          )}
                          <span className="truncate">{step.label}</span>
                          {step.detail && (
                            <span className="text-slate-400 truncate">· {step.detail}</span>
                          )}
                          {typeof step.durationMs === 'number' && (
                            <span className="text-slate-400 shrink-0">· {step.durationMs}ms</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs leading-relaxed chat-theme-text whitespace-pre-wrap font-sans">
                    {streamingContent}
                    <span className="cyber-cursor" />
                  </p>
                </div>
              </div>
            )}

            {/* Inference Error Notification & Browser OCR Fallback */}
            {error && (
              <div
                data-testid="inference-error-card"
                className="p-4 rounded-2xl bg-rose-50/95 dark:bg-rose-950/75 border border-rose-500/40 text-rose-900 dark:text-rose-100 text-xs shadow-lg backdrop-blur-md space-y-3"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-500 dark:text-rose-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <p className="font-semibold text-rose-700 dark:text-rose-200">
                        {resolvedErrorTitle}
                      </p>
                      {(inferenceErrorMeta?.provider ||
                        inferenceErrorMeta?.model ||
                        inferenceErrorMeta?.status) && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-200">
                          {[
                            inferenceErrorMeta.provider,
                            inferenceErrorMeta.model,
                            inferenceErrorMeta.status ? `HTTP ${inferenceErrorMeta.status}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                      {typeof inferenceErrorMeta?.retryAfterSeconds === 'number' &&
                        inferenceErrorMeta.retryAfterSeconds > 0 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200">
                            {t.visionErrRetryIn.replace(
                              '{sec}',
                              String(inferenceErrorMeta.retryAfterSeconds)
                            )}
                          </span>
                        )}
                    </div>
                    <p className="mt-1 opacity-90 break-words leading-relaxed">{error}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearInferenceError}
                    title={t.visionOcrDismiss}
                    aria-label={t.visionOcrDismiss}
                    className="p-1 rounded-lg hover:bg-rose-500/15 text-rose-600 dark:text-rose-300 cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {showVisionOcrFallback && (
                  <div className="pt-2.5 border-t border-rose-500/25 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="run-browser-ocr-btn"
                        disabled={ocrRunning}
                        onClick={handleRunBrowserOcr}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-medium text-xs transition-colors cursor-pointer shadow-xs"
                      >
                        {ocrRunning ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ScanText className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {ocrRunning
                            ? t.visionOcrRunning.replace(
                                '{pct}',
                                String(ocrProgress?.progress ?? 5)
                              )
                            : t.visionOcrActionBtn}
                        </span>
                      </button>
                    </div>

                    {ocrEmptyNotice && (
                      <p
                        data-testid="browser-ocr-empty-notice"
                        className="text-[11px] px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200"
                      >
                        {t.visionOcrNoTextFound}
                      </p>
                    )}

                    {ocrErrorMsg && (
                      <p className="text-[11px] text-rose-700 dark:text-rose-300">{ocrErrorMsg}</p>
                    )}

                    {ocrReady && (
                      <div className="space-y-2" data-testid="browser-ocr-preview-box">
                        <p className="text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200">
                          {t.visionOcrNoticeBanner}
                        </p>
                        <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-200">
                          {t.visionOcrPreviewLabel}
                        </label>
                        <textarea
                          value={ocrDraft}
                          onChange={(e) => setOcrDraft(e.target.value)}
                          rows={5}
                          className="w-full rounded-xl p-2.5 text-xs font-mono bg-white/90 dark:bg-slate-950/80 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-y"
                        />
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleCopyOcrText}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-medium cursor-pointer transition-colors"
                          >
                            {ocrCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{ocrCopied ? t.copiedBtn : t.copyBtn}</span>
                          </button>
                          <button
                            type="button"
                            data-testid="send-ocr-to-text-ai-btn"
                            disabled={!ocrDraft.trim()}
                            onClick={handleSendOcrToTextAi}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer transition-colors shadow-xs"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{t.visionOcrSendToTextAi}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div ref={scrollEndRef} />
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 p-2 rounded-full bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950 shadow-lg hover:scale-105 transition-all cursor-pointer z-20"
          title="Scroll to latest message"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
