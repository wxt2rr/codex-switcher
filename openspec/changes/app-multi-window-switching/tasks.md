## 1. Persistent Window Intent

- [x] 1.1 Add normalized per-environment App window count persistence with a 1-8 bound
- [x] 1.2 Migrate counts on environment rename and remove them on environment deletion
- [x] 1.3 Cover defaults, successful updates, invalid data, rename, and deletion with tests

## 2. Cross-Platform App Lifecycle

- [x] 2.1 Reuse the core support boundary for serialized additional-window launch
- [x] 2.2 Implement active-account-only multi-open that persists only after a successful launch
- [x] 2.3 Reconcile every saved window when switching an App account while preserving other environments
- [x] 2.4 Implement repeated Windows packaged-App activation without repeating home materialization
- [x] 2.5 Add macOS, Windows executable, packaged-App, partial-failure, and stale-instance tests
- [x] 2.6 Reconcile persisted counts against live environment-scoped managed instances before multi-open and account switching
- [x] 2.7 Add regression coverage for manually closed windows and conservative untracked-target fallback

## 3. Desktop UI and IPC

- [x] 3.1 Extend launch strategy types through renderer, preload, IPC, and bridge
- [x] 3.2 Add the multi-open item to every App menu and enforce active-account-only backend validation
- [x] 3.3 Render inactive multi-open as disabled with the required hover explanation
- [x] 3.4 Add renderer and bridge contract tests for the new action

## 4. Release Verification

- [x] 4.1 Run OpenSpec strict validation, desktop tests, type checks, and production build
- [x] 4.2 Verify the menu and disabled hint in the rendered desktop UI
- [x] 4.3 Document behavior and residual Windows packaged-App activation limitations
