import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UniversalInboxPanel } from './UniversalInboxPanel';
import { gmailAdapter, setInboxAdapter } from '../../adapters/inbox/registry';

/**
 * বাংলা মন্তব্য: আগে Telegram/WhatsApp/Messenger/Instagram ফিল্টার বাটন সবসময়
 * দেখাত অথচ কোনো adapter ছিল না। এখন বাটন শুধু নিবন্ধিত adapter থেকেই আসে।
 */
afterEach(() => {
  cleanup();
  setInboxAdapter('telegram', undefined);
});

describe('UniversalInboxPanel — চ্যানেল ফিল্টার', () => {
  it('শুধু Gmail নিবন্ধিত থাকলে কোনো ভুয়া সোশ্যাল বাটন নেই', () => {
    render(<UniversalInboxPanel />);
    for (const label of ['Telegram', 'WhatsApp', 'Messenger', 'Instagram']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(screen.queryByText(/Local Desktop\/APK Sandbox Required/)).toBeNull();
  });

  it('নতুন adapter নিবন্ধন করলে তার বাটন নিজে থেকে দেখা যায়', () => {
    setInboxAdapter('telegram', gmailAdapter);
    render(<UniversalInboxPanel />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gmail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WhatsApp' })).toBeNull();
  });
});
