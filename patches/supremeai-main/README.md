# `Supremeai-bd/supremeai` — রেডি-টু-অ্যাপ্লাই ফিক্স

এই ফোল্ডারের ফাইলগুলো **অন্য রেপোর** (`Supremeai-bd/supremeai`) জন্য। বর্তমান সেশনের
ব্রাঞ্চ `supremeai-public`-এ বাঁধা, তাই ওই রেপোতে সরাসরি ব্রাঞ্চ/PR খোলা যায়নি —
পরিবর্তে যাচাই করা প্যাচ + ফাইল এখানে রাখা হলো।

**বেস:** `main` @ `280e089` (2026-11-23 15:37 UTC, PR #755-এর পর)

---

## ১. `0001-guard-roster-diagnostics.patch` — nightly কি কারণে লাল, সেটা দৃশ্যমান করা

### সমস্যা

`🔧 Nightly Ops & Maintenance` → **Guard Roster** টানা **২০+ রান লাল**, অথচ একই রোস্টার
লোকালে **১০৮/১০৮ পাস** করে (shallow clone, একই ৪টি ডিপ, `gh` টোকেন ছাড়াও)।

দুটি কাঠামোগত কারণে ব্যর্থতার কারণ **কখনো পড়া যেত না**:

| # | কারণ | ফল |
|---|---|---|
| ১ | এই জবে **step summary লেখা হয় না** | কারণ শুধু `guard-roster.log` আর্টিফ্যাক্টে; artifact ডাউনলোড না করলে কিছুই জানা যায় না — এটাই "silent failure", যেটা এই রোস্টারের উদ্দেশ্যেই নিষিদ্ধ |
| ২ | **পরিবেশ রেকর্ড নেই** | interpreter, `gh` আছে কি নেই, `gh auth`, ডিপ ভার্সন, shallow-ness, `api.github.com` পৌঁছানো যায় কি না — CI আর ল্যাপটপের মধ্যে যে ৬টি জিনিস আলাদা, একটিও লগে ছিল না |

### ফিক্স

- নতুন স্টেপ **`Record guard environment (failure triage)`** → `guard-env.txt` + step summary.
  কখনো job ফেল করবে না (`|| true`) — শুধু প্রমাণ যোগাবে।
- **`Run every guard`** এখন `|| true` দিয়ে job বাঁচিয়ে রাখে, তারপর **সৎভাবে exit code ঠিক করে**:
  - `N/N guards passed` লাইন না থাকলে → `::error::` (**"never green on a dark surface"**)
  - `FAILED:` ব্লক থাকলে → `::error::` + **কোন কোন গার্ড ফেল করেছে তা step summary-তে নামসহ**
- আর্টিফ্যাক্টে `guard-roster.log` + `guard-env.txt` দুটোই যায়।

### যাচাই (লোকালে চালানো)

| যাচাই | ফল |
|---|---|
| `git apply --check` fresh `main`-এ | ✅ ক্লিন অ্যাপ্লাই |
| YAML সঠিক | ✅ ৩৭ job |
| `workflow_validity_guard.py --check` | ✅ OK (৪ ফাইল) |
| পূর্ণ রোস্টার | ✅ **১০৮/১০৮ পাস** |
| সবুজ পাথ | ✅ `108/108` পার্স হয়, exit 0 |
| লাল পাথ | ✅ `102/108` → `::error::` পাথ ট্রিগার হয় |

### প্রয়োগ

```bash
git clone https://github.com/Supremeai-bd/supremeai.git && cd supremeai
git checkout -b fix/guard-roster-diagnostics
git am < 0001-guard-roster-diagnostics.patch
git push -u origin fix/guard-roster-diagnostics   # তারপর PR খুলুন
```

অথবা `git apply` ব্যবহার করুন (কমিট মেসেজ নিজে লিখতে চাইলে)।

---

## ২. `SECURITY.md` — root-এ যোগ করুন

`docs/SECURITY.md` আগে থেকেই আছে, কিন্তু **GitHub শুধু root-এর `SECURITY.md` পড়ে**
Security tab-এ দেখায়। ফলে:

- `docs/MASTER_SIMPLIFICATION_PLAN.md` লাইন ৪৩-এ `[security policy](SECURITY.md)` লিংকটা **৪০৪**
- রেপোতে "Report a vulnerability" বাটন নেই

নতুন ফাইলটি `docs/SECURITY.md`-এর নীতির **সংক্ষিপ্ত সর্বজনীন রূপ** (supported versions,
private advisory + email, in/out of scope, ২৪–৪৮ ঘণ্টা SLA, supply-chain নিয়ম) এবং
বিস্তারিত নীতির দিকে লিংক করে — তাই **দুটি সত্যের drift তৈরি হয় না**।

```bash
cp SECURITY.md /path/to/supremeai/SECURITY.md
```

`docs_link_integrity_guard.py --check` এই ফাইলসহ পাস করেছে (৬১৪ লিংক, র্যাচেট অক্ষত)।

---

## ৩. 🔴 যেগুলো আরও আগে দরকার — কিন্তু কোড দিয়ে "ফিক্স" করা যায় না

### (ক) `redis-quota-monitor` এখন কোটার সংকট লুকিয়ে ফেলে

PR #755-এ `exit 3` → `exit 0` করা হয়েছে (সঠিক সিদ্ধান্ত — nightly আর লাল হবে না), কিন্তু
ফলে **Upstash `QUOTA_EXCEEDED` আর পাইপলাইনে দেখা যাবে না**। এখন একমাত্র চ্যানেল Telegram।

⚠️ অথচ `scripts/ops/redis_quota_monitor.py:685` — `TELEGRAM_BOT_TOKEN` বা `TELEGRAM_CHAT_ID`
না থাকলে স্ক্রিপ্ট **`SKIPPED` + exit 0** দেয়। অর্থাৎ **সিক্রেট দুটো সেট না থাকলে সংকট পুরোপুরি অদৃশ্য**।

**করণীয় (কোড নয়, কনফিগ):** রেপো সেটিংসে `TELEGRAM_BOT_TOKEN` ও `TELEGRAM_CHAT_ID` আছে কি না নিশ্চিত করুন,
তারপর `workflow_dispatch` দিয়ে `run_redis_quota_monitor=true` চালিয়ে টেস্ট মেসেজ পান।

### (খ) টোকেন কোটার আরেকটি কারণ

এই জবটাই ছিল শেষ সফল রান (৪৫১৭১১৬২৬২৫) — **12:06:32 → 12:06:50Z** (১৮ সেকেন্ড) অথচ quota-monitor-এর
`timeout-minutes: 5`। অর্থাৎ স্ক্রিপ্ট ৩ নম্বর exit দিয়ে **দ্রুত** ফিরছিল — নেটওয়ার্ক টাইমআউট নয়, বরং
`RENDER_MCP_URL` থেকে tower-এ পৌঁছেই ব্যর্থতা। এটাই #616/#617-এর কোটা-সংকট।

### (গ) nightly রোস্টারের আসল কারণ চিহ্নিত করতে ১টি ম্যানুয়াল রান

```bash
gh workflow run "🔧 Nightly Ops & Maintenance" -f run_guard_roster=true
```
প্যাচ অ্যাপ্লাই করার পরে এই রানটিই প্রথমবার step summary-তে **কোন গার্ড কেন ফেল করেছে** দেখাবে।
আমার সন্দেহ: `gh`-নির্ভর গার্ডগুলো (রোস্টারে ২৭টি নেটওয়ার্ক ছোঁয়) CI-তে `GH_TOKEN`
পায় না (এই job-এ শুধু `contents: read`, কোনো `env: GH_TOKEN` নেই) → GitHub API rate-limit
বা auth ব্যর্থতা। লোকালে আমার `gh` authed ছিল, তাই ধরা পড়েনি।

> এই হেতু সন্দেহটি **প্রমাণিত নয়** — লগ/আর্টিফ্যাক্ট এখান থেকে ডাউনলোড করা যায়নি
> (Actions blob storage ব্লকড)। তাই অনুমানে গার্ড কোড বদলানো হয়নি; আগে দৃশ্যমানতা, তারপর ফিক্স।

---

## অগ্রাধিকার ক্রম

| ক্রম | কাজ | সময় |
|---|---|---|
| ১ | `git am` করে রোস্টার প্যাচ + ম্যানুয়াল রান → আসল গার্ড চিহ্নিত | ১৫ মিনিট |
| ২ | `SECURITY.md` root-এ কপি | ২ মিনিট |
| ৩ | Telegram সিক্রেট যাচাই + টেস্ট অ্যালার্ট | ১০ মিনিট |
| ৪ | চিহ্নিত গার্ড(গুলো)-র আসল ফিক্স | পরবর্তী |
| ৫ | `ops-maintenance.yml` (২,৭৩৮ লাইন) ভাঙা — সপ্তাহে ১টি arm | চলমান |
| ৬ | ব্যর্থতা-রেজিস্টার #9 পুনরুজ্জীবিত বা বন্ধ | ৩০ মিনিট |
