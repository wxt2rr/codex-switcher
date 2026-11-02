## ADDED Requirements

### Requirement: Subscription snapshots refresh independently of UI visibility
The system SHALL refresh eligible subscription accounts on startup, after auth/account mutations, on a bounded background interval, and after application focus or system resume.

#### Scenario: App starts with saved accounts
- **WHEN** the Electron main process becomes ready
- **THEN** it schedules one initial read for every eligible canonical account without requiring the Accounts page to be open

#### Scenario: Accounts page is hidden
- **WHEN** the page is hidden while the background interval is due
- **THEN** the main-process scheduler still refreshes according to policy

### Requirement: Refreshes are deduplicated, bounded, and backed off
The system SHALL allow at most one in-flight read per canonical account, enforce a provider-safe minimum interval, bound concurrency, and apply exponential backoff with jitter after retryable errors.

#### Scenario: Duplicate refresh requests
- **WHEN** UI refresh, startup refresh, and a scheduler tick target the same account together
- **THEN** they share one in-flight operation and produce one upstream read

#### Scenario: Rate limited upstream
- **WHEN** an upstream responds with HTTP 429 or a retry-after value
- **THEN** the scheduler records a rate-limited status and does not poll again before the derived backoff deadline

### Requirement: State is durable and token-free
The system SHALL atomically persist snapshots, scheduler state, notification dedupe keys, and consumption history in versioned local state without storing access or refresh tokens.

#### Scenario: App restarts after a successful read
- **WHEN** the app restarts before the next refresh
- **THEN** it displays the last safe snapshot with its freshness timestamp and schedules a new read

#### Scenario: State file is malformed
- **WHEN** the persisted state cannot be parsed
- **THEN** the manager preserves the unreadable file, starts from an empty safe state, and records a recoverable diagnostic

### Requirement: Identical accounts across environments share one snapshot
The system SHALL canonicalize account identity using subscription/account/workspace identifiers and SHALL update every environment reference from one canonical snapshot.

#### Scenario: Same subscription in two environments
- **WHEN** two environments reference the same ChatGPT account identity
- **THEN** the scheduler makes one upstream read and both account cards show the same snapshot and freshness

### Requirement: Error states remain distinguishable from empty data
The system SHALL represent unsupported, unauthorized, rate-limited, network-failed, parse-failed, stale, and empty-card states separately.

#### Scenario: Temporary network failure
- **WHEN** a refresh fails due to transport failure and a prior snapshot exists
- **THEN** the UI keeps the prior card details, marks them stale, shows the last error, and schedules a backoff retry

#### Scenario: Unauthorized account
- **WHEN** the upstream responds with 401 or 403
- **THEN** the snapshot is marked reauthentication-required and automation is disabled until a fresh credential is available
