#!/usr/bin/env bash
# Apply branch protection to `main` so a red CI can never be merged again.
#
# Requires a token with "Administration: write" on the repo:
#   GH_TOKEN=<your-token> ./scripts/apply-branch-protection.sh
#
# Or paste the JSON body into:
#   https://github.com/Supremeai-bd/supremeai-public/settings/branches

set -euo pipefail

REPO="${REPO:-Supremeai-bd/supremeai-public}"
BRANCH="${BRANCH:-main}"

echo "Applying branch protection to ${REPO}@${BRANCH} ..."

gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Web Studio Typecheck & Build",
      "Desktop Tauri v2 (Windows Rust + React UI)",
      "Android Tauri v2 APK (Single-Source React UI + Rust)",
      "VS Code Extension (TypeScript + VSIX Tests)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

echo "Done. Verify with:"
echo "  gh api repos/${REPO}/branches/${BRANCH}/protection"
