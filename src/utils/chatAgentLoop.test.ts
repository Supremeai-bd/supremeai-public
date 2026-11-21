import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAutoRepairPrompt,
  runSandboxVerificationStep,
  shouldVerifyProjectInAgentLoop,
} from './chatAgentLoop';
import type { ExtractedVirtualProject } from './artifactStreamParser';

const samplePythonProject: ExtractedVirtualProject = {
  title: 'Sample Script',
  runtime: 'python',
  entryFile: 'main.py',
  isStreaming: false,
  files: [{ path: 'main.py', lang: 'python', content: 'print("ok")', isEntry: true }],
};

describe('chatAgentLoop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only enables sandbox verification for python/node projects when agent loop is on', () => {
    expect(shouldVerifyProjectInAgentLoop(samplePythonProject, true)).toBe(true);
    expect(shouldVerifyProjectInAgentLoop(samplePythonProject, false)).toBe(false);
    expect(
      shouldVerifyProjectInAgentLoop(
        {
          title: 'Web App',
          runtime: 'web',
          entryFile: 'index.html',
          isStreaming: false,
          files: [{ path: 'index.html', lang: 'html', content: '<h1/>', isEntry: true }],
        },
        true
      )
    ).toBe(false);
  });

  it('reports verified step on exit code 0 and triggers needsRepair on runtime error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ exitCode: 0, stdout: 'ok', stderr: '', durationMs: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const okOutcome = await runSandboxVerificationStep(samplePythonProject);
    expect(okOutcome.verified).toBe(true);
    expect(okOutcome.needsRepair).toBe(false);
    expect(okOutcome.step.status).toBe('done');
    expect(okOutcome.durationMs).toBe(42);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          exitCode: 1,
          stdout: '',
          stderr: 'ZeroDivisionError: division by zero',
          durationMs: 31,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const errOutcome = await runSandboxVerificationStep(samplePythonProject);
    expect(errOutcome.verified).toBe(false);
    expect(errOutcome.needsRepair).toBe(true);
    expect(errOutcome.step.status).toBe('error');
    expect(errOutcome.stderr).toContain('ZeroDivisionError');
  });

  it('gracefully skips subprocess verification on Cloudflare Edge (supported: false)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ supported: false, exitCode: null, runtimeEnv: 'cloudflare-pages-edge' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const outcome = await runSandboxVerificationStep(samplePythonProject);
    expect(outcome.supported).toBe(false);
    expect(outcome.needsRepair).toBe(false);
    expect(outcome.step.status).toBe('done');
  });

  it('builds actionable repair prompt containing stderr and source files', () => {
    const prompt = buildAutoRepairPrompt(
      'Compute averages',
      samplePythonProject,
      'NameError: name x is not defined',
      ''
    );
    expect(prompt).toContain('NameError: name x is not defined');
    expect(prompt).toContain('file="main.py"');
  });

  it('forwards stored access token headers and runs JS syntax fallback when host runner returns 403', async () => {
    localStorage.setItem('supremeai_access_token', 'tok_user_test_123');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Restricted' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const brokenNodeProject: ExtractedVirtualProject = {
      title: 'Broken Node',
      runtime: 'node',
      entryFile: 'index.js',
      isStreaming: false,
      files: [{ path: 'index.js', lang: 'javascript', content: 'function broken( {' , isEntry: true }],
    };

    const outcome = await runSandboxVerificationStep(brokenNodeProject);
    const callInit = fetchSpy.mock.calls[0]?.[1];
    const headers = callInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_user_test_123');
    expect(headers['X-SupremeAI-Key']).toBe('tok_user_test_123');
    expect(outcome.needsRepair).toBe(true);
    expect(outcome.stderr).toContain('SyntaxError:');

    localStorage.removeItem('supremeai_access_token');
  });
});
