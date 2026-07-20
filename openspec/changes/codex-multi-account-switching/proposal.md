## Why

Codex App and Codex CLI currently share a single-login mental model, which blocks users who need different identities for GUI and terminal workflows. Power users also need to keep multiple CLI accounts signed in and switch quickly without re-authentication.

For codex-switcher desktop environments, the isolation boundary is `CODEX_HOME`: CLI and App may use different accounts only when they use different environments. Targets sharing one environment also share its active account and materialized configuration.

## What Changes

- Introduce account-context isolation so Codex App and Codex CLI can be authenticated with different accounts on the same machine.
- Enforce one active account per codex-switcher environment when CLI and App share its `CODEX_HOME`.
- Add multi-account support in Codex CLI, including adding, listing, removing, and selecting an active account.
- Add explicit account-switching UX in CLI (command-level and interactive flow) with clear active-account visibility.
- Define secure token/session storage structure that supports multiple CLI accounts and one App account without accidental overwrite.
- Standardize behavior for expired tokens, revoked sessions, and missing active account during switch or command execution.

## Capabilities

### New Capabilities
- `account-context-isolation`: Separate authentication state and storage boundaries between Codex App and Codex CLI.
- `cli-multi-account-management`: Allow Codex CLI to maintain multiple authenticated accounts simultaneously.
- `cli-account-switching`: Provide commands and UX to switch active CLI account safely and predictably.

### Modified Capabilities
- None.

## Impact

- Affected systems: auth/session manager, local credential storage, CLI command surface, startup/account bootstrap flow.
- Affected interfaces: CLI commands (`login`, `logout`, `whoami`, new account management commands), status output, error messaging.
- Security implications: stronger separation of token namespaces, validation of account ownership before activation.
- Operational impact: migration path required from single-account CLI state to multi-account format.
