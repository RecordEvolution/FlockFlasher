# FlockFlasher — dev & release helpers. Run `just` to list recipes.

ROOT_DIR := justfile_directory()

# electron-builder target for the CURRENT OS. macOS builds arm64 only — the
# amd64/x64 mac build was dropped, which also removes the manual latest-mac.yml
# stitching step described in the README. Run `just release` once per platform.
BUILDER_TARGET := if os() == "macos" { "--mac --arm64" } else if os() == "linux" { "--linux" } else { "--win" }

default:
    @just --list

# Start the local dev environment (electron-vite with HMR).
dev:
    npm run dev

# Run the unit tests (Vitest).
test:
    npm test

# Type-check + build the app bundle (no publish).
build:
    npm run build

# Build, then run the production bundle locally to verify it works (no publish).
preview: build
    npm run start

# -----------------------------------------------------------------------------
# Version bumping. Edits package.json + package-lock.json only — no git commit,
# so you can review the change first. Follow with `just release` (or use the
# combined release-patch / release-minor recipes).
# -----------------------------------------------------------------------------

# Bump the patch version (x.y.Z).
bump-patch:
    npm version patch --no-git-tag-version
    @echo "Bumped patch. Review & commit package.json + package-lock.json, then: just release"

# Bump the minor version (x.Y.0).
bump-minor:
    npm version minor --no-git-tag-version
    @echo "Bumped minor. Review & commit package.json + package-lock.json, then: just release"

# Bump the major version (X.0.0).
bump-major:
    npm version major --no-git-tag-version
    @echo "Bumped major. Review & commit package.json + package-lock.json, then: just release"

# -----------------------------------------------------------------------------
# Release: build + publish to GitHub Releases for the CURRENT OS. Run once per
# target machine (macOS arm64 / Windows / Linux), as described in the README.
# Requires GH_TOKEN in the environment; on macOS also APPLEID + APPLEIDPASS in
# .env for notarization.
# -----------------------------------------------------------------------------

# Build + publish the current OS's artifact to GitHub Releases.
release:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ROOT_DIR}}
    : "${GH_TOKEN:?set GH_TOKEN in your environment to publish to GitHub Releases}"
    npm run build
    npx --no-install electron-builder {{BUILDER_TARGET}} --publish always

# Bump the patch version, then build + publish for the current OS.
release-patch: bump-patch release

# Bump the minor version, then build + publish for the current OS.
release-minor: bump-minor release

# Bump the major version, then build + publish for the current OS.
release-major: bump-major release
