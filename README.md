# SupremeAI Studio

SupremeAI Studio shares a React and TypeScript frontend across the web app, Tauri desktop app, and Tauri Android app. The local web server uses Express and Vite; the deployed web app uses Cloudflare Pages Functions.

[![CI](https://github.com/Supremeai-bd/supremeai-public/actions/workflows/unified-pipeline.yml/badge.svg)](https://github.com/Supremeai-bd/supremeai-public/actions/workflows/unified-pipeline.yml)
[![CodeQL](https://github.com/Supremeai-bd/supremeai-public/actions/workflows/codeql.yml/badge.svg)](https://github.com/Supremeai-bd/supremeai-public/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/Supremeai-bd/supremeai-public?label=release&color=blue)](https://github.com/Supremeai-bd/supremeai-public/releases)
[![License](https://img.shields.io/github/license/Supremeai-bd/supremeai-public?color=blue)](LICENSE)
[Releases](https://github.com/Supremeai-bd/supremeai-public/releases) · [Security Policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

---

## 🌟 Key Capabilities

- **Lightweight & High Performance**:
  - Tauri v2 + Rust runtime ensures tiny binary footprint, near-instant launch, and minimal memory usage compared to Electron.
- **Interactive 3D Holographic Companion**:
  - Three.js powered 3D holographic avatar (`Holographic3D`, `PrismCanvas`) responding dynamically to user status.
- **Voice & Speech Assistant**:
  - Integrated speech synthesis and voice assistant support (`speechHelper`).
- **Unified AI Model Selector**:
  - Instant switching between `Supreme Auto`, `Reasoning Pro`, and `Fast Chat` via the SupremeAI Gateway.
- **Developer Workspace & Admin Studio**:
  - Integrated Code Viewer, Terminal panel, User Authentication, and 2FA-gated Admin Dashboard for MCP Tower and Cluster monitoring.
- **Desktop Native Power**:
  - System Tray integration, Global keyboard shortcuts (`Ctrl+Alt+S` / `Cmd+Alt+S`), and Dark/Light theme switching.

---

## 🌐 Languages & In-App Feedback

- **English (default) and বাংলা (bn-BD)** across the whole desktop shell: sidebar, welcome screen, chat, composer, command palette, sign-in and quick-lock, settings.
- The language switcher lives in two places, matching the web workspace:
  - a compact **EN | বাং** toggle in the sidebar footer;
  - the full picker in **Settings** (`⌘ ,` / the gear button in the sidebar footer), with the same option labels and descriptions as the web app.
- The choice persists per device (`supremeai.desktop.lang.v1` in localStorage) and sets `<html lang>` so Bengali typography (taller glyphs, more line-height, Windows _Nirmala UI_ / _Hind Siliguri_ fallbacks) kicks in automatically.
- **Feedback / product pulse**: auto-surfaces after 4 user messages, with snooze (3 days), submit cooldown (14 days) and "don't ask" — the same cadence, ratings and wording as the web widget. Submissions go through the native `submit_feedback` command, which posts `{event_type, payload.context}` to the gateway's authenticated `/api/feedback/ingest` endpoint using the signed-in session token. The token never enters the WebView.

Translations live in `src/i18n/en.ts` (canonical key set) and `src/i18n/bn.ts` (typed against `TranslationKeys`, so a missing Bengali key is a compile error rather than a silent English fallback).

## 🔊 Neural Voice (ported from the web workspace)

The desktop app no longer reads replies through the bare OS speech engine. It now uses the same
voice stack as the web app:

| Stage      | What happens                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sanitise   | Markdown, code fences, URLs and emphasis markers are stripped (`sanitizeSpeechText`)                                                                                                                       |
| Segment    | One unified voice **per message**; split only at sentence/paragraph boundaries so inline English inside a Bengali sentence never causes mid-sentence male/female voice switching (`splitByScriptSegments`) |
| Chunk      | ≤220 chars at punctuation boundaries so the first audio starts within a few hundred ms (`chunkSpeechSegment`)                                                                                              |
| Synthesise | `POST {gateway}/api/tts/edge` (edge-tts neural voices) called from Rust — no CORS, no WebView audio limits                                                                                                 |
| Play       | Base64 MP3 → blob → `<audio>`, played in sequence with speed control; a generation counter means a new reply (or Stop) instantly cancels stale audio                                                       |
| Fallback   | If the gateway is unreachable, language-matched **OS voices** are used — and Bengali is never read by an English voice                                                                                     |

Voices match the web exactly: `bn-BD-NabanitaNeural` / `bn-BD-PradeepNeural` (Bangladesh),
`bn-IN-TanishaaNeural` / `bn-IN-BashkarNeural` (West Bengal), `en-US-AvaMultilingualNeural` /
`en-US-AndrewMultilingualNeural`. Five personas (Zephyr, Kore → female; Puck, Charon, Fenrir → male).

Where to find it:

- **Settings → Voice**: persona, Bangla dialect, speaking speed (0.85–1.25×), auto-speak toggle, and a test phrase.
- **Top bar speaker button**: turns auto-speak on/off; while audio is playing it becomes **Stop**.
- **Every assistant message**: a _Read aloud_ action next to Copy / Regenerate.

Preference key: `supremeai.desktop.tts.v1`. Audio is synthesised per chunk, so long answers begin speaking
immediately instead of waiting for the whole reply.

---

---

<!-- ARCHITECTURE_GAP_MAP:START -->

### 🗺️ Live System Reality & Gap Map (Unified 2-Repo SSOT)

> **Repository Federation:** Connected to [Supremeai-bd/supremeai](https://github.com/Supremeai-bd/supremeai) (Private Core, Gateway, Browser Relay & MCP Tower)  
> _Generated by scripts/ci/architecture_gap_guardian.py (Zero Sprawl, Overwrites Cleanly)_

`mermaid
flowchart TD
%% SupremeAI Canonical Architecture Reality & Gap Map
%% Auto-generated: Single Source of Truth, Overwrites on every run
classDef live fill:#1b4332,stroke:#40916c,stroke-width:2px,color:#d8f3dc;
classDef gap fill:#5c0002,stroke:#ba181b,stroke-width:2px,color:#ffccd5,stroke-dasharray: 5 5;
classDef isolated fill:#7f4f24,stroke:#a68a64,stroke-width:2px,color:#ede0d4;

    subgraph LiveMesh [Live Production Mesh (Active Traffic)]
        Public_Studio_Web["Web Client (React 19 + Tailwind v4)"]
        Public_Studio_Desktop["Desktop / Android App (Tauri v2 Rust Core)"]
        Public_Edge_Functions["Cloudflare Pages & Edge Proxy"]
        Gateway_Entry["API Gateway Entry (FastAPI)"]
        Gateway_Arbiter["Gateway Core Service & Route Arbiter"]
        Browser_Relay["Browser Relay (DuckAi / Fast-Path)"]
        MCP_Control_Tower["MCP Control Tower Client & Mesh"]
    end

    subgraph DetectedGaps [Architecture Gaps (Needs Wiring or Retirement)]
        Task_Engine["Task Execution Engine [core/brain] <br/>⚠️ [ISOLATED CHAIN]"]
        Reasoning_Orchestrator["Reasoning Orchestrator [core/brain] <br/>⚠️ [ISOLATED CHAIN]"]
        Autonomous_Browser["Autonomous Browser Agent [browser/] <br/>⚠️ [FLOATING NO ENTRY]"]
        MCP_Hub_Routes["MCP Hub Routes [core/api] <br/>⚠️ [FLOATING NO ENTRY]"]
        Redis_Manager["Redis Cache Manager [core/cache] <br/>⚠️ [FLOATING NO ENTRY]"]
        Supabase_Client["Supabase DB Client [core/database] <br/>⚠️ [FLOATING NO ENTRY]"]
        RAG_Pipeline["RAG Pipeline [core/memory] <br/>⚠️ [FLOATING NO ENTRY]"]
    end

    Public_Studio_Web --> Gateway_Entry
    Public_Studio_Desktop --> Gateway_Entry
    Public_Edge_Functions --> Gateway_Entry
    Gateway_Entry --> Gateway_Arbiter
    Gateway_Arbiter --> MCP_Control_Tower
    Gateway_Arbiter --> Browser_Relay
    Gateway_Arbiter --> Gateway_Entry
    Browser_Relay --> Gateway_Entry
    Browser_Relay --> Gateway_Arbiter
    MCP_Control_Tower --> Browser_Relay
    MCP_Control_Tower --> Gateway_Entry
    MCP_Control_Tower --> Gateway_Arbiter
    Task_Engine --> Gateway_Arbiter
    Reasoning_Orchestrator --> Gateway_Arbiter
    Reasoning_Orchestrator --> Task_Engine
    Autonomous_Browser --> Reasoning_Orchestrator
    Autonomous_Browser --> Gateway_Arbiter
    MCP_Hub_Routes --> Browser_Relay
    MCP_Hub_Routes --> Gateway_Entry
    MCP_Hub_Routes --> Gateway_Arbiter
    Redis_Manager --> Gateway_Entry
    Redis_Manager --> Gateway_Arbiter
    Supabase_Client --> Gateway_Entry
    Supabase_Client --> Gateway_Arbiter
    RAG_Pipeline --> Gateway_Arbiter

    class Public_Studio_Web live;
    class Public_Studio_Desktop live;
    class Public_Edge_Functions live;
    class Gateway_Entry live;
    class Gateway_Arbiter live;
    class Browser_Relay live;
    class MCP_Control_Tower live;
    class Task_Engine isolated;
    class Reasoning_Orchestrator isolated;
    class Autonomous_Browser gap;
    class MCP_Hub_Routes gap;
    class Redis_Manager gap;
    class Supabase_Client gap;
    class RAG_Pipeline gap;

`
<!-- ARCHITECTURE_GAP_MAP:END -->

---

## 🛠️ Architecture & Tech Stack

| Layer                     | Technology                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Core Shell & IPC**      | Tauri v2 (Rust)                                                                                            |
| **Frontend UI**           | React 19, TypeScript, Vite                                                                                 |
| **3D Rendering**          | Three.js                                                                                                   |
| **Markdown & Formatting** | ReactMarkdown, remark-gfm                                                                                  |
| **Installer Formats**     | Windows NSIS (`.exe`), WiX (`.msi`), macOS (`.dmg`) and Linux (`.AppImage`) when built for those platforms |

---

## Development quickstart

Use **Node.js 24 (24.12 or later)** and **npm**. `package-lock.json` is the canonical lockfile. Use `npm ci` for a clean checkout and `npm install` only when intentionally updating dependencies.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. On PowerShell, use `Copy-Item .env.example .env`. Set `PORT` or pass `npm run dev -- --port 3001` if port 3000 is busy.

- **Mock UI development:** Set `VITE_USE_MOCK=true` in `.env` and restart. Supported services use local fixtures without provider credentials. This is not a full offline backend: integrations without fixtures can still require a live service. Mock mode is disabled in production builds.
- **Live backend:** Leave `VITE_USE_MOCK=false` and set `SUPREMEAI_BACKEND_URL` to your backend to use the same-origin API proxy; unset, it uses the configured SupremeAI default. Set `VITE_API_BASE_URL` only if the browser should call a separate API origin directly. Add provider keys, Firebase settings, or Supabase settings only for the integrations you are testing. Never put server credentials in `VITE_*` variables; Vite exposes those values to the browser.

| Task                                       | Command                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| Run the JavaScript tests                   | `npm test`                                                     |
| Typecheck all Cloudflare Pages Functions   | `npm run typecheck:edge`                                       |
| Build the production web bundle            | `npm run build:web`                                            |
| Build the shared desktop/Android UI bundle | `npm run build:app`                                            |
| Run the desktop app locally                | `npm run tauri:dev`                                            |
| Build desktop installers for your host     | `npm run tauri:build`                                          |
| Initialize and run Tauri Android           | `npm run tauri:android:init`, then `npm run tauri:android:dev` |

Native development requires stable Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Android also requires the Android SDK/NDK and JDK 21. See [Monorepo Architecture](MONOREPO_ARCHITECTURE.md) for repository layout.

## CI and releases

[Unified CI](.github/workflows/ci.yml) checks the web bundle and Pages Functions, builds and tests the Windows Rust backend, and builds an Android debug APK. Configure these jobs as required checks on `main`; the workflow does not merge pull requests.

[Build & Release](.github/workflows/release-all.yml) publishes the web bundle, Windows NSIS/MSI installers, and Android APKs. It does not currently publish macOS or Linux installers. The web job deploys to Cloudflare Pages when its secrets are configured. Versioned releases use `v<package.json version>`; run `npm run version:sync` after changing the package version to update the Tauri and Cargo configuration. The release workflow generates `latest-desktop.json` from the Windows installer it actually publishes. A manual run with no tag uses the rolling `latest` prerelease when publishing is enabled.
