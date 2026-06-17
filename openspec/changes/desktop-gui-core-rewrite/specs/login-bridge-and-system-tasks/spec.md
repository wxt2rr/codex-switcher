## ADDED Requirements

### Requirement: Core SHALL execute external login-dependent workflows through a bridged task layer
The system SHALL run workflows that depend on external `codex` CLI or App behavior through a bridged task layer that captures inputs, execution state, outputs, and final results.

#### Scenario: Auth login bridge
- **WHEN** a front-end requests an auth-based account login
- **THEN** the core SHALL start a bridged login task, track its execution state, and return a structured completion or failure result

#### Scenario: Relogin bridge with existing account
- **WHEN** a front-end requests relogin for an existing account
- **THEN** the core SHALL execute the relogin through the bridged task layer and update the account state only after task success

### Requirement: Core SHALL natively support non-interactive credential-based login flows
The system SHALL support credential-driven login flows such as API key or provider profile configuration without requiring interactive stdin-driven shell prompts.

#### Scenario: API key login request
- **WHEN** a front-end submits an API key login request with account metadata and runtime settings
- **THEN** the core SHALL persist the account auth and runtime state without relying on shell prompt emulation

#### Scenario: Provider-profile login request
- **WHEN** a front-end submits a structured provider configuration for a supported non-auth login mode
- **THEN** the core SHALL validate and persist the configuration as part of the account runtime state

### Requirement: Core SHALL expose system operations as typed tasks
The system SHALL expose App launch, App restart, proxy test, token refresh, import, doctor, recover, and initialization operations as typed tasks with structured results.

#### Scenario: App restart task
- **WHEN** a front-end requests restarting the current App target
- **THEN** the core SHALL execute the restart through the task system and report success or failure with structured metadata

#### Scenario: Doctor fix task
- **WHEN** a front-end requests a repair operation
- **THEN** the core SHALL execute the repair as a typed task and surface the applied actions and final status

### Requirement: Core SHALL retain logs and summaries for task outcomes
The system SHALL retain task summaries and accessible logs for bridged and system tasks so that front-ends can show recent history and failure diagnostics.

#### Scenario: Recent task history available
- **WHEN** a front-end requests recent task history
- **THEN** the core SHALL return recent task summaries including type, target, timestamps, status, and log location or excerpts

#### Scenario: Failed task diagnostics
- **WHEN** a bridged or system task fails
- **THEN** the core SHALL retain enough structured context for a front-end to display the failure reason and suggested next action

### Requirement: Core SHALL isolate platform-specific task adapters
The system SHALL isolate platform-specific execution details for launch agents, process control, shell setup, and OS integration behind adapters so the task API remains stable.

#### Scenario: macOS token refresh adapter
- **WHEN** the core starts or stops the token refresh guard on macOS
- **THEN** it SHALL use a platform adapter that hides launchd-specific details from front-end callers

#### Scenario: Future platform extension
- **WHEN** a new operating system adapter is introduced
- **THEN** the front-end task API SHALL remain unchanged for equivalent operations
