# SupremeAI Public — `supremeai-public` (ফ্রন্টএন্ড) কাজ তালিকা

**ক্যাটাগরি:** P0 (অফুরন্ত), P1 (অফুরন্ত), P2 (পরের)
**ব্রাঞ্চ:** `arena/af2516f6-supremeai-public`
**রেপো:** `Supremeai-bd/supremeai-public`

---

## 🔴 P0 —今天是 2026-11-20 — 今天立刻开始

### 1. `server.ts`eleaf-monolith ভেঙে রাউটার মডিউলে ভাগ করা (১১,৭২৫ লাইন, ১৪১ রুট)

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

### 2.ভার্সন সিঙ্ক (P0)

**সমস্যা:** `package.json` = 2.5.0, Release = `v0.1.0`, `version.json` = 2.5.0, `Cargo.toml` = 2.5.0, `tauri.conf.json` = 2.5.0 — Release-এ ম্যাচ নেই।
**অ্যাকশন:**

- `npm run sync:version` (বা `node scripts/sync-versions.mjs`)
- `git add package.json version.json src-tauri/Cargo.toml src-tauri/tauri.conf.json packages/vscode-extension/package.json`
- `git commit -m "chore(version): sync 2.5.0 across Web/Desktop/Android/VSIX/version.json"`
- `git push origin arena/af2516f6-supremeai-public`

### 3. লাইসেন্স যোগ (P0)

**সমস্যা:** ফ্রন্টএন্ডে লাইসেন্স ফাইল নেই (ব্যাকএন্ডে MIT আছে)।
**অ্যাকশন:**

- `LICENSE` (MIT) তৈরি (ব্যাকএন্ড থেকে কপি)
- `git add LICENSE`
- `git commit -m "docs(license): add MIT license matching backend"`
- `git push origin arena/af2516f6-supremeai-public`

---

## 🟡 P1 — দ্রুত

### 4. দুই Admin এক করা (P1)

**সমস্যা:** `src/components/admin/` (৩৬ ভিউ) বনাম `admin/` (আলাদা Next.js অ্যাপ)।
**অ্যাকশন:**

- `admin/` অ্যাপটি `src/components/admin/`-এর সাথে ম تاج (বা বিপরীত) করা।
- `admin/src/lib/mcp-client.ts` (১৮৯ লাইন) → `src/server/mcpRouter.ts` বা `src/shared/`-এ ম تاج।
- `admin/src/lib/admin-security.ts` (৫৮ লাইন) → `src/shared/serverSecurity.ts`-এর সাথে ম تاج।
- `admin/src/app/page.tsx` → `src/components/admin/AdminOverviewView.tsx`-এর সাথে ম تاج।
- `admin/` ফোল্ডারের অলিগলি বা ডুপ্লিকেট কোড ডিলিট করে `src/components/admin/`-কে ক্যানোনিকাল ঘোষণা করা।

### 5. টেস্ট ক ነገ (P1)

**সমস্যা:** ১,০৯,০০০ লাইনের বিপরীতে মাত্র ~৩০টি টেস্ট ফাইল।
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

### 6. Tauri CSP শক্ত করা (P1)

**সমস্যা:** `src-tauri/tauri.conf.json`-এ `unsafe-inline` + `unsafe-eval`।
**অ্যাকশন:**

- CSP থেকে `unsafe-inline` / `unsafe-eval` কট করে nonce/hash-এ নিয়ে আসা (যদি সম্ভব)।
- `git add src-tauri/tauri.conf.json`
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
