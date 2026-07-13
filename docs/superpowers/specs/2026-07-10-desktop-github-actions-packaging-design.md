# Desktop GitHub Actions Packaging Design

## Goal

Make desktop installer packaging reproducible on GitHub. Normal pushes and pull requests continue to validate the repository, while a `desktop-v*` tag builds native macOS and Windows installers that can be downloaded from the workflow run. The workflow also supports manual dispatch for pipeline testing.

## Repository Source Boundary

The desktop application source under `apps/desktop` must be committed. Generated and machine-local files remain ignored:

- `apps/desktop/dist/`
- `apps/desktop/electron-dist/`
- `apps/desktop/release/`
- `apps/desktop/node_modules/`

Desktop icons, Electron sources, renderer sources, configuration, tests, and packaging scripts are source assets and must be tracked.

## Test Portability

Desktop tests must resolve the repository or desktop root from the test module location instead of a developer-specific absolute path. The packaging configuration test must assert the configured macOS targets `dmg`, `zip`, and `dir`.

The existing CI remains responsible for push and pull-request validation. Its desktop job builds before running tests because package tests inspect generated Electron and renderer output.

## Packaging Workflow

Create `.github/workflows/desktop-package.yml` with these triggers:

- `workflow_dispatch` for manual pipeline verification.
- `push.tags: ["desktop-v*"]` for versioned installer builds.

The workflow contains independent native jobs:

### macOS

- Runner: `macos-latest`.
- Node.js: version 20 with npm cache.
- Run `npm ci`, desktop tests, desktop build, macOS packaging, and packaged-app verification.
- Build the existing Apple Silicon targets: DMG and ZIP, with the directory target available to Electron Builder as configured.
- Upload DMG, ZIP, and their blockmaps as artifact `codex-switcher-macos-arm64`.

### Windows

- Runner: `windows-latest`.
- Node.js: version 20 with npm cache.
- Run `npm ci`, desktop tests, desktop build, and Windows packaging.
- Build the existing x64 NSIS installer.
- Upload EXE and blockmap files as artifact `codex-switcher-windows-x64`.

Both uploads use `if-no-files-found: error` so an apparently successful packaging job cannot silently publish an empty artifact. Artifact retention is 14 days.

## Release Boundary

This change does not publish a GitHub Release and does not configure code signing. It produces unsigned installers in Actions Artifacts. Public distribution requires a separate change for:

- Apple Developer ID signing and notarization.
- Windows Authenticode signing.
- A release job with `contents: write` permission.

Keeping the initial workflow artifact-only avoids granting write permission or exposing signing secrets before the unsigned pipeline is proven.

## Versioning and Operation

The desktop package version remains sourced from `apps/desktop/package.json`. Before creating a release tag, that version must match the intended installer version.

Automatic packaging is triggered with:

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Pushing ordinary commits does not produce installers. Manual dispatch can be used to verify packaging before creating a tag.

## Verification

- A workflow contract test checks the manual and tag triggers, both native runners, package commands, and artifact upload behavior.
- Desktop package tests run without developer-specific paths.
- `npm run desktop:test` passes locally after a desktop build.
- The workflow YAML is parsed or structurally checked through repository tests.
- The desktop production build succeeds locally.

The final macOS and Windows installers can only be proven end to end after the workflow runs on GitHub-hosted native runners.
