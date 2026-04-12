## 1. Auth Storage Model and Migration

- [ ] 1.1 Introduce scoped auth storage schema (`app`, `cli`) with versioned metadata.
- [ ] 1.2 Implement migration-on-read from legacy single-account CLI state to `cli.accounts[] + activeAccountId`.
- [ ] 1.3 Add backup-and-restore path for migration failures and schema validation errors.

## 2. CLI Multi-Account Lifecycle Commands

- [ ] 2.1 Implement CLI account add/login flow that appends accounts without overwriting existing entries.
- [ ] 2.2 Implement account listing output with active marker and token validity status.
- [ ] 2.3 Implement account removal behavior for non-active, active-with-fallback, and last-account cases.

## 3. Active Account Switching and Command Resolution

- [ ] 3.1 Implement explicit account switch command with atomic update of `activeAccountId`.
- [ ] 3.2 Route all authenticated CLI requests through the active account credential resolver.
- [ ] 3.3 Update identity/status commands (e.g., `whoami`) to display current active account context.

## 4. Error Handling, Security, and UX Messaging

- [ ] 4.1 Add standardized actionable errors for missing/invalid switch target and missing active account.
- [ ] 4.2 Add expired/revoked token handling that preserves account records while requiring re-authentication.
- [ ] 4.3 Ensure logs and diagnostics never print raw tokens; verify scoped storage isolation in error paths.

## 5. Verification and Release Readiness

- [ ] 5.1 Add unit tests for scoped storage isolation and legacy migration logic.
- [ ] 5.2 Add CLI integration tests covering add/list/switch/remove workflows and active-account execution.
- [ ] 5.3 Add regression tests proving App login/logout and CLI login/logout remain scope-isolated.
- [ ] 5.4 Document command usage, migration behavior, and rollback procedure in user/developer docs.
