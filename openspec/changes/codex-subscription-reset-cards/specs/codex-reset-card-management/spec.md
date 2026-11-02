## ADDED Requirements

### Requirement: Subscription reset cards are read only for eligible authenticated accounts
The system SHALL identify ChatGPT/Codex subscription accounts from the existing auth state and SHALL NOT call reset-card endpoints for API-key, custom, plugin, or relay accounts.

#### Scenario: Eligible subscription account
- **WHEN** an account has a valid Codex access token and subscription auth mode
- **THEN** the manager reads usage windows and reset-card metadata using that account's credentials

#### Scenario: Unsupported account
- **WHEN** an account has API-key or custom-provider authentication
- **THEN** the account is marked unsupported without making a reset-card request and without showing zero cards

### Requirement: Reset-card metadata is normalized without losing safe detail
The system SHALL normalize available reset cards into count, stable local identity, reset type, grant time, optional expiry, availability status, observation time, and source status, while preserving an explicit unknown-expiry state.

#### Scenario: Cards include expiry dates
- **WHEN** the upstream returns multiple available credits with valid ISO expiry timestamps
- **THEN** the snapshot contains all available cards sorted by expiry, with the earliest expiring card first

#### Scenario: Cards have no expiry
- **WHEN** the upstream returns an available card without an expiry timestamp
- **THEN** the card is displayed as non-expiring/unknown according to the wire value and is never treated as expiring by automation

### Requirement: Manual reset consumption is explicit and idempotent
The system SHALL expose manual consumption only through trusted desktop IPC, SHALL require confirmation, SHALL re-read the account before consuming, and SHALL send a unique idempotency key with every consume request.

#### Scenario: User consumes a selected card
- **WHEN** the user confirms a selected available card
- **THEN** the manager revalidates the card, consumes only that card, records the request and result, and refreshes usage and cards

#### Scenario: Selected card disappeared
- **WHEN** revalidation shows the selected card is no longer available
- **THEN** the manager aborts without consuming another card and reports that the card changed

#### Scenario: Ambiguous network result
- **WHEN** the consume request times out after being sent
- **THEN** the manager records an ambiguous result, does not automatically consume a different card, and requires a fresh read before another destructive action

### Requirement: Automatic use is policy-driven and opt-in
The system SHALL default automatic use off and SHALL support independent `weekly-exhausted` and `expiring` triggers as global defaults with per-account overrides.

#### Scenario: Weekly exhaustion with a viable fallback
- **WHEN** an account's weekly window is exhausted but another eligible account can answer
- **THEN** the system does not consume a reset card for the exhausted account

#### Scenario: Weekly exhaustion without a fallback
- **WHEN** automatic weekly use is enabled, the weekly window is exhausted, no viable candidate remains, and an unused card exists
- **THEN** the system may consume one card after notification/grace and SHALL record at most one automatic weekly consumption for that weekly window

#### Scenario: Expiring card with unused windows
- **WHEN** an enabled expiring card is within the configured lead but the account's windows have not been used
- **THEN** the system leaves the card unused

#### Scenario: Expiring card with no recovery before expiry
- **WHEN** an enabled card is within the lead, a usage window has been used, and the account will remain unavailable until after the card expires
- **THEN** the system selects the earliest expiring card and consumes it only after revalidation

### Requirement: Automatic consumption is serialized and auditable
The system SHALL lock consumption per canonical account, persist the trigger, selected card, idempotency key, outcome, and timestamp, and SHALL invalidate and refresh the snapshot after a successful consume.

#### Scenario: Concurrent triggers
- **WHEN** a background poll and a gateway request trigger the same account concurrently
- **THEN** only one consume operation runs, and the other operation observes its result or re-evaluates without consuming a second card

#### Scenario: Successful automatic consumption
- **WHEN** the upstream returns a successful reset outcome
- **THEN** the account's routing state is refreshed before the next request and a success notification is eligible once

### Requirement: Reset-card consumption is never exposed through external gateway access
The system SHALL reject reset-card consume operations arriving through Agent/Gateway HTTP endpoints or gateway keys.

#### Scenario: External client attempts consume
- **WHEN** a local or remote Agent sends a request that attempts to consume a reset card
- **THEN** the gateway rejects it as unsupported/forbidden and no upstream consume request is made
