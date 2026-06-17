## ADDED Requirements

### Requirement: Core SHALL own the canonical switcher state model
The system SHALL provide a versioned core state model that represents environments, accounts, target pointers, runtime settings, and migration metadata independently of any CLI, TUI, or GUI presentation layer.

#### Scenario: Load existing state into core model
- **WHEN** the core starts against an existing `codex-switcher` state directory
- **THEN** it SHALL load envs, accounts, target pointers, and runtime settings into a validated in-memory model

#### Scenario: Persist state changes through core
- **WHEN** a front-end requests an operation such as creating an env or switching an account
- **THEN** the core SHALL persist the resulting state change through its own versioned write path instead of direct front-end file mutation

### Requirement: Core SHALL provide structured operations for switcher workflows
The system SHALL expose structured operations for env management, account management, target switching, runtime configuration, and status inspection that are consumable by multiple front-ends without parsing human-readable text.

#### Scenario: Front-end requests account list
- **WHEN** a front-end requests the accounts for a given env
- **THEN** the core SHALL return structured account data including auth state, runtime settings, and current-target markers

#### Scenario: Front-end requests switch action
- **WHEN** a front-end requests switching a target to a specific env/account pair
- **THEN** the core SHALL execute the switch, update target pointers, and return a structured success or failure result

### Requirement: Core SHALL preserve backward-compatible state migration
The system SHALL support migration from the existing Bash-managed state layout to the new core-managed state model with backup, validation, and rollback support.

#### Scenario: Successful migration from legacy state
- **WHEN** the new core first encounters a legacy state directory
- **THEN** it SHALL create a backup, migrate the legacy state, validate the migrated result, and mark the state with the current schema version

#### Scenario: Failed migration rollback
- **WHEN** validation fails during migration
- **THEN** the core SHALL restore the backup and surface a structured migration error with recovery guidance

### Requirement: Core SHALL centralize configuration writes to Codex homes
The system SHALL own writes to `CODEX_HOME`-scoped configuration and auth material for both CLI and App targets so that front-ends do not directly manipulate `auth.json` or `config.toml`.

#### Scenario: Apply target runtime configuration
- **WHEN** a target is switched to an account with runtime settings such as auth method, provider, base URL, or model
- **THEN** the core SHALL write the necessary target home configuration and auth files consistently for that target

#### Scenario: Clear target runtime configuration
- **WHEN** an account is logged out or removed from the active target
- **THEN** the core SHALL clear or rewrite the target home configuration to a valid post-logout state

### Requirement: Core SHALL provide typed errors and operation results
The system SHALL classify operational failures into typed error categories so that CLI, TUI, and GUI can present actionable feedback without string matching shell output.

#### Scenario: Invalid target switch request
- **WHEN** a front-end requests switching to an account that does not have valid auth for the selected env
- **THEN** the core SHALL return a typed error indicating missing authentication and the required recovery action

#### Scenario: Corrupted pointer state
- **WHEN** the core detects corrupted current-target pointer data
- **THEN** it SHALL return a typed integrity error and expose the supported recovery path
