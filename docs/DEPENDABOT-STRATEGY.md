# Dependabot — কীভাবে "smarter" হলো (ও কেন)

**অবস্থা:** চালু · **মালিক:** CI/CD · **সংশ্লিষ্ট ফাইল:** `.github/dependabot.yml`, `.github/workflows/apply-dependabot-update.yml`

---

## ১. সমস্যাটা কী ছিল (প্রমাণসহ)

| লক্ষণ                         | প্রমাণ                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| একসাথে ২১টি Dependabot PR    | `open-pull-requests-limit: 5` ছিল, কিন্তু ecosystem ৪টি → মোট ২১                                                                            |
| **Huge jump merge হয়ে গেছে** | PR **#15**: `typescript 5.9.3 → 7.0.2` ✅ merged · PR **#14**: `@types/node 20.19.43 → 26.6.6` ✅ merged                                  |
| ফল: **version skew**         | `packages/vscode-extension` এখন TS **7.0.2** + `@types/node` **26**, অথচ root TS **5.3.3**, admin TS **5.9.3**, আর CI runtime **node 24** |
| প্রলোভন                       | সব check সবুজ (web + ext + CodeQL), তাই "merge করাই যায়" মনে হয়                                                                            |
| কিন্তু                         | `@types/node@26` মানে **Node 26-এর API-র টাইপ**, যা node 24 runtime-এ নেই → ভুল কোড compile হয়ে প্রোডাকশনে ভাঙতে পারে                       |

> অর্থাৎ Dependabot যা করছিল তা **ভুল ছিল না** — সে শুধু "নতুন ভার্সন আছে" জানে।
> "এই ভার্সনটি **আমাদের** ভাঙবে কি না" সেই বিচার তার কাজ নয়। সেটাই এখানে যোগ করা হলো।

---

## ২. ⚠️ সবচেয়ে গুরুত্বপূর্ণ আবিষ্কার — যা "সাধারণ ফিক্স" করলে বিপদ হতো

GitHub-এর অফিসিয়াল ডকুমেন্টেশন যাচাই করে পাওয়া গেল:

| অপশন                  | version update | **security update** |
| --------------------- | -------------- | ------------------- |
| `groups.update-types` | ✅ কাজ করে     | ❌ কাজ করে না       |
| `allow.update-types`  | ✅ কাজ করে     | ❌ কাজ করে না       |
| **`ignore:`**         | ✅ আটকায়       | ⚠️ **আটকায়ও**       |

👉 তাই সবচেয়ে স্বাভাবিক "ফিক্স" — `ignore: update-types: [semver-major]` — **করলে
কোনো নতুন CVE-র major প্যাচও আমাদের কাছে পৌঁছাত না**। এ কারণেই এখানে `ignore:`
**একেবারেই ব্যবহার করা হয়নি**; semver নিয়ন্ত্রণ হয়েছে `groups.update-types` +
`cooldown` দিয়ে, যেগুলো security path-কে স্পর্শ করে না।

---

## ৩. তিন স্তরের নিয়ন্ত্রণ

### স্তর ১ — `dependabot.yml`: LESS PR, BETTER TIMING

| ব্যবস্থা                       | মান                | কেন                                                                                                            |
| ---------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `cooldown.semver-major-days` | **৩০** (rust: ৪৫)  | major-এর বাস্তব প্রমাণ জমতে সময় লাগে                                                                             |
| `cooldown.semver-minor-days` | **১৪** (rust: ২১)  | ⚠️ GitHub default মাত্র **৩ দিন** — publish-then-yank ধরার জন্য কম                                               |
| `cooldown.semver-patch-days` | **৭**              | security update cooldown-মুক্ত, তাই ঝুঁকি নেই                                                                      |
| `groups`                     | ecosystem-aware    | `react`+`react-dom`+`@types/react`, `vite`+`vitest`+`@vitejs/*`, `typescript`+`@types/node` — কখনো আলাদা হয় না |
| `open-pull-requests-limit`   | ২–৬                | PR-bomb বন্ধ                                                                                                    |
| schedule timezone            | `Asia/Dhaka` ০৪:০০ | রাতের বেলা, সকালে review-ready                                                                                 |

**Critical:** `#14` ও `#15` আলাদা PR ছিল বলে skew হলো। এখন `typescript` + `@types/node`
একই group → হয় দুটোই আসে, নয় কোনোটাই।

### স্তর ২ — Workflow: RISK-TIERED DECISION

`.github/workflows/apply-dependabot-update.yml` প্রতিটি Dependabot PR-এ চলে:

```
patch  + non-high-risk + soak পাস   → auto-merge ✅
patch  + high-risk (react/vite/ts)   → মানুষ
minor                                 → মানুষ
major                                 → মানুষ + structured breaking-change রিপোর্ট
security (alert-state থাকে)           → soak বাদ, তবু high-risk নিয়ম মানে
```

**হার্ড গেট (একটিও ফেল করলে merge নেই):**

| #   | গেট                                     | কী ধরে                                                  |
| --- | --------------------------------------- | ------------------------------------------------------- |
| ১   | required checks                         | unified-pipeline + CodeQL সবুজ                           |
| ২   | `npm ci --dry-run`                      | lockfile ↔ manifest drift                               |
| ৩   | **runtime node ↔ `@types/node` parity** | `#14`-এর মতো skew — `@types/node` major ≤ runtime major |
| ৪   | cross-tree skew রিপোর্ট                  | root/admin/ext-এ `react`/`ts` major ছড়িয়ে যাওয়া         |
| ৫   | **release soak**                        | `npm view <pkg>@<ver> time` → কত দিন পুরোনো              |

**HIGH-RISK তালিকা** (patch-ও auto নয়): `react*`, `typescript`, `vite`, `vitest`,
`@vitejs/*`, `@vitest/*`, `next`, `eslint-config-next`, `tauri*`, `@tauri-apps/*`,
`webpack`, `esbuild`, `rollup`, `@babel/*`, `electron`, `prisma`, `undici`, `sharp`।

> কেন `vitest`-এর **patch**-ও auto নয়? কারণ `vite` ↔ `vitest` ↔ `@vitejs/plugin-react`
> একে অপরের peer dependency-তে pinned। একটি patch অন্যটির range ভাঙতে পারে —
> local-এ কাজ করে, CI-তে নাও করতে পারে।

### স্তর ৩ — אנשים যা দেখবেন

`flag-for-human` job একটি **structured কমেন্ট** দেয়: প্যাকেজ, from→to, ঝুঁকি স্তর,
কারণ, **কী দেখতে হবে** (migration guide / cross-tree / @types/node parity / transitive
major), এবং `risk:major` + `needs-human-review` লেবেল। কমেন্ট **ইডেম্পোটেন্ট**
(একই PR-এ দুবার লেখে না) — টিমের নোটিফিকেশন spam বন্ধ।

---

## ৪. যাচাই (লোকালে চালানো)

| যাচাই                                         | ফল                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `dependabot.yml` / workflow YAML parse        | ✅                                                                          |
| `dependabot/fetch-metadata` outputs (নাম-ধরে) | ✅ সব আউটপুট action.yml-এ বিদ্যমান                                            |
| auto-merge রেপোতে চালু?                        | ✅ `allow_auto_merge: true`                                                 |
| Node-parity গেট — বর্তমান রেপোতে               | ✅ **FAIL ধরে** (`vscode-ext` @types/node 26 > runtime) — অর্থাৎ `#14` আটকাত |
| classification matrix (১১টি কেস)              | ✅ patch/low-risk/soak → auto · major/high-risk/young → human               |
| security-aware শাখা                           | ✅ security patch soak বাদ দেয়, high-risk নিয়ম মানে                         |
| `npm run lint:structure`                      | ✅                                                                          |

> **সীমাবদ্ধতা (সৎভাবে):** workflow-টি প্রথমবার **আসল** Dependabot PR-এ চললেই
> `dependabot/fetch-metadata`-এর আচরণ চূড়ান্তভাবে প্রমাণিত হবে। লোকালে যা যাচাই
> করা যায়নি: `GITHUB_TOKEN`-এর approve-এ branch protection-এর প্রতিক্রিয়া।

---

## ৫. করণীয় (মানুষের হাতের কাজ)

1. **বর্তমান ১৪টি খোলা PR** — #47 (TS 5→7), #46 (`@types/express` 4→5), #45 (vitest 4→5),
   #41 (`@vitest/coverage-v8` 4→5), #39/#38/#37 (rust major) — এগুলো **major**, মানুষ দেখবেন।
   #43 (lucide-react 1.75→1.77), #42 (next patch), #44 (tailwind patch) — নিরাপদ।
2. **skew ঠিক করা** — `packages/vscode-extension`-এ TS `^7.0.2` → `^5.9.3` এবং
   `@types/node` `^26.6.6` → `^24` (runtime-এর সাথে) নামানো উচিত। এটা **ইচ্ছাকৃত** commit,
   Dependabot-এর কাজ নয় (সে কখনো নিচে নামায় না)।
3. **Branch protection**-এ `Dependabot — Intelligent Apply Gate / Classify + gate analysis`
   কে required check বানানো — নাহলে কেউ গেট বাইপাস করতে পারবে।
