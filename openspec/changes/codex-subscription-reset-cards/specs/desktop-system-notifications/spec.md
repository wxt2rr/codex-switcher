## ADDED Requirements

### Requirement: System notifications are cross-platform and degradable
The system SHALL use the Electron native notification channel when supported on macOS, Windows, or Linux and SHALL fall back to the existing in-app notice when native notifications are unavailable or disabled.

#### Scenario: Native notification supported
- **WHEN** a user enables system notifications on a supported platform
- **THEN** the main process sends a native notification and reports delivery capability to the renderer

#### Scenario: Native notification unsupported
- **WHEN** the platform or runtime cannot deliver a native notification
- **THEN** the event is shown through the in-app notice without failing the quota operation

### Requirement: Notification events are deduplicated and safe
The system SHALL deduplicate expiry, pre-consumption, success, failure, sync-error, and reauthentication events using persisted account/card/event keys and SHALL never include credentials or full opaque credit ids.

#### Scenario: Repeated expiry polls
- **WHEN** five scheduler polls observe the same card within the same reminder threshold
- **THEN** at most one expiry notification is delivered for that threshold

#### Scenario: Card changes
- **WHEN** a card's expiry or availability changes
- **THEN** a new notification key is eligible and the previous card key is not reused

### Requirement: Notification actions focus the relevant account
The system SHALL associate notifications with canonical account and environment references and SHALL focus the app and select the relevant account when the user clicks a notification.

#### Scenario: User clicks an expiry notification
- **WHEN** the user clicks an expiry notification
- **THEN** the app opens/focuses the Accounts view and highlights the corresponding account's reset-card details

### Requirement: Automatic-use notifications precede destructive actions
The system SHALL send a pre-consumption notification before an automatic consume and SHALL honor the configured grace or confirmation policy before sending the upstream consume request.

#### Scenario: Grace-period mode
- **WHEN** an automatic trigger is confirmed and grace mode is enabled
- **THEN** the system notifies the user, waits the configured grace period, revalidates, and consumes only if the trigger still holds

#### Scenario: Confirmation mode
- **WHEN** confirmation mode is enabled
- **THEN** the system notifies the user and waits for explicit confirmation; it never consumes on notification delivery alone
