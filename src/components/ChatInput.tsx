import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Plus,
  Paperclip,
  Image as ImageIcon,
  X,
  BookOpen,
  AudioLines,
  Loader2,
  Wand2,
  Search,
  Lightbulb,
  Bot,
  Eye,
} from 'lucide-react';
import { ModelDetail, ChatAttachment } from '../types';
import { usePlatformStore } from '../stores/usePlatformStore';
import { useAuthStore } from '../stores/useAuthStore';
import type { LiveSessionStatus } from '../hooks/useLiveVoiceSession';
import { useI18n } from '../utils/i18n';
import {
  isImageAttachment,
  MAX_CHAT_ATTACHMENTS,
  processSelectedFiles,
} from '../utils/imageAttachmentUtils';

interface ChatInputProps {
  onSendMessage: (
    text: string,
    attachment?: ChatAttachment,
    attachments?: ChatAttachment[]
  ) => void;
  onStopStreaming: () => void;
  isStreaming: boolean;
  activeModel: ModelDetail;
  onSelectModel: (model: ModelDetail) => void;
  onOpenPromptLibrary?: () => void;
  onOpenLiveVoice?: () => void;
  isLiveVoiceOpen?: boolean;
  voiceStatus?: LiveSessionStatus;
  /** বাংলা মন্তব্য: JARVIS মোড — ভয়েস + অটোনমাস টাস্ক এক্সিকিউশনের সেতু */
  jarvisEnabled?: boolean;
  onToggleJarvis?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onStopStreaming,
  isStreaming,
  activeModel,
  onSelectModel,
  onOpenPromptLibrary,
  onOpenLiveVoice,
  isLiveVoiceOpen = false,
  jarvisEnabled = false,
  onToggleJarvis,
}) => {
  const [inputText, setInputText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isProcessingAttachment, setIsProcessingAttachment] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const { t } = useI18n();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = usePlatformStore((s) => s.config);
  const currentRole = useAuthStore((s) => s.currentRole);
  const isVisionEnabled = config.featureFlags.enable_multimodal_vision !== false;
  const isJarvisOrVoiceActive = Boolean(jarvisEnabled || isLiveVoiceOpen);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 180);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [inputText]);

  // Listen for Click-to-Prompt Element Inspector injections from Preview dock
  useEffect(() => {
    const handleInjectPrompt = (ev: Event) => {
      const detail = (ev as CustomEvent<{ text?: string; focus?: boolean }>).detail;
      const snippet = detail?.text?.trim();
      if (!snippet) return;
      setInputText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${snippet} ` : `${snippet} `));
      if (detail?.focus !== false) {
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.focus();
            const len = el.value.length;
            el.setSelectionRange(len, len);
          }
        });
      }
    };
    window.addEventListener('supremeai-insert-chat-prompt', handleInjectPrompt);
    return () => window.removeEventListener('supremeai-insert-chat-prompt', handleInjectPrompt);
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && attachments.length === 0) || isStreaming || isProcessingAttachment) {
      return;
    }
    onSendMessage(
      inputText.trim(),
      attachments[0],
      attachments.length > 0 ? attachments : undefined
    );
    setInputText('');
    setAttachments([]);
    setAttachmentError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const ingestFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (!isVisionEnabled && currentRole !== 'admin') {
      setAttachmentError(t.attachmentDisabledError);
      return;
    }
    if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
      setAttachmentError(t.attachmentMaxLimitError);
      return;
    }

    setAttachmentError(null);
    setIsProcessingAttachment(true);
    try {
      const { attachments: processed, errors } = await processSelectedFiles(
        files,
        attachments.length
      );
      if (processed.length > 0) {
        setAttachments((prev) => [...prev, ...processed].slice(0, MAX_CHAT_ATTACHMENTS));
      }
      if (errors.length > 0) {
        setAttachmentError(errors[0]);
      }
    } finally {
      setIsProcessingAttachment(false);
    }
  };

  // Handle File / Image Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    setShowAttachMenu(false);
    if (fileList.length > 0) {
      void ingestFiles(fileList);
    }
  };

  // Handle Clipboard Image Paste (Ctrl+V / Cmd+V screenshots)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          const ext = (f.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
          const named =
            f.name && f.name !== 'image.png'
              ? f
              : new File([f], `pasted-image-${Date.now()}.${ext}`, { type: f.type });
          imageFiles.push(named);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void ingestFiles(imageFiles);
    }
  };

  // Handle Drag-and-Drop Images / Files
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDraggingOver) setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setIsDraggingOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    void ingestFiles(dropped);
  };



  const insertStarter = (snippet: string) => {
    setInputText((prev) => (prev ? `${prev}\n${snippet}` : snippet));
    setShowAttachMenu(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  };

  return (
    <div
      className="w-full px-2.5 @[480px]/chat:px-4 py-2 @[480px]/chat:py-3 bg-transparent transition-colors"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="@container/input workspace-input-container space-y-2 relative">
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.ts,.tsx,.json,.py,.md"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Drag-and-Drop Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 rounded-2xl @[640px]/input:rounded-3xl border-2 border-dashed border-cyan-500 bg-cyan-500/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/85 text-cyan-200 text-xs font-medium shadow-md">
              <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t.attachmentDropHint}</span>
            </div>
          </div>
        )}

        {/* Attachment preview capsules if files/images are loaded */}
        {(attachments.length > 0 || isProcessingAttachment) && (
          <div className="space-y-1.5">
            {attachments.length > 0 &&
              (() => {
                const hasImages = attachments.some((a) => isImageAttachment(a));
                return (
                  <div
                    data-testid="vision-mode-indicator"
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-[11px] text-cyan-700 dark:text-cyan-300"
                    title={hasImages ? t.visionModeInspectingHint : t.fileInspectionHint}
                  >
                    <Eye className="w-3 h-3 text-cyan-500 shrink-0" />
                    <span className="font-semibold">
                      {hasImages ? t.visionModeLabel : t.fileInspectionLabel}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      · {hasImages ? t.visionModeInspectingHint : t.fileInspectionHint}
                    </span>
                  </div>
                );
              })()}
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.name}-${idx}`}
                  className="flex items-center gap-2 p-1.5 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 max-w-fit shadow-xs animate-in fade-in duration-150"
                >
                  {isImageAttachment(att) && att.data ? (
                    <img
                      src={att.data}
                      alt={att.name}
                      className="w-9 h-9 rounded-md object-cover border border-slate-300 dark:border-slate-600"
                    />
                  ) : (
                    <Paperclip className="w-4 h-4 text-cyan-500" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs font-mono font-medium text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                      {att.name}
                    </span>
                    <span className="text-[10px] text-slate-400">{t.attachedHint}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachments((prev) => prev.filter((_, i) => i !== idx));
                      setAttachmentError(null);
                    }}
                    aria-label={`Remove ${att.name}`}
                    className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-rose-500 transition-colors ml-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {isProcessingAttachment && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
                  <span>{t.attachmentProcessing}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {attachmentError && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300">
            <span className="truncate">{attachmentError}</span>
            <button
              type="button"
              onClick={() => setAttachmentError(null)}
              className="p-0.5 rounded hover:bg-rose-500/20 cursor-pointer shrink-0"
              aria-label="Dismiss attachment error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* SupremeAI Container-Responsive Input Capsule */}
        <div className="relative rounded-2xl @[640px]/input:rounded-3xl theme-input-surface border shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:shadow-[0_14px_40px_rgba(0,0,0,0.45)] theme-capsule-focus transition-all p-2 @[520px]/input:p-2.5 flex flex-wrap @[640px]/input:flex-nowrap items-center gap-1.5 @[520px]/input:gap-2">
          {/* Left Controls: + Attach Menu */}
          <div className="order-2 @[640px]/input:order-1 flex items-center shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                aria-label="Attach files, prompt recipes, and starters"
                title={t.inputOptionsHeader}
                className="relative w-7 h-7 @[520px]/input:w-8 @[520px]/input:h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 text-slate-600 dark:text-slate-300"
              >
                <Plus className="w-3.5 h-3.5 @[520px]/input:w-4 @[520px]/input:h-4" />
              </button>

              {/* Streamlined + Menu */}
              {showAttachMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowAttachMenu(false)} />
                  <div className="absolute left-0 bottom-full mb-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40 p-2 space-y-1 text-xs">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {t.inputOptionsHeader}
                    </div>
                    {(isVisionEnabled || currentRole === 'admin') && (
                      <button
                        type="button"
                        onClick={() => {
                          fileInputRef.current?.click();
                          setShowAttachMenu(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                        <span>{t.uploadFileOption}</span>
                      </button>
                    )}
                    {onOpenPromptLibrary && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenPromptLibrary();
                          setShowAttachMenu(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <span>{t.browseRecipesOption}</span>
                      </button>
                    )}

                    <div className="border-t border-slate-100 dark:border-slate-700/60 my-1 pt-1" />
                    <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {t.quickStartersHeader}
                    </div>
                    <button
                      type="button"
                      onClick={() => insertStarter(t.starterBuildAppPrompt)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer"
                    >
                      <Wand2 className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                      <span>{t.starterBuildAppTitle}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertStarter(t.starterResearchPrompt)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>{t.starterResearchTitle}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertStarter(t.starterAnalyzePrompt)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer"
                    >
                      <Lightbulb className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{t.starterAnalyzeTitle}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Text Area — always spans generous width on row 1 when narrow, inline center when wide */}
          <textarea
            id="supremeai-chat-input"
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              attachments.length > 0
                ? t.attachmentPlaceholder
                : isLiveVoiceOpen
                  ? t.voicePlaceholder
                  : t.askPlaceholder
            }
            className="order-1 @[640px]/input:order-2 basis-full @[640px]/input:basis-0 @[640px]/input:flex-1 min-w-0 max-h-40 bg-transparent resize-none border-none focus:outline-none text-xs @[520px]/input:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-2 py-1 leading-relaxed"
          />

          {/* Right Controls: Unified JARVIS Voice + Task Action & Send */}
          <div className="order-3 ml-auto @[640px]/input:ml-0 flex items-center gap-1 @[520px]/input:gap-1.5 shrink-0 pr-0.5">
            {/* বাংলা মন্তব্য: একক JARVIS বাটন — অন করলে ভয়েস ও টাস্ক অটোমেশন দুটোই চালু হয়, অফ করলে দুটোই বন্ধ হয়। */}
            {(onToggleJarvis || onOpenLiveVoice) && (
              <button
                type="button"
                onClick={() => {
                  if (onToggleJarvis) {
                    onToggleJarvis();
                  } else if (onOpenLiveVoice) {
                    onOpenLiveVoice();
                  }
                }}
                aria-label={isJarvisOrVoiceActive ? t.jarvisDisableTooltip : t.jarvisEnableTooltip}
                aria-pressed={isJarvisOrVoiceActive}
                title={isJarvisOrVoiceActive ? t.jarvisDisableTooltip : t.jarvisEnableTooltip}
                data-testid="jarvis-toggle"
                className={`inline-flex items-center gap-1.5 px-3 py-1 @[520px]/input:py-1.5 rounded-full border text-[11px] @[520px]/input:text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                  isJarvisOrVoiceActive
                    ? 'theme-btn-primary border-transparent shadow-xs'
                    : 'theme-accent-active hover:brightness-105'
                }`}
              >
                <Bot
                  className={`w-3.5 h-3.5 shrink-0 ${isJarvisOrVoiceActive ? 'animate-pulse' : ''}`}
                  aria-hidden="true"
                />
                {isJarvisOrVoiceActive && (
                  <AudioLines className="w-3.5 h-3.5 shrink-0 text-cyan-400 animate-pulse" />
                )}
                <span className="whitespace-nowrap">
                  {isJarvisOrVoiceActive ? t.jarvisOnBtn : t.jarvisBtn}
                </span>
              </button>
            )}

            {/* Submit / Stop button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                aria-label="Stop generating"
                className="w-7 h-7 @[520px]/input:w-8 @[520px]/input:h-8 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-colors cursor-pointer shadow-xs"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={(!inputText.trim() && attachments.length === 0) || isProcessingAttachment}
                aria-label="Send prompt"
                className="w-7 h-7 @[520px]/input:w-8 @[520px]/input:h-8 rounded-full theme-btn-primary disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
