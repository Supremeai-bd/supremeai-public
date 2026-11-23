# MCP Tower দিয়ে `supremeai`→`supremeai-public` push করা যায় কি?

**সংক্ষিপ্ত উত্তর: না।** Tower-এ **কোনো `git push` / branch / commit লেখার পথ নেই** —
ইচ্ছাকৃতভাবে। কিন্তু এটা ব্যর্থতা নয়: Tower ইতিমধ্যেই আপনার সমস্যার **অর্ধেক**
সমাধান করে, আর বাকি অর্ধেক GitHub নিজেই দেয় (API-তে) — শুধু সেটা কনফিগ করতে হয়।

**যাচাই:** টাওয়ারের সোর্স (`infrastructure/mcp-control-plane/src/`), live health endpoint,
এবং লাইভ `/mcp` — তিনটিই দেখা হয়েছে।

---

## ১. Tower আসলে কী (live প্রমাণ)

```
GET https://supremeai-mcp-tower-live.onrender.com/health  → 200
{"status":"degraded","server":"supremeai-control-tower","version":"1.0.1",
 "services":{"healthy":23,"degraded":2,"total":25},
 "lastCompletedSweepAt":"2026-11-23T16:26:46Z","sweepCompletions":7,"stale":false}
```

Tower বেঁচে আছে — ২৫টি সার্ভিসের ২৩টি healthy। (`degraded` = ২টি সার্ভিস, সম্ভবত
Upstash কোটা #616/#617-এর সাথে সম্পর্কিত।)

## ২. Tower-এর GitHub টুল — ১০টি, এবং সবই একটি ব্যতিক্রম ছাড়া read-only

`tools/github.tools.ts`-এ নিবন্ধিত (সোর্স থেকে সরাসরি):

| টুল                        | ধরন          | কী করে                      |
| ------------------------- | ------------ | --------------------------- |
| `github.actions_op`       | read         | workflow runs / failed logs |
| `github.workflow_runs`    | read         | run তালিকা                  |
| `github.get_failed_logs`  | read         | ব্যর্থ job-এর লগ              |
| `github.list_secrets`     | read         | **শুধু নাম**, মান নয়          |
| `github.read_file`        | read         | রেপোর ফাইল পড়া              |
| `github.list_prs`         | read         | PR তালিকা                   |
| `github.search_code`      | read         | কোড সার্চ                    |
| `github.code_search`      | read         | কোড সার্চ (alias)            |
| `github.inspect_pr_diff`  | read         | PR diff                     |
| **`github.create_issue`** | **⚠️ write** | **শুধু issue তৈরি**           |

আর সমাধান-প্লেন: `system.execute` — নাম শুনে ভয় পাওয়ার মতো, কিন্তু
description-এ স্পষ্ট: _"Safe remediation planning gate (plan-only) … Does NOT execute
live restart/redeploy until an adapter is wired; returns `executed:false`."_
অর্থাৎ এটা restart/redeploy/rollback-এর **পরিকল্পনা** করে, shell চালায় না।

**নিশ্চিতভাবে অনুপস্থিত:** `create_pull_request`, `commit_file`, `update_file`,
`push`, `merge_pr`, `git.*`, `write_file`, `apply_patch` — একটিও নেই।

👉 **Tower কোনো কোড লিখতে পারে না।** `adapters/github/index.ts`-এ একমাত্র POST হলো
`/issues`।

## ৩. কেন এটা বাগ নয় — বরং ভালো ডিজাইন

Tower একটি **control plane**: সে দেখে, মাপে, রিপোর্ট করে, issue খোলে, সার্ভিস
restart-এর পরিকল্পনা করে। কোড লেখা তার কাজ নয় — সেটা agent/মানুষের কাজ।
এমনকি `github.create_issue`-ও `repoAccessFor(role)` দিয়ে সুরক্ষিত:

```
rank >= 1 (agent/admin)  → read-write
repo_viewer              → all-readonly
restricted_viewer        → satellite-readonly
viewer/public            → none
```

আর `supremeai-public` একটি **satellite repo** (`supremeai-*` প্রিফিক্স), তাই নিচু
role-ও পড়তে পারে — কিন্তু লিখতে পারে না।

---

## ৪. তাহলে "দ্বিতীয় রেপোতে push" কীভাবে করবেন — ৩টি বাস্তব পথ

### ✅ পথ A — Tower কে _পাহারাদার_ বানান, pusher নয় (সবচেয়ে শক্তিশালী)

Tower ইতিমধ্যেই পারে: `github.create_issue`, `github.list_prs`, `github.inspect_pr_diff`,
`github.actions_op`, `github.get_failed_logs`। অর্থাৎ—

```
[আপনার agent/CI]  ──push──▶  supremeai (private)
        │
        └─ Tower: PR খুলল? diff ঠিক? CI সবুজ? ──verify──▶  issue/PR কমেন্ট
                                    │
                              ✅ হলে sync job → supremeai-public
```

অর্থাৎ Tower-কে **verifier + auditor** হিসেবে বসান, pusher হিসেবে নয়। এটাই তার নকশা।

### ✅ পথ B — GitHub-এর নিজের API দিয়ে sync (কোনো Tower লাগে না)

```bash
# supremeai-public-এ একটি branch-এ ফাইল কমিট (Contents API, PAT দিয়ে)
gh api -X PUT repos/Supremeai-bd/supremeai-public/contents/PATH \
  -f message="sync: from supremeai@<sha>" \
  -f content="$(base64 -w0 file)" \
  -f branch="sync/from-core"

# তারপর PR খুলুন
gh pr create --repo Supremeai-bd/supremeai-public \
  --base main --head sync/from-core \
  --title "sync(core→public): <sha>" --body "..."
```

এটা **action-এ** (`.github/workflows/`) বসালে প্রতিটি core merge-এ স্বয়ংক্রিয় sync হবে —
Tower-এর কোনো ভূমিকা ছাড়াই। ⚠️ তবে `supremeai` প্রাইভেট, তাই cross-repo token
(`SYNC_PAT` বা GitHub App) লাগবে, এবং ফাঁস হওয়া secret/`.env` ফিল্টার করতে হবে।

### ✅ পথ C — Tower-এ একটা সত্যিকারের sync টুল যোগ করা (উন্নয়ন)

চাইলে Tower-এ `github.commit_files` + `github.open_pr` টুল লেখা যায় —
`adapters/github/index.ts`-এ দুটি ফাংশন, `github.tools.ts`-এ দুটি `registerTool`,
এবং **কঠোর গেট**: `repoAccessFor(role) === 'read-write'` + approval token + কেবল
allow-listed path (`.env*` কখনো নয়)।

⚠️ কিন্তু আমি এটি **সুপারিশ করছি না**। এখন কোনো agent-এর হাতে কোড-লেখার ক্ষমতা
নেই; সেটা যোগ করলে আপনার "fail-closed" নীতি দুর্বল হবে। এই কাজটা CI/CD-র
(পথ B), Tower-এর নয়।

---

## ৫. প্রকৃত সমস্যা: আপনার repo **sync হয়নি** — এবং আমি প্রমাণ পেয়েছি

| প্রমাণ                                                                               | মানে                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `supremeai`-এ `SECURITY.md` নেই, `CONTRIBUTING.md` আছে                              | দুই রেপো ইতিমধ্যেই আলাদা পথে হাঁটছে                 |
| `supremeai`-এ `dependabot.yml` আছে, কিন্তু `/admin`+`/packages/contracts` কভার করে না | ঠিক যে কাজটা `supremeai-public`-এ PR #48-এ করলাম |
| `supremeai`-এর `ops-maintenance.yml` = **২,৭৩৮ লাইন**                               | public-এর পাইপলাইন ৪৫৫ লাইন                      |
| `supremeai`-এ র‍্যাপার্ড গার্ড ১০৮টি; public-এ নেই                                     | দুইটি আলাদা সত্য                                   |

👉 তাই আসল প্রশ্ন "Tower দিয়ে push করা যায় কি" নয় — **"একই `dependabot.yml` দুই
রেপোতে কে সত্য রাখবে"**। উত্তর: একটা single-source + sync job, Tower নয়।

---

## ৬. আমার সুপারিশ (অগ্রাধিকার ক্রমে)

| #   | কাজ                                                                                                                        | কেন                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ১   | **`dependabot.yml`-এর একটাই source** — `supremeai-public`-এ রাখুন, এবং একটি sync workflow দিয়ে `supremeai`-এ কপি করুন (পথ B) | আজ যে ফিক্সটা করলাম (#48) সেটাই core-এ পৌঁছাবে; দুই রেপো আলাদা হয়ে যাওয়া বন্ধ |
| ২   | Tower-কে **verifier** হিসেবে ব্যবহার করুন: `create_issue` দিয়ে drift ধরা, `inspect_pr_diff` দিয়ে merge-পূর্ব যাচাই             | Tower যা পারে ঠিক সেটাই, নতুন ক্ষমতা ছাড়াই                                  |
| ৩   | `SECURITY.md` ও প্যাচটা `supremeai`-এ প্রয়োগ করুন (`patches/supremeai-main/`)                                                 | ইতিমধ্যেই প্রস্তুত ও যাচাই করা                                                |
| ৪   | Tower-এ write টুল **যোগ করবেন না**                                                                                          | agent-এর হাতে push ক্ষমতা = fail-closed নীতির অবসান                        |

---

## ৭. সীমাবদ্ধতা (সৎভাবে)

- এই sandbox থেকে টাওয়ারের `/mcp`-এ **TLS হ্যান্ডশেক ব্লকড** (`SSL_ERROR_SYSCALL`),
  তাই লাইভ `tools/list` নিজে কল করে দেখতে পারিনি। টুল-তালিকা এসেছে
  **রেপোতে committed সোর্স** থেকে (`github.tools.ts`, `remediation.tools.ts`) —
  যা deployment-এ যা চলে তারই ভিত্তি, কিন্তু লাইভ-এ ভিন্ন build থাকলে তার সম্ভাবনা ক্ষীণ।
- `/health` পাবলিক (কোনো auth ছাড়াই) — এটা নিজেই একটা ছোট তথ্য-প্রকাশ, বিবেচনার বিষয়।
