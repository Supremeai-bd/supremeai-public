# Splitting `server.ts` — group map, method and current status

`server.ts` is the Express + Vite bootstrap for the web app, the desktop shell
and the Android WebView bridge. It is also, historically, the place where every
route was written. As of this change it is **11,184 lines** with **≈128 inline
route registrations inside a single function scope** (down from 11,550 / 143 —
`wc -l` and `grep -n app.(get|post|…)` counts differ slightly, see the ratchet
script for the exact figure it enforces).

A big-bang rewrite is not reviewable, not testable, and not worth the risk. The
method here is **one cohesive group at a time, proven by the type checker and
by hitting the live routes**, with a ratchet so the file can never grow back.

## Method (repeatable, ~30 minutes per group)

1. Pick a group from the table below (prefix + line range).
2. Find its real dependencies mechanically:

   ```bash
   node scripts/server-scope-deps.mjs --from 1590 --to 1600
   # closure : app, mcpClusterServices, recordAudit, resolveAuditActor, verifyAdminAuthorization
   ```

   If the closure list is longer than ~8 names, the group is not cohesive yet —
   split it smaller first.
3. Create `src/server/routes/<group>Routes.ts` exporting
   `register<Group>Routes(app, ctx)` with a typed `ctx` interface. Move the block
   verbatim; replace nothing inside it.
4. In `server.ts`, replace the block **in place** with the `register…` call so
   Express registration order (and therefore matching precedence) is unchanged.
   Pass later-declared helpers as **lazy closures** (`(req) => fn(req)`) — the
   monolith declares `recordAudit` *below* the routes, so a direct reference
   would hit the temporal dead zone at registration time.
5. `npx tsc -p tsconfig.json --noEmit` → must stay clean.
6. Boot `npx tsx server.ts` and curl every route in the group (HTTP 200 + same
   JSON shape). A 404 or a 500 here means the extraction changed behaviour.
7. `node scripts/check-server-budget.mjs --lower` and paste the new budget into
   `scripts/check-server-budget.mjs`. The ratchet is enforced by `npm run lint`,
   which CI runs.

## Group map (by size, current file)

| Group | Routes | Line span | Difficulty | Notes |
|---|---|---|---|---|
| `api/admin/*` | 39 (up from 35 after PR #24) | 4234–7256 (two islands: 4242–5801 + 6941–7256) | high | depends on admin auth middleware, audit, provider store; split into `admin/{auth,providers,security,customers,queue,platform,llmGateway,github,schemaParity}.ts` — **15/39 done** (customers 4, security 4, swarm 3 + queue 3 + DLQ 1) → `server.ts` 11550→11184 (−366 net, −440 gross, +74 devSwarm re-add) |
| `api/admin` remaining | 24 | 4242–4306 auth/verify, 4306–4558 platform (config/overview/feature-flags/models), 5050–5420 providers/infisical, 5660–5900 schemaParity/llmGateway/github | high | `providerMesh` shared with `/api/llm-gateway/latency` (read via ctx), `schemaParityTables`/`llmGatewayRoutes`/`getGithubAuthHeaders` can be owned in new modules; next candidate: `platform` (6 routes, ~250 lines, 6 closure) |
| `api/v1/*` (projects, conversations, preferences, graph) | 23 | 3379–10844 | medium | conversations block is self-contained; projects block touches GitHub |
| `api/workspace/*` | 12 | 8017–9170 | medium | terminal/files/browser-vault/gmail-session; each is its own module candidate |
| `api/auth/*` | 8 | 3378–3957 | low | handlers already exist (`handleLoginRequest`, …) — mostly wiring |
| `api/user/*` | 8 | 6129–6619 | low | webhooks + team |
| `api/billing/*` | 5 | 5992–6046 | medium | Stripe wallet logic |
| `api/api-keys/*` | 3 | 5166–5351 | low | CRUD |
| `api/tts/*` | 2 | 10141–10241 | low | uses `src/utils/speechUtils` only |
| `api/feedback`, `api/git`, `api/releases`, `api/telemetry`, `api/models`, `api/health`, `api/platform` | 1–2 each | scattered | trivial | small single-purpose routes |

## Done so far

| Group | Result | Verification |
|---|---|---|
| `api/mcp-tower/*` (health, services, reboot, probe, SSE stream) | moved to `src/server/routes/mcpTowerRoutes.ts` (287 lines) | `tsc` clean; all five endpoints curl-verified (200 + identical JSON); 262/262 vitest; `server.ts` −287 lines |
| `api/admin/customers` (GET/POST/PATCH/DELETE) | moved to `src/server/routes/admin/customers.ts` (208 lines, owns `fetchSupabaseLiveUsers`) | `tsc` clean; 294/294 vitest; `server.ts` −160 lines; `customerDirectory`/`usersDb` via ctx getter/setter so `filter`/`map` reassignments stay coherent |
| `api/admin/security` + `audit` (WAF blacklist + audit log) | moved to `src/server/routes/admin/security.ts` (146 lines, owns `securityEventsStore`) | `tsc` clean; `blockedIps` via live array reference (in-place splice for delete), `auditRecords` read-only |
| `api/admin/swarm` + `queue` + `DLQ flush` (Agent Swarm workers + BullMQ simulation) | moved to `src/server/routes/admin/swarmQueue.ts` (286 lines, owns `devQueueJobs`) | `tsc` clean; `devSwarmWorkers` stays in `server.ts` (shared with `/api/agent-swarm/stream`) and is passed via ctx; `devQueueJobs` owned here |

The MCP Tower closure was 5 names (`app`, `mcpClusterServices`, `resolveAuditActor`,
`recordAudit`, `verifyAdminAuthorization`). Admin customers closed over 4 shared
names (`app`, `customerDirectory`, `usersDb`, `recordAudit`/`resolveAuditActor`)
plus an internal Supabase helper — the same pattern (ctx getter/setter for
reassigning `let`s) generalizes to the rest of `api/admin/*`.

## Why a ratchet instead of a deadline

The budget lives in `scripts/check-server-budget.mjs` and only ever goes down.
If a PR adds a route to `server.ts`, CI fails with a message pointing here. That
converts "someone should split this someday" into a constraint that costs
nothing to satisfy when you are already touching the file.
