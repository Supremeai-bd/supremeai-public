# এক ব্যাকএন্ড — Hono মাইগ্রেশন (অডিট-প্ল্যান ২.১, সপ্তাহ ৩–৪)

## সমস্যা

একই API দুই জায়গায় আলাদা করে লেখা ছিল:

| স্তর | কোথায় | আকার |
|---|---|---|
| Express (Node: লোকাল, ডেস্কটপ, Android WebView) | `server.ts` + `src/server/routes/**` | ~১৬k লাইন |
| Cloudflare Pages Functions ("Edge API mirror") | `functions/api/**` | ~৮k লাইন |

এক জায়গায় নিরাপত্তা ফিক্স হলে অন্যটায় থেকে যেত। PR #91-এ admin auth দুই জায়গায় আলাদা করে ঠিক করতে হয়েছিল। এটা Creed-এর "Single source of logic" নিয়ম ভাঙে।

## সমাধান

```
src/api/app.ts            ← একমাত্র রুট রেজিস্ট্রি (Hono)
src/api/routes/*.ts       ← রুট-গ্রুপ (Web-standard Request/Response)
functions/_lib/honoAdapter.ts → Cloudflare: createApiApp().fetch(request, env) + CORS
src/api/node.ts           → Node: Express-এ mount (@hono/node-server)
```

নিয়মগুলো:

1. **হ্যান্ডলার রানটাইম-নিরপেক্ষ।** `process.env`, `express`, `fs` বা `node:*` চলবে না। env পড়তে হবে `readEnv(c, 'KEY')` দিয়ে, আর নেটওয়ার্কের জন্য `fetch` (টেস্টে `deps.fetch` দিয়ে বদলানো যায়)।
2. **পাথ পূর্ণ লিখতে হবে** (`/api/...`)। Express adapter `listApiPaths()` দিয়ে ঠিক এই পাথগুলোই mount করে, তাই আলাদা কোনো তালিকা রাখতে হয় না।
3. **রানটাইম-নির্দিষ্ট কাজ adapter-এ থাকে:**
   - Edge-এর CORS থাকে `honoAdapter`-এ।
   - Edge-এর security header থাকে `functions/_middleware.ts`-এ।
   - Node-এর security header, metrics আর rate-limit `server.ts`-এর middleware-এ থাকে। Hono mount হয় এগুলোর পরে, `express.json()`-এর **আগে**।
4. **দুই কপির আচরণ আলাদা হলে কড়াটা রাখতে হবে**, আর সেটা PR-এ লিখে দিতে হবে।

## একটা রুট-গ্রুপ সরানোর ধাপ

1. Express আর Edge দুই কপি পাশাপাশি পড়ো। আচরণের পার্থক্যগুলো লিখে রাখো।
2. `src/api/routes/<group>.ts`-এ `create<Group>Routes(deps)` বানাও, আর `app.ts`-এ `app.route('/', …)` যোগ করো।
3. `src/api/app.test.ts`-এ `app.request(...)` দিয়ে টেস্ট লেখো। নেটওয়ার্ক চলবে না, শুধু `deps.fetch` ব্যবহার করবে।
4. Edge-এর পুরনো ফাইলের পুরো লেখা মুছে এক লাইন রাখো:
   `export { onRequestViaHono as onRequest } from '../../_lib/honoAdapter';`
5. Express-এর পুরনো হ্যান্ডলার মুছে দাও। `register…` কল থেকেও সরাও।
6. যাচাই করো:
   - `tsc` (`tsconfig.json` + `tsconfig.edge.json`)
   - `npm test`
   - `npx tsx server.ts` চালিয়ে curl
   - `npx wrangler pages dev <dir>` চালিয়ে curl
   - `node scripts/check-server-budget.mjs --lower`

## অবস্থা

| রুট | Edge ফাইল (লাইন) | Express কপি | অবস্থা |
|---|---|---|---|
| `GET /api/releases/latest` | ২০৪ → ২ | `routes/releases.ts` (২০০, মুছে ফেলা) | ✅ Hono |
| `POST /api/telemetry/client-error` | ৭৩ → ২ | `routes/telemetry.ts`-এর অংশ | ✅ Hono (Edge-এর ৮ KB সীমা, 413 আর 405 এখন Node-এও আছে) |
| `GET /api/health` | ৩৭ → ২ | `routes/telemetry.ts`-এর health অংশ সরানো | ✅ Hono; version package.json থেকে; providerReadiness, no-store, HEAD ও 405 |
| `GET /api/models` | ২৯ → ২ | `routes/telemetry.ts`-এ শুধু Node catalog cache | ✅ Hono; Node-এর shared cache helper injected (billing-ও ব্যবহার করে); Edge-এ স্থানীয় canonical catalog |
| `GET /api/platform/config` | ৪০ | `routes/admin/platform.ts` | ⏳ (Express-এ admin store থেকে পড়ে, Edge-এ static) |
| `/api/llm-gateway/latency` | ১১০ | `routes/llmLatency.ts` | ⚠️ দুই কপির ডেটা আলাদা: Express-এ স্থির সংখ্যা, Edge-এ সত্যিকারের probe। আগে product সিদ্ধান্ত লাগবে |
| `/api/share/generate`, `/api/share/artifact`, `/api/share/:id` | ১৪১ → ৪ | আগে শুধু Edge-এ | ✅ Hono; Node-এও চলে; no-store, 1 MiB actual-byte limit, malformed input 400/404, HEAD ও 405 |
| `/api/research/*` | ২৫৪ | — (শুধু Edge-এ) | ⏳ আলাদা ধাপ |
| `/api/tts`, `/api/tts/edge` | ৪৫৮ | `routes/tts.ts` | ⏳ |
| `/api/chat`, `/api/chat/title`, `/api/intent/analyze`, `/api/transcribe` | ৫৮৪ | `routes/media.ts`, `routes/stream.ts` | ⏳ (SSE: `streamSSE`) |
| `/api/api-keys/*`, `/api/user/team/*` | ২৬৩ | `routes/apiKeys.ts`, `routes/team.ts` | ⏳ |
| `/api/auth/totp/*`, `/api/auth/verify-2fa` | ৪৮৭ | `routes/authTotp.ts` | ⏳ নিরাপত্তা-সংবেদনশীল, আলাদা PR |
| `/api/git/oauth/*` | ৩৪১ | `routes/gitOauth.ts` | ⏳ |
| `/api/v1/sync/*` | ৩৬৪ | `routes/sync.ts` | ⏳ (SSE) |
| `/api/workspace/*` (proxy, vault, schedules, gmail-session, terminal, project-run) | ১,৫৪৪ | `routes/workspace/**` | ⏳ নিরাপত্তা-সংবেদনশীল, আলাদা PR |
| `/api/agent/execute` | ৫৬১ | `routes/agentExecute.ts` | ⏳ |
| `/api/mcp-tower/*` | ১৮০ | `routes/mcpTowerRoutes.ts` | ⏳ |
| `/api/admin/*`, `/api/admin/control-plane/*` | ১,১৬৭ | `routes/admin/**`, `controlPlaneRouter.ts` | ⏳ সবার শেষে (সবচেয়ে বড়) |
| `/api/*` (catch-all) | ১৯৯ | — | থাকবে। যেসব রুট এখনো সরানো হয়নি, সেগুলো Render gateway-তে proxy করে |

সব রুট সরানো শেষ হলে:
- `functions/api/**`-এর এক লাইনের ফাইলগুলোর বদলে একটাই `functions/api/[[path]].ts` থাকবে, যেটা Hono-কে কল করবে। যে রুট Hono-তে মিলবে না, সেটা gateway-তে proxy হবে।
- Node-এ Express বাদ দিয়ে `@hono/node-server`-এর `serve()` আর Vite middleware ব্যবহার করা হবে।

## Share contract ও সীমা

- Conversation/artifact link stateless base64url: encrypted, signed, expiring বা revocable নয়। URL যার কাছে যাবে সে payload পড়তে/বদলাতে পারে; secret/token শেয়ার করা যাবে না। এই migration কোনো private-sharing প্রতিশ্রুতি দেয় না।
- Generated URL, Unicode payload, mode ও defaults রাখা হয়েছে। Node-এ একই endpoint নতুনভাবে পাওয়া যায়।
- ইচ্ছাকৃত hardening: malformed JSON/ভুল field type-এ 400; POST body actual UTF-8 bytes-এ 1 MiB অতিক্রমে 413 (Content-Length মিথ্যা হলেও); malformed token-এ 404; অন্য method-এ 405; GET থেকে HEAD-এ body বাদ। Artifact-এর আগের সব method-এ 200 আচরণ রাখা হয়নি।
- Edge CORS এখন adapter-এ env.ALLOWED_ORIGINS-সহ চলে। Conversation ও code response no-store; token payload-এর id/status server-এর response metadata override করে না।

### Stored conversation sharing: চিহ্নিত অবশিষ্ট gap

`core/api/routes/share.py`-এর authenticated DB-backed sharing (`conversation_id`, expiry/revoke) এই stateless contract নয়। Studio shareService একই id request পাঠালেও Edge আগে blank conversation তৈরি করত এবং client failure-এ fake `/share/id` বানাত। এখন unsupported stored-id request-এ 400 ও invalid/missing backend response-এ error caller-এ যায়; mock mode-এর explicit demo আচরণ অপরিবর্তিত। Stored-share proxy/UI viewer wiring এবং auth/expiry/revoke E2E আলাদা কাজ; এই PR-কে পূর্ণ share UI fix বলা যাবে না।

### Stored-share access hardening — target review pending

`.patches/private/stored-share-access.patch` মূল repo `75bda24`-এর `core/api/routes/share.py` এবং নতুন regression test-এর Rule 10 review payload। Cache-hit-এর আগে প্রতিবার live share row/public/expiry যাচাই হয়; অন্য worker-এ revoke/private হলে পরের read-এ cached content আর ফেরে না। Message cache-এর ৩০ মিনিট TTL রাখা, কিন্তু LRU সর্বোচ্চ ৫০০ entry; TTL hit-এ অসীমভাবে বাড়ে না। Public read-এ no-store, cache conversation identity বদলালে miss, DB failure-এ fail-closed। Production JWT/DB integration বা full-app boot প্রমাণ নয়।

মূল repo-তে payload apply/CI/merge/deploy প্রমাণ না আসা পর্যন্ত এই নিরাপত্তা fix landed বা stored-share UI enabled ধরে নেওয়া যাবে না। Reverse-sync apply step এখনও skipped দেখা গেছে; credential/config workflow operator review বাকি। Sandbox full-app `import main` missing uvicorn-এ blocked; focused real FastAPI router boot ও lifecycle tests সফল। নতুন UI/proxy চালু করা হয়নি, কোনো live DB write/delete চালানো হয়নি।
