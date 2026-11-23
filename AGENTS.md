# SupremeAI Public — AGENTS.md (Operating Constitution & Guidelines)

> rules_version: `3.3` · যতই ঘুড়ি উড়াও রাতে, নাটাই তো আমার হাতে।
>
> Agent-কে ঘুড়ির মতো স্বাধীনভাবে উড়তে দাও; কিন্তু নাটাই সবসময় SupremeAI Admin / Control Plane-এর হাতে থাকবে।

### Operator Creed (admin — non-negotiable)

- Fastest, lightest, secure, zero-cost — and actually used. Every feature must earn its place.
- Single source of logic: the same job always follows the same code path. A justified exception ships with a comment explaining why it exists.
- Find a problem → fix it at the root. No over-engineering.
- Never hoard defensive copies 'in case something breaks'. Fixing it a hundred times beats creating one layer of speculative waste.

---

## The Living Protocols (Root-Cause Invariants)

### 1. বাংলা/বাংলিশ ব্যবহারের বাধ্যবাধকতা (Mandatory Bengali/Banglish)
আমাদের পুরো টেক টিম বাংলাদেশি — তাই যেখানেই সম্ভব বাংলা (বা প্রাঞ্জল বাংলিশ) ব্যবহার করতে হবে:
- কোডের ভেতরের সমস্ত মন্তব্য ও সিদ্ধান্তের ব্যাখ্যা (code comments — e.g. `// বাংলা মন্তব্য:` বা `# বাংলা মন্তব্য:`)
- অ্যাডমিনের যেকোনো প্রশ্নের উত্তর, বার্তা ও স্ট্যাটাস রিপোর্ট
- PR সামারি, ডেসক্রিপশন ও ইস্যু ডিসকাশনে বাংলা বা বাংলিশ ১০০% বাধ্যতামূলক।

### 2. Verify First (3-Tier Verification)
অনুমানে কোনো ফাইল এডিট বা ডিলিট নিষিদ্ধ। পরিবর্তনের আগে ও পরে ৩ স্তর যাচাই আবশ্যক:
1. **Type & Linter Check:** `npm run check` বা `npx tsc --noEmit`
2. **Smoke / Unit Test:** বিদ্যমান টেস্ট রানার বা স্ক্রিপ্ট ভেরিফিকেশন
3. **Build Check:** সংশ্লিষ্ট প্যাকেজ বিল্ড (যেমন: `npm run build` বা `smart-pr-guard.mjs`)।

### 3. Bi-Directional Cross-Repo Patch Protocol (উভয় রিপোতে স্বয়ংক্রিয় প্যাচ ও পিআর নীতি)
যদি কোনো এজেন্ট `supremeai-public` রিপোতে কাজ করার সময় লক্ষ্য করে যে মূল `supremeai` (Monorepo)-তেও সঙ্গতিপূর্ণ পরিবর্তন (যেমন: Backend Schemas, APIs, MCP Tools) প্রয়োজন:
1. সে সরাসরি মূল রিপোর জন্য স্ট্যান্ডার্ড `git diff` / `patch` তৈরি করবে।
2. প্যাচটি `.patches/private/<slug>.patch` ফাইলে সংরক্ষণ করবে।
3. PR মার্জ হওয়ার সাথে সাথে অটোমেটেড CI স্ক্রিপ্ট (`apply_cross_repo_patch.py`) মূল `Supremeai-bd/supremeai` রিপোতে স্বয়ংক্রিয়ভাবে নতুন ব্রাঞ্চ তৈরি করে প্যাচ অ্যাপ্লাই করবে এবং `auto-sync` লেবেলযুক্ত PR ওপেন করবে।
4. সার্কুলার লুপ প্রতিরোধে বটের তৈরি PR-এ এই অটোমেশন নিষ্ক্রিয় থাকবে (`github.actor != 'github-actions[bot]'`)।

---

## Bootstrap Checklist (সেশন শুরু হলে ঠিক এই ক্রমে কাজ করো)

1. `git fetch origin --prune && git status` — সেশন শুরুতে সর্বদা origin sync দেখো
2. পরিবর্তনের আগে বিদ্যমান আর্কিটেকচার অক্ষত রাখো
3. ৩-স্তর ভেরিফিকেশন সম্পন্ন করো
4. PR ওপেন করার সময় অবশ্যই বাংলা সারাংশ ও টেস্ট এভিডেন্স প্রদান করো
