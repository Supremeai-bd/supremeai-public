import { describe, expect, it } from 'vitest';
import { classifySpokenJarvisCommand, computeJarvisToggleState } from './jarvisVoiceRouter';

describe('jarvisVoiceRouter', () => {
  it('keeps jarvis and live voice strictly synchronized across toggle & desync states', () => {
    // Both off -> turns both cleanly ON
    expect(computeJarvisToggleState(false, false)).toEqual({
      nextJarvisEnabled: true,
      nextLiveVoiceOpen: true,
      action: 'enable',
    });

    // Desync case 1: persisted jarvisEnabled=true after reload while liveVoiceOpen=false
    // Clicking toggle MUST turn BOTH OFF instead of re-opening live voice!
    expect(computeJarvisToggleState(true, false)).toEqual({
      nextJarvisEnabled: false,
      nextLiveVoiceOpen: false,
      action: 'disable',
    });

    // Desync case 2: liveVoiceOpen=true while jarvisEnabled=false
    expect(computeJarvisToggleState(false, true)).toEqual({
      nextJarvisEnabled: false,
      nextLiveVoiceOpen: false,
      action: 'disable',
    });

    // Normal ON -> OFF
    expect(computeJarvisToggleState(true, true)).toEqual({
      nextJarvisEnabled: false,
      nextLiveVoiceOpen: false,
      action: 'disable',
    });
  });

  it('routes voice UI commands directly to dashboard actions', () => {
    const darkCmd = classifySpokenJarvisCommand({ transcript: 'Hey Jarvis, turn on dark mode' });
    expect(darkCmd.kind).toBe('dashboard_action');
    expect(darkCmd.dashboardMatch.action).toBe('toggle_dark_mode');
    expect(darkCmd.shouldInterruptLiveReply).toBe(true);

    const bnCmd = classifySpokenJarvisCommand({ transcript: 'জার্ভিস, বাংলায় কথা বলো' });
    expect(bnCmd.kind).toBe('dashboard_action');
    expect(bnCmd.dashboardMatch.action).toBe('switch_lang_bn');

    const themeCmd = classifySpokenJarvisCommand({ transcript: 'Switch to Aurora theme' });
    expect(themeCmd.kind).toBe('dashboard_action');
    expect(themeCmd.dashboardMatch.action).toBe('set_live_theme');
    expect(themeCmd.dashboardMatch.payload).toBe('aurora-borealis');

    const stopCmd = classifySpokenJarvisCommand({ transcript: 'Jarvis stop' });
    expect(stopCmd.kind).toBe('dashboard_action');
    expect(stopCmd.dashboardMatch.action).toBe('disable_jarvis');
  });

  it('routes actionable spoken requests to autonomous task execution', () => {
    const buildCmd = classifySpokenJarvisCommand({
      transcript: 'Hey Jarvis, build me an invoice calculator website',
    });
    expect(buildCmd.kind).toBe('autonomous_task');
    expect(buildCmd.primaryGoal).toBe('build_app');
    expect(buildCmd.autoOpenDockTab).toBe('preview');

    const searchCmd = classifySpokenJarvisCommand({
      transcript: 'আজকের ডলারের দাম সার্চ করে দাও',
    });
    expect(searchCmd.kind).toBe('autonomous_task');
    expect(searchCmd.primaryGoal).toBe('live_web');

    const scheduleCmd = classifySpokenJarvisCommand({
      transcript: 'Remind me every day at 9am to check https://example.com',
    });
    expect(scheduleCmd.kind).toBe('autonomous_task');
    expect(scheduleCmd.primaryGoal).toBe('schedule_task');
  });

  it('keeps casual conversational remarks in live_chat', () => {
    const chatCmd = classifySpokenJarvisCommand({
      transcript: 'How are you doing today?',
    });
    expect(chatCmd.kind).toBe('live_chat');
    expect(chatCmd.shouldInterruptLiveReply).toBe(false);
  });
});
