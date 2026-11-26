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
| `/api/share/*`, `/api/research/*` | ১২৭ + ২৫৪ | — (শুধু Edge-এ) | ⏳ সরাসরি Hono-তে নেওয়া যায় |
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
