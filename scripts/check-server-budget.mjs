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
// The ratchet continues from the merged baseline; future extractions lower it.
const BUDGET = 11550;

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
