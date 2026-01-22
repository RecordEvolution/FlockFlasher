# FlockFlasher - AI Coding Instructions

## Overview
Electron app for flashing IoT devices with IronFlock OS. Uses etcher-sdk for drive operations.

## Commands
```bash
npm run dev      # Development mode
npm run build    # Build application
npm run release  # Build and publish to GitHub releases
```

## Architecture
```
src/
├── main/
│   ├── api/
│   │   └── flash.ts    # Flashing logic with etcher-sdk
│   └── index.ts        # Electron main process
├── preload/            # Electron preload scripts
└── renderer/           # UI (web content)
```

## etcher-sdk Integration
Requires root/admin privileges for drive access:
- Spawns elevated subprocess using `sudo`
- Uses Electron binary as Node runtime (`ELECTRON_RUN_AS_NODE`)
- Progress communicated via stdout JSON

ASAR packaging: Node modules accessed from compressed archive at runtime.

## Release Process
1. Update version in `package.json` and `package-lock.json`
2. Set `GH_TOKEN` environment variable
3. Run `npm run build && npm run release` on each target platform

### macOS Specifics
- Requires notarization (Apple Developer account)
- Set `APPLEID` and `APPLEIDPASS` in `.env`
- **Manual step**: Combine `latest-mac.yml` for amd64 + arm64 releases

### Windows Specifics
- Requires Windows Driver Kit (WDK)
- `winusb-driver-generator` auto-installed via `scripts/windows.js`
- Visual Studio Build Tools required

## Build Outputs
Published to [GitHub Releases](https://github.com/RecordEvolution/FlockFlasher/releases)
