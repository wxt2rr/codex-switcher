## ADDED Requirements

### Requirement: Multi-open is available only for the active App account
The desktop UI SHALL show a multi-open action for every account, SHALL enable it only for the current App account, and SHALL explain the active-account requirement when disabled.

#### Scenario: Active account opens another window
- **WHEN** the user selects multi-open on the current App account
- **THEN** the system launches one additional managed App window without changing the selected account

#### Scenario: Inactive account shows disabled action
- **WHEN** the user opens the App action menu for an account that is not the current App account
- **THEN** the multi-open action is disabled and hovering it explains that only the active account supports multi-open

### Requirement: Desired window count is persistent and bounded
The system SHALL persist the desired App window count per environment, SHALL default missing or invalid values to one, and SHALL bound the value between one and eight.

#### Scenario: Successful multi-open persists the count
- **WHEN** an additional App window launches successfully
- **THEN** the environment's desired window count increases by one and remains after codex-switcher restarts

#### Scenario: Failed multi-open preserves the count
- **WHEN** an additional App window fails to launch
- **THEN** the persisted desired count remains unchanged

### Requirement: Account switching reconciles every window in the environment
The system SHALL close all managed App instances for the selected environment and SHALL reopen the persisted desired number of windows using the newly selected account.

#### Scenario: Switching an environment with multiple windows
- **WHEN** an environment has three desired App windows and the user switches its active account
- **THEN** all managed windows for that environment are closed and three replacement windows launch with the new account projection

#### Scenario: Other environments remain running
- **WHEN** the selected environment is switched while another environment has managed App instances
- **THEN** the system leaves the other environment's managed instances untouched on platforms that support isolated instances

### Requirement: Multi-window lifecycle supports desktop platforms
The system SHALL express the same desired-window behavior for macOS executable launches, Windows executable aliases, and Windows packaged-App activation.

#### Scenario: Executable launch uses isolated managed profiles
- **WHEN** macOS or a Windows executable alias launches multiple windows
- **THEN** each managed instance receives a distinct profile and is recorded under the environment scope

#### Scenario: Windows packaged App restores desired activations
- **WHEN** a Windows packaged-App target is switched with a desired count greater than one
- **THEN** the system materializes the account once and submits the saved number of activation requests

### Requirement: Environment lifecycle maintains window settings
The system SHALL migrate the saved window count when an environment is renamed and SHALL remove it when an environment is deleted.

#### Scenario: Environment is renamed
- **WHEN** an environment with a saved multi-window count is renamed
- **THEN** the count moves to the new environment name and the old key is removed

#### Scenario: Environment is deleted
- **WHEN** an environment is deleted
- **THEN** its saved window count is removed
