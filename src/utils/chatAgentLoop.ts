import { AgentExecutionStep } from '../types';
import { ExtractedVirtualProject } from './artifactStreamParser';
import { getWorkspaceAuthHeaders } from './workspaceAuth';

export interface SandboxVerificationOutcome {
  verified: boolean;
  needsRepair: boolean;
  supported: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  step: AgentExecutionStep;
}

export function shouldVerifyProjectInAgentLoop(
  project: ExtractedVirtualProject | null | undefined,
  agentLoopEnabled: boolean
): boolean {
  if (!agentLoopEnabled || !project || project.files.length === 0) return false;
  return project.runtime === 'python' || project.runtime === 'node';
}

function checkNodeSyntaxFallback(project: ExtractedVirtualProject): {
  checked: boolean;
  syntaxError: string | null;
} {
  if (project.runtime !== 'node') return { checked: false, syntaxError: null };
  const entry =
    project.files.find((f) => f.path === project.entryFile) ||
    project.files.find((f) => /\.(?:js|cjs|mjs)$/i.test(f.path));
  if (!entry || !/\.(?:js|cjs)$/i.test(entry.path)) {
    return { checked: false, syntaxError: null };
  }
  // Skip ES module syntax that `new Function` cannot parse natively without transform
  if (/^\s*(?:import|export)\s/m.test(entry.content)) {
    return { checked: false, syntaxError: null };
  }
  try {
    // Parse syntax without executing code on the main thread
    new Function(entry.content);
    return { checked: true, syntaxError: null };
  } catch (err: unknown) {
    return {
      checked: true,
      syntaxError: err instanceof Error ? err.message : 'JavaScript syntax error',
    };
  }
}

export async function runSandboxVerificationStep(
  project: ExtractedVirtualProject
): Promise<SandboxVerificationOutcome> {
  const startedAt = Date.now();
  try {
    const res = await fetch('/api/workspace/project-run', {
      method: 'POST',
      headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
      signal: AbortSignal.timeout(7500),
      body: JSON.stringify({
        runtime: project.runtime,
        entryFile: project.entryFile,
        files: project.files.map((f) => ({ path: f.path, content: f.content })),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      supported?: boolean;
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
      durationMs?: number;
      error?: string;
    };

    const durationMs =
      typeof data.durationMs === 'number' ? data.durationMs : Date.now() - startedAt;

    if (data.supported === false || res.status === 403) {
      const jsFallback = checkNodeSyntaxFallback(project);
      if (jsFallback.checked && jsFallback.syntaxError) {
        return {
          verified: false,
          needsRepair: true,
          supported: true,
          exitCode: 1,
          stdout: '',
          stderr: `SyntaxError: ${jsFallback.syntaxError}`,
          durationMs,
          step: {
            id: `step_verify_${Date.now()}`,
            label: `Syntax error in ${project.entryFile} (client check)`,
            tool: 'sandbox_verify',
            status: 'error',
            detail: jsFallback.syntaxError.slice(0, 140),
            durationMs,
          },
        };
      }

      return {
        verified: jsFallback.checked,
        needsRepair: false,
        supported: false,
        exitCode: null,
        stdout: data.stdout || '',
        stderr: data.stderr || data.error || '',
        durationMs,
        step: {
          id: `step_verify_${Date.now()}`,
          label: jsFallback.checked
            ? `Syntax verified ${project.entryFile} (Edge check)`
            : res.status === 403
              ? `Host sandbox restricted (${project.runtime})`
              : `Sandbox check skipped on Edge (${project.runtime})`,
          tool: 'sandbox_verify',
          status: 'done',
          detail: jsFallback.checked
            ? 'Client JS parser passed'
            : res.status === 403
              ? 'Server subprocess requires admin + isolated runner'
              : 'Run locally with Node server for subprocess verification',
          durationMs,
        },
      };
    }

    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : res.ok ? 0 : 1;
    const stdout = String(data.stdout || '').trim();
    const stderr = String(data.stderr || data.error || '').trim();

    if (res.ok && exitCode === 0) {
      return {
        verified: true,
        needsRepair: false,
        supported: true,
        exitCode: 0,
        stdout,
        stderr,
        durationMs,
        step: {
          id: `step_verify_${Date.now()}`,
          label: `Verified ${project.entryFile} (${project.runtime})`,
          tool: 'sandbox_verify',
          status: 'done',
          detail: stdout ? stdout.split('\n')[0].slice(0, 120) : 'Exit code 0',
          durationMs,
        },
      };
    }

    return {
      verified: false,
      needsRepair: true,
      supported: true,
      exitCode,
      stdout,
      stderr: stderr || `Process exited with code ${exitCode}`,
      durationMs,
      step: {
        id: `step_verify_${Date.now()}`,
        label: `Runtime error in ${project.entryFile} (exit ${exitCode})`,
        tool: 'sandbox_verify',
        status: 'error',
        detail: (stderr || `exit ${exitCode}`).split('\n')[0].slice(0, 140),
        durationMs,
      },
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : 'Sandbox verification unreachable';
    return {
      verified: false,
      needsRepair: false,
      supported: false,
      exitCode: null,
      stdout: '',
      stderr: msg,
      durationMs,
      step: {
        id: `step_verify_${Date.now()}`,
        label: `Sandbox check unavailable`,
        tool: 'sandbox_verify',
        status: 'done',
        detail: msg.slice(0, 120),
        durationMs,
      },
    };
  }
}

export function buildAutoRepairPrompt(
  originalRequest: string,
  project: ExtractedVirtualProject,
  stderr: string,
  stdout: string
): string {
  const filesSummary = project.files
    .slice(0, 5)
    .map((f) => `\`\`\`${f.lang} file="${f.path}"\n${f.content.slice(0, 2200)}\n\`\`\``)
    .join('\n\n');

  return [
    `[AUTONOMOUS SANDBOX VERIFICATION FAILURE — REPAIR REQUIRED]`,
    `Original user goal: ${originalRequest.slice(0, 400)}`,
    `Runtime: ${project.runtime} · Entry: ${project.entryFile}`,
    `Stderr / Error Output:\n\`\`\`\n${stderr.slice(0, 1600)}\n\`\`\``,
    stdout ? `Stdout:\n\`\`\`\n${stdout.slice(0, 600)}\n\`\`\`` : '',
    `Current project files:\n${filesSummary}`,
    `Fix the bug and output the complete corrected runnable file block(s) with file="path" attributes.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
