# Splitting `server.ts` — group map, method and current status

`server.ts` is the Express + Vite bootstrap for the web app, the desktop shell
and the Android WebView bridge. It is also, historically, the place where every
route was written. As of this change it is **10,076 lines** with **≈104 inline
route registrations inside a single function scope** (down from 11,550 / 143 —
`wc -l` and `grep -n app.(get|post|…)` counts differ slightly, see the ratchet
script for the exact figure it enforces). `api/admin/*` is now **fully
extracted (39/39)** into `src/server/routes/admin/` — the biggest group is
done, −1,474 lines gross.

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
| `api/admin/*` | 39 (up from 35 after PR #24) | 4234–7256 (two islands: 4242–5801 + 6941–7256) | high | **DONE** — split into `admin/{customers,security,swarmQueue,platform,providers,system}.ts` (39/39) → `server.ts` 11550→10076 (−1,474) |
| `api/admin` remaining | 0 | — | — | all 39 handlers now in `src/server/routes/admin/` (customers 4, security 4, swarm 3 + queue 3 + DLQ 1, platform 6+1 public, providers 7 + infisical 2, schemaParity 2 + llmGateway 3 + github 4) |
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
| `api/admin/customers` (GET/POST/PATCH/DELETE) | moved to `src/server/routes/admin/customers.ts` (208 lines, owns `fetchSupabaseLiveUsers`) | `tsc` clean; 294/294 vitest; `server.ts` −160 lines; `customerDirectory`/`usersDb` via ctx getter/setter |
| `api/admin/security` + `audit` (WAF blacklist + audit log) | moved to `src/server/routes/admin/security.ts` (146 lines, owns `securityEventsStore`) | `tsc` clean; `blockedIps` via live array reference (in-place splice), `auditRecords` read-only |
| `api/admin/swarm` + `queue` + `DLQ flush` (Agent Swarm workers + BullMQ) | moved to `src/server/routes/admin/swarmQueue.ts` (286 lines, owns `devQueueJobs`) | `tsc` clean; `devSwarmWorkers` stays in `server.ts` (shared with `/api/agent-swarm/stream`) |
| `api/admin/platform` (auth verify + platform config + overview + feature-flags + model policy) | moved to `src/server/routes/admin/platform.ts` (324 lines, `runtimeFeatureFlags` via getter/setter, `SUPPORTED_MODELS`/`activeAdminSessions` via ctx) | `tsc` clean; `customerDirectory`/`blockedIps`/`auditRecords` read-only, `platformConfig` by reference |
| `api/admin/providers` + `infisical` (provider mesh 7 + vault 2) | moved to `src/server/routes/admin/providers.ts` (472 lines, `providerMesh`/`infisicalExtraVaultKeys` via getter/setter) | `tsc` clean; `maskServerSecret`/`PROVIDER_KEY_ENV`/`probeProviderUpstream`/`buildInfisicalVaultKeys` via ctx |
| `api/admin/system` (schema parity 2 + llm-gateway 3 + github 4) | moved to `src/server/routes/admin/system.ts` (498 lines, owns `schemaParityTables`/`llmGatewayRoutes`/`fetchSupabaseLiveSchema`/`isSupabaseConfigured`/`getGithubAuthHeaders`) | `tsc` clean; 9 handlers + 2 stores + 3 helpers owned, only audit + `getRealGatewayTrafficSummary` via ctx |

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
