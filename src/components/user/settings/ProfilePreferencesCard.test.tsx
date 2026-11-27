import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AUTO_SAVE_DELAY_MS, ProfilePreferencesCard } from './ProfilePreferencesCard';
import { AdminWorkspaceSwitcher } from './AdminWorkspaceSwitcher';

const baseSettings = { name: 'Rahim', customInstructions: '', showWorkspaceTips: true };

describe('ProfilePreferencesCard (auto-save)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('has no Save button', () => {
    render(<ProfilePreferencesCard settings={baseSettings} onUpdateSettings={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(document.querySelector('form')).toBeNull();
  });

  it('saves the name automatically after typing stops', () => {
    const onUpdate = vi.fn();
    render(<ProfilePreferencesCard settings={baseSettings} onUpdateSettings={onUpdate} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Rahim Uddin ' } });
    expect(onUpdate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS));
    expect(onUpdate).toHaveBeenCalledWith({ name: 'Rahim Uddin' });
  });

  it('never saves an empty name', () => {
    const onUpdate = vi.fn();
    render(<ProfilePreferencesCard settings={baseSettings} onUpdateSettings={onUpdate} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '   ' } });
    act(() => vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS * 2));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('applies instructions live and saves them once typing stops', () => {
    const onUpdate = vi.fn();
    const onLive = vi.fn();
    render(
      <ProfilePreferencesCard
        settings={baseSettings}
        onUpdateSettings={onUpdate}
        onInstructionsLive={onLive}
      />
    );
    const box = document.getElementById('profile-custom-instructions')!;
    fireEvent.change(box, { target: { value: 'Be brief' } });
    expect(onLive).toHaveBeenCalledWith('Be brief');
    act(() => vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS));
    expect(onUpdate).toHaveBeenCalledWith({ customInstructions: 'Be brief' });
  });

  it('saves the tips switch immediately', () => {
    const onUpdate = vi.fn();
    render(<ProfilePreferencesCard settings={baseSettings} onUpdateSettings={onUpdate} />);
    fireEvent.click(screen.getByTestId('profile-workspace-tips'));
    expect(onUpdate).toHaveBeenCalledWith({ showWorkspaceTips: false });
  });
});

describe('AdminWorkspaceSwitcher', () => {
  afterEach(cleanup);

  it('switches between admin studio and the normal view', () => {
    const onSwitch = vi.fn();
    const { rerender } = render(
      <AdminWorkspaceSwitcher currentRole="user" onSwitchRole={onSwitch} />
    );
    fireEvent.click(screen.getByTestId('admin-workspace-switch-btn'));
    expect(onSwitch).toHaveBeenCalledWith('admin');

    const onOpen = vi.fn();
    rerender(
      <AdminWorkspaceSwitcher
        currentRole="admin"
        onSwitchRole={onSwitch}
        onOpenAdminConsole={onOpen}
      />
    );
    fireEvent.click(screen.getByTestId('admin-workspace-switch-btn'));
    expect(onSwitch).toHaveBeenLastCalledWith('user');
  });
});
