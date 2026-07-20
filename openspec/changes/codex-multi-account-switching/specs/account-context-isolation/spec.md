## ADDED Requirements

### Requirement: A shared codex-switcher environment has one active account
When CLI and App target the same codex-switcher environment, the system MUST resolve both targets to the same account because they share one `CODEX_HOME` configuration.

#### Scenario: App switches the account in the CLI environment
- **WHEN** CLI and App target the same environment and App switches to another account
- **THEN** both target pointers SHALL reference the selected account
- **THEN** account overview markers SHALL show CLI and App on that account only

#### Scenario: CLI and App target different environments
- **WHEN** CLI and App target different environments
- **THEN** each environment MAY keep a different active account

#### Scenario: Legacy pointers disagree in a shared environment
- **WHEN** persisted CLI and App pointers reference different accounts in the same environment
- **THEN** the system SHALL reconcile both pointers to the most recently selected valid account

### Requirement: App and CLI authentication states are isolated by scope
The system MUST store and resolve authentication state using distinct environment or client scope namespaces. This isolation does not permit different active accounts inside one shared codex-switcher environment.

#### Scenario: App login does not replace CLI account state
- **WHEN** a user signs in through Codex App while Codex CLI already has one or more authenticated accounts
- **THEN** the CLI account list and active CLI account SHALL remain unchanged

#### Scenario: CLI login does not replace App account state
- **WHEN** a user signs in through Codex CLI while Codex App is authenticated
- **THEN** the App authenticated session SHALL remain unchanged

### Requirement: Logout behavior is scope-specific
The system MUST execute logout operations within the initiating scope only unless a global logout command is explicitly invoked.

#### Scenario: CLI logout keeps App authenticated
- **WHEN** a user logs out from Codex CLI
- **THEN** Codex App SHALL remain authenticated if its app-scope session is valid

#### Scenario: App logout keeps CLI accounts stored
- **WHEN** a user logs out from Codex App
- **THEN** Codex CLI stored accounts and active account pointer SHALL remain unchanged

### Requirement: Storage schema versions support scoped migration
The system MUST support migration from legacy unscoped CLI auth state into scoped storage without losing existing account access.

#### Scenario: Legacy CLI auth record is migrated to scoped format
- **WHEN** the CLI starts with a legacy single-account auth record
- **THEN** the system SHALL create a scoped CLI account entry and set it as active
- **THEN** the original legacy record SHALL be preserved as backup before migration
