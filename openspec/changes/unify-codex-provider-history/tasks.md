## 1. Stable provider materialization

- [x] 1.1 Export the stable managed provider ID and make direct/gateway target config use it.
- [x] 1.2 Preserve account display names and add regression tests for direct and gateway target config.

## 2. History migration service

- [x] 2.1 Implement environment-scoped JSONL session metadata scanning and atomic migration with backups.
- [x] 2.2 Implement SQLite thread-index migration with schema detection, transaction, and backup/rollback.
- [x] 2.3 Add migration unit tests for JSONL, SQLite, running-App rejection, and rollback.

## 3. Desktop integration

- [x] 3.1 Add bridge/preload IPC for environment history synchronization.
- [x] 3.2 Add the environment-card action, confirmation, progress state, result summary, and error handling.
- [x] 3.3 Add UI/bridge regression coverage and update localized copy.

## 4. Verification

- [x] 4.1 Run focused core and desktop tests.
- [x] 4.2 Build the desktop app and verify the generated target config and packaged files.
