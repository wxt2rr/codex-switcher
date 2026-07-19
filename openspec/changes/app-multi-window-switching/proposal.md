## Why

Codex App switching currently assumes one managed App window per environment. Users who intentionally open multiple App windows lose that working layout when switching accounts, while allowing multi-open from an inactive account would create ambiguous ownership and credentials.

## What Changes

- Add a persistent multi-open action for the active App account that launches one additional managed App window.
- Display the same action for inactive accounts in a disabled state with a clear active-account requirement.
- Persist the desired App window count per environment so subsequent account switches replace all windows for that environment and reopen the same count.
- Keep windows in other environments untouched and preserve existing single-window behavior by default.
- Apply the lifecycle consistently to macOS application binaries and Windows executable or packaged-App activation paths.

## Capabilities

### New Capabilities
- `app-multi-window-lifecycle`: Manage a persistent environment-scoped App window count, active-account-only multi-open, and coordinated account switching.

### Modified Capabilities

## Impact

- Desktop account action menu and launch strategy types.
- Electron IPC/preload bridge and App launch orchestration.
- Core managed App process/profile lifecycle on macOS and Windows.
- Desktop settings persistence and cross-platform lifecycle tests.
