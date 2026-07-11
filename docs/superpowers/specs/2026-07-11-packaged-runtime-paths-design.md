# Packaged Runtime Paths Design

## Problem

The installed Windows application loads Electron code from `app.asar`, while shared core modules and scripts are copied to Electron's external `resources` directory. The desktop runtime currently derives these paths from the source repository layout and eagerly resolves a workspace root, so `desktop:loadOverview` fails before bundled modules can load.

## Design

- The Electron main process exposes `process.resourcesPath` through `CODEX_SWITCHER_DESKTOP_RESOURCES_PATH` before IPC handlers run.
- A focused runtime-path module resolves bundled resources from that explicit directory and discovers the source repository only as a development fallback.
- Core module loading checks the bundled `packages/core/dist` directory first and only resolves source paths when bundled files are absent.
- Bridge script and working-directory resolution follows the same bundled-first rule.
- Packaging includes the core package manifest so bundled `.js` files retain ESM semantics, plus `scripts/bin` for packaged command execution.

## Error Handling

If neither packaged resources nor a valid source workspace exists, resolution throws an error that names both attempted runtime layouts. Normal installed execution never depends on the current working directory.

## Verification

- Unit tests simulate an `app.asar` location and an external Electron resources directory.
- Builder configuration tests assert every required external resource.
- Desktop type checking and tests run locally.
- A native directory package verifies the expected resource layout before publishing a new release.
