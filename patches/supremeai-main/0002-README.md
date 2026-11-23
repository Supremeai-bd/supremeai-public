# 0002 — MCP Tower HITL গেট + CI wiring

**তারিখ:** ২০২৬-১১-২৩ · **ফাইল:** `patches/supremeai-main/0002-mcp-hitl-approval-gate-and-ci-wiring.patch`

## কেন এই প্যাচ

PR #757 (`git log`: `fix(mcp): harden github.push_file & github.merge_pr`) তিনটে গুরুত্বপূর্ণ জিনিস
ঠিক করেছিল — repo allowlist, protected-branch guard, আর `destructiveHint: true`। কিন্তু
**মানব-অনুমোদনের (HITL) ধাপটা তখনো ছিল না**। ফলে `agent` রোলের কোনো কলার
`github.push_file` দিয়ে `agent/*` ব্রাঞ্চে লিখে `github.merge_pr` দিয়ে PR merge করে ফেলতে পারত —
কোনো মানুষ না জেনেই।

এই প্যাচ সেটাই বন্ধ করে, এবং সাথে দুটো ছোট কিন্তু বাস্তব ফাঁক।

## প্যাচে কী আছে (৪ ফাইল, +১৮৮ −৩)

| ফাইল | পরিবর্তন |
| --- | --- |
| `infrastructure/mcp-control-plane/src/tools/integrations.tools.ts` | `requestWriteApproval()` + `assertApproved()` যোগ; দুই টুলে গেট |
| `infrastructure/mcp-control-plane/test_github_guards.ts` | HITL-এর ৮টি নতুন assertion |
| `.github/workflows/unified-pipeline.yml` | `npm run test:github-guards` যোগ |
| `AGENTS.md` | পুরনো/ভুল `github.actor` দাবি ঠিক করা |

## ১. HITL গেট — আসল ফাঁক

`admin`-এর নিচের প্রতিটি রোল এখন দুটি ধাপে কাজ করে:

```
১ম কল  →  approval request তৈরি (REQ-xxxx), কিছুই লেখা হয় না
          রেসপন্স: { action: "HITL_APPROVAL_REQUIRED", requestId, approvalRisk }
অনুমোদন →  admin `policy.approve` দিয়ে APPROVED করেন
২য় কল  →  approvalRequestId সহ আবার কল → আসল কাজ হয়
```

`admin`/`supremeadmin` (rank ≥ 2) ছাড়প্রাপ্ত — তারাই অনুমোদনকারী, তাই দ্বিগুণ বাধা নেই।
এটা `guardian.tools.ts:331`-এর বিদ্যমান প্যাটার্নই অনুসরণ করে; নতুন কোনো রীতিনীতি বানানো হয়নি।

`assertApproved()` **fail-closed** — চারটে ক্ষেত্রেই ব্যর্থ:

| অবস্থা | ফলাফল |
| --- | --- |
| `approvalRequestId` নেই | ❌ `requires human approval (HITL)` |
| অজানা/জাল ID | ❌ `not found or expired` |
| এখনো `PENDING` | ❌ `is PENDING, not APPROVED` |
| `REJECTED` | ❌ `is REJECTED, not APPROVED` |

## ২. `test:github-guards` CI-তে যোগ

#757-এর সাথে টেস্ট ফাইলটা এসেছিল, `package.json`-এ script-ও ছিল — কিন্তু
`unified-pipeline.yml`-এ **কোনো workflow সেটা চালাত না**। মানে গার্ড ভাঙলেও CI সবুজ দেখাত।
এখন `syntax-and-governance-gate` জবে চলে।

## ৩. `AGENTS.md` সংশোধন

পুরনো লেখা: *"সার্কুলার লুপ প্রতিরোধে বটের তৈরি PR-এ এই অটোমেশন নিষ্ক্রিয় থাকবে।"*

কিন্তু `62a3dee`-তে `github.actor != 'github-actions[bot]'` শর্তটা **সরিয়ে ফেলা হয়েছে**।
তাই ডকুমেন্টেশন কোডের সাথে মিথ্যা বলছিল। নতুন লেখায় আসল invariance:
লুপ বন্ধ হয় **merge শেষে প্যাচ ফাইল মুছে ফেলার কারণে**, এবং একই ব্রাঞ্চ-নামে force-push হওয়ার
অবশিষ্ট ঝুঁকিটাও স্পষ্ট করে বলা হয়েছে।

## ✅ যা যাচাই করা হয়েছে (অনুমান নয়)

| যাচাই | ফলাফল |
| --- | --- |
| `npx tsc --noEmit` | **০ এরর** |
| `npm run test:github-guards` | **সব পাস** (আগের গার্ড টেস্ট + ৮ নতুন HITL assertion) |
| workflow YAML parse | ✅ ২৪ job; টেস্ট সঠিক জবে wired |
| `git apply --check` against main | ✅ **পরিষ্কারভাবে apply হয়** |

টেস্ট চালাতে গিয়ে **দুটো আসল বাগ** ধরা পড়েছিল এবং ঠিক করা হয়েছে:
১. `requestWriteApproval` async — প্রথম খসড়ায় `await` ছাড়া ডাকা হয়েছিল
২. HITL লিংক সাইনে `MCP_ADMIN_KEY` লাগে (`signing.ts:32`) — টেস্টে এখন সেট করা হয়

## কেন প্যাচ হিসেবে, সরাসরি commit নয়

এই সেশনের টোকেন main রেপোতে (`Supremeai-bd/supremeai`) **লিখতে পারে না** — যাচাই করা হয়েছে:

```
POST /repos/Supremeai-bd/supremeai/git/refs
→ 403 Resource not accessible by integration
```

(public রেপোতে একই কল সফল হয়, তাই ওখানে টুলটা ব্যবহার করা গেছে।)

তাই দুটো পথ খোলা:

**পথ A — লোকালে apply করে PR:**
```bash
cd /path/to/supremeai && git checkout -b fix/mcp-hitl-gate
git apply /path/to/0002-mcp-hitl-approval-gate-and-ci-wiring.patch
npm --prefix infrastructure/mcp-control-plane run test:github-guards
git commit -am "fix(mcp): HITL approval gate + CI wiring" && git push -u origin HEAD
```

**পথ B — নিজের sync পাইপ দিয়ে (এটাই বেশি মানানসই):**
প্যাচটা `.patches/public/`-এ রাখলে main-এর `sync-cross-repo-patches` জব নিজেই
অটো-PR খুলবে। এতে একইসাথে forward পাইপেরও আরেকটা প্রমাণ মিলবে।
