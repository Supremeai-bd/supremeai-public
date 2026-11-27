import { describe, expect, it } from 'vitest';
import {
  buildMemoryContextPrompt,
  detectDirectDashboardActionWithPayload,
  isRunLastCodeCommand,
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
      'open_workspace_dock'
    );
    expect(detectDirectDashboardActionWithPayload('still background', false).action).toBe(
      'toggle_theme_motion'
    );
    const theme = detectDirectDashboardActionWithPayload('set cyberpunk theme', false);
    expect(theme.action).toBe('set_live_theme');
    expect(theme.payload).toBe('cyberpunk');
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

describe('run-last-code voice/chat command (replaces chat Run/Preview buttons)', () => {
  it('detects short EN / BN / Banglish run commands', () => {
    for (const phrase of [
      'run it',
      'Run',
      'preview',
      'please run the code',
      'show me the preview',
      'run it again',
      'চালাও',
      'কোডটা চালাও',
      'প্রিভিউ দেখাও',
      'রান করো',
      'chalao',
      'eta chalao',
      'preview dekhao',
      'run koro',
    ]) {
      expect(isRunLastCodeCommand(phrase), phrase).toBe(true);
      expect(detectDirectDashboardActionWithPayload(phrase, false).action, phrase).toBe(
        'run_last_code'
      );
    }
  });

  it('does not hijack real requests that merely mention running', () => {
    for (const phrase of [
      'run a marathon',
      'show me how to run a node server',
      'preview of the new iphone',
      'write code to run',
      'how do I run python',
      'chalao ekta website',
      'open settings',
    ]) {
      expect(isRunLastCodeCommand(phrase), phrase).toBe(false);
    }
  });
});
