## ADDED Requirements

### Requirement: Environment owns an explicit account pool
The system SHALL let a user configure at most one enabled account pool per environment and SHALL include only explicitly selected accounts from that environment. Responses pools SHALL support both AUTH and API-key members, while Chat compatibility pools SHALL remain API-key only.

#### Scenario: Save a valid pool
- **WHEN** the user selects eligible accounts and enables the pool
- **THEN** the system persists the member configuration and exposes one shared local pool route for the environment

#### Scenario: Reject an invalid member
- **WHEN** a selected member is missing, belongs to another environment, or has an incompatible protocol or authentication mode
- **THEN** the system rejects the configuration without changing existing account runtimes

#### Scenario: Mix AUTH and API-key members
- **WHEN** the user selects a ChatGPT AUTH account and an API-key account for a Responses pool
- **THEN** both members are enabled and each request uses the selected member's native bearer credential and upstream endpoint

### Requirement: Account list exposes pool routing state
The account list SHALL display each enabled pool member's original upstream Base URL rather than the local loopback URL and SHALL identify both local proxying and automatic distribution.

#### Scenario: Display a pooled account
- **WHEN** an account belongs to an enabled account pool
- **THEN** its row shows its original upstream Base URL plus indicators for enabled proxying and enabled automatic distribution

#### Scenario: Display account runtime details
- **WHEN** the account list renders a native AUTH account or a Chat-compatible API-key account
- **THEN** native AUTH hides internal ChatGPT routing details unless an independent custom URL and key are configured, while Chat compatibility shows the real upstream URL instead of the local loopback route

### Requirement: Pool activation is transactional
The system MUST hydrate all selected member credentials and create the shared route before rewriting account runtime files, and MUST restore the prior state if any activation step fails.

#### Scenario: Activation fails during hydration
- **WHEN** one member credential cannot be hydrated
- **THEN** no account remains pointed at the incomplete pool and the prior routing state is restored

### Requirement: Pool lifecycle follows account and environment changes
The system SHALL resynchronize an enabled pool after an account is added, updated, copied, or deleted and SHALL restore original runtime settings when the pool or environment is disabled.

#### Scenario: Delete a pooled account
- **WHEN** a pool member account is deleted
- **THEN** the member and its bindings are removed atomically and remaining eligible members continue serving requests

#### Scenario: Router restarts
- **WHEN** the detached router restarts while a pool is enabled
- **THEN** the application rehydrates the pool from core account state before reporting it ready

### Requirement: User can manage pool membership and status
The environment page SHALL provide an account-pool editor with enablement, member selection, order, weight, affinity TTL, same-account failure threshold, and maximum account failover attempts, and SHALL show the current ready/degraded member counts. The editor SHALL label and explain these parameters so users can distinguish distribution weight, session affinity, same-account retries, and cross-account failover.

#### Scenario: Inspect member state
- **WHEN** the user opens an enabled pool editor
- **THEN** each member shows its runtime health, cooldown or recovery time, and last failure summary without exposing credentials

#### Scenario: Configure retry thresholds
- **WHEN** the user sets the same-account failure threshold and maximum account failover attempts
- **THEN** the editor persists both values independently and explains that the former controls retries before switching while the latter limits how many other accounts may be tried
