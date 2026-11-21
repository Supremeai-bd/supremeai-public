import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Plus,
  Mic,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Paperclip,
  Image as ImageIcon,
  X,
  BookOpen,
  Lock,
  AudioLines,
  Loader2,
  Check,
  Wand2,
  Search,
  Lightbulb,
  SlidersHorizontal,
  Globe,
  Braces,
  Bot,
  Eye,
} from 'lucide-react';
import { ModelDetail, ChatAttachment, PlanTier, WorkbenchThinkingLevel } from '../types';
import { SUPREMEAI_MODELS, getModelColorTheme } from '../data/models';
import { usePlatformStore } from '../stores/usePlatformStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useCustomerStore } from '../stores/useCustomerStore';
import { useChatStore } from '../stores/useChatStore';
import { useAudioTranscription } from '../hooks/useAudioTranscription';
import type { LiveSessionStatus } from '../hooks/useLiveVoiceSession';
import { useI18n } from '../utils/i18n';
import { estimateMessagesContextTokens, validateJsonSchemaInput } from '../utils/workbenchUtils';
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
  developerMode?: boolean;
  onOpenLiveVoice?: () => void;
  isLiveVoiceOpen?: boolean;
  voiceStatus?: LiveSessionStatus;
}

const TIER_RANK: Record<PlanTier, number> = {
  Free: 0,
  Pro: 1,
  Enterprise: 2,
};

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onStopStreaming,
  isStreaming,
  activeModel,
  onSelectModel,
  onOpenPromptLibrary,
  developerMode: developerModeProp,
  onOpenLiveVoice,
  isLiveVoiceOpen = false,
  voiceStatus = 'idle',
}) => {
  const [inputText, setInputText] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showManualModels, setShowManualModels] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showWorkbenchMenu, setShowWorkbenchMenu] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isProcessingAttachment, setIsProcessingAttachment] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const { t } = useI18n();

  const runSettings = useChatStore((s) => s.runSettings);
  const updateRunSettings = useChatStore((s) => s.updateRunSettings);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const customInstruction = useChatStore((s) => s.customInstruction);
  const activeMessages = React.useMemo(
    () => (sessions.find((s) => s.id === activeSessionId) || sessions[0])?.messages || [],
    [sessions, activeSessionId]
  );
  const estimatedContextTokens = React.useMemo(
    () => estimateMessagesContextTokens(activeMessages, inputText, attachments, customInstruction),
    [activeMessages, inputText, attachments, customInstruction]
  );
  const schemaValidation = React.useMemo(
    () => validateJsonSchemaInput(runSettings.jsonSchemaText),
    [runSettings.jsonSchemaText]
  );
  const isThinkingManual = runSettings.thinkingMode === 'manual';
  const isSearchManual = runSettings.searchMode === 'manual';
  const hasCustomRunConfig =
    isSearchManual ||
    runSettings.responseMimeType === 'application/json' ||
    isThinkingManual ||
    !runSettings.agentLoopEnabled;

  const {
    isRecording,
    isTranscribing,
    recordingSeconds,
    error: transcribeError,
    toggleRecording,
    clearError: clearTranscribeError,
  } = useAudioTranscription({
    onTranscript: (transcript) => {
      setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = usePlatformStore((s) => s.config);
  const currentRole = useAuthStore((s) => s.currentRole);
  const authUser = useAuthStore((s) => s.authUser);
  const storeDeveloperMode = useCustomerStore((s) => s.userSettings.developerMode);
  const autoModelRouting = useCustomerStore((s) => s.userSettings.autoModelRouting !== false);
  const updateSettings = useCustomerStore((s) => s.updateSettings);
  const developerMode =
    developerModeProp !== undefined
      ? developerModeProp
      : Boolean(storeDeveloperMode && (authUser?.isDeveloperEligible || currentRole === 'admin'));

  const userTier: PlanTier = authUser?.plan || 'Pro';
  const isVisionEnabled = config.featureFlags.enable_multimodal_vision !== false;
  const activeModelTheme = getModelColorTheme(activeModel.id);

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

  // Microphone Audio Transcription via gemini-3.5-transcribe
  const toggleListening = () => {
    void toggleRecording();
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

        {transcribeError && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300">
            <span className="truncate">{transcribeError}</span>
            <button
              type="button"
              onClick={clearTranscribeError}
              className="p-0.5 rounded hover:bg-rose-500/20 cursor-pointer shrink-0"
              aria-label="Dismiss audio transcription error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* SupremeAI Container-Responsive Input Capsule */}
        <div className="relative rounded-2xl @[640px]/input:rounded-3xl theme-input-surface border shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:shadow-[0_14px_40px_rgba(0,0,0,0.45)] theme-capsule-focus transition-all p-2 @[520px]/input:p-2.5 flex flex-wrap @[640px]/input:flex-nowrap items-center gap-1.5 @[520px]/input:gap-2">
          {/* Left + Button (Clean Intent-First Upload, Recipes & Quick Starters) */}
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

          {/* Right Controls: Workbench Run Settings + Model Selector + Voice/Mic + Send */}
          <div className="order-3 ml-auto @[640px]/input:ml-0 flex items-center gap-1 @[520px]/input:gap-1.5 shrink-0 pr-0.5">
            {estimatedContextTokens > 0 && (
              <span
                title={`Estimated prompt context: ~${estimatedContextTokens.toLocaleString('en-US')} tokens`}
                className="hidden @[560px]/input:inline text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500 px-1 select-none"
              >
                ~{estimatedContextTokens.toLocaleString('en-US')} {t.wbTokensEstSuffix}
              </span>
            )}

            {/* Workbench Run Config Popover (Developer Mode Only) */}
            {developerMode && (
              <div className="relative">
                <button
                  type="button"
                  data-testid="workbench-run-settings-btn"
                  onClick={() => {
                    setShowWorkbenchMenu((prev) => !prev);
                    setShowModelMenu(false);
                  }}
                  aria-label={t.wbSettingsBtn}
                  title={t.wbSettingsTitle}
                  className={`relative w-7 h-7 @[520px]/input:w-8 @[520px]/input:h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                    showWorkbenchMenu
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                      : 'hover:bg-slate-200/80 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {hasCustomRunConfig && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-cyan-500" />
                  )}
                </button>

                {showWorkbenchMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowWorkbenchMenu(false)}
                    />
                    <div
                      data-testid="workbench-run-settings-popover"
                      className="absolute right-0 bottom-full mb-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40 p-3 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {t.wbSettingsTitle}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-slate-400">
                          ~{estimatedContextTokens.toLocaleString('en-US')} {t.wbTokensEstSuffix}
                        </span>
                      </div>

                      {/* Thinking Level */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          {t.wbThinkingLevelLabel}
                        </div>
                        <div className="grid grid-cols-5 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80">
                          <button
                            type="button"
                            onClick={() => updateRunSettings({ thinkingMode: 'auto' })}
                            className={`py-1 rounded-md text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                              !isThinkingManual
                                ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-300 shadow-xs'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                          >
                            {t.wbAutoModeBtn}
                          </button>
                          {(['LOW', 'MEDIUM', 'HIGH', 'XHIGH'] as WorkbenchThinkingLevel[]).map(
                            (lvl) => (
                              <button
                                key={lvl}
                                type="button"
                                onClick={() =>
                                  updateRunSettings({ thinkingLevel: lvl, thinkingMode: 'manual' })
                                }
                                className={`py-1 rounded-md text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                                  isThinkingManual && runSettings.thinkingLevel === lvl
                                    ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-300 shadow-xs'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                              >
                                {lvl}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {/* Google Search Grounding */}
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                          <Globe className="w-3.5 h-3.5 text-cyan-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                              {t.wbSearchGroundingLabel}
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug">
                              {runSettings.responseMimeType === 'application/json'
                                ? t.wbJsonModeDisablesSearch
                                : t.wbSearchGroundingHint}
                            </div>
                          </div>
                        </label>
                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                          {isSearchManual ? (
                            <button
                              type="button"
                              onClick={() => updateRunSettings({ searchMode: 'auto' })}
                              className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                            >
                              {t.wbAutoModeBtn}
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                              {t.wbAutoModeBtn}
                            </span>
                          )}
                          <input
                            type="checkbox"
                            checked={
                              runSettings.responseMimeType !== 'application/json' &&
                              isSearchManual &&
                              runSettings.enableSearchGrounding
                            }
                            disabled={runSettings.responseMimeType === 'application/json'}
                            onChange={(e) =>
                              updateRunSettings({
                                enableSearchGrounding: e.target.checked,
                                searchMode: 'manual',
                              })
                            }
                            className="accent-cyan-500 cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Autonomous Agent Loop */}
                      <label className="flex items-start justify-between gap-2 cursor-pointer">
                        <div className="flex items-start gap-2 min-w-0">
                          <Bot className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                              {t.wbAgentLoopLabel}
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug">
                              {t.wbAgentLoopHint}
                            </div>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={runSettings.agentLoopEnabled}
                          onChange={(e) =>
                            updateRunSettings({ agentLoopEnabled: e.target.checked })
                          }
                          className="mt-0.5 accent-emerald-500 cursor-pointer"
                        />
                      </label>

                      {/* Structured JSON Output */}
                      <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2">
                        <label className="flex items-start justify-between gap-2 cursor-pointer">
                          <div className="flex items-start gap-2 min-w-0">
                            <Braces className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                {t.wbStructuredOutputLabel}
                              </div>
                              <div className="text-[10px] text-slate-400 leading-snug">
                                {t.wbStructuredOutputHint}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={runSettings.responseMimeType === 'application/json'}
                            onChange={(e) =>
                              updateRunSettings({
                                responseMimeType: e.target.checked
                                  ? 'application/json'
                                  : 'text/plain',
                              })
                            }
                            className="mt-0.5 accent-amber-500 cursor-pointer"
                          />
                        </label>

                        {runSettings.responseMimeType === 'application/json' && (
                          <div className="space-y-1">
                            <textarea
                              rows={2}
                              value={runSettings.jsonSchemaText}
                              onChange={(e) =>
                                updateRunSettings({ jsonSchemaText: e.target.value })
                              }
                              placeholder={t.wbJsonSchemaPlaceholder}
                              className="w-full px-2 py-1.5 text-[11px] font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:border-cyan-500"
                            />
                            {!schemaValidation.valid && (
                              <p className="text-[10px] text-rose-500">
                                {t.wbJsonSchemaInvalid}: {schemaValidation.error}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Model Override Selector — silent automatic routing for Standard users; Developer Mode unlocks manual overrides */}
            {developerMode && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowModelMenu((prev) => {
                      const next = !prev;
                      if (next) setShowManualModels(!autoModelRouting);
                      return next;
                    });
                  }}
                  aria-label={autoModelRouting ? t.autoModelTitle : `Model: ${activeModel.name}`}
                  title={
                    autoModelRouting
                      ? t.autoModelDesc
                      : `${activeModel.name} (${activeModelTheme.label})`
                  }
                  className={`flex items-center gap-1.5 px-2.5 @[520px]/input:px-3 py-1 rounded-full border text-[11px] @[520px]/input:text-xs font-semibold transition-all cursor-pointer ${
                    autoModelRouting
                      ? 'theme-accent-active text-slate-900 dark:text-white'
                      : activeModelTheme.triggerClass
                  }`}
                >
                  {autoModelRouting ? (
                    <Sparkles className="w-3 h-3 theme-accent-text shrink-0" />
                  ) : (
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${activeModelTheme.dotClass}`}
                    />
                  )}
                  <span className="whitespace-nowrap">
                    {autoModelRouting ? t.autoModelBadge : activeModel.name}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-75 shrink-0" />
                </button>

                {/* Model Menu Dropdown (Developer Mode only): Auto Routing First + Collapsible Manual Selection */}
                {developerMode && showModelMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowModelMenu(false)} />
                    <div className="absolute right-0 bottom-full mb-2 w-76 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40 p-1.5 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          updateSettings({ autoModelRouting: true });
                          setShowModelMenu(false);
                        }}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                          autoModelRouting
                            ? 'theme-accent-active font-medium'
                            : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 theme-accent-text shrink-0" />
                            <span>{t.autoModelTitle}</span>
                          </span>
                          {autoModelRouting && (
                            <Check className="w-3.5 h-3.5 theme-accent-text shrink-0" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                          {t.autoModelDesc}
                        </p>
                      </button>

                      <div className="border-t border-slate-100 dark:border-slate-700/70 my-1 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowManualModels((v) => !v)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
                        >
                          <span>{t.manualModelToggle}</span>
                          {showManualModels ? (
                            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                          )}
                        </button>
                      </div>

                      {showManualModels && (
                        <div className="space-y-0.5 max-h-60 overflow-y-auto pt-0.5">
                          {SUPREMEAI_MODELS.map((model) => {
                            const policy = config.modelPolicies[model.id] || {
                              enabled: true,
                              minTier: 'Free',
                            };
                            const isDisabledByAdmin = !policy.enabled && currentRole !== 'admin';
                            const isTierLocked =
                              currentRole !== 'admin' &&
                              TIER_RANK[userTier] < TIER_RANK[policy.minTier];
                            const isBlocked = isDisabledByAdmin || isTierLocked;
                            const modelTheme = getModelColorTheme(model.id);
                            const isSelected = !autoModelRouting && model.id === activeModel.id;

                            return (
                              <button
                                key={model.id}
                                type="button"
                                disabled={isBlocked}
                                onClick={() => {
                                  if (isBlocked) return;
                                  updateSettings({ autoModelRouting: false });
                                  onSelectModel(model);
                                  setShowModelMenu(false);
                                }}
                                className={`w-full text-left p-2 rounded-lg transition-colors ${
                                  isBlocked
                                    ? 'opacity-50 cursor-not-allowed bg-slate-50/50 dark:bg-slate-900/30 text-slate-400'
                                    : isSelected
                                      ? `${modelTheme.menuActiveClass} font-medium cursor-pointer`
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 border border-transparent text-slate-700 dark:text-slate-300 cursor-pointer'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold flex items-center gap-2">
                                    {isBlocked ? (
                                      <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                                    ) : (
                                      <span
                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${modelTheme.dotClass}`}
                                      />
                                    )}
                                    <span className={isSelected ? modelTheme.activeTextClass : ''}>
                                      {model.name}
                                    </span>
                                  </span>
                                  {(isDisabledByAdmin ||
                                    isTierLocked ||
                                    developerMode ||
                                    currentRole === 'admin') && (
                                    <span className="text-[10px] font-mono text-slate-400">
                                      {isDisabledByAdmin
                                        ? 'Disabled'
                                        : isTierLocked
                                          ? `${policy.minTier}+`
                                          : model.latencyRating}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 pl-4.5 line-clamp-1">
                                  {model.tagline}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Unified Voice & Microphone Mode Button */}
            {onOpenLiveVoice ? (
              <button
                type="button"
                onClick={onOpenLiveVoice}
                aria-label={isLiveVoiceOpen ? 'Disable Voice Mode' : 'Enable Voice Mode'}
                aria-pressed={isLiveVoiceOpen}
                title={
                  isLiveVoiceOpen
                    ? 'Voice Mode active — speak or type for voice replies (click to turn off)'
                    : 'Enable Voice Mode — speak or type and hear 3D Avatar voice responses'
                }
                className={`inline-flex items-center gap-1 px-2.5 py-1 @[520px]/input:py-1.5 rounded-full border text-[11px] @[520px]/input:text-xs font-medium transition-all cursor-pointer shrink-0 ${
                  isLiveVoiceOpen
                    ? 'theme-btn-primary border-transparent'
                    : 'theme-accent-active hover:brightness-105'
                }`}
              >
                {isLiveVoiceOpen ? (
                  <AudioLines className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Mic className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="hidden @[440px]/input:inline whitespace-nowrap">
                  {isLiveVoiceOpen
                    ? voiceStatus === 'speaking'
                      ? t.voiceSpeakingBtn
                      : t.voiceOnBtn
                    : t.voiceBtn}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleListening}
                disabled={isTranscribing}
                aria-label={
                  isRecording
                    ? 'Stop recording and transcribe audio'
                    : 'Record audio for transcription'
                }
                className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-full hover:bg-slate-200/80 dark:hover:bg-slate-700/80 transition-colors cursor-pointer disabled:opacity-50 ${
                  isRecording
                    ? 'text-white bg-rose-600 hover:bg-rose-700'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {isTranscribing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
                ) : isRecording ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span className="font-mono text-[10px]">
                      0:{String(recordingSeconds).padStart(2, '0')}
                    </span>
                  </>
                ) : (
                  <Mic className="w-4 h-4" />
                )}
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
