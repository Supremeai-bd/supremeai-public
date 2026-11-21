# SupremeAI VS Code Extension (`packages/vscode-extension`)

Unified VS Code `.vsix` extension inside the `Supremeai-bd/supremeai-public` single-source repository.
Every single push builds **Web + Desktop (`.exe`/`.msi`) + Android (`.apk`) + VS Code (`.vsix`)** together and keeps versions and endpoints synchronized.

## Key Features

- **Federation Runway Telemetry**: Live status bar indicator showing active autonomous agents, open claims, and CI gate health via `https://supremeai-mcp-tower-live.onrender.com/mcp`.
- **In-Editor Chat Sidebar & Inline Selection Actions**: Ask, explain, or fix code directly using SupremeAI Gateway (`https://supremeai-api-ulw0.onrender.com`).
- **Task Dispatch & Emergency Kill-Switch**: Dispatch work to federation repositories or trigger emergency autonomy halt.
- **Silent Release Update & Cross-Platform Shortcuts**: Checks `latest-release.json` cleanly in the background and offers 1-click access to `.vsix`, Web Studio, Android `.apk`, and Windows `.exe`.
