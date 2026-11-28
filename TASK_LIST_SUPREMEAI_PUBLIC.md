# SupremeAI Public — `supremeai-public` (ফ্রন্টএন্ড) কাজ তালিকা

**ক্যাটাগরি:** P0 (অফুরন্ত), P1 (অফুরন্ত), P2 (পরের)
**ব্রাঞ্চ:** `arena/af2516f6-supremeai-public`
**রেপো:** `Supremeai-bd/supremeai-public`

---

## 🔴 P0 — 今天是 2026-11-26 — 今天立刻开始

> re-audit (২০২৬-১১-২৮):
> - ✅ #1 `server.ts` monolith (১১,৭৮২ → **১,০৩৯ লাইন**, বাজেট `<=1,039`) সম্পূর্ণ মডিউলার `src/server/routes/**` ও শেয়ার্ড `src/api/**` (Hono)-তে বিভক্ত।
> - ✅ #2 ভার্সন-সিঙ্ক (`npm run version:sync` + CI গেট `npm run version:check`) ও #3 MIT `LICENSE` যাচাইকৃত।
> - ✅ #4 একক ক্যানোনিকাল Admin, #5 ১৬৬+ Vitest স্যুট (Node + jsdom প্রজেক্ট স্প্লিট, V8 কভারেজ গেট ৪২%+), #6 Tauri nonce-ভিত্তিক কঠোর CSP (`'nonce-${NONCE}'`, কোনো `unsafe-inline`/`unsafe-eval` নেই), #7 ক্যাটাগরাইজড `.env.example`, এবং #9 VS Code এক্সটেনশন সিঙ্ক সম্পন্ন।
> - ✅ ESLint কঠোর গেট (`eslint . --max-warnings=0`, ০ এরর ও ০ ওয়ার্নিং), `npm audit --omit=dev` ০ ভালনারেবিলিটি, একীভূত IPv4/IPv6 SSRF ক্লাসিফায়ার (`src/shared/ipClassifier.ts`), এবং Supabase প্রোডাকশন `SECURITY DEFINER` RPC হার্ডেনিং সম্পন্ন।
> - চলমান: #8 অবশিষ্ট Express ↔ Cloudflare Pages রুটগুলো ধাপে ধাপে Hono (`src/api/`)-তে একীভূত করা (`docs/HONO_MIGRATION.md` — ইতিমধ্যে ৮টি রুট-গ্রুপ একীভূত)।

### 1. `server.ts` monolith ভেঙে রাউটার মডিউলে ভাগ করা — ✅ সম্পন্ন (১১,৭৮২ → ১,০৩৬ লাইন)

**সমস্যা:** এক ফাইলে সব রুট, একটি পরিবর্তন হলে পুরো সার্ভার ভেঙে যায়।
**পরিকল্পনা:**

- `src/server/authRouter.ts` (login, signup, guest, refresh, logout, totp, 2fa) — лিন: ³⁶⁰⁸-⁴²⁰⁰
- `src/server/adminRouter.ts` (customers, security, audit, queue, swarm, providers, infisical, billing, llm-gateway, github) — лিন: ⁴⁴²²-⁶⁰⁰⁰
- `src/server/billingRouter.ts` (plans, wallet, summary, analytics, history, add-funds, usage) — лিন: ⁶²²²-⁶³⁵⁰
- `src/server/workspaceRouter.ts` (terminal, files, file, project-run, browser-vault, gmail-session, browser-schedules) — лিন: ⁸²⁴⁴-⁹⁵⁵⁰
- `src/server/gitRouter.ts` (oauth status, url) — лিন: ⁹⁵⁴⁴-⁹⁶³⁰
- `src/server/projectRouter.ts` (v1 projects) — лিন: ⁶⁴⁸³-⁶⁸⁵⁰
- `src/server/conversationRouter.ts` (v1 conversations) — лিন: ¹⁰⁸¹⁹-¹¹¹⁰⁰
- `src/server/visionRouter.ts` (avatar, transcribe, chat-title, intent, tts, tts/edge) — лিন: ⁹⁸⁷⁴-¹⁰⁸⁰⁰
- `src/server/mcpRouter.ts` (health, services, reboot-all, probe, stream) — лিন: ¹⁵⁸⁴-¹⁸⁵⁰ (কখনও `controlPlaneRouter.ts`-এর সাথে মर्ज করা)
- `src/server/telemetryRouter.ts` (client-error, feedback) — лিন: ³⁸²⁷-³⁹⁰⁰
- `src/server/apiKeysRouter.ts` (api-keys) — лিন: ⁵³⁹⁶-⁵⁶⁰⁰
- `src/server/providersRouter.ts` (providers) — лিন: ⁵⁶⁰¹-⁵⁹⁷⁰
- `src/server/releaseRouter.ts` (latest, models) — лিন: ¹³³²-¹³⁸⁰
- `src/server/main.ts` (startServer, express app, middleware, rateLimit, fetchGatewayJson, health, models, static dist) — лিন: ¹¹⁶⁰-¹³⁰⁰ + ¹¹¹³⁸-¹¹³⁰⁰

**অ্যাকশন:**

1. `src/server/authRouter.ts` তৈরি (প্যাটার্ন: `controlPlaneRouter.ts`)
2. `server.ts` থেকে лিন ³⁶⁰⁸-⁴²⁰⁰ কট করে নতুন ফাইলে পেস্ট
3. `server.ts` এ `import { registerAuthRoutes } from './src/server/authRouter';` যোগ
4. `registerAuthRoutes(app, deps);` কল যোগ
5. একইভাবে Admin, Billing, Workspace, Git, Project, Conversation, Vision, API Keys, Providers, Release, Telemetry, MCP, Main-static-dist—সবগুলো ভাগ করা।

### 2.ভার্সন সিঙ্ক (P0) — ✅ সম্পন্ন (২০২৬-১১-২৬ re-audit verify)

**verify:** `package.json` = 2.5.0 · `version.json` = `v2.5.0` · `npm run version:sync` (`scripts/sync-versions.mjs`) live আছে।
Release tag `v2.5.0` — `version.json.releaseTag` সাথে ম্যাচ করে।

### 3. লাইসেন্স যোগ (P0) — ✅ সম্পন্ন (২০২৬-১১-২৬ re-audit verify)

**verify:** `LICENSE` (MIT) রেপো root-এ আছে — backend-এর সাথে ম্যাচ করে।

---

## 🟡 P1 — দ্রুত

### 4. দুই Admin এক করা (P1) — ✅ সম্পন্ন (২০২৬-১১-২৬)

`admin/` (আলাদা Next.js অ্যাপ) মুছে ফেলা হয়েছে; `src/components/admin/` এখন একমাত্র (ক্যানোনিকাল) অ্যাডমিন।
লাইভ `supremeai-admin.pages.dev`-এর `/api/admin/*` কল আগেই 404 দিচ্ছিল (API রুট `api-backup/`-এ সরানো ছিল),
তাই কোনো কার্যকর ফিচার হারায়নি। ওই ডোমেইন এখন `deploy/admin-redirect/` দিয়ে মূল স্টুডিওর
`?tab=admin-overview`-এ 301 redirect করে। সেশন সাইনিং `src/shared/serverSecurity.ts`-এ আগে থেকেই আছে।

### 5. টেস্ট কভারেজ ও সিকিউরিটি স্যুট সম্প্রসারণ (P1) — ✅ সম্পন্ন (২০২৬-১১-২৮)

**অবস্থা:** ১৬৫টি Vitest টেস্ট ফাইল (`node` + `jsdom` প্রজেক্ট স্প্লিট) + `productionHardening.test.ts` সিকিউরিটি স্যুট + ৪২+ Python CI গার্ড টেস্ট; কভারেজ র‍্যাচেট `vitest.config.ts`-এ কার্যকর।
**অ্যাকশন:**

- `src/server/authRouter.ts` (নতুন) → `src/server/authRouter.test.ts`
- `src/server/adminRouter.ts` (নতুন) → `src/server/adminRouter.test.ts`
- `src/server/billingRouter.ts` (নতুন) → `src/server/billingRouter.test.ts`
- `src/server/workspaceRouter.ts` (নতুন) → `src/server/workspaceRouter.test.ts`
- `src/server/gitRouter.ts` (নতুন) → `src/server/gitRouter.test.ts`
- `src/server/projectRouter.ts` (নতুন) → `src/server/projectRouter.test.ts`
- `src/server/conversationRouter.ts` (নতুন) → `src/server/conversationRouter.test.ts`
- `src/server/visionRouter.ts` (নতুন) → `src/server/visionRouter.test.ts`
- `src/server/apiKeysRouter.ts` (নতুন) → `src/server/apiKeysRouter.test.ts`
- `src/server/providersRouter.ts` (নতুন) → `src/server/providersRouter.test.ts`
- `src/server/releaseRouter.ts` (নতুন) → `src/server/releaseRouter.test.ts`
- `src/server/telemetryRouter.ts` (নতুন) → `src/server/telemetryRouter.test.ts`
- `src/server/mcpRouter.ts` (নতুন) → `src/server/mcpRouter.test.ts`

### 6. Tauri CSP শক্ত করা (P1) — ✅ সম্পন্ন (২০২৬-১১-২৮ re-audit verify)

**অবস্থা:** `src-tauri/tauri.conf.json`-এ ইতিমধ্যে `'nonce-${NONCE}'` ভিত্তিক কঠোর `script-src` ও `style-src` CSP কার্যকর রয়েছে (`unsafe-inline` এবং `unsafe-eval` সম্পূর্ণ মুক্ত)।
- `git commit -m "security(tauri): remove unsafe-inline/unsafe-eval from CSP"`
- `git push origin arena/af2516f6-supremeai-public`

### 7. `.env.example` পরিষ্কার করা (P1)

**সমস্যা:** ৫০+ ভ্যারিয়েবল একসাথে, কোনটা লোকাল/প্রোডাকশন তা স্পষ্ট নয়।
**অ্যাকশন:**

- `# LOCAL DEVELOPMENT` / `# PRODUCTION` / `# MCP TOWER` / `# GATEWAY` / `# TTS` / `# FIREBASE` / `# SUPABASE` — গ্রুপ করে কমেন্ট যোগ।
- অলিগলি ভ্যারিয়েবল ডিলিট।
- `git add .env.example`
- `git commit -m "docs(env): group and clean .env.example (50+ vars → categorized)"`
- `git push origin arena/af2516f6-supremeai-public`

---

## 🟢 P2 — পরে

### 8. Cloudflare Pages Functions ↔ Express `server.ts` ডুপ্লিকেট লজিক (P2)

> 🚧 **চলছে (২০২৬-১১-২৬):** পদ্ধতি ঠিক হয়েছে — রুট হ্যান্ডলার একবার লেখা হবে
> **Hono**-তে (`src/api/`), Cloudflare (`functions/_lib/honoAdapter.ts`) আর Express
> (`src/api/node.ts`) দুই জায়গা থেকেই সেটা চলবে। প্রথম ধাপে `GET /api/releases/latest`
> আর `POST /api/telemetry/client-error` সরানো হয়েছে। রুট-গ্রুপের তালিকা ও অবস্থা:
> `docs/HONO_MIGRATION.md`।

**সমস্যা:** `functions/api/mcp-tower/[[path]].ts` (Cloudflare) এবং `server.ts` (Express) — দুইޫটে একই MCP Tower লজিক।
**অ্যাকশন:**

- `functions/_lib/edgeHelpers.ts` → `src/shared/`-এ ম تاج (যদি সম্ভব)।
- `functions/api/mcp-tower/[[path]].ts` → `src/server/mcpRouter.ts`-এর লজিক ব্যবহার করে (`registerControlPlaneRoutes` এর মতো)।

### 9. VSCode এক্সটেনশন সিঙ্ক (P2)

**সমস্যা:** `packages/vscode-extension/package.json` — আলাদাเวอร์শন/লকফাইল।
**অ্যাকশন:**

- `scripts/sync-versions.mjs` এ VSCode এক্সটেনশনও যোগ করা আছে (প্যাটার্ন দেখতে পারে)।
- `git add packages/vscode-extension/package.json`
- `git commit -m "chore(vscode): sync version 2.5.0"`
- `git push origin arena/af2516f6-supremeai-public`

### 10. `admin/api-backup/` ফোল্ডারের সিদ্ধান্ত (P2)

**সম tangente:** `admin/api-backup/` — কি এটিhipi?
**অ্যাকশন:**

- `ls -la admin/api-backup/`
- যদি ডুপ্লিকেট/অলিগলি — ডিলিট বা `src/shared/` এ ম تاج।

---

## কাজ শুরু: P0.1 — `server.ts` ভেঙে `src/server/authRouter.ts` তৈরি

আমি এখন `src/server/authRouter.ts` তৈরি করব এবং `server.ts` থেকে лিন ³⁶⁰⁸-⁴²⁰⁰ কট করে পেস্ট করব।
