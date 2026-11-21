# GitDiagram wiring audit — SupremeAI Public (2026-11-21)

GitDiagram renders `src/**` static imports. It correctly infers the static
graph but misrepresents **runtime-resolved** wiring. This doc explains every
“not wired” arrow the diagram shows and what is actually wired at runtime.

## Diagram screenshot reference
`diagram (5).png` (Studio client → AI interaction → Workspace tools → Platform services → Admin operations)

## 1) `API gateway routes [&[path]a].ts` — rendering bug, not a code bug

- **Diagram label:** `API gateway routes [&[path]a].ts` (HTML entity corruption)
- **Real file:** `functions/api/[[path]].ts` — Cloudflare Pages catch-all reverse proxy to `https://supremeai-api-ulw0.onrender.com/api/*` (fallback `supremeai-primary-node-5xso`).
- **Why it looks unwired:** GitDiagram escapes `[` `]` as `&#91;` `&#93;` inside an HTML label, which renders as `[&` `a]`.
- **Runtime wiring:** `src/config/env.ts:apiBaseUrl = ''` (same-origin). In dev, Vite serves `server.ts` on `:3000`; in prod, `_routes.json` + `functions/api/[[path]].ts` serves. No code change needed.

## 2) `Local server [server.ts]` shows stale helpers — cleaned 2026-11-21

After splitting `api/admin/*` (39 routes) and `api/workspace/*` (16 routes) into `src/server/routes/{admin,workspace}/*`, `server.ts` still imported their helpers. ESLint reported 17 `never used` warnings, which made the diagram draw those helpers as if they were still inside `server.ts`.

Cleaned in this commit:
```ts
// removed from server.ts
import { collectLiveServiceHealth, sampleHostRuntime } from './mcpHealthCollector'
import { DEFAULT_MCP_TOWER_ORIGIN } from './platformEndpoints'
import { adminPasskeySchema } from './validation'
import { buildJsonViewerHtml, ... } from './browserProxyHtml'
import { isProtectedWorkspaceFile } from './serverSecurity'
import { buildGmailSessionSetCookie, ... } from './gmailSessionCrypto'
import { getCronMinuteKey, matchesCronAtDate } from './cronMatcher'
import { execFile } from 'child_process'; import { promisify } from 'util' // → terminal.ts only
```
Each now lives in its route module (`browserProxy.ts`, `browserVault.ts`, `gmailSession.ts`, `browserSchedules.ts`, `terminal.ts`). Diagram will re-render without those phantom edges after push.

## 3) `functions/api/*` vs `server.ts` — intentional dual runtime (looks like “not wired”)

Both trees implement the same contract (workspace proxy, vault, schedules, admin, auth). They are **not** wired to each other statically; they are wired by deploy target:

| Runtime | Entrypoint | Origin |
|---------|------------|--------|
| `bun run dev` / `tsx server.ts` | `server.ts` + `src/server/routes/*` | `http://localhost:3000` |
| Cloudflare Pages | `functions/api/*` + `functions/_lib/edgeHelpers.ts` | `/api/*` → `SUPREMEAI_BACKEND_URL` |

GitDiagram only walks `src/**`, so `functions/**` appears disconnected. This is expected. Live wiring is verified by `functions/api/workspace/browser-proxy.test.ts` + `browser-schedules.test.ts`.

## 4) `Tauri runtime [lib.rs]` → `calls speech API` — true duplication

`src-tauri/src/lib.rs::send_chat` re-implements `POST /api/v1/stream/chat` SSE parsing (`process_sse_line`) with its own `DEFAULT_GATEWAY = https://supremeai-api-ulw0.onrender.com`. It bypasses `src/services/apiClient.ts` and `federationSyncService.ts`.

- **Consequence:** Desktop chat does not emit `SESSION_EXPIRED_EVENT`, does not share `supplyGuestToken`, and does not go through `federationSources.ts` 4-tier matrix. Diagram correctly shows it as a detached edge.
- **Fix options (deferred):** Either (a) bridge Tauri IPC through `apiClient` in `src/bridge/` (recommended), or (b) document as intentional offline path. No change in this budget ratchet.

## 5) Correctly wired (diagram is accurate)

- `App.tsx → useAuthStore → authService → apiClient → env.apiBaseUrl` ✓
- `App.tsx → useWorkspaceStore → WorkspaceDock/BrowserTab/Vault` ✓
- `App.tsx → useLiveVoiceSession → ttsService → Speech synthesis` ✓
- `useChatStore → intentOrchestrator → chatService/researchService/visionRouting → artifactStreamParser → useWorkspaceStore.liveArtifactSync` ✓
- `controlPlaneRouter.ts ↔ mcpHealthCollector.ts ↔ mcpTowerRoutes.ts → Admin Studio` ✓
- `federationSources.ts` (4 tiers, 7 groups) → `federationSyncService.ts` → `FederationSyncView` → `useFederationStore` ✓

## How to verify after fix

```bash
./node_modules/.bin/tsc -p tsconfig.json --noEmit   # 0 errors
./node_modules/.bin/tsc -p tsconfig.edge.json --noEmit # 0 errors
./node_modules/.bin/eslint .                           # 0 server.ts “never used”, 250 total warnings (any/assignment)
node scripts/check-server-budget.mjs                 # 8796 lines (budget 8819)
```

Next split per `docs/SERVER_TS_SPLIT_PLAN.md`: `api/v1/*` (23 routes), `api/auth/*` (8), `api/user/*` (8).

