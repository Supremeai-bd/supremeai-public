import React, { Suspense, useState, useEffect, useRef } from 'react';
import {
  PanelLeft,
  PanelRight,
  Download,
  Trash2,
  Share2,
  GitFork,
  AlertTriangle,
  X,
  Lock,
  UserCheck,
  ShieldCheck,
  Megaphone,
  ArrowLeft,
  Home,
  Pin,
  LogIn,
  MoreVertical,
  Search,
  ChevronRight,
} from 'lucide-react';
import { WorkspaceMicroSurvey } from './components/chat/WorkspaceTipsAndSurvey';
import { shareService } from './services/shareService';
import { decodeArtifactSharePayload } from './utils/previewShare';
import { Sidebar } from './components/Sidebar';
import { ChatThread } from './components/ChatThread';
import { ChatEmptyState } from './components/chat/ChatEmptyState';
import { ChatInput } from './components/ChatInput';
import { GuestOnboardingCard } from './components/chat/GuestOnboardingCard';
import { useLiveVoiceSession } from './hooks/useLiveVoiceSession';
import {
  jarvisService,
  isJarvisModeEnabled,
  subscribeJarvisMode,
} from './services/jarvisService';
import { shouldRouteToAutonomousAgent } from './shared/agentTypes';
import { isAuthorizedAdminEmail } from './services/authService';
import { useHitlApproval } from './hooks/useHitlApproval';
import { ToastContainer } from './components/common/ToastContainer';
import { PWAInstallButton } from './components/common/PWAInstallButton';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import {
  DangerConfirmModal,
  type DangerConfirmState,
} from './components/common/DangerConfirmModal';
import {
  ADMIN_ONLY_TABS,
  DEV_ONLY_TABS,
  getLocalizedSubviewTitle,
  SUBVIEW_TITLES,
} from './config/navigationTabs';
import { detectPlatform } from './bridge/platform';
import { toast } from './stores/useToastStore';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { startUnifiedPlatformSync } from './sync/unifiedSyncCoordinator';
import { IntentClarificationCard } from './components/chat/IntentClarificationCard';
import { TaskApprovalCard } from './components/chat/TaskApprovalCard';
import {
  orchestrateUserIntent,
  loadUserMemory,
  shouldEnableSmartDeveloperMode,
  USER_MEMORY_UPDATED_EVENT,
  type DashboardActionType,
  type PendingClarification,
  type UserMemoryProfile,
} from './services/intentOrchestrator';
import {
  classifySpokenJarvisCommand,
  computeJarvisToggleState,
} from './utils/jarvisVoiceRouter';

const ChatHistoryView = React.lazy(() =>
  import('./components/chat/ChatHistoryView').then((m) => ({ default: m.ChatHistoryView }))
);
const LiveVoicePanel = React.lazy(() =>
  import('./components/chat/LiveVoicePanel').then((m) => ({ default: m.LiveVoicePanel }))
);
const WorkspaceDock = React.lazy(() =>
  import('./components/workspace/WorkspaceDock').then((m) => ({ default: m.WorkspaceDock }))
);
const RoleModal = React.lazy(() =>
  import('./components/RoleModal').then((m) => ({ default: m.RoleModal }))
);
const RoleLab = React.lazy(() =>
  import('./components/RoleLab').then((m) => ({ default: m.RoleLab }))
);
const ModelMatrix = React.lazy(() =>
  import('./components/ModelMatrix').then((m) => ({ default: m.ModelMatrix }))
);
const RepoHub = React.lazy(() =>
  import('./components/RepoHub').then((m) => ({ default: m.RepoHub }))
);
const UserProjectsView = React.lazy(() =>
  import('./components/user/UserProjectsView').then((m) => ({ default: m.UserProjectsView }))
);
const UserPluginsView = React.lazy(() =>
  import('./components/user/UserPluginsView').then((m) => ({ default: m.UserPluginsView }))
);
const UserSettingsView = React.lazy(() =>
  import('./components/user/UserSettingsView').then((m) => ({ default: m.UserSettingsView }))
);
const UserApiKeysView = React.lazy(() =>
  import('./components/user/UserApiKeysView').then((m) => ({ default: m.UserApiKeysView }))
);
const BoostLimitView = React.lazy(() =>
  import('./components/user/BoostLimitView').then((m) => ({ default: m.BoostLimitView }))
);
const UserKnowledgeBaseView = React.lazy(() =>
  import('./components/user/UserKnowledgeBaseView').then((m) => ({
    default: m.UserKnowledgeBaseView,
  }))
);
const UserTeamView = React.lazy(() =>
  import('./components/user/UserTeamView').then((m) => ({ default: m.UserTeamView }))
);
const UserPlanUsageView = React.lazy(() =>
  import('./components/user/UserPlanUsageView').then((m) => ({ default: m.UserPlanUsageView }))
);
const UsageView = React.lazy(() =>
  import('./components/UsageView').then((m) => ({ default: m.UsageView }))
);
const PromptLibraryModal = React.lazy(() =>
  import('./components/user/PromptLibraryModal').then((m) => ({ default: m.PromptLibraryModal }))
);
const AuthPage = React.lazy(() =>
  import('./components/auth/AuthPage').then((m) => ({ default: m.AuthPage }))
);
const AdminOverviewView = React.lazy(() =>
  import('./components/admin/AdminOverviewView').then((m) => ({ default: m.AdminOverviewView }))
);
const AdminArchitectureTopologyView = React.lazy(() =>
  import('./components/admin/AdminArchitectureTopologyView').then((m) => ({
    default: m.AdminArchitectureTopologyView,
  }))
);
const AdminVisualCockpitView = React.lazy(() =>
  import('./components/admin/AdminVisualCockpitView').then((m) => ({
    default: m.AdminVisualCockpitView,
  }))
);
const AdminGitHubPipelineView = React.lazy(() =>
  import('./components/admin/AdminGitHubPipelineView').then((m) => ({
    default: m.AdminGitHubPipelineView,
  }))
);
const AdminCustomersView = React.lazy(() =>
  import('./components/admin/AdminCustomersView').then((m) => ({ default: m.AdminCustomersView }))
);
const AdminMcpTowerView = React.lazy(() =>
  import('./components/admin/AdminMcpTowerView').then((m) => ({ default: m.AdminMcpTowerView }))
);
const AdminAgentSwarmView = React.lazy(() =>
  import('./components/admin/AdminAgentSwarmView').then((m) => ({ default: m.AdminAgentSwarmView }))
);
const AdminTaskQueueView = React.lazy(() =>
  import('./components/admin/AdminTaskQueueView').then((m) => ({ default: m.AdminTaskQueueView }))
);
const AdminSchemaParityView = React.lazy(() =>
  import('./components/admin/AdminSchemaParityView').then((m) => ({
    default: m.AdminSchemaParityView,
  }))
);
const AdminLlmGatewayView = React.lazy(() =>
  import('./components/admin/AdminLlmGatewayView').then((m) => ({ default: m.AdminLlmGatewayView }))
);
const AdminSecurityView = React.lazy(() =>
  import('./components/admin/AdminSecurityView').then((m) => ({ default: m.AdminSecurityView }))
);
const AdminSystemAuditView = React.lazy(() =>
  import('./components/admin/AdminSystemAuditView').then((m) => ({
    default: m.AdminSystemAuditView,
  }))
);
const AdminFeatureFlagsView = React.lazy(() =>
  import('./components/admin/AdminFeatureFlagsView').then((m) => ({
    default: m.AdminFeatureFlagsView,
  }))
);
const AdminProviderKeysView = React.lazy(() =>
  import('./components/admin/AdminProviderKeysView').then((m) => ({
    default: m.AdminProviderKeysView,
  }))
);
const AdminMultiAccountProviderHub = React.lazy(() =>
  import('./components/admin/AdminMultiAccountProviderHub').then((m) => ({
    default: m.AdminMultiAccountProviderHub,
  }))
);
const AdminAuthModal = React.lazy(() =>
  import('./components/admin/AdminAuthModal').then((m) => ({ default: m.AdminAuthModal }))
);
const AdminTwoFactorModal = React.lazy(() =>
  import('./components/admin/AdminTwoFactorModal').then((m) => ({ default: m.AdminTwoFactorModal }))
);
const HitlApprovalModal = React.lazy(() =>
  import('./components/admin/HitlApprovalModal').then((m) => ({ default: m.HitlApprovalModal }))
);
const ControlCenterSafetyGateModal = React.lazy(() =>
  import('./components/admin/ControlCenterSafetyGateModal').then((m) => ({
    default: m.ControlCenterSafetyGateModal,
  }))
);
const ControlCenterHitlPoliciesView = React.lazy(() =>
  import('./components/admin/ControlCenterHitlPoliciesView').then((m) => ({
    default: m.ControlCenterHitlPoliciesView,
  }))
);
const ControlCenterReleaseGateView = React.lazy(() =>
  import('./components/admin/ControlCenterReleaseGateView').then((m) => ({
    default: m.ControlCenterReleaseGateView,
  }))
);
const ControlCenterAgentBridgeView = React.lazy(() =>
  import('./components/admin/ControlCenterAgentBridgeView').then((m) => ({
    default: m.ControlCenterAgentBridgeView,
  }))
);
const ControlCenterMemoryGraphView = React.lazy(() =>
  import('./components/admin/ControlCenterMemoryGraphView').then((m) => ({
    default: m.ControlCenterMemoryGraphView,
  }))
);
const ControlCenterComputeFleetView = React.lazy(() =>
  import('./components/admin/ControlCenterComputeFleetView').then((m) => ({
    default: m.ControlCenterComputeFleetView,
  }))
);
const ControlCenterFinOpsOmnichannelView = React.lazy(() =>
  import('./components/admin/ControlCenterFinOpsOmnichannelView').then((m) => ({
    default: m.ControlCenterFinOpsOmnichannelView,
  }))
);
const ControlCenterHealthMonitorView = React.lazy(() =>
  import('./components/admin/ControlCenterHealthMonitorView').then((m) => ({
    default: m.ControlCenterHealthMonitorView,
  }))
);

import { useAuthStore } from './stores/useAuthStore';
import { useAppPreferencesStore } from './stores/useAppPreferencesStore';
import { useChatStore } from './stores/useChatStore';
import { useAdminStore } from './stores/useAdminStore';
import { useCustomerStore } from './stores/useCustomerStore';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useThemeStore, LIVE_THEMES, type LiveThemeId } from './stores/useThemeStore';
import { usePlatformStore } from './stores/usePlatformStore';
import { useControlCenterStore } from './stores/useControlCenterStore';
import { useTabRouter } from './hooks/useTabRouter';
import { useMcpTelemetry } from './hooks/useMcpTelemetry';
import { useAutoUpdater } from './hooks/useAutoUpdater';
import { useOsThemeSync } from './hooks/useOsThemeSync';
import { LiveScreenBackdrop } from './components/theme/LiveScreenBackdrop';
import { AdminConsoleNav } from './components/admin/AdminConsoleNav';
import { UserProject, ChatAttachment } from './types';
import { useI18n } from './utils/i18n';
import { executeScheduledTaskOnce, loadScheduledTasks } from './services/browserVaultService';
import { getCronMinuteKey, matchesCronAtDate } from './shared/cronMatcher';



export default function App() {
  useOsThemeSync();
  useAutoUpdater();

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title =
        detectPlatform() === 'tauri' ? 'SupremeAI Studio Desktop' : 'SupremeAI Studio';
    }
  }, []);

  // বাংলা মন্তব্য: Web, Desktop, Mobile এবং VS Code Extension-এর মধ্যে একীভূত রিয়েল-টাইম সিঙ্ক ইঞ্জিন সক্রিয় করা হলো
  useEffect(() => {
    return startUnifiedPlatformSync();
  }, []);

  const { activeTab, setActiveTab } = useTabRouter('chat');

  const {
    authUser,
    impersonatedCustomer,
    trustedBrowserUntil,
    isTwoFactorModalOpen,
    isAdminAuthModalOpen,
    setIsTwoFactorModalOpen,
    setIsAdminAuthModalOpen,
    logout,
    revokeTrustedBrowser,
    impersonateCustomer,
    exitImpersonation,
  } = useAuthStore();

  const currentRole = useAppPreferencesStore((s) => s.role);
  const setRole = useAppPreferencesStore((s) => s.setRole);

  const {
    sessions,
    activeSessionId,
    activeModel,
    activeRole,
    customInstruction,
    isStreaming,
    streamingContent,
    inferenceError,
    generatingTitleIds,
    isPromptModalOpen,
    isRoleModalOpen,
    selectSession,
    deleteSession,
    renameSession,
    togglePinSession,
    createNewSession,
    branchSession,
    clearCurrentThread,
    exportThread,
    selectModel,
    selectRole,
    setCustomInstruction,
    setIsPromptModalOpen,
    setIsRoleModalOpen,
    sendMessage,
    appendVoiceTurn,
    stopStreaming,
    pendingTaskApproval,
    approvePendingTask,
    dismissPendingTask,
    clearPendingTaskApproval,
  } = useChatStore();

  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(
    null
  );

  const {
    mcpServices,
    isProbingCluster,
    swarmWorkers,
    queueJobs,
    schemaTables,
    gatewayRoutes,
    securityEvents,
    blockedIps,
    auditRecords,
    customers,
    fetchMcpServices,
    fetchAdminSync,
    rebootService,
    rebootAllServices,
    probeCluster,
    getMcpAlertCount,
    toggleSwarmWorker,
    scaleWorker,
    retryQueueJob,
    retryAllDlq,
    clearCompletedJobs,
    runParitySync,
    toggleFailover,
    updateGatewayPrice,
    addBlockedIp,
    removeBlockedIp,
    addCustomer,
    updateCustomer,
    deleteCustomer,
  } = useAdminStore();

  const {
    apiKeys,
    webhooks,
    knowledgeDocs,
    teamMembers,
    maxSeats: teamMaxSeats,
    invoices,
    userProjects,
    userPlugins,
    userSettings,
    fetchApiKeys,
    fetchWebhooks,
    fetchKnowledgeDocs,
    fetchTeamMembers,
    fetchInvoices,
    fetchProjects,
    addApiKey,
    updateApiKey,
    revokeApiKey,
    deleteApiKey,
    probeApiKey,
    addWebhook,
    deleteWebhook,
    testWebhook,
    addKnowledgeDoc,
    toggleKnowledgeGrounding,
    deleteKnowledgeDoc,
    inviteTeamMember,
    updateTeamRole,
    removeTeamMember,
    topUpTokens,
    addProject,
    forkProject,
    refreshProjectBuildStatus,
    deleteProject,
    togglePlugin,
    addCustomPlugin,
    updateSettings,
    recordTokenUsage,
  } = useCustomerStore();

  const {
    config: platformConfig,
    dismissedBannerMessage,
    fetchConfig,
    dismissBanner,
  } = usePlatformStore();

  const healthAlertCount = useControlCenterStore((s) => s.healthSnapshot?.alerts?.length ?? 0);

  const { lang: appLanguage, t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 900 : true
  );
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState<boolean>(false);

  // বাংলা মন্তব্য: JARVIS ও Live Voice বাটনের একক State Machine (Desync প্রতিরোধে)।
  const [jarvisEnabled, setJarvisEnabled] = useState<boolean>(() => isJarvisModeEnabled());
  useEffect(() => subscribeJarvisMode(setJarvisEnabled), []);
  const [userMemory, setUserMemory] = useState<UserMemoryProfile>(() => loadUserMemory());
  const [explicitDevOverride, setExplicitDevOverride] = useState<boolean | undefined>(() => {
    if (typeof localStorage === 'undefined') return undefined;
    const saved = localStorage.getItem('supremeai_dev_mode_override');
    if (saved === 'true') return true;
    if (saved === 'false') return false;
    return undefined;
  });

  useEffect(() => {
    const syncMemory = () => setUserMemory(loadUserMemory());
    window.addEventListener(USER_MEMORY_UPDATED_EVENT, syncMemory);
    return () => window.removeEventListener(USER_MEMORY_UPDATED_EVENT, syncMemory);
  }, []);

  const liveVoiceSystemInstruction =
    customInstruction.trim() ||
    userSettings.customInstructions?.trim() ||
    activeRole.systemInstruction;

  const liveTurnCommittedHandlerRef = useRef<
    (
      userText: string,
      assistantText: string,
      voice: string,
      meta?: { fromTeardown?: boolean }
    ) => void
  >(() => {});

  const liveVoice = useLiveVoiceSession({
    systemInstruction: liveVoiceSystemInstruction,
    language: appLanguage,
    onTurnCommitted: (userText, assistantText, voice, meta) => {
      liveTurnCommittedHandlerRef.current(userText, assistantText, voice, meta);
    },
  });

  const handleToggleJarvis = (forceNext?: boolean) => {
    const transition =
      typeof forceNext === 'boolean'
        ? {
            nextJarvisEnabled: forceNext,
            nextLiveVoiceOpen: forceNext,
            action: (forceNext ? 'enable' : 'disable') as 'enable' | 'disable',
          }
        : computeJarvisToggleState(isJarvisModeEnabled() || jarvisEnabled, isLiveVoiceOpen);

    if (transition.action === 'disable') {
      // বাংলা মন্তব্য: বন্ধ করার ক্লিকে কখনোই ভয়েস অন হবে না বা কথা বলবে না।
      jarvisService.setEnabled(false, { announce: false });
      liveVoice.disconnect();
      setIsLiveVoiceOpen(false);
      setJarvisEnabled(false);
      return;
    }

    jarvisService.setEnabled(true, { announce: false });
    setJarvisEnabled(true);
    setIsLiveVoiceOpen(true);
  };

  const toggleJarvisRef = useRef<() => void>(() => {});
  toggleJarvisRef.current = () => handleToggleJarvis();

  // Ctrl+Alt+J — যেকোনো সময় JARVIS ও ভয়েস মোড নিরাপদে টগল (stale closure ছাড়া)
  useEffect(() => {
    const onJarvisShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        toggleJarvisRef.current();
      }
    };
    window.addEventListener('keydown', onJarvisShortcut);
    return () => window.removeEventListener('keydown', onJarvisShortcut);
  }, []);

  useEffect(() => {
    if (isLiveVoiceOpen) {
      liveVoice.connect();
    } else {
      liveVoice.disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveVoiceOpen, appLanguage]);
  const [authModal, setAuthModal] = useState<{ open: boolean; reason?: string }>({ open: false });
  const [isSurveyForceOpen, setIsSurveyForceOpen] = useState<boolean>(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showExportSubmenu, setShowExportSubmenu] = useState(false);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);

  useEffect(() => {
    setIsChatSearchOpen(false);
    setShowChatMenu(false);
    setShowExportSubmenu(false);
  }, [activeSessionId]);
  const [dangerConfirm, setDangerConfirm] = useState<DangerConfirmState | null>(null);
  const [isDangerRunning, setIsDangerRunning] = useState(false);

  const {
    isDockOpen,
    isSharedArtifactView,
    previewCode,
    projectFiles,
    openSharedArtifact,
    toggleDock,
    setDockOpen,
    setActiveDockTab,
  } = useWorkspaceStore();
  const hasGeneratedWorkspace = previewCode.trim().length > 0 || projectFiles.length > 0;
  const isGuest = !authUser;
  const isAuthorizedAdmin = Boolean(
    authUser && (authUser.isAdminEligible || isAuthorizedAdminEmail(authUser.email))
  );
  const effectiveRole = isAuthorizedAdmin && currentRole === 'admin' ? 'admin' : 'user';
  const isProjectAdmin = isAuthorizedAdmin && effectiveRole === 'admin';
  const isDeveloperEligible = true;
  // বাংলা মন্তব্য: ব্যবহারকারীর কাজের ধরন (developerAffinityScore) বা কমান্ড বুঝে স্মার্টভাবে ডেভ-টুলস আনলক হয়
  const developerMode = shouldEnableSmartDeveloperMode({
    explicitDeveloperMode: userSettings.developerMode ? true : explicitDevOverride,
    isAdmin: isProjectAdmin,
    memory: userMemory,
  });
  const enableKnowledgeGrounding = !isGuest;

  const openAuthModal = (reason?: string) => {
    setAuthModal({ open: true, reason });
  };

  const handleSignOut = () => {
    logout();
    setDockOpen(false);
    setActiveTab('chat', true);
    setAuthModal({ open: true });
  };

  const {
    activeRequest: hitlActiveRequest,
    isProcessing: isHitlProcessing,
    approve: approveHitl,
    reject: rejectHitl,
    dismiss: dismissHitl,
  } = useHitlApproval();

  const resolvedScheme = useThemeStore((s) => s.resolvedScheme);
  const darkMode = resolvedScheme === 'dark';

  const contentLayout = userSettings.contentLayout || 'fluid';
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.workspaceLayout = contentLayout;
      document.documentElement.lang = appLanguage;
    }
  }, [contentLayout, appLanguage]);

  // Hydrate shared live preview artifact from ?artifact=<token> URL param (works 100% serverless)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const artifactToken = params.get('artifact');
    if (!artifactToken) return;
    const decoded = decodeArtifactSharePayload(artifactToken);
    if (!decoded) return;
    openSharedArtifact(decoded.code, decoded.lang, decoded.title);
    toast.success(t.wsPublishShareTitle, t.wsSharedArtifactLoaded);
    try {
      params.delete('artifact');
      const remaining = params.toString();
      const nextUrl = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    } catch {
      // Ignore history errors in restricted sandboxes
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync saved custom instructions into chat store on mount
  useEffect(() => {
    if (userSettings.customInstructions && !customInstruction) {
      setCustomInstruction(userSettings.customInstructions);
    }
  }, [userSettings.customInstructions, customInstruction, setCustomInstruction]);

  // Fetch global platform governance config and MCP telemetry
  useEffect(() => {
    fetchConfig();
    fetchMcpServices();
  }, [fetchConfig, fetchMcpServices]);

  // Hydrate authenticated customer workspace data from backend services
  useEffect(() => {
    if (!authUser) return;
    fetchApiKeys();
    fetchWebhooks();
    fetchKnowledgeDocs();
    fetchTeamMembers();
    fetchInvoices();
    fetchProjects();
  }, [
    authUser,
    fetchApiKeys,
    fetchWebhooks,
    fetchKnowledgeDocs,
    fetchTeamMembers,
    fetchInvoices,
    fetchProjects,
  ]);

  // Sync central admin records whenever an admin workspace tab is active and authenticated
  useEffect(() => {
    // বাংলা মন্তব্য: প্রজেক্ট অ্যাডমিন (2FA/RBAC বা X-Admin-Token) অ্যাডমিন ট্যাবে গেলে কেন্দ্রীয় রেকর্ড সিঙ্ক হবে।
    if (isProjectAdmin && ADMIN_ONLY_TABS.has(activeTab)) {
      fetchAdminSync();
    }
  }, [isProjectAdmin, activeTab, fetchAdminSync]);

  // Smooth tab routing guard: keep default landing page as 'chat' for all roles;
  // only downgrade away from admin-only tabs when leaving admin role.
  const prevRoleRef = useRef(effectiveRole);
  useEffect(() => {
    if (prevRoleRef.current !== effectiveRole) {
      if (effectiveRole !== 'admin' && ADMIN_ONLY_TABS.has(activeTab)) {
        setActiveTab('chat');
      } else if (
        effectiveRole === 'admin' &&
        prevRoleRef.current === 'user' &&
        (activeTab === 'chat' || activeTab === 'user-settings')
      ) {
        setActiveTab('admin-overview');
      }
      prevRoleRef.current = effectiveRole;
    }
  }, [effectiveRole, activeTab, setActiveTab]);

  // Security Gate: Only server-verified RBAC admins or configured project admin emails can access admin tabs or role
  useEffect(() => {
    const isAllowedAdmin = Boolean(
      authUser && (authUser.isAdminEligible || isAuthorizedAdminEmail(authUser.email))
    );
    if (!isAllowedAdmin) {
      if (effectiveRole === 'admin' || currentRole === 'admin') {
        setRole('user');
      }
      if (ADMIN_ONLY_TABS.has(activeTab)) {
        setActiveTab('chat');
      }
    }
  }, [authUser, effectiveRole, currentRole, activeTab, setActiveTab, setRole]);

  // Route & dock safety guard for Guest, Standard, and Admin workspaces
  useEffect(() => {
    // বাংলা মন্তব্য: লাইভ ডেটা ফ্যাব্রিক (live-sync) গেস্ট, সাধারণ ইউজার বা অ্যাডমিন—কারও জন্যই প্রয়োজন নেই।
    if (activeTab === 'live-sync') {
      setActiveTab('chat', true);
      return;
    }
    if (isGuest) {
      if (isDockOpen && !isSharedArtifactView && !hasGeneratedWorkspace) setDockOpen(false);
      if (activeTab !== 'chat') {
        const label = SUBVIEW_TITLES[activeTab] || 'Workspace Features';
        setActiveTab('chat', true);
        setAuthModal({ open: true, reason: label });
      }
      return;
    }
    if (effectiveRole !== 'admin') {
      if (!developerMode && DEV_ONLY_TABS.has(activeTab)) {
        setActiveTab('chat');
      }
    }
  }, [
    isGuest,
    isSharedArtifactView,
    hasGeneratedWorkspace,
    effectiveRole,
    developerMode,
    enableKnowledgeGrounding,
    isDockOpen,
    setDockOpen,
    activeTab,
    setActiveTab,
  ]);

  useEffect(() => {
    const handleOpenScheduleTab = () => {
      if (isGuest) {
        openAuthModal(t.wsScheduleTabTitle);
        return;
      }
      setActiveTab('chat');
      setActiveDockTab('schedule');
      setDockOpen(true);
    };
    window.addEventListener('supremeai-open-schedule-tab', handleOpenScheduleTab);
    return () => {
      window.removeEventListener('supremeai-open-schedule-tab', handleOpenScheduleTab);
    };
  }, [isGuest, setActiveTab, setActiveDockTab, setDockOpen, t.wsScheduleTabTitle]);

  const lastCronMinuteByTaskRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (isGuest) return;
    const tickSchedules = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = new Date();
      const minuteKey = getCronMinuteKey(now);
      const tasks = loadScheduledTasks();
      for (const task of tasks) {
        if (!task.enabled || !task.cronExpression) continue;
        if (lastCronMinuteByTaskRef.current.get(task.id) === minuteKey) continue;
        if (matchesCronAtDate(task.cronExpression, now)) {
          lastCronMinuteByTaskRef.current.set(task.id, minuteKey);
          void executeScheduledTaskOnce(task).then((res) => {
            window.dispatchEvent(new CustomEvent('supremeai-schedules-updated'));
            toast.info(t.wsScheduleRunHistoryToast, `${task.title}: ${res.summary}`);
          });
        }
      }
    };
    const timer = window.setInterval(tickSchedules, 30000);
    return () => window.clearInterval(timer);
  }, [isGuest, t.wsScheduleRunHistoryToast]);

  const handleSelectTab = (tab: string) => {
    if (tab === 'live-sync') {
      setActiveTab('chat');
      return;
    }
    if (isGuest && tab !== 'chat') {
      openAuthModal(SUBVIEW_TITLES[tab] || 'Settings & Workspace Features');
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setSidebarOpen(false);
      }
      return;
    }
    setActiveTab(tab);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  const handleToggleDeveloperMode = (forceNext?: boolean) => {
    if (!isDeveloperEligible) return;
    const next = typeof forceNext === 'boolean' ? forceNext : !developerMode;
    setExplicitDevOverride(next);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('supremeai_dev_mode_override', String(next));
      } catch {
        // Ignore storage errors
      }
    }
    updateSettings({ developerMode: next });
    if (!next) {
      if (DEV_ONLY_TABS.has(activeTab)) {
        setActiveTab('chat');
      }
    }
    toast.info(
      next ? 'Developer Mode Enabled' : 'Standard Workspace Active',
      next
        ? 'API keys, repositories, and Developer Tools are now unlocked.'
        : 'Clean Standard Mode active for everyday work.'
    );
  };

  useMcpTelemetry(currentRole === 'admin');

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const prevSessionMsgRef = useRef<{ sessionId: string; count: number }>({
    sessionId: currentSession?.id || '',
    count: currentSession?.messages?.length || 0,
  });
  const wasStreamingRef = useRef<boolean>(isStreaming);

  useEffect(() => {
    const sid = currentSession?.id || '';
    const count = currentSession?.messages?.length || 0;
    const prev = prevSessionMsgRef.current;

    const messageAddedInSameSession = sid === prev.sessionId && count > prev.count;
    const streamingJustStarted = !wasStreamingRef.current && isStreaming;

    if (messageAddedInSameSession || streamingJustStarted) {
      setSidebarOpen(false);
    }

    prevSessionMsgRef.current = { sessionId: sid, count };
    wasStreamingRef.current = isStreaming;
  }, [currentSession?.id, currentSession?.messages?.length, isStreaming]);

  const wasDockOpenRef = useRef<boolean>(isDockOpen);
  useEffect(() => {
    if (!wasDockOpenRef.current && isDockOpen && window.innerWidth < 1200) {
      setSidebarOpen(false);
    }
    wasDockOpenRef.current = isDockOpen;
  }, [isDockOpen]);

  const handleChatWithProject = (project: UserProject) => {
    createNewSession();
    setActiveTab('chat');
    setSidebarOpen(false);
    sendMessage(
      `Please inspect my connected GitHub repository: "${project.name}" (${project.repoUrl}, branch: ${project.branch}). Description: ${project.description}. Give me a quick architecture summary and recommended next steps.`,
      undefined,
      knowledgeDocs
    );
  };

  const handleTriggerCodeReview = (project: UserProject) => {
    createNewSession();
    setActiveTab('chat');
    setSidebarOpen(false);
    sendMessage(
      `Perform a comprehensive AI Code Review for the repository "${project.name}" (${project.repoUrl}). Check for security vulnerabilities, TypeScript strictness, and clean architecture.`,
      undefined,
      knowledgeDocs
    );
  };

  const executeDashboardAction = (
    action: DashboardActionType,
    lang: 'en' | 'bn' | 'banglish',
    payload?: string
  ): boolean => {
    const bn = lang === 'bn';
    switch (action) {
      case 'toggle_dark_mode':
        useThemeStore.getState().setThemeMode('dark');
        toast.success(
          bn ? 'ডার্ক মোড চালু' : 'Dark Mode Active',
          bn ? 'থিম ডার্ক মোডে পরিবর্তন করা হয়েছে।' : 'Switched workspace theme to dark mode.'
        );
        return true;
      case 'toggle_light_mode':
        useThemeStore.getState().setThemeMode('light');
        toast.success(
          bn ? 'লাইট মোড চালু' : 'Light Mode Active',
          bn ? 'থিম লাইট মোডে পরিবর্তন করা হয়েছে।' : 'Switched workspace theme to light mode.'
        );
        return true;
      case 'switch_lang_bn':
        useAppPreferencesStore.getState().setLanguage('bn');
        toast.success('ভাষা পরিবর্তন', 'এখন থেকে বাংলা ভাষা সক্রিয় থাকবে।');
        return true;
      case 'switch_lang_en':
        useAppPreferencesStore.getState().setLanguage('en');
        toast.success('Language Switched', 'Interface & replies switched to English.');
        return true;
      case 'set_live_theme': {
        const matchedTheme = payload && LIVE_THEMES.find((th) => th.id === payload);
        if (matchedTheme) {
          useThemeStore.getState().setLiveTheme(matchedTheme.id as LiveThemeId);
          toast.success(
            bn ? 'থিম পরিবর্তন' : 'Theme Updated',
            bn ? `${matchedTheme.name} চালু করা হয়েছে।` : `Switched scenic theme to ${matchedTheme.name}.`
          );
          return true;
        }
        return false;
      }
      case 'toggle_theme_motion': {
        const nextMotion = !useThemeStore.getState().liveMotion;
        useThemeStore.getState().setLiveMotion(nextMotion);
        toast.info(
          nextMotion ? 'Live Screen Active' : 'Still Background',
          nextMotion ? 'Background motion resumed.' : 'Switched to distraction-free still background.'
        );
        return true;
      }
      case 'new_chat':
        createNewSession();
        setActiveTab('chat');
        return true;
      case 'open_projects':
        handleSelectTab('user-projects');
        return true;
      case 'open_workspace_dock':
        setActiveTab('chat');
        setDockOpen(true);
        return true;
      case 'enable_dev_mode':
        handleToggleDeveloperMode(true);
        return true;
      case 'disable_dev_mode':
        handleToggleDeveloperMode(false);
        return true;
      case 'disable_jarvis':
        handleToggleJarvis(false);
        return true;
      case 'toggle_voice':
        handleToggleJarvis();
        toast.info(
          bn ? 'ভয়েস মোড' : 'Voice Mode',
          bn ? 'লাইভ ভয়েস ও জার্ভিস পরিবর্তন করা হয়েছে।' : 'Toggled JARVIS & Live Voice companion.'
        );
        return true;
      case 'open_usage':
        handleSelectTab('user-billing');
        return true;
      case 'open_settings':
        handleSelectTab('user-settings');
        return true;
      case 'open_knowledge':
        handleSelectTab('user-knowledge');
        return true;
      case 'open_history':
        handleSelectTab('chat-history');
        return true;
      case 'open_admin_health':
        if (effectiveRole === 'admin') {
          handleSelectTab('health-monitor');
          return true;
        }
        return false;
      case 'open_admin_ai':
        if (effectiveRole === 'admin') {
          handleSelectTab('llm-gateway');
          return true;
        }
        return false;
      case 'open_admin_security':
        if (effectiveRole === 'admin') {
          handleSelectTab('security');
          return true;
        }
        return false;
      case 'open_admin_releases':
        if (effectiveRole === 'admin') {
          handleSelectTab('github-pipeline');
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          action?: DashboardActionType;
          language?: 'en' | 'bn' | 'banglish';
          payload?: string;
        }>
      )?.detail;
      if (detail?.action) {
        executeDashboardAction(detail.action, detail.language || 'en', detail.payload);
      }
    };
    window.addEventListener('supremeai-dashboard-action', handler);
    return () => window.removeEventListener('supremeai-dashboard-action', handler);
  });

  const handleSendMessageWrapper = async (
    text: string,
    attachment?: ChatAttachment,
    attachments?: ChatAttachment[],
    skipClarification = false,
    fromVoiceCommand = false
  ) => {
    setPendingClarification(null);
    const trimmed = text.trim();
    const attCount = attachments?.length || (attachment ? 1 : 0);
    const estimatedTokens = Math.ceil(trimmed.length / 4) + attCount * 258;
    recordTokenUsage(estimatedTokens);

    // Run unified Semantic Intent Orchestrator (Bangla / Banglish / English + Actions + Clarification)
    const intent = trimmed
      ? await orchestrateUserIntent({
          promptText: trimmed,
          attachment: attachments?.[0] || attachment,
          knowledgeDocs,
          recentMessages: currentSession?.messages || [],
          isAdmin: effectiveRole === 'admin',
          skipClarification: skipClarification || isLiveVoiceOpen,
        })
      : undefined;

    if (intent && intent.dashboardAction !== 'none') {
      const handled = executeDashboardAction(
        intent.dashboardAction,
        intent.inferredLanguage,
        intent.actionPayload
      );
      if (handled) return;
    }

    setSidebarOpen(false);

    if (
      intent?.needsClarification &&
      intent.clarificationQuestion &&
      intent.clarificationOptions &&
      intent.clarificationOptions.length >= 2
    ) {
      setPendingClarification({
        id: `clarify_${Date.now()}`,
        originalPrompt: trimmed,
        question: intent.clarificationQuestion,
        options: intent.clarificationOptions,
        language: intent.inferredLanguage,
        attachment,
        attachments,
      });
      return;
    }

    // When Voice Mode or JARVIS Mode is active, inputs execute tasks or speak responses cleanly
    if ((isLiveVoiceOpen || jarvisEnabled) && attCount === 0 && trimmed) {
      // বাংলা মন্তব্য: JARVIS ব্রিজ — ভয়েস বা টেক্সট প্রম্পট কোনো কাজের (অ্যাপ বিল্ড, ওয়েব সার্চ,
      // রিসার্চ বা শিডিউল) হলে সরাসরি অটোনমাস এজেন্টে চলে ও ফলাফল ভয়েসে পাঠ করে শোনায়।
      const looksLikeTask =
        fromVoiceCommand ||
        shouldRouteToAutonomousAgent({
          promptText: trimmed,
          intent,
          hasAttachments: false,
          deepResearch: Boolean(intent?.enableDeepResearch),
          workspaceFileCount: useWorkspaceStore.getState().projectFiles.length,
        }) ||
        (intent !== undefined && intent.primaryGoal !== 'chat');

      if ((jarvisEnabled || fromVoiceCommand) && looksLikeTask) {
        await sendMessage(trimmed, undefined, knowledgeDocs, undefined, undefined, intent);
        const updatedSession = useChatStore
          .getState()
          .sessions.find((s) => s.id === activeSessionId);
        const lastMsg = updatedSession?.messages?.[updatedSession.messages.length - 1];
        if (lastMsg?.role === 'assistant' && lastMsg.content) {
          liveVoice.speakFallbackText(lastMsg.content);
        }
        return;
      }
      if (isLiveVoiceOpen && !fromVoiceCommand) {
        appendVoiceTurn(trimmed, '');
        const routed = liveVoice.sendTextPrompt(trimmed, { recordUserTranscript: false });
        if (routed) {
          return;
        }
      }
      // Fallback: generate via standard chat model and speak the response aloud via TTS
      await sendMessage(trimmed, undefined, knowledgeDocs, undefined, undefined, intent);
      const updatedSession = useChatStore.getState().sessions.find((s) => s.id === activeSessionId);
      const lastMsg = updatedSession?.messages?.[updatedSession.messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        liveVoice.speakFallbackText(lastMsg.content);
      }
      return;
    }

    await sendMessage(text, attachment, knowledgeDocs, undefined, attachments, intent);
    if (isLiveVoiceOpen) {
      const updatedSession = useChatStore.getState().sessions.find((s) => s.id === activeSessionId);
      const lastMsg = updatedSession?.messages?.[updatedSession.messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        liveVoice.speakFallbackText(lastMsg.content);
      }
    }
  };

  // বাংলা মন্তব্য: মুখে বলা প্রতিটি বাক্য বিশ্লেষণ — সরাসরি অ্যাকশন বা কাজ হলে ভয়েস থেকেই এক্সিকিউট হবে।
  liveTurnCommittedHandlerRef.current = (userText, assistantText, _voice, meta) => {
    const cleanUser = (userText || '').trim();
    if (meta?.fromTeardown || !cleanUser) {
      appendVoiceTurn(userText, assistantText);
      return;
    }

    const classification = classifySpokenJarvisCommand({
      transcript: cleanUser,
      isAdmin: effectiveRole === 'admin',
      workspaceFileCount: useWorkspaceStore.getState().projectFiles.length,
      knowledgeDocs,
    });

    if (classification.kind === 'dashboard_action') {
      liveVoice.interruptPlayback();
      const action = classification.dashboardMatch.action;
      if (action === 'disable_jarvis') {
        handleToggleJarvis(false);
        return;
      }
      executeDashboardAction(
        action,
        classification.language,
        classification.dashboardMatch.payload
      );
      const bn = classification.language === 'bn';
      const confirmMsg = bn
        ? 'ঠিক আছে, পরিবর্তনটি সম্পন্ন করা হয়েছে।'
        : 'Done — updated your workspace right away.';
      appendVoiceTurn(classification.cleanedTranscript, confirmMsg);
      liveVoice.speakFallbackText(confirmMsg);
      return;
    }

    if (classification.kind === 'autonomous_task') {
      liveVoice.interruptPlayback();
      jarvisService.notifyTaskAccepted(classification.language === 'bn' ? 'bn' : 'en');
      void handleSendMessageWrapper(
        classification.cleanedTranscript,
        undefined,
        undefined,
        true,
        true
      );
      return;
    }

    appendVoiceTurn(userText, assistantText);
  };

  const handleSelectClarificationOption = (option: string) => {
    if (!pendingClarification) return;
    const refinedPrompt = `${pendingClarification.originalPrompt} — ${option}`;
    const { attachment, attachments } = pendingClarification;
    setPendingClarification(null);
    void handleSendMessageWrapper(refinedPrompt, attachment, attachments, true);
  };

  const handleSkipClarification = () => {
    if (!pendingClarification) return;
    const { originalPrompt, attachment, attachments } = pendingClarification;
    setPendingClarification(null);
    void handleSendMessageWrapper(originalPrompt, attachment, attachments, true);
  };

  const handleExecuteDangerAction = async () => {
    if (!dangerConfirm) return;
    setIsDangerRunning(true);
    try {
      if (dangerConfirm.action === 'reboot-all') {
        await rebootAllServices();
      } else if (dangerConfirm.action === 'flush-dlq') {
        retryAllDlq();
      }
      setDangerConfirm(null);
    } finally {
      setIsDangerRunning(false);
    }
  };

  const mcpAlertCount = getMcpAlertCount();
  const activePluginsCount = userPlugins.filter((p) => p.isEnabled).length;
  const isChatEmpty = (currentSession?.messages?.length || 0) === 0 && !isStreaming;
  const totalUserMessages = sessions.reduce(
    (sum, s) => sum + (s.messages?.filter((m) => m.role === 'user').length || 0),
    0
  );
  const showAnnouncement =
    platformConfig.announcementBanner.active &&
    platformConfig.announcementBanner.message.trim().length > 0 &&
    dismissedBannerMessage !== platformConfig.announcementBanner.message;
  const isMaintenanceBlocked = platformConfig.maintenanceMode && effectiveRole !== 'admin';

  const bannerToneClasses =
    platformConfig.announcementBanner.level === 'critical'
      ? 'bg-rose-600 text-white border-rose-700'
      : platformConfig.announcementBanner.level === 'warning'
        ? 'bg-amber-500 text-slate-950 border-amber-600'
        : 'bg-blue-600 text-white border-blue-700';

  return (
    <ErrorBoundary>
      <div
        className={`theme-crossfade flex flex-col h-full w-full text-slate-900 dark:text-slate-100 font-sans antialiased overflow-hidden relative ${
          currentRole === 'admin' ? 'cyber-scanline' : ''
        }`}
      >
        {/* Dynamic Live Screen Backdrop */}
        <LiveScreenBackdrop isEmpty={isChatEmpty} isChatView={activeTab === 'chat'} />

        {/* Admin Impersonation Bar */}
        {impersonatedCustomer && (
          <div className="relative z-30 px-4 py-1.5 bg-purple-600 text-white text-xs flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0 truncate">
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Viewing workspace as <strong>{impersonatedCustomer.name}</strong> (
                {impersonatedCustomer.tier} · {impersonatedCustomer.email})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                exitImpersonation();
                setActiveTab('admin-overview');
              }}
              className="px-2.5 py-0.5 rounded-md bg-white/20 hover:bg-white/30 text-white font-semibold cursor-pointer shrink-0 whitespace-nowrap"
            >
              Exit Impersonation
            </button>
          </div>
        )}

        {/* Global System Announcement Banner */}
        {showAnnouncement && (
          <div
            className={`relative z-30 px-4 py-1.5 text-xs border-b flex items-center justify-between gap-3 shrink-0 ${bannerToneClasses}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Megaphone className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium truncate">
                {platformConfig.announcementBanner.message}
              </span>
            </div>
            <button
              type="button"
              onClick={() => dismissBanner(platformConfig.announcementBanner.message)}
              aria-label="Dismiss announcement"
              className="p-0.5 rounded hover:bg-black/15 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Viewport Container */}
        <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden relative z-10">
          {/* Maintenance Lock Overlay for non-admin workspaces */}
          {isMaintenanceBlocked && (
            <div className="absolute inset-0 z-40 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-6">
              <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center space-y-4 shadow-2xl">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center mx-auto">
                  <Lock className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Scheduled Maintenance Active
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {platformConfig.maintenanceMessage}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 pt-2">
                  {(Boolean(authUser && isAuthorizedAdminEmail(authUser.email)) ||
                    impersonatedCustomer) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (impersonatedCustomer) {
                          exitImpersonation();
                          setActiveTab('admin-overview');
                        } else {
                          setRole('admin');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Return to Admin Console</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => (isGuest ? openAuthModal('Account Access') : handleSignOut())}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {isGuest ? 'Sign In' : 'Sign Out'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Studio Sidebar */}
          <Sidebar
            sessions={sessions}
            activeSessionId={currentSession?.id || ''}
            onSelectSession={selectSession}
            onDeleteSession={deleteSession}
            onRenameSession={renameSession}
            onTogglePinSession={togglePinSession}
            onNewSession={createNewSession}
            activeRole={activeRole}
            onOpenRoleModal={() =>
              isGuest ? openAuthModal('Role & Model Customization') : setIsRoleModalOpen(true)
            }
            isOpen={sidebarOpen}
            onToggleOpen={() => setSidebarOpen(!sidebarOpen)}
            onSelectTab={handleSelectTab}
            activeTab={activeTab}
            projectsCount={userProjects.length}
            activePluginsCount={activePluginsCount}
            authUser={authUser}
            onSignOut={handleSignOut}
            developerMode={developerMode}
            enableKnowledgeGrounding={enableKnowledgeGrounding}
            tokensUsed={userSettings.monthlyTokensUsed}
            tokensLimit={userSettings.monthlyTokensLimit}
            isGuest={isGuest}
            onRequestAuth={openAuthModal}
            generatingTitleIds={generatingTitleIds}
          />

          {/* Floating Sidebar Expand Button for Chat */}
          {activeTab === 'chat' && !sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="absolute top-3.5 left-3.5 z-30 p-2 rounded-xl bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-xs transition-colors cursor-pointer"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}

          {/* 1. Chat Workspace */}
          {activeTab === 'chat' && (
            <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden relative">
              <main className="@container/chat flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden relative bg-transparent">
                {/* Streamlined Top Chat Controls */}
                <div
                  className={`relative z-20 px-3 sm:px-4 pt-3 flex items-center justify-end gap-2 flex-wrap pointer-events-none shrink-0 ${
                    !sidebarOpen ? 'pl-14' : ''
                  }`}
                >
                  <div className="pointer-events-auto flex items-center gap-1.5 flex-wrap justify-end shrink-0 ml-auto">
                    <PWAInstallButton />
                    {isGuest && (
                      <button
                        type="button"
                        onClick={() => openAuthModal('Settings & Full Workspace')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold theme-btn-primary cursor-pointer shadow-xs"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>{t.signInSignUp}</span>
                      </button>
                    )}

                    {(!isGuest || isSharedArtifactView || hasGeneratedWorkspace) && (
                      <button
                        type="button"
                        data-testid="focus-dock-toggle-btn"
                        onClick={() => toggleDock()}
                        aria-label={isDockOpen ? 'Close workspace dock' : 'Open workspace dock'}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium backdrop-blur-md border transition-all cursor-pointer shadow-xs ${
                          isDockOpen
                            ? 'theme-accent-active'
                            : 'bg-white/80 dark:bg-slate-900/80 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <PanelRight className="w-3.5 h-3.5" />
                        <span>{isDockOpen ? t.closeDock : t.workspaceDock}</span>
                      </button>
                    )}

                    {/* Consolidated 3-Dot Chat Menu (Search, Pin, Branch, Share, Export, Clear) */}
                    {(currentSession?.messages?.length || 0) > 0 && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowChatMenu((prev) => {
                              const next = !prev;
                              if (!next) setShowExportSubmenu(false);
                              return next;
                            });
                          }}
                          aria-label={t.chatActionsMenu}
                          aria-expanded={showChatMenu}
                          title={t.chatActionsMenu}
                          className={`p-2 rounded-xl backdrop-blur-md border transition-colors cursor-pointer shadow-xs ${
                            showChatMenu
                              ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-950 dark:border-white'
                              : 'bg-white/80 dark:bg-slate-900/80 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {showChatMenu && (
                          <>
                            <div
                              className="fixed inset-0 z-30"
                              onClick={() => {
                                setShowChatMenu(false);
                                setShowExportSubmenu(false);
                              }}
                            />
                            <div className="absolute right-0 top-full mt-1.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl z-40 p-1.5 text-xs space-y-0.5">
                              {(currentSession?.messages?.length || 0) > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsChatSearchOpen((prev) => !prev);
                                      setShowChatMenu(false);
                                      setShowExportSubmenu(false);
                                    }}
                                    className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition-colors cursor-pointer ${
                                      isChatSearchOpen
                                        ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-medium'
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <Search className="w-3.5 h-3.5 text-cyan-500" />
                                      <span>{t.searchInChat}</span>
                                    </span>
                                    {isChatSearchOpen && (
                                      <span className="text-[10px] font-mono font-semibold">
                                        {t.activeBadge}
                                      </span>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isGuest) {
                                        setShowChatMenu(false);
                                        openAuthModal('Pinned Conversations');
                                        return;
                                      }
                                      if (currentSession?.id) {
                                        togglePinSession(currentSession.id);
                                      }
                                      setShowChatMenu(false);
                                    }}
                                    className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer ${
                                      currentSession?.isPinned
                                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium'
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                    }`}
                                  >
                                    <Pin className="w-3.5 h-3.5 text-amber-500" />
                                    <span>{currentSession?.isPinned ? t.pinned : t.pin}</span>
                                  </button>

                                  {developerMode && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (currentSession?.id) {
                                          branchSession(currentSession.id);
                                        }
                                        setShowChatMenu(false);
                                      }}
                                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                    >
                                      <GitFork className="w-3.5 h-3.5 text-violet-500" />
                                      <span>{t.branch}</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={async () => {
                                      setShowChatMenu(false);
                                      if (isGuest) {
                                        openAuthModal('Sharing Conversations');
                                        return;
                                      }
                                      if (currentSession?.id) {
                                        try {
                                          const res = await shareService.generateShareLink(
                                            currentSession.id
                                          );
                                          await navigator.clipboard.writeText(res.share_url);
                                          toast.success('Share Link Copied', res.share_url);
                                        } catch {
                                          toast.error(
                                            'Share Failed',
                                            'Could not generate share link'
                                          );
                                        }
                                      }
                                    }}
                                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                  >
                                    <Share2 className="w-3.5 h-3.5 text-blue-500" />
                                    <span>{t.share}</span>
                                  </button>

                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => setShowExportSubmenu((prev) => !prev)}
                                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                                    >
                                      <span className="flex items-center gap-2">
                                        <Download className="w-3.5 h-3.5 text-emerald-500" />
                                        <span>{t.exportBtn}</span>
                                      </span>
                                      <ChevronRight
                                        className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                                          showExportSubmenu ? 'rotate-90' : ''
                                        }`}
                                      />
                                    </button>

                                    {showExportSubmenu && (
                                      <div className="pl-7 pr-1 py-1 space-y-0.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            exportThread('markdown');
                                            setShowExportSubmenu(false);
                                            setShowChatMenu(false);
                                          }}
                                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                                        >
                                          {t.exportMarkdown}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            exportThread('text');
                                            setShowExportSubmenu(false);
                                            setShowChatMenu(false);
                                          }}
                                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                                        >
                                          {t.exportPlainText}
                                        </button>
                                        {developerMode && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              exportThread('json');
                                              setShowExportSubmenu(false);
                                              setShowChatMenu(false);
                                            }}
                                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                                          >
                                            {t.exportJson}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsChatSearchOpen(false);
                                      setShowChatMenu(false);
                                      setShowExportSubmenu(false);
                                      clearCurrentThread();
                                    }}
                                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center gap-2 transition-colors cursor-pointer font-medium"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{t.clear}</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {isChatEmpty ? (
                  <div className="relative z-10 flex-1 min-h-0 overflow-y-auto chat-scroll-clean px-4 py-6 flex flex-col">
                    <div className="my-auto w-full flex flex-col items-center">
                      <ChatEmptyState
                        activeRole={activeRole}
                        activeModel={activeModel}
                        userName={authUser?.name || (isGuest ? 'Guest' : undefined)}
                        developerMode={developerMode}
                      />
                      {/* বাংলা মন্তব্য: গেস্ট গ্লাস অনবোর্ডিং কার্ড (Blueprint §4) —
                          ইনপুটের ঠিক উপরে; প্রথম টাইপ/মেসেজে ফেড-আউট। */}
                      {isGuest && (
                        <div className="w-full px-2 mt-3">
                          <GuestOnboardingCard
                            visible
                            onTryVoice={() => handleToggleJarvis()}
                            onTryCode={() =>
                              window.dispatchEvent(
                                new CustomEvent('supremeai-insert-chat-prompt', {
                                  detail: {
                                    text: 'Generate a full-stack starter app with authentication, a dashboard and tests.',
                                    focus: true,
                                  },
                                })
                              )
                            }
                          />
                        </div>
                      )}
                      {pendingClarification && (
                        <div className="w-full px-2 mb-3">
                          <IntentClarificationCard
                            clarification={pendingClarification}
                            onSelectOption={handleSelectClarificationOption}
                            onSkip={handleSkipClarification}
                            onCancel={() => setPendingClarification(null)}
                          />
                        </div>
                      )}
                      {pendingTaskApproval && (
                        <div className="w-full px-2 mb-3">
                          <TaskApprovalCard
                            approval={pendingTaskApproval}
                            onApprove={() => void approvePendingTask()}
                            onSkip={dismissPendingTask}
                            onCancel={clearPendingTaskApproval}
                          />
                        </div>
                      )}
                      <div className="workspace-input-container mt-2">
                        <ChatInput
                          onSendMessage={handleSendMessageWrapper}
                          onStopStreaming={stopStreaming}
                          isStreaming={isStreaming}
                          activeModel={activeModel}
                          onSelectModel={selectModel}
                          onOpenPromptLibrary={() =>
                            isGuest ? openAuthModal('Prompt Library') : setIsPromptModalOpen(true)
                          }
                          developerMode={developerMode}
                          onOpenLiveVoice={() => handleToggleJarvis()}
                          isLiveVoiceOpen={isLiveVoiceOpen}
                          voiceStatus={liveVoice.status}
                          jarvisEnabled={jarvisEnabled}
                          onToggleJarvis={() => handleToggleJarvis()}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
                    <ChatThread
                      messages={currentSession?.messages || []}
                      activeRole={activeRole}
                      activeModel={activeModel}
                      isStreaming={isStreaming}
                      streamingContent={streamingContent}
                      onSendPrompt={handleSendMessageWrapper}
                      error={inferenceError}
                      userName={authUser?.name || (isGuest ? 'Guest' : undefined)}
                      developerMode={developerMode}
                      onSpeakText={(txt) => liveVoice.speakFallbackText(txt)}
                      isSearchOpen={isChatSearchOpen}
                      onCloseSearch={() => setIsChatSearchOpen(false)}
                    />

                    {pendingClarification && (
                      <div className="px-3 pb-2">
                        <IntentClarificationCard
                          clarification={pendingClarification}
                          onSelectOption={handleSelectClarificationOption}
                          onSkip={handleSkipClarification}
                          onCancel={() => setPendingClarification(null)}
                        />
                      </div>
                    )}
                    {pendingTaskApproval && (
                      <div className="px-3 pb-2">
                        <TaskApprovalCard
                          approval={pendingTaskApproval}
                          onApprove={() => void approvePendingTask()}
                          onSkip={dismissPendingTask}
                          onCancel={clearPendingTaskApproval}
                        />
                      </div>
                    )}

                    <ChatInput
                      onSendMessage={handleSendMessageWrapper}
                      onStopStreaming={stopStreaming}
                      isStreaming={isStreaming}
                      activeModel={activeModel}
                      onSelectModel={selectModel}
                      onOpenPromptLibrary={() =>
                        isGuest ? openAuthModal('Prompt Library') : setIsPromptModalOpen(true)
                      }
                      developerMode={developerMode}
                      onOpenLiveVoice={() => handleToggleJarvis()}
                      isLiveVoiceOpen={isLiveVoiceOpen}
                      voiceStatus={liveVoice.status}
                      jarvisEnabled={jarvisEnabled}
                      onToggleJarvis={() => handleToggleJarvis()}
                    />
                  </div>
                )}
              </main>

              {isLiveVoiceOpen && (
                <Suspense fallback={null}>
                  <LiveVoicePanel
                    isOpen={isLiveVoiceOpen}
                    status={liveVoice.status}
                    voiceName={liveVoice.voiceName}
                    liveModelText={liveVoice.liveModelText}
                    levelsRef={liveVoice.levelsRef}
                    isMuted={liveVoice.isMuted}
                    onToggleMute={liveVoice.toggleMute}
                    onClose={() => handleToggleJarvis(false)}
                  />
                </Suspense>
              )}

              {(!isGuest || isSharedArtifactView || hasGeneratedWorkspace) && (
                <Suspense fallback={null}>
                  <WorkspaceDock developerMode={developerMode} isGuest={isGuest} />
                </Suspense>
              )}
            </div>
          )}

          {/* Unified Sub-View Shell with Back / Home / Close Bar & Responsive Containment */}
          {activeTab !== 'chat' && (
            <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-transparent">
              <div className="shrink-0 px-3 sm:px-6 py-2.5 border-b theme-surface-glass flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {!sidebarOpen && (
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(true)}
                      aria-label="Open sidebar"
                      title="Open sidebar"
                      className="p-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
                    >
                      <PanelLeft className="w-4 h-4" />
                    </button>
                  )}

                  {effectiveRole === 'admin' && activeTab !== 'admin-overview' && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('admin-overview')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/80 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[var(--theme-accent)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>{t.overview}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/80 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-[var(--theme-accent)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {effectiveRole === 'admin' ? (
                      <Home className="w-3.5 h-3.5 theme-accent-text" />
                    ) : (
                      <ArrowLeft className="w-3.5 h-3.5 theme-accent-text" />
                    )}
                    <span>{effectiveRole === 'admin' ? t.chatHome : t.backToChat}</span>
                  </button>

                  <span
                    aria-hidden="true"
                    className="hidden sm:inline text-slate-300 dark:text-slate-700"
                  >
                    /
                  </span>
                  <span className="hidden sm:inline text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {getLocalizedSubviewTitle(activeTab, t)}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <PWAInstallButton />
                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    aria-label={t.close}
                    title={t.close}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t.close}</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
                {isProjectAdmin &&
                  (ADMIN_ONLY_TABS.has(activeTab) ||
                    (activeTab === 'usage' && effectiveRole === 'admin')) && (
                    <AdminConsoleNav
                      activeTab={activeTab}
                      onSelectTab={handleSelectTab}
                      customersCount={customers.length}
                      mcpAlertCount={mcpAlertCount}
                      healthAlertCount={healthAlertCount || mcpAlertCount}
                    />
                  )}
                <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
                  <ErrorBoundary
                    key={activeTab}
                    fallbackTitle={`${SUBVIEW_TITLES[activeTab] || t.workspaceFallbackTitle} · ${t.viewErrorSuffix}`}
                  >
                    <Suspense
                      fallback={
                        <div className="flex-1 flex items-center justify-center p-12 text-xs text-slate-400">
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-700 border-t-[var(--theme-accent)] rounded-full animate-spin" />
                            <span>Loading view...</span>
                          </div>
                        </div>
                      }
                    >
                      {/* All Conversations / Chat History View */}
                      {activeTab === 'chat-history' && (
                        <ChatHistoryView
                          sessions={sessions}
                          activeSessionId={currentSession?.id || ''}
                          onSelectSession={selectSession}
                          onDeleteSession={deleteSession}
                          onRenameSession={renameSession}
                          onTogglePinSession={togglePinSession}
                          onBranchSession={branchSession}
                          onNewSession={createNewSession}
                          onOpenChat={() => setActiveTab('chat')}
                          developerMode={developerMode}
                        />
                      )}

                      {/* 2. Customer Workspace Views */}
                      {activeTab === 'user-projects' && (
                        <UserProjectsView
                          projects={userProjects}
                          onAddProject={addProject}
                          onDeleteProject={deleteProject}
                          onChatWithProject={handleChatWithProject}
                          onTriggerCodeReview={handleTriggerCodeReview}
                          onForkProject={forkProject}
                          onRefreshBuildStatus={refreshProjectBuildStatus}
                        />
                      )}

                      {activeTab === 'user-api-keys' && (
                        <UserApiKeysView
                          apiKeys={apiKeys}
                          onAddApiKey={addApiKey}
                          onUpdateApiKey={updateApiKey}
                          onRevokeApiKey={revokeApiKey}
                          onDeleteApiKey={deleteApiKey}
                          onProbeApiKey={probeApiKey}
                          webhooks={webhooks}
                          onAddWebhook={addWebhook}
                          onDeleteWebhook={deleteWebhook}
                          onTestWebhook={testWebhook}
                        />
                      )}

                      {activeTab === 'boost-limit' && (
                        <BoostLimitView />
                      )}

                      {activeTab === 'user-knowledge' && (
                        <UserKnowledgeBaseView
                          documents={knowledgeDocs}
                          onAddDocument={addKnowledgeDoc}
                          onToggleGrounding={toggleKnowledgeGrounding}
                          onDeleteDocument={deleteKnowledgeDoc}
                        />
                      )}

                      {activeTab === 'user-team' && (
                        <UserTeamView
                          members={teamMembers}
                          onInviteMember={inviteTeamMember}
                          onUpdateRole={updateTeamRole}
                          onRemoveMember={removeTeamMember}
                          developerMode={developerMode}
                          maxSeats={teamMaxSeats}
                          planTier={authUser?.plan || userSettings.plan}
                          onRefreshTeam={fetchTeamMembers}
                        />
                      )}

                      {(activeTab === 'user-billing' ||
                        (activeTab === 'usage' && effectiveRole !== 'admin')) && (
                        <UserPlanUsageView
                          planTier={authUser?.plan || userSettings.plan}
                          invoices={invoices}
                          currentTokensUsed={userSettings.monthlyTokensUsed}
                          tokensLimit={userSettings.monthlyTokensLimit}
                          sessions={sessions}
                          darkMode={darkMode}
                          onTopUpTokens={topUpTokens}
                          developerMode={developerMode}
                        />
                      )}

                      {activeTab === 'user-plugins' && (
                        <UserPluginsView
                          plugins={userPlugins}
                          onTogglePlugin={togglePlugin}
                          onAddCustomPlugin={addCustomPlugin}
                        />
                      )}

                      {activeTab === 'user-settings' && (
                        <UserSettingsView
                          settings={userSettings}
                          onUpdateSettings={updateSettings}
                          isAdminEligible={isAuthorizedAdmin}
                          onOpenAdminConsole={() => setActiveTab('admin-overview')}
                          isDeveloperEligible={isDeveloperEligible}
                          effectiveDeveloperMode={developerMode}
                          onToggleDeveloperMode={() => handleToggleDeveloperMode()}
                          trustedUntil={trustedBrowserUntil}
                          onRevokeTrustedBrowser={revokeTrustedBrowser}
                          onSignOut={logout}
                          onOpenFeedbackSurvey={() => setIsSurveyForceOpen(true)}
                          onOpenKnowledgeBase={() => setActiveTab('user-knowledge')}
                          onOpenLiveVoice={() => {
                            setActiveTab('chat');
                            handleToggleJarvis(true);
                          }}
                          onPreviewVoice={(sampleText) =>
                            liveVoice.speakFallbackText(sampleText || '')
                          }
                        />
                      )}

                      {/* 3. Admin Usage Analytics */}
                      {activeTab === 'usage' && currentRole === 'admin' && (
                        <UsageView sessions={sessions} darkMode={darkMode} />
                      )}

                      {/* 4. Admin Studio Command Center & Operations */}
                      {isProjectAdmin && (
                        <>
                          {activeTab === 'admin-overview' && (
                            <AdminOverviewView
                              customers={customers}
                              services={mcpServices}
                              workers={swarmWorkers}
                              jobs={queueJobs}
                              onNavigateTab={setActiveTab}
                              onOpenDangerConfirm={(action, title, description) =>
                                setDangerConfirm({ action, title, description })
                              }
                            />
                          )}

                          {activeTab === 'hitl-policies' && <ControlCenterHitlPoliciesView />}

                          {activeTab === 'release-gate' && <ControlCenterReleaseGateView />}

                          {activeTab === 'external-agents' && <ControlCenterAgentBridgeView />}

                          {activeTab === 'memory-graph' && <ControlCenterMemoryGraphView />}

                          {activeTab === 'compute-fleet' && <ControlCenterComputeFleetView />}

                          {activeTab === 'finops-omnichannel' && (
                            <ControlCenterFinOpsOmnichannelView />
                          )}

                          {activeTab === 'agent-swarm' && (
                            <AdminAgentSwarmView
                              workers={swarmWorkers}
                              onToggleWorkerStatus={toggleSwarmWorker}
                              onScaleConcurrency={scaleWorker}
                            />
                          )}

                          {activeTab === 'task-queue' && (
                            <AdminTaskQueueView
                              jobs={queueJobs}
                              onRetryJob={retryQueueJob}
                              onRetryAllDlq={retryAllDlq}
                              onClearCompleted={clearCompletedJobs}
                            />
                          )}

                          {activeTab === 'schema-parity' && (
                            <AdminSchemaParityView
                              tables={schemaTables}
                              onRunParitySync={runParitySync}
                            />
                          )}

                          {activeTab === 'llm-gateway' && (
                            <AdminLlmGatewayView
                              routes={gatewayRoutes}
                              onToggleFailover={toggleFailover}
                              onUpdatePrice={updateGatewayPrice}
                            />
                          )}

                          {activeTab === 'feature-flags' && <AdminFeatureFlagsView />}

                          {activeTab === 'provider-keys' && <AdminProviderKeysView />}

                          {activeTab === 'provider-accounts' && <AdminMultiAccountProviderHub />}

                          {activeTab === 'security' && (
                            <AdminSecurityView
                              securityEvents={securityEvents}
                              onAddBlockedIp={addBlockedIp}
                              onRemoveBlockedIp={removeBlockedIp}
                              blockedIps={blockedIps}
                            />
                          )}

                          {activeTab === 'system-audit' && (
                            <AdminSystemAuditView auditRecords={auditRecords} />
                          )}

                          {activeTab === 'customers' && (
                            <AdminCustomersView
                              customers={customers}
                              onAddCustomer={addCustomer}
                              onUpdateCustomer={updateCustomer}
                              onDeleteCustomer={deleteCustomer}
                              onImpersonateCustomer={(cust) => {
                                impersonateCustomer(cust);
                                setActiveTab('chat');
                              }}
                            />
                          )}

                          {activeTab === 'health-monitor' && <ControlCenterHealthMonitorView />}

                          {activeTab === 'architecture-map' && <AdminArchitectureTopologyView />}

                          {activeTab === 'visual-cockpit' && <AdminVisualCockpitView />}

                          {activeTab === 'github-pipeline' && <AdminGitHubPipelineView />}

                          {activeTab === 'mcp-tower' && (
                            <AdminMcpTowerView
                              services={mcpServices}
                              onRebootService={rebootService}
                              onRebootAll={rebootAllServices}
                              onProbeCluster={probeCluster}
                              isProbing={isProbingCluster}
                            />
                          )}
                        </>
                      )}

                      {ADMIN_ONLY_TABS.has(activeTab) && !isProjectAdmin && (
                        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
                          <AlertTriangle className="w-12 h-12 text-rose-500 animate-pulse" />
                          <div className="space-y-1">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">
                              Access Restricted
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                              This console is restricted to verified project administrator accounts.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab('chat')}
                            className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-semibold cursor-pointer"
                          >
                            Return to Chat
                          </button>
                        </div>
                      )}

                      {activeTab === 'roles' && (
                        <RoleLab
                          onSelectRoleForChat={(role, prompt) => {
                            selectRole(role, prompt);
                            setActiveTab('chat');
                          }}
                          onNavigateToChat={() => setActiveTab('chat')}
                        />
                      )}

                      {activeTab === 'models' && (
                        <ModelMatrix
                          activeModel={activeModel}
                          onSelectModel={selectModel}
                          onNavigateToChat={() => setActiveTab('chat')}
                        />
                      )}

                      {activeTab === 'repos' && <RepoHub />}
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          )}
        </div>

        <DangerConfirmModal
          dangerConfirm={dangerConfirm}
          isRunning={isDangerRunning}
          onCancel={() => setDangerConfirm(null)}
          onConfirm={handleExecuteDangerAction}
        />

        {/* Modals & Dialogs */}
        <Suspense fallback={null}>
          {isRoleModalOpen && (
            <RoleModal
              isOpen={isRoleModalOpen}
              onClose={() => setIsRoleModalOpen(false)}
              activeRole={activeRole}
              customInstruction={customInstruction}
              onSaveRole={(role, prompt) => selectRole(role, prompt)}
              activeModel={activeModel}
              onSelectModel={selectModel}
            />
          )}

          {isAdminAuthModalOpen && (
            <AdminAuthModal
              isOpen={isAdminAuthModalOpen}
              onClose={() => setIsAdminAuthModalOpen(false)}
              onSuccess={() => {
                setIsAdminAuthModalOpen(false);
                setRole('admin');
                setActiveTab('admin-overview');
              }}
            />
          )}

          {isTwoFactorModalOpen && (
            <AdminTwoFactorModal
              isOpen={isTwoFactorModalOpen}
              onClose={() => setIsTwoFactorModalOpen(false)}
              onSuccess={(newTrustedUntil) => {
                if (newTrustedUntil) {
                  localStorage.setItem('supremeai_trusted_browser_until', String(newTrustedUntil));
                  useAuthStore.setState({ trustedBrowserUntil: newTrustedUntil });
                }
                setIsTwoFactorModalOpen(false);
                // বাংলা মন্তব্য: 2FA সফল হলে useAuthStore ও useAppPreferencesStore উভয় স্টোরেই admin রোল সিঙ্ক করা হচ্ছে।
                useAuthStore.setState({ currentRole: 'admin' });
                localStorage.setItem('supremeai_studio_user_role', 'admin');
                setRole('admin');
                setActiveTab('admin-overview');
              }}
              userEmail={authUser?.email || ''}
            />
          )}

          {hitlActiveRequest && (
            <HitlApprovalModal
              isOpen={Boolean(hitlActiveRequest)}
              request={hitlActiveRequest}
              onApprove={async (id) => {
                await approveHitl(id);
              }}
              onReject={async (id, reason) => {
                await rejectHitl(id, reason);
              }}
              onClose={dismissHitl}
              isProcessing={isHitlProcessing}
            />
          )}

          {isProjectAdmin && <ControlCenterSafetyGateModal />}

          {isPromptModalOpen && (
            <PromptLibraryModal
              isOpen={isPromptModalOpen}
              onClose={() => setIsPromptModalOpen(false)}
              onSelectTemplate={(text) => handleSendMessageWrapper(text)}
              developerMode={developerMode}
            />
          )}

          {isGuest && authModal.open && (
            <AuthPage
              isModal
              authReason={authModal.reason}
              onClose={() => setAuthModal({ open: false })}
              onLoginSuccess={() => {
                setAuthModal({ open: false });
                setActiveTab('chat');
              }}
              darkMode={darkMode}
            />
          )}
        </Suspense>

        {!isGuest && (
          <WorkspaceMicroSurvey
            totalUserMessages={totalUserMessages}
            userEmail={authUser?.email}
            developerMode={developerMode}
            forceOpen={isSurveyForceOpen}
            onCloseForceOpen={() => setIsSurveyForceOpen(false)}
          />
        )}

        <OfflineIndicator />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}
