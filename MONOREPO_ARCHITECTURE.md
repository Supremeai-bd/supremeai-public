# SupremeAI Studio — Unified Single-Source Architecture (Web + Desktop + Android + VS Code)

All four SupremeAI surfaces (**Web**, **Windows Desktop**, **Android APK**, and **VS Code Extension**) share one repository and release pipeline (`packages/contracts` + `version.json`), connected to the SupremeAI Gateway (`https://supremeai-api-ulw0.onrender.com`).

## Repository Layout

```text
.
├── version.json                 # Canonical release version & rolling tag synced across all targets
├── src/                         # Single Source of UI & Logic (React 19 + TypeScript + Tailwind v4 + PWA)
│   │                            # Runs identically on Web, Desktop, and Android!
│   ├── auth/                    # Direct Guest -> Inline Login + Full Auth Modal + Quick-Lock PIN
│   ├── bridge/                  # Hybrid Tauri v2 Rust IPC + Web Gateway SSE bridge
│   ├── companion/               # Articulated Three.js 3D Hologram Companion (Aria / Orion / Custom Photo)
│   ├── components/              # LiveScreenBackdrop (11 Themes), Admin Control Center, 7-Tab WorkspaceDock
│   ├── hooks/                   # useAutoUpdater, usePWAInstall, useOnlineStatus, useMcpTelemetry
│   ├── stores/                  # Zustand state stores + modular theme presets (src/data/themePresets.ts)
│   └── sync/                    # Real-Time Cross-Device Sync engine (BroadcastChannel + Gateway SSE/REST)
├── src-tauri/                   # Single Native Core (Rust + Tauri v2) for BOTH Desktop & Android
│   ├── Cargo.toml               # Exports [lib] supremeai_lib (cdylib/staticlib) + [[bin]] desktop
│   ├── tauri.conf.json          # Unified Desktop (NSIS/MSI) + Android (minSdkVersion 26) config
│   └── src/
│       ├── lib.rs               # #[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()
│       ├── main.rs              # Thin desktop binary launcher -> supremeai_lib::run()
│       ├── secure_vault.rs      # AES-256-GCM sealed storage + SHA-256 digest verification
│       ├── auth.rs              # Encrypted user sessions & keystore (Desktop + Android)
│       ├── admin.rs             # Encrypted admin control plane commands
│       ├── feedback.rs          # Authenticated feedback bridge
│       ├── speech.rs            # Native TTS speech bridge
│       └── updater.rs           # SHA-256 verified silent updater (Windows / Android APK)
├── packages/
│   ├── contracts/               # Canonical model catalog, 11 theme tokens, and sync protocol schema
│   └── vscode-extension/        # Integrated VS Code sidebar & inline code assistant (.vsix)
├── server.ts                    # Express + Vite Bootstrap (~1,036 lines; enforced <=1,056 via check-server-budget.mjs)
├── src/api/                     # Shared Hono unified API mounted on both Express (src/api/node.ts) and Cloudflare Pages
├── src/server/                  # Modular API routes (routes/*, routes/admin/*, routes/workspace/*), wsBridge.ts, redisStore.ts
├── functions/                   # Cloudflare Pages Functions Edge API mirror + SSRF/CORS/session guards
└── .github/workflows/
    ├── unified-pipeline.yml     # Unified 4-platform PR/push/tag pipeline: PR Guard + CodeQL + Web + Desktop + Android + VSIX + Cross-Repo Sync
    └── apply-dependabot-update.yml # Automated dependency verification & landing workflow
```

## Unified Commands

- **Web / App Dev Server**: `npm run dev` (runs on port `3000`)
- **Lint + Structure Budget + Typecheck**: `npm run lint`
- **Edge Typecheck**: `npm run typecheck:edge`
- **Security + Unit Tests (Node + jsdom projects)**: `npm test` (with V8 coverage gate: `npm run test:coverage`)
- **Web Production Build (with PWA SW)**: `npm run build:web`
- **Shared Native App Bundle (Desktop + Android)**: `npm run build:app`
- **Desktop Dev (Tauri v2)**: `npm run tauri:dev`
- **Desktop Installer Build (.exe / .msi)**: `npm run tauri:build`
- **Android Init (one-time per machine)**: `npm run tauri:android:init`
- **Android Dev (Emulator / USB Device)**: `npm run tauri:android:dev`
- **Android APK Build**: `npm run tauri:android:build`
- **Sync / Verify Version Across All Platforms**: `npm run version:sync` / `npm run version:check`

## One Push -> All 4 Platforms Updated

1. Bump/edit `package.json` + run `npm run version:sync` or update code in `src/`, `src-tauri/`, or `packages/vscode-extension/`.
2. Commit & `git push origin main` (or push a version tag like `git tag v2.6.0 && git push origin v2.6.0`).
3. GitHub Actions (`unified-pipeline.yml`) automatically verifies, builds, and publishes:
   - **Web Studio** (`supremeai-web-dist.tar.gz` + Cloudflare Pages auto-deploy + PWA auto-update)
   - **Windows Desktop** (`.exe` NSIS + `.msi` installers with SHA-256 verified silent updater)
   - **Android APK** (`SupremeAI-Studio-*.apk` built via Tauri v2 + signed with `apksigner`)
   - **VS Code Extension** (`supremeai-vscode-*.vsix`)
