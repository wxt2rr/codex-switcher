## ADDED Requirements

### Requirement: Desktop GUI SHALL manage switcher state through core APIs
The desktop application SHALL use structured core APIs for env, account, target, runtime, and status operations rather than reading or mutating switcher files directly.

#### Scenario: GUI loads overview state
- **WHEN** the desktop application opens
- **THEN** it SHALL request current status, envs, accounts, and task summaries from the core through structured APIs

#### Scenario: GUI performs env action
- **WHEN** a user creates, deletes, or switches an env from the desktop application
- **THEN** the desktop application SHALL invoke the corresponding core operation and refresh its view from structured results

### Requirement: Desktop GUI SHALL cover the primary switcher management workflows
The desktop application SHALL provide first-class interfaces for env management, account management, status inspection, proxy configuration, token refresh control, App control, diagnostics, and log viewing.

#### Scenario: User manages accounts from GUI
- **WHEN** a user views an env in the desktop application
- **THEN** the application SHALL allow listing accounts, switching targets, relogging, logging out, deleting accounts, and editing runtime settings for that env

#### Scenario: User inspects operational state from GUI
- **WHEN** a user opens the overview or operations area
- **THEN** the application SHALL show current CLI/App targets, auth state, token refresh state, and recent task or log results

### Requirement: Desktop GUI SHALL support structured long-running task presentation
The desktop application SHALL present progress, success, failure, and recovery guidance for long-running core tasks without requiring the user to parse raw shell output.

#### Scenario: Proxy test task in GUI
- **WHEN** a user starts a proxy test from the desktop application
- **THEN** the application SHALL display task progress and the structured final result from the core

#### Scenario: Token refresh run-once task in GUI
- **WHEN** a user triggers a token refresh scan from the desktop application
- **THEN** the application SHALL display task status, counters, and any accounts requiring relogin

### Requirement: Desktop GUI SHALL explicitly represent bridged external interactions
The desktop application SHALL distinguish between native GUI-managed actions and bridged external interactions such as Codex login flows or system command execution.

#### Scenario: Bridged login flow
- **WHEN** a user starts a login flow that depends on external `codex` interaction
- **THEN** the application SHALL present it as a bridged task with status, logs, and completion or failure feedback

#### Scenario: Diagnostic fix action
- **WHEN** a user runs a repair action that executes external system commands
- **THEN** the application SHALL show the action as a privileged or external task rather than as an inline synchronous form operation

### Requirement: Desktop GUI SHALL preserve safe-destructive workflows
The desktop application SHALL require explicit confirmation for destructive operations that alter or remove envs, accounts, login state, or repaired state.

#### Scenario: Delete env confirmation
- **WHEN** a user attempts to delete an env
- **THEN** the application SHALL require explicit confirmation before invoking the core delete operation

#### Scenario: Logout current active account
- **WHEN** a user attempts to log out an account that is active for a target
- **THEN** the application SHALL present the impact and require explicit confirmation before proceeding
