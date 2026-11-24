import { describe, expect, it } from 'vitest';
import {
  buildGitHubCommitUrl,
  classifyRunOutcome,
  computeDeploymentTrends,
  computeRunDurationMs,
  evaluateDurationAlert,
  extractCiErrorSnippet,
  formatPipelineDuration,
  formatShortCommitSha,
  isRunActive,
  type GitHubWorkflowRun,
} from './githubPipelineMetrics';

const makeRun = (overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun => ({
  id: 100,
  name: 'Unified CI Pipeline',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/100',
  created_at: '2026-11-24T10:00:00Z',
  run_started_at: '2026-11-24T10:00:00Z',
  updated_at: '2026-11-24T10:02:00Z',
  head_branch: 'main',
  run_number: 100,
  ...overrides,
});

describe('githubPipelineMetrics', () => {
  it('computes completed and real-time active run durations accurately', () => {
    const completed = makeRun({
      run_started_at: '2026-11-24T10:00:00Z',
      updated_at: '2026-11-24T10:02:15Z',
    });
    expect(computeRunDurationMs(completed)).toBe(135_000);
    expect(formatPipelineDuration(135_000)).toBe('2m 15s');

    const active = makeRun({
      status: 'in_progress',
      conclusion: null,
      run_started_at: '2026-11-24T10:00:00Z',
      updated_at: '2026-11-24T10:00:05Z',
    });
    const nowMs = Date.parse('2026-11-24T10:00:42Z');
    expect(isRunActive(active)).toBe(true);
    expect(computeRunDurationMs(active, nowMs)).toBe(42_000);
    expect(formatPipelineDuration(42_000)).toBe('42s');
    expect(formatPipelineDuration(3_720_000)).toBe('1h 02m');
    expect(formatPipelineDuration(null)).toBe('—');
  });

  it('classifies run outcomes across active, success, failure, and cancelled states', () => {
    expect(classifyRunOutcome(makeRun({ status: 'queued', conclusion: null }))).toBe('active');
    expect(classifyRunOutcome(makeRun({ conclusion: 'success' }))).toBe('success');
    expect(classifyRunOutcome(makeRun({ conclusion: 'failure' }))).toBe('failure');
    expect(classifyRunOutcome(makeRun({ conclusion: 'timed_out' }))).toBe('failure');
    expect(classifyRunOutcome(makeRun({ conclusion: 'cancelled' }))).toBe('cancelled');
    expect(classifyRunOutcome(makeRun({ conclusion: 'skipped' }))).toBe('neutral');
  });

  it('computes success rate trends and rolling points across up to 10 deployments', () => {
    // 12 runs supplied (newest first): only latest 10 should be analyzed.
    // Older 5 of those 10 failed, newer 5 succeeded => improving (+100%).
    const newestFive = Array.from({ length: 5 }, (_, idx) =>
      makeRun({
        id: 20 - idx,
        run_number: 20 - idx,
        conclusion: 'success',
        run_started_at: '2026-11-24T10:00:00Z',
        updated_at: '2026-11-24T10:01:00Z',
      })
    );
    const olderFive = Array.from({ length: 5 }, (_, idx) =>
      makeRun({
        id: 15 - idx,
        run_number: 15 - idx,
        conclusion: 'failure',
        run_started_at: '2026-11-24T09:00:00Z',
        updated_at: '2026-11-24T09:03:00Z',
      })
    );
    const ignoredOldestTwo = [
      makeRun({ id: 2, conclusion: 'failure' }),
      makeRun({ id: 1, conclusion: 'failure' }),
    ];

    const summary = computeDeploymentTrends([...newestFive, ...olderFive, ...ignoredOldestTwo]);

    expect(summary.totalRuns).toBe(10);
    expect(summary.succeededCount).toBe(5);
    expect(summary.failedCount).toBe(5);
    expect(summary.successRatePercent).toBe(50);
    expect(summary.successRateDelta).toBe(100);
    expect(summary.trendDirection).toBe('improving');
    expect(summary.overallHealth).toBe('degraded');
    expect(summary.avgDurationMs).toBe(120_000);
    expect(summary.minDurationMs).toBe(60_000);
    expect(summary.maxDurationMs).toBe(180_000);

    // Chronological order: oldest (#11) first, newest (#20) last
    expect(summary.timeline).toHaveLength(10);
    expect(summary.timeline[0].id).toBe(11);
    expect(summary.timeline[0].rollingSuccessRate).toBe(0);
    expect(summary.timeline[9].id).toBe(20);
    expect(summary.timeline[9].rollingSuccessRate).toBe(50);
  });

  it('handles empty runs honestly without inventing numbers', () => {
    const empty = computeDeploymentTrends([]);
    expect(empty.totalRuns).toBe(0);
    expect(empty.overallHealth).toBe('empty');
    expect(empty.successRatePercent).toBeNull();
    expect(empty.avgDurationMs).toBeNull();
    expect(empty.timeline).toHaveLength(0);
  });

  it('evaluates duration threshold alerts across nominal, warning, critical, and null inputs', () => {
    expect(evaluateDurationAlert(null, 180_000)).toEqual({
      exceeded: false,
      severity: 'nominal',
      avgDurationMs: null,
      thresholdMs: 180_000,
      overageMs: 0,
      overagePercent: 0,
    });

    expect(evaluateDurationAlert(180_000, 180_000)).toMatchObject({
      exceeded: false,
      severity: 'nominal',
      overageMs: 0,
      overagePercent: 0,
    });

    expect(evaluateDurationAlert(216_000, 180_000)).toMatchObject({
      exceeded: true,
      severity: 'warning',
      overageMs: 36_000,
      overagePercent: 20,
    });

    expect(evaluateDurationAlert(300_000, 180_000)).toMatchObject({
      exceeded: true,
      severity: 'critical',
      overageMs: 120_000,
      overagePercent: 67,
    });
  });

  it('formats valid commit SHAs, constructs safe GitHub commit URLs, and populates timeline commit fields', () => {
    const fullSha = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
    expect(formatShortCommitSha(fullSha)).toBe('a1b2c3d');
    expect(formatShortCommitSha('  deadbeef  ')).toBe('deadbee');
    expect(formatShortCommitSha('javascript:alert(1)')).toBeNull();
    expect(formatShortCommitSha('abc')).toBeNull();
    expect(formatShortCommitSha(null)).toBeNull();

    expect(buildGitHubCommitUrl('Supremeai-bd/supremeai', fullSha)).toBe(
      `https://github.com/Supremeai-bd/supremeai/commit/${fullSha}`
    );
    // Falls back to parsing owner/repo from runHtmlUrl if repo slug is empty
    expect(
      buildGitHubCommitUrl(
        '',
        'deadbeef1234',
        'https://github.com/Supremeai-bd/supremeai-public/actions/runs/55'
      )
    ).toBe('https://github.com/Supremeai-bd/supremeai-public/commit/deadbeef1234');
    // Rejects unsafe repo slugs or invalid SHAs
    expect(buildGitHubCommitUrl('https://evil.com/foo', fullSha)).toBeNull();
    expect(buildGitHubCommitUrl('Supremeai-bd/supremeai', 'not-a-sha!')).toBeNull();

    const trends = computeDeploymentTrends(
      [
        makeRun({ id: 2, head_sha: fullSha }),
        makeRun({ id: 1, head_sha: null }),
      ],
      Date.parse('2026-11-24T10:05:00Z'),
      'Supremeai-bd/supremeai'
    );

    expect(trends.timeline[0].headSha).toBeNull();
    expect(trends.timeline[0].shortSha).toBeNull();
    expect(trends.timeline[0].commitUrl).toBeNull();

    expect(trends.timeline[1].headSha).toBe(fullSha);
    expect(trends.timeline[1].shortSha).toBe('a1b2c3d');
    expect(trends.timeline[1].commitUrl).toBe(
      `https://github.com/Supremeai-bd/supremeai/commit/${fullSha}`
    );
  });

  it('extracts stderr and CI failure lines while stripping ANSI escapes and timestamps', () => {
    const noise = Array.from(
      { length: 25 },
      (_, idx) => `2026-11-24T10:00:${String(idx).padStart(2, '0')}.123456Z info step ${idx}`
    ).join('\n');
    const rawLog = [
      noise,
      '2026-11-24T10:00:30.000Z \u001b[31mnpm ERR! code ELIFECYCLE\u001b[0m',
      '2026-11-24T10:00:31.000Z stderr: TypeError: Cannot read properties of undefined',
      '2026-11-24T10:00:32.000Z ##[error]Process completed with exit code 1.',
    ].join('\n');

    const result = extractCiErrorSnippet(rawLog, 15, 2000);
    expect(result.truncated).toBe(true);
    expect(result.snippet).not.toContain('\u001b[');
    expect(result.snippet).not.toContain('2026-11-24T10:00:30.000Z');
    expect(result.snippet).toContain('npm ERR! code ELIFECYCLE');
    expect(result.snippet).toContain('stderr: TypeError: Cannot read properties of undefined');
    expect(result.snippet).toContain('##[error]Process completed with exit code 1.');

    expect(extractCiErrorSnippet('')).toEqual({ snippet: '', truncated: false });
  });
});
