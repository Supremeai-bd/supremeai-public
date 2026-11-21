#!/usr/bin/env node
/**
 * Scope analyser for extracting a route group out of `server.ts`.
 *
 * `server.ts` puts every route inside one giant function scope, so the hard
 * part of any extraction is knowing exactly which local names a block closes
 * over. This script answers that mechanically: pass the 1-based line range of a
 * route group and it prints the identifiers the block uses that are declared
 * inside the enclosing function.
 *
 * Example (the MCP Tower group, before it was extracted):
 *   node scripts/server-scope-deps.mjs --from 1584 --to 1829
 *   → app, mcpClusterServices, recordAudit, resolveAuditActor, verifyAdminAuthorization
 *
 * Those five names are exactly what became `McpTowerRoutesContext`. Run this
 * before moving a block; if the list grows past ~8 names, the group is not yet
 * cohesive — split it further first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};

const from = arg('from', 0);
const to = arg('to', 0);
if (!from || !to || to <= from) {
  console.error('usage: node scripts/server-scope-deps.mjs --from <line> --to <line>');
  process.exit(2);
}

const lines = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8').split('\n');
const block = lines.slice(from - 1, to).join('\n');

// The enclosing bootstrap function starts at `const app = express()` — every
// `  const|let|function` at that indentation belongs to its scope.
const appLine = lines.findIndex((line) => line.includes('const app = express()'));
const scopeStart = appLine >= 0 ? appLine : 0;
const scopeEnd = lines.findIndex((line, i) => i > scopeStart && /^\s{2}server\.listen\(/.test(line));
const scope = lines.slice(scopeStart, scopeEnd > 0 ? scopeEnd : lines.length).join('\n');

const declared = new Set(
  [...scope.matchAll(/^\s{2}(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(
    (m) => m[1],
  ),
);
const used = new Set([...block.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]));
const closure = [...declared].filter((name) => used.has(name)).sort();

console.log(`block   : lines ${from}–${to} (${to - from + 1} lines)`);
console.log(`scope   : lines ${scopeStart + 1}–${scopeEnd > 0 ? scopeEnd : lines.length}`);
console.log(`closure : ${closure.length ? closure.join(', ') : '(none — fully self-contained)'}`);
if (closure.length > 8) {
  console.log('\nwarning: >8 closure dependencies — split this group further before extracting.');
}
