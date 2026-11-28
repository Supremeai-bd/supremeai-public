// বাংলা মন্তব্য: শেষ ১০টি GitHub Actions ডিপ্লয়মেন্টের রিয়েল-টাইম সময়কাল ও সাফল্যের প্রবণতা হিসাবের হেল্পার।

export interface GitHubWorkflowRun {
  id: number | string;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  run_started_at?: string | null;
  updated_at?: string | null;
  head_branch: string;
  head_sha?: string | null;
  run_number?: number | null;
  event?: string | null;
}

/** GitHub returns `head`/`base` as objects; the gateway returns plain strings. */
export type GitHubBranchRef = string | { ref?: string; label?: string } | null | undefined;

export interface GitHubPullRequest {
  number: number;
  title: string;
  head?: GitHubBranchRef;
  base?: GitHubBranchRef;
  html_url: string;
  user: string | { login?: string };
}

export type RunOutcome = 'active' | 'success' | 'failure' | 'cancelled' | 'neutral';

export type PipelineHealthStatus = 'active' | 'healthy' | 'degraded' | 'failing' | 'empty' | 'unknown';

export type SuccessTrendDirection = 'improving' | 'declining' | 'stable' | 'insufficient';

export interface DeploymentTimelinePoint {
  id: number | string;
  name: string;
  branch: string;
  headSha: string | null;
  shortSha: string | null;
  commitUrl: string | null;
  runNumber: number | null;
  status: string;
  conclusion: string | null;
  outcome: RunOutcome;
  isActive: boolean;
  durationMs: number | null;
  durationLabel: string;
  createdAt: string;
  rollingSuccessRate: number | null;
}

export interface DeploymentTrendsSummary {
  totalRuns: number;
  activeCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  finishedCount: number;
  successRatePercent: number | null;
  successRateDelta: number | null;
  trendDirection: SuccessTrendDirection;
  avgDurationMs: number | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  latestDurationMs: number | null;
  activeLeadRun: {
    id: number | string;
    name: string;
    branch: string;
    status: string;
    durationMs: number | null;
    durationLabel: string;
  } | null;
  overallHealth: PipelineHealthStatus;
  timeline: DeploymentTimelinePoint[];
}

export type DurationAlertSeverity = 'nominal' | 'warning' | 'critical';

export interface DurationThresholdAlert {
  exceeded: boolean;
  severity: DurationAlertSeverity;
  avgDurationMs: number | null;
  thresholdMs: number;
  overageMs: number;
  overagePercent: number;
}

export const DEFAULT_DURATION_THRESHOLD_MS = 180_000; // 3m 00s

export const DURATION_THRESHOLD_PRESETS_MS = [
  60_000,
  120_000,
  180_000,
  300_000,
  600_000,
] as const;

export function evaluateDurationAlert(
  avgDurationMs: number | null,
  thresholdMs: number = DEFAULT_DURATION_THRESHOLD_MS
): DurationThresholdAlert {
  const safeThreshold =
    Number.isFinite(thresholdMs) && thresholdMs > 0
      ? thresholdMs
      : DEFAULT_DURATION_THRESHOLD_MS;

  if (typeof avgDurationMs !== 'number' || !Number.isFinite(avgDurationMs) || avgDurationMs < 0) {
    return {
      exceeded: false,
      severity: 'nominal',
      avgDurationMs: null,
      thresholdMs: safeThreshold,
      overageMs: 0,
      overagePercent: 0,
    };
  }

  const overageMs = Math.max(0, avgDurationMs - safeThreshold);
  const exceeded = avgDurationMs > safeThreshold;
  const overagePercent = exceeded
    ? Math.max(1, Math.round((overageMs / safeThreshold) * 100))
    : 0;
  const severity: DurationAlertSeverity = !exceeded
    ? 'nominal'
    : avgDurationMs >= safeThreshold * 1.5
      ? 'critical'
      : 'warning';

  return {
    exceeded,
    severity,
    avgDurationMs,
    thresholdMs: safeThreshold,
    overageMs,
    overagePercent,
  };
}

const ACTIVE_STATUSES = new Set([
  'in_progress',
  'queued',
  'waiting',
  'pending',
  'requested',
]);

const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'startup_failure',
  'action_required',
  'stale',
]);

export function isRunActive(run: Pick<GitHubWorkflowRun, 'status'>): boolean {
  return ACTIVE_STATUSES.has(String(run.status || '').toLowerCase());
}

export function classifyRunOutcome(
  run: Pick<GitHubWorkflowRun, 'status' | 'conclusion'>
): RunOutcome {
  if (isRunActive(run)) return 'active';
  const conclusion = String(run.conclusion || '').toLowerCase();
  if (conclusion === 'success') return 'success';
  if (FAILURE_CONCLUSIONS.has(conclusion)) return 'failure';
  if (conclusion === 'cancelled') return 'cancelled';
  return 'neutral';
}

export function computeRunDurationMs(
  run: Pick<GitHubWorkflowRun, 'status' | 'created_at' | 'run_started_at' | 'updated_at'>,
  nowMs: number = Date.now()
): number | null {
  const startRaw = run.run_started_at || run.created_at;
  if (!startRaw) return null;
  const startMs = Date.parse(startRaw);
  if (!Number.isFinite(startMs)) return null;

  if (isRunActive(run)) {
    return Math.max(0, nowMs - startMs);
  }

  const endRaw = run.updated_at || run.created_at;
  if (!endRaw) return null;
  const endMs = Date.parse(endRaw);
  if (!Number.isFinite(endMs)) return null;

  return Math.max(0, endMs - startMs);
}

export function formatPipelineDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${String(remMinutes).padStart(2, '0')}m`;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function formatShortCommitSha(sha?: string | null): string | null {
  if (typeof sha !== 'string') return null;
  const trimmed = sha.trim();
  if (!COMMIT_SHA_PATTERN.test(trimmed)) return null;
  return trimmed.slice(0, 7).toLowerCase();
}

export function buildGitHubCommitUrl(
  repo: string,
  sha?: string | null,
  runHtmlUrl?: string | null
): string | null {
  if (typeof sha !== 'string') return null;
  const cleanSha = sha.trim();
  if (!COMMIT_SHA_PATTERN.test(cleanSha)) return null;

  const trimmedRepo = typeof repo === 'string' ? repo.trim() : '';
  if (REPO_SLUG_PATTERN.test(trimmedRepo)) {
    return `https://github.com/${trimmedRepo}/commit/${cleanSha}`;
  }

  if (typeof runHtmlUrl === 'string' && runHtmlUrl.trim()) {
    const match = runHtmlUrl.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\//i);
    if (match?.[1] && REPO_SLUG_PATTERN.test(match[1])) {
      return `https://github.com/${match[1]}/commit/${cleanSha}`;
    }
  }

  return null;
}

/**
 * বাংলা মন্তব্য: শেষ ১০টি ডিপ্লয়মেন্ট/ওয়ার্কফ্লো রান থেকে রিয়েল-টাইম ডিউরেশন,
 * সাফল্যের হার এবং সময়ের সাথে প্রবণতা (oldest -> newest) হিসাব করে।
 */
export function computeDeploymentTrends(
  runs: GitHubWorkflowRun[],
  nowMs: number = Date.now(),
  repo: string = ''
): DeploymentTrendsSummary {
  const recentTen = runs.slice(0, 10);

  if (recentTen.length === 0) {
    return {
      totalRuns: 0,
      activeCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      finishedCount: 0,
      successRatePercent: null,
      successRateDelta: null,
      trendDirection: 'insufficient',
      avgDurationMs: null,
      minDurationMs: null,
      maxDurationMs: null,
      latestDurationMs: null,
      activeLeadRun: null,
      overallHealth: 'empty',
      timeline: [],
    };
  }

  let activeCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  const durations: number[] = [];
  let activeLeadRun: DeploymentTrendsSummary['activeLeadRun'] = null;

  for (const run of recentTen) {
    const outcome = classifyRunOutcome(run);
    const durationMs = computeRunDurationMs(run, nowMs);
    if (durationMs !== null) {
      durations.push(durationMs);
    }

    if (outcome === 'active') {
      activeCount += 1;
      if (!activeLeadRun) {
        activeLeadRun = {
          id: run.id,
          name: run.name,
          branch: run.head_branch,
          status: run.status,
          durationMs,
          durationLabel: formatPipelineDuration(durationMs),
        };
      }
    } else if (outcome === 'success') {
      succeededCount += 1;
    } else if (outcome === 'failure') {
      failedCount += 1;
    } else if (outcome === 'cancelled') {
      cancelledCount += 1;
    }
  }

  // বাংলা মন্তব্য: শুধুমাত্র সমাপ্ত (skipped/neutral বাদে) রানগুলো সাফল্যের হারের ডিনমিনেটরে ধরা হয়।
  const finishedCount = succeededCount + failedCount + cancelledCount;
  const successRatePercent =
    finishedCount > 0 ? Math.round((succeededCount / finishedCount) * 100) : null;

  // বাংলা মন্তব্য: পুরোনো অর্ধেক বনাম নতুন অর্ধেক তুলনা করে প্রবণতা (trend delta) নির্ণয়।
  const chronological = [...recentTen].reverse();
  const chronologicalFinished = chronological.filter((r) => {
    const o = classifyRunOutcome(r);
    return o === 'success' || o === 'failure' || o === 'cancelled';
  });

  let successRateDelta: number | null = null;
  let trendDirection: SuccessTrendDirection = 'insufficient';

  if (chronologicalFinished.length >= 4) {
    const midpoint = Math.floor(chronologicalFinished.length / 2);
    const olderHalf = chronologicalFinished.slice(0, midpoint);
    const newerHalf = chronologicalFinished.slice(midpoint);
    const olderRate =
      (olderHalf.filter((r) => classifyRunOutcome(r) === 'success').length / olderHalf.length) *
      100;
    const newerRate =
      (newerHalf.filter((r) => classifyRunOutcome(r) === 'success').length / newerHalf.length) *
      100;
    const delta = Math.round(newerRate - olderRate);
    successRateDelta = delta;
    if (delta >= 5) {
      trendDirection = 'improving';
    } else if (delta <= -5) {
      trendDirection = 'declining';
    } else {
      trendDirection = 'stable';
    }
  }

  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null;
  const minDurationMs = durations.length > 0 ? Math.min(...durations) : null;
  const maxDurationMs = durations.length > 0 ? Math.max(...durations) : null;
  const latestDurationMs = durations.length > 0 ? durations[0] : null;

  let overallHealth: PipelineHealthStatus = 'unknown';
  if (activeCount > 0) {
    overallHealth = 'active';
  } else if (successRatePercent !== null) {
    if (successRatePercent >= 80) overallHealth = 'healthy';
    else if (successRatePercent >= 50) overallHealth = 'degraded';
    else overallHealth = 'failing';
  }

  // বাংলা মন্তব্য: চার্টে বাম থেকে ডানে (পুরোনো থেকে নতুন) রোলিং সাফল্যের হার দেখানোর জন্য।
  let cumFinished = 0;
  let cumSuccess = 0;
  const timeline: DeploymentTimelinePoint[] = chronological.map((run) => {
    const outcome = classifyRunOutcome(run);
    const isActive = outcome === 'active';
    const durationMs = computeRunDurationMs(run, nowMs);
    if (outcome === 'success') {
      cumFinished += 1;
      cumSuccess += 1;
    } else if (outcome === 'failure' || outcome === 'cancelled') {
      cumFinished += 1;
    }
    const headSha =
      typeof run.head_sha === 'string' && COMMIT_SHA_PATTERN.test(run.head_sha.trim())
        ? run.head_sha.trim()
        : null;
    return {
      id: run.id,
      name: run.name,
      branch: run.head_branch,
      headSha,
      shortSha: formatShortCommitSha(headSha),
      commitUrl: buildGitHubCommitUrl(repo, headSha, run.html_url),
      runNumber: run.run_number ?? null,
      status: run.status,
      conclusion: run.conclusion,
      outcome,
      isActive,
      durationMs,
      durationLabel: formatPipelineDuration(durationMs),
      createdAt: run.created_at,
      rollingSuccessRate: cumFinished > 0 ? Math.round((cumSuccess / cumFinished) * 100) : null,
    };
  });

  return {
    totalRuns: recentTen.length,
    activeCount,
    succeededCount,
    failedCount,
    cancelledCount,
    finishedCount,
    successRatePercent,
    successRateDelta,
    trendDirection,
    avgDurationMs,
    minDurationMs,
    maxDurationMs,
    latestDurationMs,
    activeLeadRun,
    overallHealth,
    timeline,
  };
}

// বাংলা মন্তব্য: ব্যর্থ GitHub Actions জব লগ থেকে ANSI কোড ও বাড়তি টাইমস্ট্যাম্প বাদ দিয়ে মূল stderr/error স্নিপেট বের করে।
export interface GitHubFailedStepSummary {
  name: string;
  number: number;
  conclusion: string | null;
}

export interface GitHubFailedJobSummary {
  id: number;
  name: string;
  conclusion: string | null;
  html_url: string | null;
  failedSteps: GitHubFailedStepSummary[];
}

export interface GitHubRunAnnotation {
  path: string;
  startLine: number;
  annotationLevel: string;
  title: string | null;
  message: string;
}

export interface GitHubRunErrorLogsResponse {
  runId: string;
  repo: string;
  available: boolean;
  reason?: string;
  failedJobs: GitHubFailedJobSummary[];
  annotations: GitHubRunAnnotation[];
  stderrSnippet: string;
  truncated: boolean;
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;
const GH_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;
const CI_ERROR_LINE_RE =
  /(##\[error\]|\bstderr\b|\berror\b[:\s!]|\bERR!|\bfatal:|\bFAIL\b|\bAssertionError\b|\bTypeError\b|\bSyntaxError\b|\bReferenceError\b|\bException\b|Process completed with exit code (?:[1-9]\d*)|Command failed|exit code [1-9]\d*)/i;

export function extractCiErrorSnippet(
  rawLog: string,
  maxLines: number = 40,
  maxChars: number = 5000
): { snippet: string; truncated: boolean } {
  const normalized = String(rawLog || '')
    .replace(ANSI_ESCAPE_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const cleanedLines = normalized
    .split('\n')
    .map((line) => line.replace(GH_TIMESTAMP_RE, '').trimEnd())
    .filter((line) => line.trim().length > 0);

  if (cleanedLines.length === 0) {
    return { snippet: '', truncated: false };
  }

  let selectedLines: string[];
  let truncated = cleanedLines.length > maxLines;

  const errorIndices: number[] = [];
  for (let i = 0; i < cleanedLines.length; i += 1) {
    if (CI_ERROR_LINE_RE.test(cleanedLines[i])) {
      errorIndices.push(i);
    }
  }

  if (errorIndices.length > 0) {
    // বাংলা মন্তব্য: শেষের প্রধান ত্রুটির আশেপাশের লাইন ও আগে পাওয়া গুরুত্বপূর্ণ ##[error] লাইনগুলো একত্র করে দেখানো হয়।
    const focusIdx = errorIndices[errorIndices.length - 1];
    const windowStart = Math.max(0, focusIdx - Math.max(8, maxLines - 15));
    const windowEnd = Math.min(cleanedLines.length, focusIdx + 12);
    const windowLines = cleanedLines.slice(windowStart, windowEnd);

    const priorErrors = errorIndices
      .filter((idx) => idx < windowStart && cleanedLines[idx].includes('##[error]'))
      .slice(-4)
      .map((idx) => cleanedLines[idx]);

    const combined = priorErrors.length > 0 ? [...priorErrors, '...', ...windowLines] : windowLines;
    selectedLines = combined.slice(-maxLines);
    truncated = truncated || windowStart > 0 || windowEnd < cleanedLines.length;
  } else {
    selectedLines = cleanedLines.slice(-maxLines);
  }

  let snippet = selectedLines.join('\n');
  if (snippet.length > maxChars) {
    snippet = snippet.slice(-maxChars);
    truncated = true;
  }

  return { snippet, truncated };
}

