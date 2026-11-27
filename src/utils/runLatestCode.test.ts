import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../types';

const loadCodeIntoWorkspace = vi.fn();
const syncVirtualProject = vi.fn();
const runCurrentServerProject = vi.fn(() => Promise.resolve());

vi.mock('../stores/useWorkspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({ loadCodeIntoWorkspace, syncVirtualProject, runCurrentServerProject }),
  },
}));

import { runLatestCodeFromMessages } from './runLatestCode';

const msg = (role: ChatMessage['role'], content: string, id = Math.random().toString()) =>
  ({ id, role, content, timestamp: Date.now() }) as ChatMessage;

describe('runLatestCodeFromMessages ("চালাও / run it" without a Run button)', () => {
  beforeEach(() => {
    loadCodeIntoWorkspace.mockClear();
    syncVirtualProject.mockClear();
    runCurrentServerProject.mockClear();
  });

  it('returns none when there is no code in the conversation', () => {
    expect(runLatestCodeFromMessages(undefined)).toBe('none');
    expect(runLatestCodeFromMessages([msg('assistant', 'Hello! How can I help?')])).toBe('none');
    expect(loadCodeIntoWorkspace).not.toHaveBeenCalled();
  });

  it('opens the latest HTML answer in Preview', () => {
    const html = '<div class="p-4">New</div>';
    const result = runLatestCodeFromMessages([
      msg('assistant', '```html\n<div>Old</div>\n```'),
      msg('user', '```html\n<p>user pasted</p>\n```'),
      msg('assistant', `Here you go:\n\n\`\`\`html\n${html}\n\`\`\``),
      msg('user', 'run it'),
    ]);
    expect(result).toBe('preview');
    expect(loadCodeIntoWorkspace).toHaveBeenCalledWith(html, 'html', 'preview');
  });

  it('runs the latest JS answer in the sandbox with auto-run', () => {
    const result = runLatestCodeFromMessages([
      msg('assistant', '```javascript\nconsole.log(42);\n```'),
    ]);
    expect(result).toBe('sandbox');
    expect(loadCodeIntoWorkspace).toHaveBeenCalledWith(
      'console.log(42);',
      'javascript',
      'sandbox',
      true
    );
  });

  it('syncs a multi-file project and starts server runtimes automatically', () => {
    const content = [
      '```python file="main.py"',
      'print("hello")',
      '```',
      '```text file="requirements.txt"',
      'flask',
      '```',
    ].join('\n');
    const result = runLatestCodeFromMessages([msg('assistant', content)]);
    expect(result).toBe('project');
    expect(syncVirtualProject).toHaveBeenCalledTimes(1);
    expect(syncVirtualProject.mock.calls[0][0]).toMatchObject({
      runtime: 'python',
      entryFile: 'main.py',
    });
    expect(runCurrentServerProject).toHaveBeenCalledTimes(1);
  });
});
