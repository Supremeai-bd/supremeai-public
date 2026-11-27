import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDock } from './WorkspaceDock';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { EN_DICT as en } from '../../locales/en';

// বাংলা মন্তব্য: Developer Mode সরানোর পর — সাইন-ইন করা সবাই Sandbox/Terminal/Graph পায়,
// আলাদা কোনো "ডেভেলপার" সুইচ লাগে না। গেস্টরা শুধু Preview/Code দেখে।
describe('WorkspaceDock without Developer Mode', () => {
  beforeEach(() => {
    act(() => {
      useWorkspaceStore.setState({ isDockOpen: true, activeDockTab: 'preview' });
    });
  });
  afterEach(() => cleanup());

  it('offers Sandbox, Terminal and Graph to every signed-in user', () => {
    render(<WorkspaceDock isGuest={false} />);
    fireEvent.click(screen.getByTitle(en.dockMoreTools));
    expect(screen.getByTestId('dock-tab-sandbox')).toBeInTheDocument();
    expect(screen.getByTestId('dock-tab-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('dock-tab-graph')).toBeInTheDocument();
  });

  it('keeps guests on Preview and Code only', () => {
    render(<WorkspaceDock isGuest />);
    expect(screen.getByTestId('dock-tab-preview')).toBeInTheDocument();
    expect(screen.getByTestId('dock-tab-code')).toBeInTheDocument();
    expect(screen.queryByTitle(en.dockMoreTools)).toBeNull();
    expect(screen.queryByTestId('dock-tab-sandbox')).toBeNull();
  });
});
