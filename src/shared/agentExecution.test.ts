import { describe, expect, it } from 'vitest';
import {
  buildScheduleEvaluationPrompt,
  extractHtmlTitle,
  extractReadablePageSnippet,
} from './scheduleExecution';
import { shouldRouteToAutonomousAgent } from './agentTypes';

describe('scheduleExecution helpers', () => {
  it('extracts clean title and readable body snippet while stripping scripts and styles', () => {
    const html = `
      <html>
        <head>
          <title>  Release Tracker &amp; Status  </title>
          <style>.hidden { display: none; }</style>
        </head>
        <body>
          <script>window.__SECRET = "ignore";</script>
          <h1>Latest Release v2.9.0</h1>
          <p>All telemetry nodes healthy &amp; synced.</p>
        </body>
      </html>
    `;
    expect(extractHtmlTitle(html, 'fallback')).toBe('Release Tracker &amp; Status');
    const snippet = extractReadablePageSnippet(html, 500);
    expect(snippet).toContain('Latest Release v2.9.0');
    expect(snippet).toContain('All telemetry nodes healthy & synced.');
    expect(snippet).not.toContain('__SECRET');
    expect(snippet).not.toContain('display: none');
  });

  it('builds structured JSON evaluation prompt for scheduled web monitoring', () => {
    const prompt = buildScheduleEvaluationPrompt({
      title: 'GitHub Releases Check',
      targetUrl: 'https://github.com/Supremeai-bd/supremeai-public/releases',
      instruction: 'Check the latest tag version.',
      pageTitle: 'Releases · supremeai-public',
      statusCode: 200,
      pageText: 'v3.2.1 released yesterday',
    });
    expect(prompt).toContain('GitHub Releases Check');
    expect(prompt).toContain('HTTP Status: 200');
    expect(prompt).toContain('Check the latest tag version.');
    expect(prompt).toContain('v3.2.1 released yesterday');
  });
});

describe('shouldRouteToAutonomousAgent', () => {
  it('routes workspace file inspections, Bangla/Banglish multi-step prompts, and multi-URL checks', () => {
    expect(
      shouldRouteToAutonomousAgent({
        promptText: 'Inspect src/App.tsx and explain how TaskApprovalCard is mounted',
        hasAttachments: false,
        deepResearch: false,
        workspaceFileCount: 0,
      })
    ).toBe(true);

    expect(
      shouldRouteToAutonomousAgent({
        promptText: 'আমার প্রজেক্টের ফাইল পড়ে বাগ ফিক্স করে দাও',
        hasAttachments: false,
        deepResearch: false,
        workspaceFileCount: 2,
      })
    ).toBe(true);

    expect(
      shouldRouteToAutonomousAgent({
        promptText: 'Compare https://example.com and https://iana.org pricing summaries',
        hasAttachments: false,
        deepResearch: false,
        workspaceFileCount: 0,
      })
    ).toBe(true);
  });

  it('skips autonomous agent for trivial greetings, dashboard shortcuts, deep research, or image uploads', () => {
    expect(
      shouldRouteToAutonomousAgent({
        promptText: 'Hello!',
        hasAttachments: false,
        deepResearch: false,
        workspaceFileCount: 0,
      })
    ).toBe(false);

    expect(
      shouldRouteToAutonomousAgent({
        promptText: 'Check src/App.tsx please',
        hasAttachments: true,
        deepResearch: false,
        workspaceFileCount: 2,
      })
    ).toBe(false);

    expect(
      shouldRouteToAutonomousAgent({
        promptText: 'Check src/App.tsx please',
        hasAttachments: false,
        deepResearch: true,
        workspaceFileCount: 2,
      })
    ).toBe(false);
  });
});
