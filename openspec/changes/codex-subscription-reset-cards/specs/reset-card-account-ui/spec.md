## ADDED Requirements

### Requirement: Account cards show reset-card status compactly
The Accounts page SHALL show a reset-card status row for eligible auth accounts with count, loading, stale, unsupported, empty, and error states, without representing an unreadable card list as zero.

#### Scenario: Fresh cards exist
- **WHEN** a fresh snapshot has three available cards
- **THEN** the account card shows `3` cards and a nonintrusive reset-card indicator

#### Scenario: Snapshot is stale
- **WHEN** the last read is stale but contains cards
- **THEN** the account card keeps the count, marks it stale, and exposes the last sync time/error

#### Scenario: API-key account
- **WHEN** the account is not a subscription account
- **THEN** the reset-card row is neutral/unsupported and does not offer refresh or consume actions

### Requirement: Details are available on hover and keyboard focus
The system SHALL provide a hover- and focus-accessible popover listing each available card's safe label, type, exact/relative expiry, freshness, and last error, with a manual refresh action subject to cooldown.

#### Scenario: User hovers the count
- **WHEN** the pointer enters the reset-card indicator
- **THEN** the popover shows all card details without another upstream request

#### Scenario: Keyboard user focuses the count
- **WHEN** the indicator receives keyboard focus
- **THEN** the same details are available and dismissible without a pointer

### Requirement: Settings expose safe global and per-account controls
The Settings page SHALL expose refresh interval, expiry reminder lead, system notification enablement, auto-use mode, pre-use behavior, and per-account auto-use overrides with clear irreversible-action copy.

#### Scenario: User enables expiring-card automation
- **WHEN** the user selects the expiring trigger and saves
- **THEN** the setting persists, is reflected in the account controls, and does not enable unrelated accounts when an override is disabled

#### Scenario: User disables automation
- **WHEN** the user turns automatic use off
- **THEN** pending automatic actions are canceled and future background reads remain enabled

### Requirement: Manual refresh and consume have visible state
The UI SHALL show synchronization progress, cooldown, confirmation, success, failure, and ambiguous-result states without blocking unrelated account selection.

#### Scenario: Manual refresh
- **WHEN** the user clicks refresh for an account
- **THEN** the UI shows a nonblocking refresh state, updates the card when complete, and reports the last sync result

#### Scenario: Manual consume succeeds
- **WHEN** the user confirms a card consume and the upstream succeeds
- **THEN** the UI shows the outcome, refreshes the count/details, and makes the audit time visible
