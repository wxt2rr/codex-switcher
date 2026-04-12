## Context

Codex currently behaves as a single-account client model in practice: signing in from one entry point can affect the other on the same machine. The requested product direction introduces two concerns at once: (1) app and CLI account separation, and (2) multiple concurrent accounts for CLI with fast switching.

This change crosses auth state management, local credential persistence, and CLI UX. It also introduces migration needs for users with existing single-account local state.

## Goals / Non-Goals

**Goals:**
- Allow Codex App and Codex CLI to stay logged in with different accounts on the same device.
- Support multiple authenticated accounts in Codex CLI.
- Allow explicit, low-friction switching of active CLI account.
- Ensure consistent behavior for token expiry, account removal, and missing active account.
- Preserve secure local token handling while extending data model.

**Non-Goals:**
- Cross-device account sync.
- Organization/role-level policy management.
- UI redesign of the full Codex App account center.
- Changing upstream identity provider contracts.

## Decisions

### Decision 1: Introduce account scope namespaces (`app`, `cli`) in local auth storage
- **Choice:** Persist auth state under two top-level namespaces to prevent collisions.
- **Why:** Clean separation avoids accidental overwrite and keeps logout semantics independent.
- **Alternatives considered:**
  - Keep shared storage with source tags. Rejected because writes can still race and logout logic remains coupled.
  - Separate files without schema-level scope key. Rejected because future tooling/migration becomes fragile.

### Decision 2: Use a multi-account CLI state model with one active account pointer
- **Choice:** Store `accounts[]` (each with account id, label/email, token reference, status) plus `activeAccountId`.
- **Why:** Supports deterministic command execution while preserving quick switching.
- **Alternatives considered:**
  - Token per shell session only. Rejected; not persistent and poor UX.
  - Environment-variable-only switching. Rejected; difficult discoverability and high misconfiguration risk.

### Decision 3: Extend CLI command surface with explicit account lifecycle operations
- **Choice:** Support command patterns for `add/login`, `list`, `switch`, `remove`, plus active marker in `whoami`.
- **Why:** Makes account state visible and controllable from scripts and interactive usage.
- **Alternatives considered:**
  - Implicit switch on login only. Rejected; insufficient for users managing 2+ accounts.
  - Interactive-only menu. Rejected; weak automation support.

### Decision 4: Add migration-on-read for legacy single-account CLI state
- **Choice:** On first CLI startup after upgrade, convert old single-account record into `accounts[0]` and set active pointer.
- **Why:** Zero-touch migration for existing users; no manual recovery needed.
- **Alternatives considered:**
  - Hard reset requiring re-login. Rejected due to avoidable user friction.
  - One-time migration command. Rejected because many users will never run it.

### Decision 5: Standardize failure handling with actionable fallback
- **Choice:** If active account is invalid/expired, command fails with next-step guidance (switch/login), and non-destructive operations (e.g., list) remain available.
- **Why:** Predictable behavior improves trust and recoverability.
- **Alternatives considered:**
  - Auto-switch to first valid account. Rejected because it hides state changes.

## Risks / Trade-offs

- [Risk] Migration bug could lock users out of existing CLI sessions. -> Mitigation: backup old state before migration and allow rollback to backup file.
- [Risk] Users may confuse app login state with CLI active account. -> Mitigation: add explicit scope wording in login/status output.
- [Risk] More commands increase UX complexity. -> Mitigation: provide concise `account list` output with active marker and guided errors.
- [Risk] Additional token records increase local exposure surface. -> Mitigation: continue encrypted/OS-keychain-backed storage and avoid plain-text tokens in logs.

## Migration Plan

1. Detect legacy CLI auth schema at startup.
2. Copy legacy state to a timestamped backup file.
3. Transform to multi-account structure (`accounts[]`, `activeAccountId`, `version`).
4. Validate transformed structure; if invalid, restore backup and prompt re-login.
5. Keep migration idempotent by checking schema version.

Rollback:
- If post-release issues occur, restore from backup state and temporarily disable multi-account behavior via feature flag/config gate.

## Open Questions

- Should CLI support account aliases/custom names at launch or defer to email/account-id labels?
- Should `codex logout` default to logging out active account only, or support `--all` with explicit confirmation?
- Do we need a hard cap on stored CLI accounts (for example 10) in the first release?
