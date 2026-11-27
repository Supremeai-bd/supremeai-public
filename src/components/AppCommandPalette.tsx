import React, { useEffect, useMemo, useState } from 'react';
import { CommandPalette } from './CommandPalette';
import { ADMIN_SECTIONS } from '../config/adminSections';
import { SUBVIEW_TITLES, getLocalizedSubviewTitle } from '../config/navigationTabs';
import { useAdminHealthSummary } from '../hooks/useAdminHealthSummary';
import type { DashboardActionType } from '../services/intentOrchestrator';
import { useChatStore } from '../stores/useChatStore';
import {
  OPEN_COMMAND_PALETTE_EVENT,
  isPaletteShortcut,
  type PaletteItem,
} from '../utils/commandPalette';
import { useI18n } from '../utils/i18n';
import type { TranslationKeys } from '../locales/en';

/**
 * বাংলা মন্তব্য: Ctrl+K (⌘K) — যেকোনো জায়গা থেকে পেজ, অ্যাডমিন সেকশন, চ্যাট আর দ্রুত কাজ
 * খুঁজে এক Enter-এ খোলা। অ্যাডমিন হলে "মনোযোগ দরকার" (লাল/হলুদ সমস্যা) সবার ওপরে আসে।
 * কাজগুলো আগের `supremeai-dashboard-action` ইভেন্ট দিয়ে চলে — ভয়েস/চ্যাট যেভাবে চালায়, ঠিক সেভাবে।
 */

type T = Record<TranslationKeys, string>;

interface AppCommandPaletteProps {
  isAdmin: boolean;
  onSelectTab: (tab: string) => void;
}

const USER_PAGES = [
  'universal-inbox',
  'user-projects',
  'boost-limit',
  'user-team',
  'user-billing',
  'user-settings',
] as const;

function dispatchAction(action: DashboardActionType, language: string) {
  window.dispatchEvent(
    new CustomEvent('supremeai-dashboard-action', {
      detail: { action, language: language === 'bn' ? 'bn' : 'en' },
    })
  );
}

export function buildBaseItems(opts: {
  t: T;
  lang: string;
  isAdmin: boolean;
  onSelectTab: (tab: string) => void;
  onOpenChat: (id: string) => void;
  sessions: ReturnType<typeof useChatStore.getState>['sessions'];
}): PaletteItem[] {
  const { t, lang, isAdmin, onSelectTab, onOpenChat, sessions } = opts;
  const act = (
    id: DashboardActionType,
    title: string,
    keywords: string[],
    subtitle?: string
  ): PaletteItem => ({
    id: `action:${id}`,
    title,
    subtitle,
    group: 'actions',
    keywords,
    run: () => dispatchAction(id, lang),
  });

  const items: PaletteItem[] = [
    act('new_chat', t.cpNewChat, ['new', 'chat', 'নতুন', 'চ্যাট']),
    act('open_workspace_dock', t.cpOpenWorkspace, ['workspace', 'code', 'dock', 'ওয়ার্কস্পেস']),
    act('toggle_voice', t.cpToggleVoice, ['voice', 'jarvis', 'mic', 'ভয়েস']),
    act('toggle_dark_mode', t.cpDarkMode, ['dark', 'theme', 'ডার্ক', 'থিম']),
    act('toggle_light_mode', t.cpLightMode, ['light', 'theme', 'লাইট', 'থিম']),
    act(
      lang === 'bn' ? 'switch_lang_en' : 'switch_lang_bn',
      lang === 'bn' ? 'Switch to English' : 'বাংলায় দেখাও (Switch to Bangla)',
      ['language', 'bangla', 'english', 'ভাষা', 'বাংলা']
    ),
    {
      id: 'page:chat',
      title: t.cpPageChat,
      group: 'pages',
      keywords: ['chat', 'home', 'চ্যাট'],
      run: () => onSelectTab('chat'),
    },
  ];

  for (const tab of USER_PAGES) {
    const title = tab === 'universal-inbox' ? t.cpPageInbox : getLocalizedSubviewTitle(tab, t);
    items.push({
      id: `page:${tab}`,
      title,
      group: 'pages',
      keywords: [tab.replace(/-/g, ' '), SUBVIEW_TITLES[tab] || ''],
      run: () => onSelectTab(tab),
    });
  }

  if (isAdmin) {
    for (const section of ADMIN_SECTIONS) {
      for (const tab of section.tabs) {
        items.push({
          id: `admin:${tab.id}`,
          title: tab.label === section.label ? tab.label : `${section.label} › ${tab.label}`,
          subtitle: section.description,
          group: 'admin',
          keywords: [
            'admin',
            tab.id.replace(/-/g, ' '),
            SUBVIEW_TITLES[tab.id] || '',
            getLocalizedSubviewTitle(tab.id, t),
          ],
          run: () => onSelectTab(tab.id),
        });
      }
    }
  }

  const chats = sessions
    .filter((s) => s.messages.some((m) => m.role !== 'system'))
    .sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned) || b.updatedAt - a.updatedAt)
    .slice(0, 50);
  for (const s of chats) {
    const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
    items.push({
      id: `chat:${s.id}`,
      title: s.title || t.inboxAiUntitled,
      subtitle: t.inboxAiMessages.replace('{n}', String(s.messages.length)),
      group: 'chats',
      keywords: lastUser ? [lastUser.content.slice(0, 200)] : [],
      run: () => onOpenChat(s.id),
    });
  }
  return items;
}

/** Admin-only extras: open issues first, and issue counts on each section. */
const AdminPaletteBody: React.FC<{
  base: PaletteItem[];
  onSelectTab: (tab: string) => void;
  onClose: () => void;
}> = ({ base, onSelectTab, onClose }) => {
  const { t } = useI18n();
  const { issues, issuesBySection } = useAdminHealthSummary();
  const items = useMemo(() => {
    const attention: PaletteItem[] = issues
      .filter((i) => i.severity !== 'info')
      .sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'))
      .slice(0, 6)
      .map((i) => ({
        id: `issue:${i.id}`,
        title: i.title,
        subtitle: i.detail,
        group: 'attention' as const,
        keywords: ['issue', 'problem', 'fix', 'সমস্যা'],
        badge: {
          text: i.severity === 'critical' ? t.cpCritical : t.cpWarning,
          tone: i.severity === 'critical' ? ('critical' as const) : ('warning' as const),
        },
        run: () => onSelectTab(i.targetTab),
      }));
    const withBadges = base.map((it) => {
      if (it.group !== 'admin') return it;
      const section = ADMIN_SECTIONS.find((s) => `admin:${s.tabs[0].id}` === it.id);
      const c = section ? issuesBySection[section.id] : undefined;
      if (!c || (c.critical === 0 && c.warning === 0)) return it;
      return {
        ...it,
        badge: {
          text: String(c.critical || c.warning),
          tone: c.critical ? ('critical' as const) : ('warning' as const),
        },
      };
    });
    return [...attention, ...withBadges];
  }, [base, issues, issuesBySection, onSelectTab, t]);
  return <CommandPalette open onClose={onClose} items={items} />;
};

const PaletteBody: React.FC<AppCommandPaletteProps & { onClose: () => void }> = ({
  isAdmin,
  onSelectTab,
  onClose,
}) => {
  const { t, lang } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const base = useMemo(
    () =>
      buildBaseItems({
        t,
        lang,
        isAdmin,
        onSelectTab,
        sessions,
        onOpenChat: (id) => {
          void selectSession(id);
          onSelectTab('chat');
        },
      }),
    [t, lang, isAdmin, onSelectTab, sessions, selectSession]
  );
  return isAdmin ? (
    <AdminPaletteBody base={base} onSelectTab={onSelectTab} onClose={onClose} />
  ) : (
    <CommandPalette open onClose={onClose} items={base} />
  );
};

export const AppCommandPalette: React.FC<AppCommandPaletteProps> = (props) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  if (!open) return null;
  return <PaletteBody {...props} onClose={() => setOpen(false)} />;
};
