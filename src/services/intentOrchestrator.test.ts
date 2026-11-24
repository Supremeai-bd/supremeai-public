import { describe, expect, it } from 'vitest';
import {
  buildMemoryContextPrompt,
  detectDirectDashboardActionWithPayload,
  shouldEnableSmartDeveloperMode,
} from './intentOrchestrator';

describe('intentOrchestrator smart commands & adaptive memory', () => {
  it('supports natural EN/BN/Banglish direct dashboard commands', () => {
    expect(detectDirectDashboardActionWithPayload('dark mode koro', false).action).toBe(
      'toggle_dark_mode'
    );
    expect(detectDirectDashboardActionWithPayload('বাংলায় কথা বলো', false).action).toBe(
      'switch_lang_bn'
    );
    expect(detectDirectDashboardActionWithPayload('switch to english', false).action).toBe(
      'switch_lang_en'
    );
    expect(detectDirectDashboardActionWithPayload('turn on developer tools', false).action).toBe(
      'enable_dev_mode'
    );
    expect(detectDirectDashboardActionWithPayload('still background', false).action).toBe(
      'toggle_theme_motion'
    );
    const theme = detectDirectDashboardActionWithPayload('set cyberpunk theme', false);
    expect(theme.action).toBe('set_live_theme');
    expect(theme.payload).toBe('cyberpunk');
  });

  it('automatically adapts developerMode from learned affinity and explicit overrides', () => {
    expect(
      shouldEnableSmartDeveloperMode({
        explicitDeveloperMode: false,
        isAdmin: false,
        memory: {
          preferredLanguage: 'en',
          recentTopics: [],
          interactionCount: 5,
          developerAffinityScore: 4,
          updatedAt: Date.now(),
        },
      })
    ).toBe(false);

    expect(
      shouldEnableSmartDeveloperMode({
        explicitDeveloperMode: undefined,
        isAdmin: false,
        memory: {
          preferredLanguage: 'en',
          recentTopics: [],
          interactionCount: 4,
          developerAffinityScore: 2,
          updatedAt: Date.now(),
        },
      })
    ).toBe(true);

    expect(
      shouldEnableSmartDeveloperMode({
        explicitDeveloperMode: undefined,
        isAdmin: false,
        memory: {
          preferredLanguage: 'bn',
          recentTopics: [],
          interactionCount: 3,
          developerAffinityScore: 0,
          updatedAt: Date.now(),
        },
      })
    ).toBe(false);
  });

  it('embeds learned brevity and language preferences cleanly into memory prompt', () => {
    const prompt = buildMemoryContextPrompt({
      preferredLanguage: 'bn',
      recentTopics: ['ecommerce', 'invoice'],
      interactionCount: 4,
      developerAffinityScore: 0,
      preferredResponseStyle: 'concise',
      updatedAt: Date.now(),
    });
    expect(prompt).toMatch(/Bengali/);
    expect(prompt).toMatch(/brief, direct answers/i);
    expect(prompt).toMatch(/ecommerce, invoice/);
  });
});
