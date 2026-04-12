## ADDED Requirements

### Requirement: CLI can persist multiple authenticated accounts
Codex CLI MUST allow a user to add and persist multiple authenticated accounts concurrently on the same machine.

#### Scenario: User adds a second CLI account
- **WHEN** a user authenticates a new account while another CLI account already exists
- **THEN** the new account SHALL be stored without removing existing accounts

#### Scenario: Accounts persist across CLI restarts
- **WHEN** a user restarts the CLI after adding multiple accounts
- **THEN** the CLI SHALL reload all previously stored accounts

### Requirement: CLI can list stored accounts with status metadata
Codex CLI MUST provide an account listing operation that includes account identity, active marker, and token validity status.

#### Scenario: Account list shows active account
- **WHEN** a user runs account listing command
- **THEN** exactly one stored account SHALL be marked as active

#### Scenario: Account list shows invalid status
- **WHEN** a stored account token is expired or revoked
- **THEN** the listing output SHALL mark the account as requiring re-authentication

### Requirement: CLI supports safe account removal
Codex CLI MUST allow removing an account and handle active-account removal deterministically.

#### Scenario: Remove non-active account
- **WHEN** a user removes an account that is not active
- **THEN** the active account pointer SHALL remain unchanged

#### Scenario: Remove active account with fallback
- **WHEN** a user removes the current active account and at least one other valid account exists
- **THEN** the CLI SHALL assign another valid account as active

#### Scenario: Remove final remaining account
- **WHEN** a user removes the only stored account
- **THEN** the CLI SHALL clear active account state and require login for authenticated commands
