## ADDED Requirements

### Requirement: CLI provides explicit account switching
Codex CLI MUST provide an explicit account switching operation that updates the active account pointer atomically.

#### Scenario: Switch to another stored account
- **WHEN** a user selects a different stored account using account switching command
- **THEN** the selected account SHALL become the active account for subsequent authenticated CLI commands

#### Scenario: Switch target does not exist
- **WHEN** a user attempts to switch to an account that is not stored
- **THEN** the CLI SHALL reject the switch and return an actionable error

### Requirement: Authenticated command execution uses the active account
All authenticated CLI requests MUST use credentials from the active account only.

#### Scenario: Active account governs API identity
- **WHEN** a user runs an authenticated command after switching accounts
- **THEN** the command SHALL execute under the switched active account identity

#### Scenario: No active account available
- **WHEN** no active account is configured
- **THEN** authenticated commands SHALL fail with guidance to login or switch to an existing account

### Requirement: CLI exposes current active account to users
Codex CLI MUST expose the active account in status output so users can verify execution context before running commands.

#### Scenario: whoami reflects switched account
- **WHEN** a user runs account identity/status command after a successful switch
- **THEN** output SHALL display the newly active account as the current identity
