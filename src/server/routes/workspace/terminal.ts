import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isProtectedWorkspaceFile } from '../../../shared/serverSecurity';
import type { PlanTier } from '../../../types';

const execFileAsync = promisify(execFile);

/**
 * Workspace Terminal & Files — sandboxed shell + file reader + project runner + browser proxy
 *
 * WHY THIS FILE EXISTS
 *   Workspace Dock (terminal, file list/reader, project-run, browser proxy)
 *   was 550+ lines inside server.ts with 5 route handlers sharing the same
 *   sandbox policy (isProtectedWorkspaceFile) and MCP telemetry. Moving it
 *   keeps the monolith shrinking; the handlers are cohesive (all operate on
 *   the host workspace root via fs/path) and have no other consumer.
 *
 * CONTRACT WITH server.ts
 *   - `requireAuthMiddleware` stays in server.ts as `app.use('/api/workspace', ...)`
 *     before this registration, so all routes remain protected.
 *   - `mcpClusterServices`, `PORT`, `apiKey` are injected via ctx because they
 *     live inside the bootstrap closure and cannot be imported.
 *   - Registration order preserved — server.ts calls this exactly where the
 *     inline block sat.
 */

interface McpClusterService {
  id: string;
  name: string;
  displayName: string;
  category: string;
  port: number;
  status: string;
  latencyMs: number;
  cpuPercent: number;
  [k: string]: unknown;
}

export interface WorkspaceTerminalContext {
  mcpClusterServices: readonly McpClusterService[];
  PORT: number;
  apiKey: string;
}

export function registerWorkspaceTerminalRoutes(app: Express, ctx: WorkspaceTerminalContext): void {
  app.post('/api/workspace/terminal', async (req: Request, res: Response) => {
    const rawCommand = String(req.body?.command || '').trim();
    if (!rawCommand) {
      res.status(400).json({ error: 'Command cannot be empty.', exitCode: 1 });
      return;
    }

    const parts = rawCommand.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmd === 'help') {
      res.json({
        exitCode: 0,
        stdout: [
          'SupremeAI Studio Interactive Shell v2.4',
          'Available Commands:',
          '  ls [dir]         List files in workspace directory',
          '  pwd              Print current workspace root',
          '  cat <file>       Read file content inside workspace',
          '  git status       Check git repository working tree',
          '  git log          Show recent git commits',
          '  node -v          Check active Node.js runtime version',
          '  npm -v           Check npm package manager version',
          '  mcp status       Inspect live MCP cluster service telemetry',
          '  health           Query local SupremeAI Studio health endpoint',
          '  date / whoami    Show container runtime info',
          '  clear            Clear terminal output buffer',
        ].join('\n'),
      });
      return;
    }

    if (cmd === 'pwd') {
      res.json({ exitCode: 0, stdout: process.cwd() });
      return;
    }

    if (cmd === 'whoami') {
      res.json({ exitCode: 0, stdout: 'supremeai-agent (uid=1000, role=studio-orchestrator)' });
      return;
    }

    if (cmd === 'date') {
      res.json({ exitCode: 0, stdout: new Date().toUTCString() });
      return;
    }

    if (cmd === 'echo') {
      res.json({ exitCode: 0, stdout: args.join(' ') });
      return;
    }

    if (cmd === 'health') {
      res.json({
        exitCode: 0,
        stdout: JSON.stringify(
          {
            status: 'healthy',
            app: 'SupremeAI Studio',
            port: ctx.PORT,
            gatewayConfigured: Boolean(ctx.apiKey),
            uptimeSec: Math.round(process.uptime()),
            memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          },
          null,
          2,
        ),
      });
      return;
    }

    if (cmd === 'mcp') {
      const summary = ctx.mcpClusterServices
        .map(
          (s) =>
            `[${s.status.toUpperCase().padEnd(9)}] ${s.id.padEnd(24)} port:${s.port}  latency:${s.latencyMs}ms  cpu:${s.cpuPercent}%`,
        )
        .join('\n');
      res.json({ exitCode: 0, stdout: summary });
      return;
    }

    if (cmd === 'cat') {
      const targetRel = args[0];
      if (!targetRel) {
        res.json({ exitCode: 1, stderr: 'cat: missing file operand (e.g. cat package.json)' });
        return;
      }
      if (isProtectedWorkspaceFile(targetRel)) {
        res.json({
          exitCode: 1,
          stderr: 'Security guard: access to protected environment or credential files is denied.',
        });
        return;
      }
      const workspaceRealRoot = fs.realpathSync(process.cwd());
      const resolved = path.resolve(workspaceRealRoot, targetRel);
      if (resolved !== workspaceRealRoot && !resolved.startsWith(workspaceRealRoot + path.sep)) {
        res.json({ exitCode: 1, stderr: 'Security guard: access outside workspace root denied.' });
        return;
      }
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        res.json({ exitCode: 1, stderr: `cat: ${targetRel}: No such file` });
        return;
      }
      let realTarget: string;
      try {
        realTarget = fs.realpathSync(resolved);
      } catch {
        res.json({ exitCode: 1, stderr: `cat: ${targetRel}: Cannot resolve file` });
        return;
      }
      if (
        realTarget !== workspaceRealRoot &&
        !realTarget.startsWith(workspaceRealRoot + path.sep)
      ) {
        res.json({
          exitCode: 1,
          stderr: 'Security guard: symlink escape outside workspace denied.',
        });
        return;
      }
      const resolvedRel = path.relative(workspaceRealRoot, realTarget);
      if (isProtectedWorkspaceFile(resolvedRel)) {
        res.json({
          exitCode: 1,
          stderr: 'Security guard: access to protected environment or credential files is denied.',
        });
        return;
      }
      const content = fs.readFileSync(realTarget, 'utf-8');
      res.json({
        exitCode: 0,
        stdout: content.length > 6000 ? content.slice(0, 6000) + '\n... [truncated]' : content,
      });
      return;
    }

    // বাংলা মন্তব্য: আগের \\r\\n ডাবল-এস্কেপের কারণে ক্যারেক্টার ক্লাসে আক্ষরিক ব্যাকস্ল্যাশ, 'r' ও 'n'
    // অক্ষর ম্যাচ করছিল — ফলে node -v / npm -v / git branch-এর মতো বৈধ কমান্ড ভুলভাবে ব্লক হচ্ছিল,
    // আবার সত্যিকারের CR/LF ইনজেকশন প্রবেশ করতে পারছিল। এখন প্রকৃত ক্যারেজ-রিটার্ন/নিউলাইন ব্লক হয়।
    if (/[;&|`$<>\r\n]/.test(rawCommand)) {
      res.json({
        exitCode: 126,
        stderr: `Command "${rawCommand}" is blocked by workspace sandbox policy. Type "help" to view permitted commands.`,
      });
      return;
    }

    let execSpec: { bin: string; binArgs: string[] } | null = null;
    if (cmd === 'ls') {
      const workspaceRealRoot = fs.realpathSync(process.cwd());
      const safeLsArgs: string[] = [];
      for (const arg of args) {
        if (/^-[alhF1]+$/.test(arg)) {
          safeLsArgs.push(arg);
          continue;
        }
        if (arg.startsWith('-')) {
          res.json({ exitCode: 126, stderr: `Unsupported ls flag "${arg}".` });
          return;
        }
        const resolved = path.resolve(workspaceRealRoot, arg);
        if (resolved !== workspaceRealRoot && !resolved.startsWith(workspaceRealRoot + path.sep)) {
          res.json({
            exitCode: 1,
            stderr: 'Security guard: access outside workspace root denied.',
          });
          return;
        }
        if (fs.existsSync(resolved)) {
          const realDir = fs.realpathSync(resolved);
          if (realDir !== workspaceRealRoot && !realDir.startsWith(workspaceRealRoot + path.sep)) {
            res.json({
              exitCode: 1,
              stderr: 'Security guard: symlink escape outside workspace denied.',
            });
            return;
          }
        }
        safeLsArgs.push(arg);
      }
      execSpec = { bin: 'ls', binArgs: safeLsArgs };
    } else if (rawCommand === 'node -v' || rawCommand === 'node --version') {
      execSpec = { bin: process.execPath, binArgs: ['-v'] };
    } else if (rawCommand === 'npm -v' || rawCommand === 'npm --version') {
      execSpec = { bin: 'npm', binArgs: ['-v'] };
    } else if (rawCommand === 'git status' || rawCommand === 'git status -s') {
      execSpec = {
        bin: 'git',
        binArgs: rawCommand === 'git status -s' ? ['status', '-s'] : ['status'],
      };
    } else if (rawCommand === 'git branch') {
      execSpec = { bin: 'git', binArgs: ['branch'] };
    } else if (rawCommand === 'git log' || /^git log -n [1-9]\d{0,1}$/.test(rawCommand)) {
      const n = rawCommand === 'git log' ? '10' : rawCommand.split(' ').pop() || '10';
      execSpec = { bin: 'git', binArgs: ['log', '--oneline', '-n', n] };
    } else if (rawCommand === 'git diff --stat') {
      execSpec = { bin: 'git', binArgs: ['diff', '--stat'] };
    } else if (rawCommand === 'tsc --version') {
      execSpec = { bin: 'npx', binArgs: ['tsc', '--version'] };
    }

    if (!execSpec) {
      res.json({
        exitCode: 126,
        stderr: `Command "${rawCommand}" is blocked by workspace sandbox policy. Type "help" to view permitted commands.`,
      });
      return;
    }

    try {
      const { stdout, stderr } = await execFileAsync(execSpec.bin, execSpec.binArgs, {
        cwd: process.cwd(),
        timeout: 5000,
        maxBuffer: 512 * 1024,
      });
      res.json({
        exitCode: 0,
        stdout: stdout || stderr || '(no output)',
      });
    } catch (execErr: unknown) {
      const msg = execErr instanceof Error ? execErr.message : 'Command execution failed';
      res.json({ exitCode: 1, stderr: msg });
    }
  });

  app.get('/api/workspace/files', (_req: Request, res: Response) => {
    const allowedExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.md']);
    const ignoreDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      '.next',
      'coverage',
      '.aistudio',
      '.studio-data',
    ]);
    const collected: string[] = [];

    const walk = (dir: string, depth: number) => {
      if (depth > 3 || collected.length >= 120) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (collected.length >= 120) break;
        if (entry.name.startsWith('.env')) continue;
        const candidateRel = path.relative(process.cwd(), path.join(dir, entry.name));
        if (isProtectedWorkspaceFile(candidateRel)) continue;
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            walk(path.join(dir, entry.name), depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (allowedExt.has(ext)) {
            collected.push(candidateRel);
          }
        }
      }
    };

    walk(process.cwd(), 0);
    collected.sort();
    res.json({ files: collected });
  });

  app.get('/api/workspace/file', (req: Request, res: Response) => {
    const relPath = String(req.query.path || '').trim();
    if (!relPath) {
      res.status(400).json({ error: 'File path parameter is required.' });
      return;
    }
    if (isProtectedWorkspaceFile(relPath)) {
      res
        .status(403)
        .json({ error: 'Access to protected environment or credential files is blocked.' });
      return;
    }
    const workspaceRealRoot = fs.realpathSync(process.cwd());
    const resolved = path.resolve(workspaceRealRoot, relPath);
    if (resolved !== workspaceRealRoot && !resolved.startsWith(workspaceRealRoot + path.sep)) {
      res.status(403).json({ error: 'Security guard: path outside workspace root denied.' });
      return;
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.status(404).json({ error: `File not found: ${relPath}` });
      return;
    }
    let realTarget: string;
    try {
      realTarget = fs.realpathSync(resolved);
    } catch {
      res.status(404).json({ error: `File not found: ${relPath}` });
      return;
    }
    if (realTarget !== workspaceRealRoot && !realTarget.startsWith(workspaceRealRoot + path.sep)) {
      res.status(403).json({ error: 'Security guard: symlink escape outside workspace denied.' });
      return;
    }
    if (isProtectedWorkspaceFile(path.relative(workspaceRealRoot, realTarget))) {
      res
        .status(403)
        .json({ error: 'Access to protected environment or credential files is blocked.' });
      return;
    }
    const content = fs.readFileSync(realTarget, 'utf-8');
    const ext = path.extname(realTarget).replace(/^\./, '').toLowerCase() || 'text';
    res.json({
      path: relPath,
      lang: ext,
      content:
        content.length > 60000 ? content.slice(0, 60000) + '\n// [Truncated at 60KB]' : content,
    });
  });

  app.post('/api/workspace/project-run', async (req: Request, res: Response) => {
    const callerIdentity = (req as unknown as { authIdentity?: { email: string; isAdmin: boolean; tier: PlanTier } }).authIdentity;
    if (process.env.ALLOW_UNSANDBOXED_PROJECT_RUN !== 'true' || !callerIdentity?.isAdmin) {
      res.status(403).json({
        error:
          'Host project code execution is disabled in this environment for security isolation. Run code in the client-side browser preview or enable an isolated sandbox runner.',
      });
      return;
    }
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      runtime?: string;
      entryFile?: string;
      files?: Array<{ path?: string; content?: string }>;
    };
    const runtime = body.runtime === 'python' ? 'python' : body.runtime === 'node' ? 'node' : null;
    if (!runtime) {
      res.status(400).json({ error: 'Supported runtime must be "python" or "node".' });
      return;
    }

    const inputFiles = Array.isArray(body.files) ? body.files.slice(0, 30) : [];
    if (inputFiles.length === 0) {
      res.status(400).json({ error: 'Project files array must not be empty.' });
      return;
    }

    let tmpDir = '';
    const startedAt = Date.now();
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supremeai-run-'));
      const writtenPaths: string[] = [];
      let totalBytes = 0;

      for (const item of inputFiles) {
        const rawRel = String(item?.path || '')
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        if (!rawRel || rawRel.includes('..') || path.isAbsolute(rawRel)) continue;
        const content = typeof item?.content === 'string' ? item.content : '';
        totalBytes += Buffer.byteLength(content, 'utf-8');
        if (totalBytes > 512 * 1024) {
          res.status(413).json({ error: 'Project payload exceeds 512KB sandbox execution limit.' });
          return;
        }
        const dest = path.resolve(tmpDir, rawRel);
        if (dest !== tmpDir && !dest.startsWith(tmpDir + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, 'utf-8');
        writtenPaths.push(rawRel);
      }

      const preferredEntry = String(body.entryFile || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      const entryFile =
        writtenPaths.find((p) => p === preferredEntry) ||
        writtenPaths.find((p) =>
          runtime === 'python' ? /\.py$/i.test(p) : /\.(?:m?js|cjs)$/i.test(p),
        ) ||
        writtenPaths[0];

      if (!entryFile) {
        res.status(400).json({ error: 'No valid runnable entry file found in project.' });
        return;
      }

      const bin = runtime === 'python' ? 'python3' : process.execPath;
      const execResult = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        execFile(
          bin,
          [entryFile],
          {
            cwd: tmpDir,
            timeout: 5000,
            maxBuffer: 262144,
            env: {
              PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
              LANG: 'en_US.UTF-8',
              PYTHONDONTWRITEBYTECODE: '1',
            },
          },
          (error, stdout, stderr) => {
            if (error) {
              const code =
                typeof (error as { code?: unknown }).code === 'number'
                  ? (error as { code: number }).code
                  : (error as { killed?: boolean }).killed
                    ? 124
                    : 1;
              resolve({
                exitCode: code,
                stdout: String(stdout || ''),
                stderr: String(stderr || error.message || 'Execution error'),
              });
              return;
            }
            resolve({
              exitCode: 0,
              stdout: String(stdout || ''),
              stderr: String(stderr || ''),
            });
          },
        );
      });

      res.json({
        ok: execResult.exitCode === 0,
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        runtime,
        entryFile,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Project sandbox runner failed.';
      res.status(500).json({
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: msg,
        runtime,
        entryFile: body.entryFile || '',
        durationMs: Date.now() - startedAt,
        error: msg,
      });
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      }
    }
  });
}
