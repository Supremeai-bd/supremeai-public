#!/usr/bin/env node
/**
 * Keep `server.ts` non-increasing (structural ratchet).
 *
 * WHY: server.ts is a single Express/Vite bootstrap that also contains 149
 * inline route registrations in one function scope (~11.5k lines). Rewriting it
 * in one go is a multi-day, high-risk change, but letting it grow while the
 * split is in progress guarantees the split never finishes.
 *
 * So this guard does the cheap, reversible half: the file may only get smaller.
 * Every extraction lowers the budget; the budget may never be raised.
 *
 * The first group is already out: the MCP Tower proxy surface now lives in
 * src/server/routes/mcpTowerRoutes.ts (287 lines, 5 closure dependencies,
 * verified by scripts/server-scope-deps.mjs). See
 * docs/SERVER_TS_SPLIT_PLAN.md for the remaining groups.
 *
 * Usage:
 *   node scripts/check-server-budget.mjs           # enforce
 *   node scripts/check-server-budget.mjs --lower    # print the tightened value
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 'server.ts';

// Ratchet: lowered by every extraction, never raised by branch-local changes.
// 11782 → 11495 after extracting the MCP Tower proxy group
//         (src/server/routes/mcpTowerRoutes.ts).
// Re-baselined to 11550 on merge with main (PR #24): main added 57 net lines
// of validation/audit hardening to server.ts after this branch was cut
// (spread across ~30 hunks of existing inline code, not a new route group).
// 11550 → 11184 after extracting api/admin customers+security+swarmQueue
//         (src/server/routes/admin/{customers,security,swarmQueue}.ts) —
//         15 routes moved, 440 lines removed (customers 4, security 4,
//         swarm 3 + queue 3 + DLQ flush), shared stores now via ctx.
// 11184 → 10960 after extracting api/admin platform
//         (src/server/routes/admin/platform.ts) — 6 admin routes + 1 public
//         platform/config, 224 lines removed, runtimeFeatureFlags via
//         getter/setter.
// 10960 → 10596 after extracting api/admin providers+infisical
//         (src/server/routes/admin/providers.ts) — 9 routes (providers 7 +
//         infisical 2), 364 lines removed, providerMesh/infisicalExtraVaultKeys
//         via getter/setter, helpers via ctx.
// 10596 → 10076 after extracting api/admin system (schema parity 2 +
//         llm-gateway 3 + github 4) + its exclusive stores/helpers
//         (src/server/routes/admin/system.ts) — 9 routes, 520 lines removed
//         (3499 store defs + 1146 fetch helper + 12928 handlers −237 register).
//         api/admin/* now 39/39 complete; server.ts 11550→10076 (−1474).
// 10076 → 9617 after extracting workspace terminal dock (terminal + files +
//         file + project-run) into src/server/routes/workspace/terminal.ts
//         — 4 routes, 459 lines removed (469 block −10 delegation).
// 9617 → 8819 after extracting workspace remaining (browser-proxy 1 +
//         browser-vault 3 + gmail-session 3 + browser-schedules 5) into
//         src/server/routes/workspace/{browserProxy,browserVault,gmailSession,browserSchedules}.ts
//         — 12 routes, 798 lines removed (325+131+86+284 blocks −14+4 delegation + studioDataDir dedup).
//         api/workspace/* now complete; server.ts 10076→8819 (−1257) total workspace.
// 8819 → 8796 after removing 17 dead imports that were moved to routes
//         (collectLiveServiceHealth, sampleHostRuntime, DEFAULT_MCP_TOWER_ORIGIN,
//         adminPasskeySchema, browserProxyHtml 4, isProtectedWorkspaceFile,
//         gmailSessionCrypto 6, cronMatcher 2, execFile/promisify) — lint clean.
// 8796 → 8422 after extracting api/v1/conversations (6 routes: list/create/
//         list-messages/post-message/patch/delete) into src/server/routes/
//         conversations.ts — 374 lines removed (380 block −6 delegation).
//         api/v1/* now 23→17 remaining; conversations own store + Supabase dual.
// 8422 → 8152 after extracting api/v1/projects (5 routes: list/github-status/
//         create/fork/delete) into src/server/routes/projects.ts — 270 lines
//         removed (260 block + 16 store def −6 delegation). Owns userProjectsStore.
// 8152 → 7952 after extracting api/api-keys/* (6 routes: list/create/patch/
//         revoke/probe/delete) into src/server/routes/apiKeys.ts — 200 lines
//         removed (208 block −8 delegation). Owns userApiKeysStore + probe.
// 7952 → 7817 after extracting api/user/team (4 routes: list/create/patch/delete)
//         into src/server/routes/team.ts — 135 lines removed (132 block + 11 store
//         def −8 delegation). Owns userTeamStore/userTeamOwner.
// 7817 → 7686 after extracting api/user/webhooks (4 routes: list/create/delete/test)
//         into src/server/routes/webhooks.ts — 131 lines removed (127 block + 11
//         store def −7 delegation). Owns userWebhooksStore/userWebhookOwner.
// 7686 → 7531 after extracting api/v1/graph/* (2 routes: skills/path) into
//         src/server/routes/graph.ts — 155 lines removed (161 block −6
//         delegation). Owns buildStudioTopologyGraph.
// 7531 → 7174 after extracting api/tts + api/tts/edge (2 routes: cloud/edge)
//         into src/server/routes/tts.ts — 357 lines removed (363 block −6
//         delegation). Owns Gemini + Edge/TTS fallback logic.
// 7174 → 6932 after extracting api(v1)/user/preferences (3 routes: GET/POST/PUT)
//         into src/server/routes/preferences.ts — 242 lines removed (251 block
//         −9 delegation). Owns userPreferencesVault + vault file.
// 6932 → 6765 after extracting api/billing/* + metrics/usage (6 routes: plans/
//         wallet/summary|analytics/history/add-funds/metrics) into
//         src/server/routes/billing.ts — 167 lines removed (181 block −14
//         delegation). Owns wallet/invoice/usage stores.
const BUDGET = 6765;

const file = path.join(ROOT, TARGET);
const text = fs.readFileSync(file, 'utf8');
// wc -l semantics: count newline-terminated lines, not the empty tail element.
const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
const args = new Set(process.argv.slice(2));

if (args.has('--lower')) {
  console.log(`${TARGET} budget → ${lines}`);
  process.exit(0);
}

const pct = ((1 - lines / 11782) * 100).toFixed(1);
console.log(`${TARGET}: ${lines} lines (budget ${BUDGET}, ${pct}% below the 2026-11-21 baseline)`);

if (lines > BUDGET) {
  console.error(
    `\n::error::${TARGET} grew to ${lines} lines (budget ${BUDGET}).\n` +
      'New routes belong in src/server/routes/<group>.ts, registered through a\n' +
      'register*Routes(app, ctx) function — see docs/SERVER_TS_SPLIT_PLAN.md for the\n' +
      'group map and scripts/server-scope-deps.mjs for the closure-dependency check.\n',
  );
  process.exit(2);
}
