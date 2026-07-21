## Why

Multiple isolated Codex App instances currently use indistinguishable Dock or taskbar icons, so users cannot tell which environment a window belongs to after multi-opening. Environment badges must be opt-in, permission-aware, low-overhead, and must never modify or re-sign the installed Codex App.

## What Changes

- Add a disabled-by-default desktop setting for Codex App environment badges on macOS and Windows.
- Add a first-enable macOS permission explanation and system Accessibility authorization flow; enable only after authorization succeeds.
- Track managed Codex App instances by PID and environment and synchronize platform badge helpers without restarting Codex automatically.
- Render a stable environment monogram/color badge over macOS Dock items and Windows taskbar buttons, with graceful fallback when a platform cannot identify an existing window.
- Show success, permission, partial-application, and disable notices; advise reopening Codex App only when the badge is not visible.
- Stop helpers and remove owned overlays when disabled, without changing Codex files, profiles, or running work.

## Capabilities

### New Capabilities
- `app-environment-badges`: Persisted settings, permission lifecycle, managed-instance identity, macOS Dock overlays, Windows taskbar overlays, user feedback, performance limits, and fallback behavior.

### Modified Capabilities

None.

## Impact

- Desktop renderer settings UI, permission guidance dialog, and notices.
- Electron main/preload/bridge contracts and managed Codex App launch lifecycle.
- A main-process macOS N-API module and a Windows native taskbar adapter.
- Desktop packaging, signing, native-resource verification, and platform-specific tests.
- Local state under the codex-switcher state directory for badge settings, cached monograms, helper state, and diagnostics.
