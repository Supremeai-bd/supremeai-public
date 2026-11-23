# Security Policy — SupremeAI

> **এই ফাইলটি root-এ থাকার কারণ:** GitHub শুধু repository root-এর `SECURITY.md`
> পড়ে Security tab-এ দেখাতে। বিস্তারিত অভ্যন্তরীণ নীতি
> [`docs/SECURITY.md`](docs/SECURITY.md)-এ আছে — এখানে সেটিরই সংক্ষিপ্ত, সর্বজনীন রূপ।

## Supported versions

| Plane | Supported |
|---|---|
| `main` (একমাত্র customer-facing release branch) | :white_check_mark: |
| Render / Vercel / Cloudflare production deploys of `main` | :white_check_mark: |
| Feature branches, `SupremeAI-internal` platform-only builds, archived releases | :x: |

## Reporting a vulnerability

**দয়া করে পাবলিক issue খুলবেন না।**

1. **GitHub private advisory (প্রথম পছন্দ):**
   [Report a vulnerability privately](https://github.com/Supremeai-bd/supremeai/security/advisories/new)
2. **ইমেইল:** `security@supremeai.com`
3. যদি দুটোই সম্ভব না হয়, তাহলে একটি issue খুলে শুধু "private security report —
   details requested" লিখুন; কোর টিম আলাদা চ্যানেলে যোগাযোগ করবে।
   **কোনো PoC, secret বা exploit detail পাবলিক issue-তে দেবেন না।**

### প্রতিশ্রুতি (SLA)

| ধাপ | সময় |
|---|---|
| প্রাপ্তি স্বীকার | ২৪–৪৮ ঘণ্টা |
| প্রাথমিক triage + severity (CVSS) | ৫ কর্মদিবস |
| Critical/high fix বা mitigation | ৩০ দিন (সম্ভব হলে তার আগে) |
| Coordinated disclosure | fix রিলিজের ৯০ দিন পর, অথবা আপনার সাথে সম্মত সময়ে |

## In scope

`gateway/`, `core/`, `browser/`, `studio/`, `infrastructure/`, `scripts/` এবং
শেয়ারড `api-schemas/` — বিশেষভাবে:

- Auth / session / TOTP / JWT যাচাই ও tenant isolation (RLS)
- Gateway ingress, model-routing ও relay পাথ
- Secret হ্যান্ডলিং (Infisical / Render / Cloudflare), CI/CD ওয়ার্কফ্লো
- Prompt-injection বা agent-boundary লঙ্ঘন যা operator plane-এ পৌঁছায়

## Out of scope

- তৃতীয় পক্ষের সেবার (Upstash, Render, Firebase, Cloudflare) নিজস্ব আউটেজ
- Free-tier কোটা শেষ হওয়া (`QUOTA_EXCEEDED`) — এটি পরিচালন সমস্যা, নিরাপত্তা ত্রুটি নয়
- কোনো secret ছাড়া শুধু "stack trace দেখা যাচ্ছে" ধরনের রিপোর্ট
- Social engineering, physical access, অথবা ইতিমধ্যে মালিকানাধীন অ্যাকাউন্টের অনুমোদিত কাজ

## Supply chain

- তৃতীয় পক্ষের GitHub Action অবশ্যই full commit SHA-তে pin করা
- প্রতিটি package manager-এর lockfile কমিট করা (`npm ci`, `pip install -r ...lock`)
- PR-এ `pip-audit`, `bandit[sarif]`, `trufflehog`, `gitleaks` চলে (`bandit_sast_guard.py`, `secret_scanner_policy.py`, `py_dep_cve_guard.py`)
- Vulnerability disclosure-এর জন্য ধন্যবাদ — আমরা contributor-দের কৃতজ্ঞতার সাথে উল্লেখ করি (আপনি না চাইলে নয়)
