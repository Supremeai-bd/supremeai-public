import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LiveVoicePanel } from './LiveVoicePanel';
import { useThemeStore } from '../../stores/useThemeStore';

vi.mock('./LiveVoiceAvatarCanvas', () => ({
  LiveVoiceAvatarCanvas: ({ isDark }: { isDark?: boolean }) => (
    <div data-testid="avatar-canvas" data-dark={String(isDark)} />
  ),
}));

afterEach(() => cleanup());

const renderPanel = () =>
  render(
    <LiveVoicePanel
      isOpen
      status="idle"
      voiceName="Kore"
      liveModelText=""
      levelsRef={{ current: { input: 0, output: 0 } }}
    />
  );

describe('LiveVoicePanel — অবতারের ব্যাকগ্রাউন্ড থিমের সাথে মেলে', () => {
  it('লাইট থিমে কোনো স্থায়ী কালো ব্যাকগ্রাউন্ড নেই, ক্যানভাস লাইট মোড পায়', () => {
    useThemeStore.setState({ resolvedScheme: 'light' } as never);
    renderPanel();
    const panel = screen.getByTestId('live-voice-panel');
    const classes = panel.className.split(/\s+/);
    expect(classes).not.toContain('bg-slate-950/85');
    expect(classes).toContain('bg-white/90');
    expect(classes).toContain('sm:bg-transparent');
    expect(panel.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('avatar-canvas').getAttribute('data-dark')).toBe('false');
  });

  it('ডার্ক থিমে ক্যানভাস ডার্ক মোড পায়; চ্যাটের সাথে আলাদা রঙিন গ্রেডিয়েন্ট নেই', () => {
    useThemeStore.setState({ resolvedScheme: 'dark' } as never);
    renderPanel();
    const panel = screen.getByTestId('live-voice-panel');
    expect(panel.getAttribute('data-theme')).toBe('dark');
    expect(panel.className).not.toMatch(/from-cyan-950|from-slate-50/);
    expect(screen.getByTestId('avatar-canvas').getAttribute('data-dark')).toBe('true');
  });
});
