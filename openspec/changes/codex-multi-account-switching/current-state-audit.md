## Current-State Audit (2026-04-11)

This note captures what is **verified** about current Codex auth behavior before implementing account isolation.

## 1. Verified Facts

### 1.1 CLI is single-account today
- Local runtime (`codex-cli 0.119.0`) login status shows only one active mode (`ChatGPT` or `API key`), not account list.
- Source confirms login status reads one auth payload and prints one mode:
  - `codex-rs/cli/src/login.rs:316-344`
- Source `AuthDotJson` schema contains `auth_mode`, `OPENAI_API_KEY`, `tokens`, `last_refresh` only (no `accounts[]`):
  - `codex-rs/login/src/auth/storage.rs:28-42`

### 1.2 Auth storage root is shared by Codex components
- Core config defines one `codex_home` (defaults to `~/.codex`, overridable by `CODEX_HOME`):
  - `codex-rs/core/src/config/mod.rs:400-403`
  - `codex-rs/core/src/config/mod.rs:2301-2310`
- App-server login paths call `login_with_api_key(..., config.codex_home, config.cli_auth_credentials_store_mode)`:
  - `codex-rs/app-server/src/codex_message_processor.rs:1076-1080`

### 1.3 Logout is global for that auth store (no scope)
- CLI `logout` delegates to login manager logout:
  - `codex-rs/cli/src/login.rs:347-363`
- `AuthManager::logout()` clears both managed and ephemeral auth stores:
  - `codex-rs/login/src/auth/manager.rs:1556-1560`
  - `codex-rs/login/src/auth/manager.rs:585-595`
- App-server test verifies `account/logout` removes `auth.json`:
  - `codex-rs/app-server/tests/suite/v2/account.rs:157-198`

### 1.4 Credential backend can be file/keyring/auto/ephemeral
- Config enum:
  - `codex-rs/config/src/types.rs:39-52`
- Keyring mode store key currently includes `cli|<hash>` prefix:
  - `codex-rs/login/src/auth/storage.rs:120-134`

### 1.5 External host auth path already exists (in-memory)
- Protocol supports `chatgptAuthTokens` mode where tokens are external/in-memory:
  - `codex-rs/app-server-protocol/src/protocol/common.rs:23-33`

### 1.6 Non-destructive local experiment (temp CODEX_HOME)
- `CODEX_HOME=<tmp> codex login --with-api-key` creates single `auth.json`.
- `CODEX_HOME=<tmp> codex logout` removes `auth.json`.
- Confirms current behavior is single-profile and file-scoped when in `file` mode.

## 2. Implications for Isolation Design

1. We cannot bolt on multi-account as a thin CLI UX only; auth manager/storage model must change.
2. App and CLI currently operate over the same logical auth surface (`codex_home` + one auth payload), so scope isolation requires explicit `AuthScope` in auth APIs.
3. Existing `logout` semantics are destructive for all auth in that store; must be scope-aware after migration.
4. `chatgptAuthTokens` in-memory flow gives a precedent for a second auth channel, but not durable multi-account.

## 3. Unified Isolation Architecture (Revised)

### 3.1 Add first-class scope
Introduce `AuthScope` enum:
- `App`
- `Cli`

All auth manager/storage APIs accept scope explicitly.

### 3.2 Add scoped state model
Persist metadata in a scoped state document (new file, e.g. `auth_state.json`):
- `version`
- `scopes.app.session_ref` (single account)
- `scopes.cli.accounts[]`
- `scopes.cli.active_account_id`

Tokens remain in configured credential backend (file/keyring/auto/ephemeral), keyed by scope+account.

### 3.3 Backward-compatible migration
On first read:
- If legacy single `auth.json` exists and no scoped state exists:
  - Backup legacy file.
  - Import into `scopes.cli.accounts[0]` and set active.
  - Mark migration version.

### 3.4 Scope-specific command semantics
- `codex login` defaults to `--scope cli`.
- `codex logout` defaults to active CLI account only.
- Add `codex logout --scope app` and optional `--all-scopes`.
- `codex login status` outputs:
  - app scope status
  - CLI active account + stored account count

### 3.5 CLI multi-account semantics
- `account add/login`: append account
- `account list`: show account id/label/status + active marker
- `account switch <id>`: atomic active pointer change
- `account remove <id>`: deterministic fallback behavior

## 4. Validation Matrix (to run during implementation)

### A. Scope isolation
- App login, then CLI login as different user -> both remain independent.
- CLI logout should not affect App session.
- App logout should not remove CLI accounts.

### B. CLI multi-account lifecycle
- Add second account -> both persist after restart.
- Switch active -> authenticated command identity follows active account.
- Remove active account -> fallback to another valid account or clear active.

### C. Migration and rollback
- Legacy `auth.json` migrated to scoped model.
- Corrupt migration path restores backup and fails safely.

### D. Credential backend parity
- File mode works with scoped schema.
- Keyring mode stores/retrieves by scope/account key.
- Auto mode fallback behavior remains intact.

### E. Failure behavior
- Expired/revoked token flagged without deleting account metadata.
- Missing active account returns actionable error (`login` or `switch`).

## 5. External Product Context

- Codex App entry is launched via `codex app` in OSS CLI:
  - `README.md:8`
- OpenAI product post indicates the app can pick up CLI session/config context; this reinforces the need for explicit scope boundaries when adding multi-account.
