# FlockFlasher - AI Coding Instructions

## Overview
Electron desktop app (by Record Evolution) for flashing IronFlock OS onto IoT devices. The renderer is Vue 3 + Vuetify + Pinia + vue-i18n (English/German); the main process uses etcher-sdk for drive operations. Users drop `.flock` / `.reswarm` device-config files (JSON, see `ReswarmConfig` in `src/types/index.ts`) or plain `.iso` / `.img` images, pick a target drive, and flash.

## Commands
```bash
npm run dev            # Development mode with HMR (electron-vite)
npm run dev:debug      # Dev mode with --inspect for the main process
npm run build          # Typecheck + electron-vite build
npm run typecheck      # tsc for main/preload (tsconfig.node.json) + vue-tsc for renderer (tsconfig.web.json)
npm run lint           # ESLint with --fix
npm run format         # Prettier
npm run release        # electron-builder (publishes to GitHub releases)
npm run build:mac      # Build + release macOS x64 (publishes always)
npm run build:macm1    # Build + release macOS arm64
npm run build:win      # Build + release Windows
npm run build:linux    # Build + release Linux AppImage
```
There is no test suite. VS Code users can use the "Debug All" compound launch config (main + renderer debugging).

## Critical Constraints
- **Electron is pinned to 19.x** — etcher-sdk breaks on Electron 20+ due to security changes (https://github.com/balena-io/etcher/issues/4087). Do not upgrade Electron.
- Flashing requires root/admin. On macOS/Linux the app spawns `sudo` subprocesses; on Windows the whole app runs elevated (`requestedExecutionLevel: requireAdministrator`).
- `~/.Reflasher` is the app's config/cache directory (downloaded OS images, agent binary, `supportedBoardsImages.json`).
- Board/image metadata and binaries are fetched from `https://instance-registry.ironflock.com`.

## Architecture

### Three Electron layers
- `src/main/` — main process. `index.ts` handles window creation, auto-update (electron-updater, checks every 60s), single-instance lock, and `.flock`/`.reswarm` file/protocol associations (opening a file sends `add-image-item` to the renderer, gated on the renderer signalling `image-item-store-ready`). `ipcHandlers.ts` registers all RPC handlers; the real work lives in `src/main/api/`.
- `src/preload/index.ts` — exposes `window.api` (typed wrappers around `ipcRenderer.invoke`) and `window.ipcRenderer.receive` for push events.
- `src/renderer/` — Vue app. Pinia stores in `src/renderer/src/store/` own all backend calls and event subscriptions (e.g. `flash.ts` listens for `flash-progress`). Locales live in `src/renderer/src/locales/`; `@renderer` is aliased to `src/renderer/src`.

### RPC contract
The `RPC` enum in `src/types/index.ts` is the single registry of invoke channel names. Adding an endpoint means touching three files: `src/types/index.ts` (enum), `src/main/ipcHandlers.ts` (handler), `src/preload/index.ts` (api wrapper). Main→renderer push events use `webContents.send` with ad-hoc channels: `flash-progress`, `drive-scanner-attach/detach/progress/error`, `agent-logs`, `agent-state`, `agent-download-progress`, `update-status`, `add-image-item`.

### Elevated flashing (`flash.ts` + `permissions.ts` + `utils/index.ts`)
The core trick: `flashDevice()` generates a standalone JS script (as a string) that requires etcher-sdk and does the actual write, saves it to a temp file, and runs it with the Electron binary in Node mode (`ELECTRON_RUN_AS_NODE=1`, `process.execPath`) — so users don't need Node installed.
- macOS/Linux: spawned via `sudo -E -S` with the sudo password piped to stdin. The password is collected by `SudoDialog.vue` and held in memory in `permissions.ts` (never persisted).
- Windows: no elevation needed (app already runs as admin); paths must be double-escaped (`\\` → `\\\\`) before being embedded in the generated script.
- In production, the script requires etcher-sdk from inside the packaged archive: `app.asar/node_modules` (see `getNodeModulesResourcePath`). On Linux AppImage the app image must first be loop-mounted to a temp dir to reach those resources (`mountAppImage` in `permissions.ts`).
- Progress flows back as JSON `Progress` objects written to the subprocess stdout, parsed by the parent, and forwarded to the renderer. Cancellation sends SIGTERM (via elevated `kill` on macOS).

### Flash pipeline for `.flock` / `.reswarm` items (`getReswarmImage` in `flash.ts`)
1. The config file is JSON containing the target board; the board's latest OS image (gzipped) is downloaded to `~/.Reflasher` and gunzipped (`boards.ts` / `ImageManager`), skipped if cached.
2. ISO-variant images are extracted (`iso.ts`), the device config is written into `boot/`, and the ISO is rebuilt with `xorriso` — bundled static binaries for macOS/Windows live in `resources/binaries/` (distributed via `asarUnpack`; `dd`/`du` for Windows too). Plain image variants instead get the config file copied onto the drive's boot partition after flashing.
3. Backwards compatibility: `.flock` configs are always duplicated as `.reswarm` on the device.

### Device test mode (`agent.ts`)
`AgentManager` downloads the `reagent` binary from the instance registry into `~/.Reflasher/agent` and can run a "virtual device" locally against a `.flock` config. Requires a running Docker daemon (`hasDocker()`); streams agent logs/state to the renderer.

### Drive discovery (`drives.ts` + `ipcHandlers.ts`)
etcher-sdk `scanner` adapters (BlockDevice, Usbboot, DriverlessDevice on Windows) push attach/detach events to the renderer; `drivelist` handles listing/partitions and `mountutils` mounting.

## Release Process
1. Bump version in `package.json` **and** `package-lock.json`.
2. Set `GH_TOKEN` env var, then run the platform-specific `npm run build:*` on each target machine.
3. Releases land in [GitHub Releases](https://github.com/RecordEvolution/FlockFlasher/releases); keep the release private until all platforms are uploaded.

### macOS
- Notarization runs automatically after signing (`scripts/notarize.js`, notarytool): needs `APPLEID` and `APPLEIDPASS` (app-specific password) in `.env`.
- **Manual step**: electron-builder can't merge `latest-mac.yml` for x64 + arm64 — stitch the two files' `files:` entries together by hand (example in README.md).

### Windows
- Requires the Windows Driver Kit (WDK) and Visual Studio Build Tools to compile the winusb driver.
- `winusb-driver-generator` is installed automatically on Windows via `scripts/windows.js` (postinstall); it is intentionally not in the dependency list for other platforms.
