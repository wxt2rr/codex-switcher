## Requirements

### Requirement: Stable managed provider identity

The system SHALL use `codex_switcher_router` as the `model_provider` value when materializing a managed direct or gateway Codex target, while preserving the account's display name separately.

#### Scenario: Direct target

- **WHEN** an account is materialized without an environment gateway
- **THEN** its Codex target configuration uses `model_provider = "codex_switcher_router"`

#### Scenario: Gateway target

- **WHEN** the same environment is materialized with a gateway
- **THEN** its Codex target configuration keeps `model_provider = "codex_switcher_router"` and changes only the transport provider settings needed for the gateway

### Requirement: Safe environment history synchronization

The system SHALL provide an environment-scoped action that synchronizes local conversation provider metadata to `codex_switcher_router`.

#### Scenario: Successful migration

- **WHEN** the user confirms synchronization while no managed App instance for the environment is running
- **THEN** the system backs up affected files, updates session metadata and the supported Codex thread index, and returns counts and the backup location

#### Scenario: Running App

- **WHEN** a managed App instance for the environment is running
- **THEN** synchronization is rejected with an instruction to close/restart the App before retrying

#### Scenario: Migration failure

- **WHEN** any atomic migration step fails
- **THEN** the system restores the backup where possible and reports that the result is not synchronized

### Requirement: Non-destructive metadata changes

The system SHALL change only provider classification metadata and SHALL preserve conversation bodies, response items, and user content.

#### Scenario: Existing session

- **WHEN** a rollout JSONL file is migrated
- **THEN** only the `session_meta.payload.model_provider` value changes

### Requirement: Clear UI semantics

The environment action SHALL identify the operation as local conversation-index synchronization and SHALL warn that visibility unification does not guarantee cross-provider continuation.
