# Apply branch protection to `main` using GitHub CLI (PowerShell)
#
# Usage:
#   .\scripts\apply-branch-protection.ps1
#
# Requires:
#   gh CLI logged in with repo admin permissions (or GH_TOKEN with repo admin scope)

param (
  [string]$Repo = "Supremeai-bd/supremeai-public",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

Write-Host "Applying branch protection to ${Repo}@${Branch} ..." -ForegroundColor Cyan

$body = @{
  required_status_checks = @{
    strict = $true
    contexts = @(
      "Web Studio Typecheck & Build",
      "Desktop Tauri v2 (Windows Rust + React UI)",
      "Android Tauri v2 APK (Single-Source React UI + Rust)",
      "VS Code Extension (TypeScript + VSIX Tests)"
    )
  }
  enforce_admins = $false
  required_pull_request_reviews = @{
    required_approving_review_count = 1
    dismiss_stale_reviews = $true
  }
  restrictions = $null
  allow_force_pushes = $false
  allow_deletions = $false
  required_conversation_resolution = $true
} | ConvertTo-Json -Depth 5

$body | gh api -X PUT "repos/$Repo/branches/$Branch/protection" --input -

Write-Host "Done! Verification:" -ForegroundColor Green
gh api "repos/$Repo/branches/$Branch/protection" --jq '.required_status_checks.contexts'
