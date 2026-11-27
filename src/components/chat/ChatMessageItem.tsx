import React, { useMemo, useState } from 'react';
import {
  Copy,
  Check,
  Paperclip,
  Sparkles,
  User,
  Volume2,
  Globe,
  ExternalLink,
  FolderGit2,
  Eye,
  Download,
  Code2,
  Bot,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Database,
  Brain,
  Cpu,
  Zap,
} from 'lucide-react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { ChatMessage, RolePersona, ModelDetail } from '../../types';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { ResearchReportViewer } from './ResearchReportViewer';
import { useI18n } from '../../utils/i18n';
import { formatChatTimestampWithMs, formatResponseDeltaMs } from '../../utils/chatTimestamp';
import { getMessageAttachments, isImageAttachment } from '../../utils/imageAttachmentUtils';
import { extractVirtualProject } from '../../utils/artifactStreamParser';
import { downloadProjectZip } from '../../utils/projectZipExport';

interface ChatMessageItemProps {
  message: ChatMessage;
  previousUserTimestamp?: number;
  activeRole: RolePersona;
  activeModel: ModelDetail;
  searchQuery?: string;
  onSpeakText?: (text: string) => void;
}

// Escape HTML utility
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createMarkdownProcessor(labels: {
  savedTitle: string;
  openTabLabel: string;
  codeLabel: string;
  copyLabel: string;
}) {
  const processor = new Marked({
    gfm: true,
    breaks: true,
  });

  processor.use({
    renderer: {
      code({ text, lang }: { text: string; lang?: string }) {
        const rawInfo = (lang || 'code').trim();
        const baseLang = rawInfo.split(/\s+/)[0] || 'code';
        const cleanLang = baseLang;
        const fileAttrMatch = rawInfo.match(/file\s*=\s*["']?([^"'\s]+)["']?/i);
        const badgeLabel = fileAttrMatch?.[1] || cleanLang;
        if (cleanLang.toLowerCase() === 'supreme-schedule') {
          try {
            const parsed = JSON.parse(text.trim()) as {
              title?: string;
              url?: string;
              cadence?: string;
              cron?: string;
              instruction?: string;
            };
            const title = escapeHtml(parsed.title || parsed.url || 'Scheduled Web Task');
            const targetUrl = escapeHtml(parsed.url || '');
            const cron = escapeHtml(parsed.cron || parsed.cadence || 'daily');
            const instruction = escapeHtml(parsed.instruction || '');
            return `<div class="my-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 space-y-1.5">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                  <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-300">${escapeHtml(labels.savedTitle)}</span>
                  <span class="text-xs font-mono text-slate-500 dark:text-slate-300 truncate">${title}</span>
                </div>
                <button type="button" class="open-schedule-tab-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0">
                  <span>${escapeHtml(labels.openTabLabel)}</span>
                </button>
              </div>
              <div class="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">${targetUrl} · ${cron}</div>
              ${instruction ? `<div class="text-xs text-slate-700 dark:text-slate-200">${instruction}</div>` : ''}
            </div>`;
          } catch {
            // Fall through to standard code block
          }
        }
        const escapedText = escapeHtml(text);
        const encodedCode = encodeURIComponent(text);
        // বাংলা মন্তব্য: কোড-ব্লকে আর Run / Preview / Terminal বাটন নেই — AI উত্তর দিলেই
        // কোড নিজে থেকে ওয়ার্কস্পেসে চলে; আবার চালাতে চাইলে শুধু বলুন "চালাও / run it"।
        // শুধু "Code" (এডিটরে খোলা) আর Copy রাখা হয়েছে।
        const dockActions = `<button type="button" class="edit-code-btn flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors text-[11px] cursor-pointer whitespace-nowrap shrink-0" data-code="${encodedCode}" data-lang="${escapeHtml(cleanLang)}">
              <span>${escapeHtml(labels.codeLabel)}</span>
            </button>`;

        return `<div class="code-block-wrapper my-3 rounded-xl overflow-hidden border border-slate-700/60 bg-slate-950 shadow-md">
          <div class="code-block-header flex items-center justify-between px-3.5 py-1.5 bg-slate-900 border-b border-slate-800 text-xs font-mono select-none">
            <span class="flex items-center gap-1.5 font-medium text-slate-300 truncate">
              <span class="w-2 h-2 rounded-full bg-cyan-400 shrink-0"></span>
              <span class="tracking-wider text-[11px] ${fileAttrMatch ? '' : 'uppercase'}">${escapeHtml(badgeLabel)}</span>
            </span>
            <div class="flex items-center gap-1.5">
              ${dockActions}
              <button type="button" class="copy-code-btn flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors text-[11px] cursor-pointer" data-code="${encodedCode}">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>Copy</span>
              </button>
            </div>
          </div>
          <pre class="p-3.5 overflow-x-auto text-xs leading-relaxed font-mono text-slate-100 bg-slate-950"><code class="language-${cleanLang}">${escapedText}</code></pre>
        </div>`;
      },
    },
    hooks: {
      postprocess(html: string) {
        return html
          .replace(/<table>/g, '<div class="markdown-table-wrapper"><table>')
          .replace(/<\/table>/g, '</table></div>');
      },
    },
  });

  return processor;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  previousUserTimestamp,
  activeRole,
  activeModel,
  onSpeakText,
}) => {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [showAgentSteps, setShowAgentSteps] = useState(false);

  const formattedTimestamp = React.useMemo(
    () => formatChatTimestampWithMs(message.timestamp),
    [message.timestamp]
  );

  const responseDelta = React.useMemo(
    () => (isUser ? null : formatResponseDeltaMs(message.timestamp, previousUserTimestamp)),
    [isUser, message.timestamp, previousUserTimestamp]
  );

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const extractedProject = useMemo(() => {
    if (isUser) return null;
    const project = extractVirtualProject(message.content);
    return project && project.files.length > 0 ? project : null;
  }, [isUser, message.content]);

  // Convert markdown to HTML for assistant responses
  const renderedContent = React.useMemo(() => {
    if (isUser) return message.content;
    try {
      const processor = createMarkdownProcessor({
        savedTitle: t.wsScheduleChatCardTitle,
        openTabLabel: t.wsScheduleViewInTab,
        codeLabel: t.dockCode,
        copyLabel: t.copyBtn,
      });
      const parsed = processor.parse(message.content);
      return typeof parsed === 'string' ? parsed : '';
    } catch {
      return message.content;
    }
  }, [
    message.content,
    isUser,
    t.wsScheduleChatCardTitle,
    t.wsScheduleViewInTab,
    t.dockCode,
    t.copyBtn,
  ]);

  return (
    <div
      className={`group flex items-start gap-3.5 py-3.5 px-4 rounded-2xl transition-all ${
        isUser ? 'chat-msg-surface-user ml-auto max-w-[85%]' : 'chat-msg-surface-ai max-w-[92%]'
      }`}
    >
      {/* Avatar Icon */}
      <div
        className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-semibold ${
          isUser ? 'theme-btn-primary border border-transparent' : 'theme-accent-active border'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
      </div>

      {/* Message Body */}
      <div className="flex-1 min-w-0">
        {/* Sender meta */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold chat-theme-text font-sans">
              {isUser ? t.youLabel : message.roleName || activeRole.name}
            </span>
            {!isUser && (
              <span className="text-[10px] theme-accent-text font-medium">{activeModel.name}</span>
            )}
            {!isUser && message.agentSteps?.some((s) => s.tool === 'vision_inspect') && (
              <span
                data-testid="message-vision-mode-tag"
                className="inline-flex items-center gap-1 text-[10px] font-medium text-cyan-600 dark:text-cyan-400"
              >
                <Eye className="w-3 h-3 shrink-0" />
                <span>{t.visionModeLabel}</span>
              </span>
            )}
            {!isUser &&
              message.routeMeta &&
              (() => {
                const poolLabel =
                  message.routeMeta.poolType === 'webhook'
                    ? t.routeWebhookLabel
                    : message.routeMeta.poolType === 'local'
                      ? t.routeLocalEngineLabel
                      : message.routeMeta.poolType === 'api-pool'
                        ? t.routeApiPoolLabel
                        : null;
                if (!poolLabel && !message.routeMeta.thinkingLevel) return null;
                return (
                  <>
                    {poolLabel && (
                      <span
                        data-testid="message-route-provenance"
                        className="text-[10px] font-medium chat-theme-text-muted tabular-nums"
                      >
                        · {poolLabel}
                        {message.routeMeta.servedModel
                          ? ` (${message.routeMeta.servedModel})`
                          : ''}
                        {typeof message.routeMeta.firstTokenMs === 'number'
                          ? ` · ${message.routeMeta.firstTokenMs}ms`
                          : ''}
                      </span>
                    )}
                    {(message.routeMeta.thinkingLevel === 'HIGH' ||
                      message.routeMeta.thinkingLevel === 'XHIGH') && (
                      <span
                        data-testid="message-high-thinking-tag"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-purple-600 dark:text-purple-400"
                      >
                        <Brain className="w-3 h-3 shrink-0" />
                        <span>{t.smartHighThinkingTitle}</span>
                      </span>
                    )}
                  </>
                );
              })()}
            <span className="text-[10px] chat-theme-text-muted font-mono tabular-nums">
              {formattedTimestamp}
            </span>
            {responseDelta && (
              <span
                className="text-[10px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400/90"
                title={`${responseDelta.diffMs.toLocaleString('en-US')} ms`}
              >
                {responseDelta.label}
              </span>
            )}
            {!isUser && message.tokenUsage && message.tokenUsage.totalTokens > 0 && (
              <span
                data-testid="message-token-usage"
                className="text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500"
              >
                · {message.tokenUsage.promptTokens.toLocaleString('en-US')} {t.wbTokenUsageIn} ·{' '}
                {message.tokenUsage.candidateTokens.toLocaleString('en-US')} {t.wbTokenUsageOut}{' '}
                {t.wbTokensEstSuffix}
              </span>
            )}
          </div>

          {isUser && (
            <button
              type="button"
              onClick={handleCopyMessage}
              className={`chat-action-btn p-1.5 rounded-lg cursor-pointer inline-flex items-center justify-center opacity-85 hover:opacity-100 transition-all ${
                copied ? '!text-emerald-500 dark:!text-emerald-400 !border-emerald-500/40' : ''
              }`}
              title={copied ? t.copiedBtn : t.copyBtn}
              aria-label={copied ? t.copiedBtn : t.copyBtn}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Multimodal Attachment Preview(s) if present */}
        {(() => {
          const msgAttachments = getMessageAttachments(message);
          if (msgAttachments.length === 0) return null;
          return (
            <div className="mb-2 flex flex-wrap gap-2">
              {msgAttachments.map((att, attIdx) => {
                const isImg = isImageAttachment(att);
                return (
                  <div
                    key={`${att.name}-${attIdx}`}
                    className="p-2 rounded-xl chat-msg-surface-user space-y-2 text-xs max-w-full"
                  >
                    {isImg && att.data && (
                      <img
                        src={att.data}
                        alt={att.name}
                        className="max-h-52 rounded-lg border border-slate-200 dark:border-slate-700 object-contain"
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <Paperclip className="w-3.5 h-3.5 theme-accent-text shrink-0" />
                      <span className="font-medium chat-theme-text truncate max-w-xs">
                        {att.name}
                      </span>
                      <span className="text-[10px] font-mono chat-theme-text-muted uppercase">
                        {att.mimeType}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Content */}
        {isUser ? (
          <p className="text-xs leading-relaxed chat-theme-text whitespace-pre-wrap font-sans">
            {message.content}
          </p>
        ) : (
          <>
            {message.researchReport && <ResearchReportViewer report={message.researchReport} />}
            <div
              className="markdown-body text-xs leading-relaxed chat-theme-text font-sans"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderedContent) }}
            />
            {extractedProject && (
              <div
                data-testid="chat-generated-project-card"
                className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderGit2 className="w-4 h-4 text-cyan-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {extractedProject.title || t.wsProjectCardReady}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                        {t.wsProjectCardReady} · {String(extractedProject.runtime || 'app').toUpperCase()} ·{' '}
                        {extractedProject.files.length} files
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      type="button"
                      data-testid="project-card-zip-btn"
                      onClick={() =>
                        downloadProjectZip(extractedProject.title, extractedProject.files)
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-cyan-500/50 hover:text-cyan-500 text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t.wsDownloadProjectZip}</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {extractedProject.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => {
                        const ws = useWorkspaceStore.getState();
                        ws.syncVirtualProject(extractedProject, {
                          isFinal: true,
                          autoOpenDock: false,
                        });
                        ws.selectProjectFile(file.path);
                        ws.setActiveDockTab('code');
                        ws.setDockOpen(true);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 hover:border-cyan-500/50 text-[11px] font-mono text-slate-700 dark:text-slate-300 hover:text-cyan-400 cursor-pointer transition-colors"
                    >
                      <Code2 className="w-3 h-3 text-cyan-500 shrink-0" />
                      <span className="truncate max-w-[180px]">{file.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {message.browserNavigation && (
              <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {message.browserNavigation.title || message.browserNavigation.hostname}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                        {message.browserNavigation.isAuthWalled
                          ? t.wsBrowserChatAuthWallLabel
                          : t.wsBrowserChatOpenedLabel}
                        {' · '}
                        {message.browserNavigation.hostname}
                        {message.browserNavigation.statusCode
                          ? ` · HTTP ${message.browserNavigation.statusCode}`
                          : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const ws = useWorkspaceStore.getState();
                        ws.setActiveDockTab('browser');
                        ws.setDockOpen(true);
                        if (ws.browserUrl !== message.browserNavigation!.url) {
                          void ws.navigateBrowser(message.browserNavigation!.url);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950 hover:opacity-90 text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-opacity"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>{t.wsBrowserFocusBtn}</span>
                    </button>
                    <a
                      href={message.browserNavigation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{t.wsBrowserOpenExternalBtn}</span>
                    </a>
                  </div>
                </div>
                {(message.browserNavigation.isAuthWalled ||
                  message.browserNavigation.proxyStatus === 'blocked' ||
                  message.browserNavigation.proxyStatus === 'error') && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                    {t.wsBrowserStatusBlockedHint}
                  </p>
                )}
              </div>
            )}

            {/* Agent Execution Trace (collapsible, unboxed rows) */}
            {message.agentSteps && message.agentSteps.length > 0 && (
              <div className="mt-2.5 border-t border-slate-200/70 dark:border-slate-800/80 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAgentSteps((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>
                    {t.wbAgentStepsHeader} ({message.agentSteps.length})
                  </span>
                  {showAgentSteps ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
                {showAgentSteps && (
                  <div className="mt-1.5 space-y-1 pl-1">
                    {message.agentSteps.map((step) => (
                      <div
                        key={step.id}
                        className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300"
                      >
                        {step.status === 'error' ? (
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
                        ) : null}
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
              </div>
            )}

            {/* Google Search Grounded Sources */}
            {message.groundingSources && message.groundingSources.length > 0 && (
              <div
                data-testid="message-grounding-sources"
                className="mt-2.5 border-t border-slate-200/70 dark:border-slate-800/80 pt-2 space-y-1"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <Globe className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                  <span>{t.wbSourcesHeader}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {message.groundingSources.map((src) => (
                    <a
                      key={src.uri}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline max-w-[260px] truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{src.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-2.5 flex items-center gap-2">
              {onSpeakText && message.content.trim() && (
                <button
                  type="button"
                  onClick={() => onSpeakText(message.content)}
                  className="chat-action-btn p-1.5 rounded-lg cursor-pointer inline-flex items-center justify-center opacity-90 hover:opacity-100 transition-all"
                  title={t.readAloud}
                  aria-label={t.readAloud}
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyMessage}
                className={`chat-action-btn p-1.5 rounded-lg cursor-pointer inline-flex items-center justify-center opacity-90 hover:opacity-100 transition-all ${
                  copied ? '!text-emerald-500 dark:!text-emerald-400 !border-emerald-500/40' : ''
                }`}
                title={copied ? t.copiedBtn : t.copyBtn}
                aria-label={copied ? t.copiedBtn : t.copyBtn}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
