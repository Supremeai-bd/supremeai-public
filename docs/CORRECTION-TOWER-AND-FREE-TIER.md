# সংশোধনী — Tower push সক্ষমতা ও Render free-tier গণিত

**তারিখ:** ২০২৬-১১-২৩
**পূর্ববর্তী ডকুমেন্ট:** `docs/MCP-TOWER-PUSH-CAPABILITY.md`, `docs/FREE-TIER-TEXTBOOK-STRATEGY.md`

আপনি দুটি নির্দিষ্ট দাবি দিয়ে আমার দুটি সিদ্ধান্ত চ্যালেঞ্জ করেছিলেন। **দুটোই যাচাই করেছি।
দুটোতেই আপনি ঠিক ছিলেন, আমি ভুল ছিলাম।** নিচে কোনটা রদ হচ্ছে, কেন, আর কী টিকে থাকছে —
আলাদা আলাদা করে লেখা আছে। আর যাচাই করতে গিয়ে একটা নতুন ঝুঁকি পেয়েছি, যেটা আমার আগের
ভুলের চেয়েও গুরুতর।

---

## ০. এক নজরে

| # | আমি যা বলেছিলাম | রায় | প্রমাণ |
| --- | --- | --- | --- |
| ১ | Tower-এ `push`/`merge_pr` নেই, "Tower কোড লিখতে পারে না" | ❌ **সম্পূর্ণ ভুল — রদ** | `integrations.tools.ts:49`, `:89`; `tools/index.ts:157` |
| ২ | Render free = ৭৫০ ঘণ্টা = ঠিক ১টি always-on সার্ভিস | ❌ **গণিতের ভিত্তি ভুল — রদ** | `account.registry.ts` (৭টি অ্যাকাউন্ট), `.env.example` (৭টি কী) |
| ৩ | Tower নিজের মনিটরিং দিয়ে peer-দের জাগিয়ে free tier খেয়ে ফেলছে | ❌ **প্রধান পথে ভুল — রদ** | `health/engine.ts` `getServiceHealth()` = Render API |
| ৪ | `total: 25 services` = Render-এ ২৫টি ইনস্ট্যান্স | ❌ **ভুল পড়া — রদ** | `/health` = provider checks, ইনস্ট্যান্স নয় |
| ৫ | Tower-এর write path-এ "কোনো গেট নেই, শুধু রোল" | ⚠️ **অসম্পূর্ণ — রদ** | governed wrapper আছে (`index.ts:129`); নেই শুধু HITL + allowlist |
| ৬ | constitution-এর ২৪/২৫ নিয়মে মানুষ লাগে, তাই L3 কখনো নয় | ✅ টিকে আছে | `rules.yml` |
| ৭ | golden eval: ১০০ কেস, থ্রেশহোল্ড ০.৯ | ✅ টিকে আছে | `evals/golden/suite.json` |
| ৮ | কভারেজ ৩১%, ভার্সন skew, দুই রেপোর drift | ✅ টিকে আছে | আগের মাপ |

**একটি বাক্যে:** Tower লেখার ক্ষমতা **আগেই আছে** (আমি ভুল বলেছিলাম নেই), Render-এর
বাজেট **per-account** (আমি ভুল ধরেছিলাম শেয়ার্ড), আর মনিটরিং **peer জাগায় না** (আমি ভুল
ধরেছিলাম জাগায়)। কিন্তু লিখতে পারে বলে **নতুন** প্রশ্ন উঠেছে: সেই ক্ষমতার উপর মানুষ-অনুমোদন
নেই — সেটাই এখন ১ নম্বর ঝুঁকি।

---

## ১. রদ — "Tower কোড লিখতে পারে না"

### আমি যা বলেছিলাম

> **সংক্ষিপ্ত উত্তর: না।** Tower-এ কোনো `git push` / branch / commit লেখার পথ নেই।
> … `push`, `merge_pr`, `git.*` — একটিও নেই। … **Tower কোনো কোড লিখতে পারে না।**

### আসল সত্য

আপনি যে ফাইল আর লাইন বলেছিলেন, ঠিক সেখানেই দুটো টুল আছে:

```
infrastructure/mcp-control-plane/src/tools/integrations.tools.ts:49   "github.push_file"
infrastructure/mcp-control-plane/src/tools/integrations.tools.ts:89   "github.merge_pr"
```

এবং দুটোই শুধু সংজ্ঞায়িত নয় — **সার্ভারে রেজিস্টার্ডও**:

```
src/tools/index.ts:49    import { registerIntegrationTools } from "./integrations.tools.js";
src/tools/index.ts:157   await registerIntegrationTools(server);
```

`github.push_file` সত্যিকারের লেখে:

```
PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}
body: { message, content: base64(content), branch?, sha? }
```

`github.merge_pr` সত্যিকারের merge করে:

```
PUT https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}/merge
body: { merge_method: "squash" | "merge" | "rebase" }
```

👉 **সরাসরি উত্তর: হ্যাঁ, Tower আপনার দ্বিতীয় রেপোতে push করতে পারে।** কোনো নতুন টুল
যোগ করার দরকার নেই — আগেই আছে। আগের ডকুমেন্টের "পথ A / পথ B" সুপারিশগুলো তাই ভিত্তিহীন;
সেগুলো বাতিল।

### আমি কেন ভুল করেছিলাম (পদ্ধতিগত ভুল, ক্ষমার যোগ্য নয়)

আমি `src/tools/` ডিরেক্টরিতে **৪৩টি** টুল ফাইল আছে জেনেও মাত্র **দুটি** ফাইল
(`github.tools.ts`, `adapters/github/index.ts`) grep করে সিদ্ধান্তে পৌঁছে গিয়েছিলাম।
`integrations.tools.ts` কখনো খোলা হয়নি। এরপর সেই আংশিক অনুসন্ধান থেকে একটা **সর্বজনীন
নেতিবাচক দাবি** ("একটিও নেই") লিখে ফেলেছিলাম — যেটা আংশিক প্রমাণ দিয়ে করা যায় না।

নিয়ম, এখন থেকে: কোনো "নেই" জাতীয় দাবি লেখার আগে পুরো ডিরেক্টরি তালিকা করে **প্রতিটি**
ফাইলে grep করতে হবে, এবং নেগেটিভ দাবির পাশে সবসময় স্কোপ লিখতে হবে ("৪৩টি ফাইলের মধ্যে
৪৩টিতেই নেই"), শুধু "নেই" নয়।

---

## ২. নতুন ফলাফল — Tower এখন সত্যিই লিখতে পারে, আর তার পাহারাদার কে?

টুলটা আছে জেনে প্রশ্ন বদলে যায়: **"পারে কি" নয় — "পারে, তাহলে থামায় কে?"**

এখানে আমার **প্রথম খসড়াটাও ভুল ছিল**, সেটাও বলে রাখি: আমি প্রথমে লিখেছিলাম "কোনো
approval গেট নেই, শুধু `agent` রোল" — কারণ আমি `integrations.tools.ts`-এর ভেতরের
`requireAgentOrAbove()` দেখে থেমে গিয়েছিলাম। কিন্তু আসলে প্রতিটি টুল-কল একটা
**কেন্দ্রীয় governed wrapper**-এর ভেতর দিয়ে যায় (`index.ts:193`-এ `server.tool`
override)। সেটাও পড়ার পর প্রকৃত ছবিটা এই:

### যা সত্যিই আছে (এবং ভালো)

`src/index.ts`-এ প্রতিটি handler মোড়া হয় `governedHandler`-এ, চারটি স্তরে:

1. **default-deny RBAC** — `toolAccessErrorAsync(sanitizedName)` (`index.ts:129`)
   → `policy/mcp-access.ts`; রোল + scope + live slot re-authorization, no-context
   হলে fail-closed।
2. **per-identity rate limit** (`#686 item 4`)
3. **পেলোড সাইজ ক্যাপ + validation**
4. **hard timeout** এবং **আউটপুট truncation**

👉 অর্থাৎ "কোনো গেট নেই" — **ভুল, প্রত্যাহার।** একটা শক্ত গেট আছে।

### যা সত্যিই অনুপস্থিত (এবং এটাই আসল ঝুঁকি)

**ক) কোনো human-approval নেই — শুধু রোল।** `classifyToolCapability`
(`mcp-access.ts:125`) প্রতিটি টুলকে একটি `approvalRequired` ফ্ল্যাগ দেয়, কিন্তু
ডিফল্ট fallback (`:276-283`):

```ts
return { name, kind: "tool", access: "restricted", requiredScope: undefined,
         riskLevel: "R2", dataClassification: "internal",
         approvalRequired: false };      // ← push_file, merge_pr — দুটোই এখানে
```

`approvalRequired` লেখা হয়, কিন্তু **টুল-কল পথের কোথাও পড়া হয় না** —
`index.ts`, `http_server.ts`, `actions/executor.ts` — তিনটিতেই grep ফাঁকা।
`globalHITLManager` ব্যবহার হয় শুধু `actions/executor.ts:64` (`system.execute`-এর
plan gate) আর `guardian.tools.ts:331`-এ। ফলে:

| পথ | approval? |
| --- | --- |
| `system.execute` → plan | ✅ HITL |
| `guardian` → merge_pr | ✅ HITL |
| **`github.merge_pr`** (আসল merge) | ❌ নেই |
| **`github.push_file`** (আসল লেখা) | ❌ নেই |

একই কাজের দুটো পথ, একটায় পাহারাদার আরেকটায় নেই — LLM যে পথটা বেছে নেবে সেটা সে-ই ঠিক করে।

**খ) রোল থ্রেশহোল্ড নিচু।** `capabilityDenial` (`:337`): শুধু
`dataClassification === "secret"` হলে `admin` লাগে, নাহলে `agent`। `push_file`/`merge_pr`
`internal` → **rank ১ (`agent`) যথেষ্ট**। আর ভেতরের `requireAgentOrAbove()`-ও একই থ্রেশহোল্ড।

**গ) কোনো রেপো allowlist নেই।** `integrations.tools.ts`-এ `SATELLITE_REPOS`,
`allowlist`, `allowedRepos` — একটিও নেই (grep ফাঁকা)। `owner`/`repo`/`path` সম্পূর্ণ
কলারের হাতে, আর `github.create_issue`-তে যে `repoAccessFor(role)` আছে, `push_file`-এ
সেই সমতুল্য কিছুই নেই। **Tower-এ রেপো-স্কোপিং আছে, কিন্তু লেখার পথটা সেটা এড়িয়ে যায়।**

**ঘ) ধ্বংসাত্মক কাজকে "নিরীহ" ঘোষণা।** দুই টুলেরই hint:
```ts
{ readOnlyHint: false, destructiveHint: false }
```
MCP ক্লায়েন্ট এই hint দেখে সতর্কতা দেখায় কি না ঠিক করে। ফাইল ওভাররাইট বা কোড merge
`destructiveHint: false` নয়।

### তাই সঠিক রায়

> Tower-এর write path **নেই** — এটা ভুল (রদ)। Tower-এর write path **সুরক্ষিত** —
> এটাও ভুল। সত্য হলো: **RBAC-সুরক্ষিত, কিন্তু human-approval-হীন, রেপো-allowlist-হীন,
> আর নিজেকে "non-destructive" বলে ঘোষণা করা।**

আপনার constitutions ২৫টির ২৪টিতেই মানুষের বিচার চায়, অথচ সবচেয়ে বেশি প্রভাব ফেলা
কাজটিতে মানুষের বিচার নেই। **L2/L3 অটোনমি নিয়ে ভাবার আগে এটা বন্ধ করতে হবে** — নাহলে
অটোনমি বাড়লে ভুলের গতি বাড়বে, ঠিক করার ক্ষমতা নয়।

### ঠিক করার সর্বনিম্ন কাজ (সব উপাদান আপনার কোডবেসে আছে)

| # | কাজ | কীভাবে |
| --- | --- | --- |
| ১ | `github_push_file` / `github_merge_pr`-কে `classifyToolCapability`-তে explicit করুন | `dataClassification: "secret"` বা `approvalRequired: true` + নতুন `write-critical` ক্লাস |
| ২ | `approvalRequired` ফ্ল্যাগটা **আসলেই পড়ুন** | `governedHandler`-এর ১ নম্বর স্তরে; true হলে `globalHITLManager.requestApproval` |
| ৩ | রেপো allowlist | `SATELLITE_REPOS` পাস করা; বাইরের `owner/repo` = প্রত্যাখ্যান |
| ৪ | hint সঠিক করুন | `destructiveHint: true` দুই টুলেই |
| ৫ | branch সীমা | `main`-এ সরাসরি push নয়; শুধু `arena/*`, `bot/*` |
| ৬ | টেস্ট | `agent` রোল দিয়ে `github_push_file` → `main` — অবশ্যই denied হবে |

---

## ৩. রদ — Render free-tier গণিত ("৭৫০ ঘণ্টা = ১টি always-on")

### আমি যা বলেছিলাম

> Free instance hours **৭৫০ / মাস / workspace (শেয়ার্ড)** → always-on সম্ভব **১টি** →
> বাস্তব ৩ সার্ভিস × ৭৩০ = **২,১৯০ ঘণ্টা = বাজেটের ২.৯ গুণ** → ২৫ সার্ভিস হলে **২৪ গুণ**।

### আসল সত্য — আপনি ঠিক ছিলেন, per-service অ্যাকাউন্ট ডিজাইনটা বাস্তবে আছে

`infrastructure/mcp-control-plane/src/registry/account.registry.ts` সত্যিই আছে, এবং
**৭টি Render অ্যাকাউন্ট** সংজ্ঞায়িত:

| অ্যাকাউন্ট id | কী (env var) | ভূমিকা |
| --- | --- | --- |
| `render-primary` | `RENDER_API_KEY_1` (+ `RENDER_API_KEY`, `RENDER_API_TOKEN`, `RENDER_API_KEY_PAYKARI`) | core-api |
| `render-worker` | `RENDER_API_KEY_2` | async tasks |
| `render-scraper` | `RENDER_API_KEY_3` | scraper |
| `render-mcp` | `RENDER_API_PAYKARI` (+ `RENDER_API_KEY_PAYKARI`) | control tower |
| `render-api` | `RENDER_API_KEY_5` (+ `RENDER_API_KEY_API`) | api |
| `render-brain` | `RENDER_API_KEY_6` | brain |
| `render-ci-runner` | `RENDER_API_KEY_7` | ci runner |

`.env.example`-এও ঠিক ৭টি স্লট: `RENDER_API_KEY_1` … `RENDER_API_KEY_7`।
আর `render.tools.ts` সত্যিই অ্যাকাউন্ট-প্যারামিটারাইজড:

```
accountId: z.string().describe("The account ID (e.g. render-primary)")
→ resolveRenderApiKey(accountId)  // adapters/render/index.ts:78
→ apiKeyRef, তারপর apiKeyRefs চেইন
```

**সুতরাং ৭৫০ ঘণ্টার পুলটা per-workspace, global নয়।** আমার "২.৯×" আর "২৪×" —
দুটোই একটাই ভুল অনুমান থেকে এসেছে (সব সার্ভিস এক পুলে)। **দুটোই রদ।**

### যেটা এখনো অপ্রমাণিত — এবং যেটা আমি প্রমাণ করতে পারি না

রেপো থেকে বোঝা যায় **৭টি আলাদা কী আছে**। কিন্তু **৭টি আলাদা workspace** — সেটা
রেপোতে লেখা নেই; এটা আপনার অ্যাকাউন্টের তথ্য, কোডের নয়। আলাদা কী একই workspace-এও
সঠিক বাক্যটি হলো:

> বাজেট **per workspace**। কয়টি workspace, তা রেপো বলতে পারে না — শুধু আপনি বলতে পারেন।

### যা টিকে থাকছে (এবং এগুলো আসল ঝুঁকি)

**১) `available: true` মানে "কাজ করছে" নয়।** `account.registry.ts:124-127`:

```ts
const hasAnyRenderKey =
  isAvailable("RENDER_API_KEY") ||
  isAvailable("RENDER_API_TOKEN") ||
  isAvailable("RENDER_API_KEY_PAYKARI");
```

আর প্রতিটি অ্যাকাউন্টের `available:` শুরু হয় `isAvailable("RENDER_API_KEY_N") || hasAnyRenderKey || …` দিয়ে।
অর্থাৎ **কোনো একটি** Render কী থাকলেই সাতটি অ্যাকাউন্টই `available: true` দেখাবে, যদিও
ছয়টি অ্যাকাউন্টের নিজের কী সেটই করা হয়নি। ড্যাশবোর্ডে "৭টি অ্যাকাউন্ট সুস্থ" দেখে
সাতটি সত্যিই আছে ভেবে নেওয়া যাবে না।

**২) এক কী দিয়ে সাত workspace চালানো যায় না — আর স্টুডিও ঠিক সেটাই করার চেষ্টা করে।**
`src/server/routes/mcpTowerRoutes.ts:211-230` (reboot-all):

```ts
const renderApiKey = process.env.RENDER_API_KEY?.trim();   // একটি মাত্র কী
const serviceMap = [
  { name: 'supremeai-api',            envVar: 'RENDER_SERVICE_ID_API' },
  { name: 'supremeai-mcp-tower',      envVar: 'RENDER_SERVICE_ID_MCP' },
  { name: 'supremeai-browser',        envVar: 'RENDER_SERVICE_ID_BROWSER' },
];
// একই renderApiKey দিয়ে তিনটিকেই POST /v1/services/{id}/restart
```

যদি এই তিনটি সার্ভিস তিনটি আলাদা workspace-এ থাকে, তাহলে একটি কী দিয়ে তিনটির মধ্যে
**সর্বোচ্চ একটি** restart সফল হবে; বাকি দুটি 401/403 ফিরবে। Tower-এর নিজের অ্যাকাউন্ট
(`render-mcp`) ব্যবহার করছে `RENDER_API_PAYKARI` — অর্থাৎ Tower নিজেই জানে অ্যাকাউন্ট আলাদা,
কিন্তু স্টুডিওর reboot-all তা জানে না।

👉 **একটি কলেই পরীক্ষা করা যায়:** reboot-all চালিয়ে `actions[]` অ্যারেতে কতগুলো `ok:true`
আসে দেখুন। তিনটির কম হলে ধরে নিন workspace আলাদা, এবং reboot-all-কে
`accounts → resolveRenderApiKey(accountId)` পথে সরাতে হবে।

**৩) ৪র্থ অ্যাকাউন্টের নাম mismatch।** `render-mcp`-এর `apiKeyRef` হলো `RENDER_API_PAYKARI`
(KEY নেই), অথচ `apiKeyRefs`-এ `RENDER_API_KEY_PAYKARI` (KEY আছে), আর `.env.example`-এ
শুধু `RENDER_API_KEY_4` আছে — যা `apiKeyRef`-এ কোথাও ব্যবহৃত হয় না। ছোট জিনিস, কিন্তু
`.env.example` দেখে কেউ ৪ নম্বর অ্যাকাউন্ট কনফিগ করলে সেটা কাজ করবে না।

---

## ৪. রদ — "মনিটরিং নিজেই free tier খেয়ে ফেলছে"

### আমি যা বলেছিলাম

> Tower প্রতি ৮ মিনিটে sweep চালায়, Render-এর idle threshold ১৫ মিনিট → Tower যাকে probe
> করে তাকে জাগিয়ে তোলে → ৩ সার্ভিস জাগে → ২.৯ গুণ বাজেট।

### আসল সত্য

`health/engine.ts`-এর `render` চেকের **প্রধান পথ** হলো Render-এর নিজের API:

```ts
const identity = resolveServiceIdentity("core");
data = await getServiceHealth(identity.accountId, identity.serviceId);
```

`getServiceHealth` → `GET https://api.render.com/v1/services/{id}` — এটি Render-এর
কন্ট্রোল প্লেন। **কোনো sleeping web service-কে HTTP দিয়ে জাগায় না।** ফলে sweep চললেও
peer-রা ঘুমিয়ে থাকে; শুধু Tower নিজে জাগে।

`http_probe_fallback` (যেটা আমি ধরেছিলাম) চলে **শুধু** তখন, যখন Render API কী অনুপস্থিত:

```ts
if ((errMsg.includes("Missing Render API Key") || ...) && identity.runtimeUrl) {
  const res = await httpRequest(`${runtimeUrl}${healthPath}`, ...);  // এটাই জাগায়
  return { status: ..., mode: "http_probe_fallback" };
}
```

👉 তাই "Tower নিজের মনিটরিং দিয়ে নিজের বাজেট খাচ্ছে" — **প্রধান ডিজাইনে ভুল, রদ।**
যেটা টিকে থাকে তা অনেক সংকীর্ণ: **যদি Render কী অনুপস্থিত থাকে আর `runtimeUrl` সেট থাকে,
তাহলে ফলব্যাক HTTP probe ঘুমন্ত সার্ভিস জাগাবে।** এটা কনফিগ-ব্যর্থতার পথ, নকশা নয়।

আর ৮ মিনিট sweep নিজে থেকেই ঠিক আছে: ৮ < ১৫, অর্থাৎ Tower ঘুমাবে না — এটা **কাঙ্ক্ষিত**।

---

## ৫. রদ — `total: 25 services`

আপনি ঠিক বলেছেন। `/health`-এর `services.total` আসে এখান থেকে:

```ts
const snapshots = globalHealthCache.getAllSnapshots();
const services = Object.entries(snapshots).map(([provider, s]) => ({ provider, status: s.status }));
// services: { healthy, degraded, total: services.length }
```

আর snapshot ভরে `runFullSweep()`-এর `checks` রেকর্ড থেকে, যেখানে আছে:
`render`, `github`, `supabase`, `redis`, `cloudflare`, `infisical`, `stripe`, `vercel`,
`firecrawl`, `kaggle`, `qdrant`, `telegram`, এবং গতিশীল `ai-<provider>`।

👉 এগুলো **integration/provider স্বাস্থ্য** — Render ইনস্ট্যান্সের সংখ্যা নয়। "২৫টি সার্ভিস
Render-এ চালাতে হবে" — এটা আমার ভুল পড়া, **রদ**। (`render.yaml`-এ ৩টি `plan: free` — সেই
সংখ্যাটাই সার্ভিস-সংখ্যার একমাত্র প্রমাণ, এবং সেটা ২৫ নয়।)

---

## ৬. আগের ডকুমেন্টের কোন অংশ এখন বদলায়

`FREE-TIER-TEXTBOOK-STRATEGY.md`-এ নিচের লাইনগুলো **এই ডকুমেন্ট দ্বারা প্রতিস্থাপিত**:

| আগের অবস্থান | ছিল | এখন |
| --- | --- | --- |
| §০ আবিষ্কার ১ (সম্পূর্ণ) | "২৫ সার্ভিসের মধ্যে ১টি চলে" | **বাতিল** — §৩, §৫ দেখুন |
| §৬ সিদ্ধান্ত ১ | "Render free = ঠিক ১টি always-on" | **প্রত্যাহার** → "প্রতি workspace-এ ১টি always-on; Tower নিজের workspace-এ থাকবে" |
| §৬ সিদ্ধান্ত ৪ (কারণ) | কারণ = constitution-এ মানুষ লাগে | **কারণ যোগ** — `push_file`/`merge_pr`-এ কোনো approval নেই (§২) |
| §৫ সপ্তাহ ১–২ "peer-probe বন্ধ" | cost কমানোর কাজ | **বাতিল** → বদলে "HITL + allowlist + destructiveHint" (§২) |
| §০ স্কোরকার্ড "খরচ" সারি | ❌ ২.৯× Render | **⚠️ অপ্রমাণিত** — §৩ |
| §৭ সীমাবদ্ধতা | — | **যোগ:** §২ = সবচেয়ে গুরুতর নতুন ঝুঁকি, আর আগে আমি সেটা দেখিইনি |

`MCP-TOWER-PUSH-CAPABILITY.md`-এর §১, §২ ও §৩ (যেখানে "পারে না", "একটিও নেই",
"কোড লিখতে পারে না") **সম্পূর্ণ বাতিল**। ওই ফাইলের উপরের দিকে বাতিল-নোটিশ বসানো হয়েছে।

### যা অপরিবর্তিত টিকে আছে

- Actions-এর হিসাব: public রেপোতে **আনলিমিটেড**, private হলে ২,০০০ মিনিট → তাহলে ২.৪×
  (রেপো public থাকলে এই সীমাটাই প্রযোজ্য নয়, তাই সিদ্ধান্ত ৩ বহাল)।
- constitution: ২৫ নিয়ম, `fixable: true` মাত্র **১**টি, আর সেই ফ্ল্যাগ পড়ে এমন কোনো
  ইঞ্জিন নেই।
- golden eval: ১০০ কেস, থ্রেশহোল্ড ০.৯, সাপ্তাহিক।
- কভারেজ ৩১% (লক্ষ্য ৬০%), ভার্সন skew (vscode-ext TS `^7.0.2`, `@types/node` `^26.6.6`),
  দুই রেপোর drift (`SECURITY.md` নেই, roster guard ১০৮ বনাম ০)।
- ১২-লাইনের "textbook" সংজ্ঞা এবং L0→L2 সিঁড়ি (L3 কখনো নয়) — অপরিবর্তিত।

---

## ৭. সৎ নোট — আমার ভুলের ধরন

তিনটির মধ্যে তিনটে প্রধান সিদ্ধান্তই ভুল হয়েছিল, আর **একই কারণে**: স্থানীয় নমুনা দেখে
সর্বজনীন সিদ্ধান্ত টানা।

| কী দেখেছিলাম | কী অনুমান করেছি | আসল |
| --- | --- | --- |
| ২টি টুল ফাইল | "৪৩টিতেও নেই" | `integrations.tools.ts`-এ আছে |
| `render.yaml`-এ ৩টি সার্ভিস | "সব এক workspace-এ" | ৭টি কী, per-account ডিজাইন |
| sweep-এর কোডে HTTP probe | "এটাই প্রধান পথ" | সেটা ফলব্যাক; প্রধান পথ Render API |

আপনি প্রতিবারই নির্দিষ্ট ফাইল ও লাইন দিয়ে ধরিয়ে দিয়েছেন — সেটাই কাজে লেগেছে।
আমার উচিত ছিল দাবি লেখার আগে নিজেই সেটা করা।

**যা আমি বদলাচ্ছি:** এই ডকুমেন্টের প্রতিটি নেতিবাচক দাবির পাশে এখন স্কোপ আর ফাইল-তালিকা
আছে, আর কোনো সিদ্ধান্ত চূড়ান্ত করার আগে পুরো ডিরেক্টরি enumerate করা হয়েছে (§১-এর নিয়ম)।
