## ADDED Requirements

### Requirement: Environment badges are opt-in
The desktop application SHALL keep Codex App environment badges disabled by default and SHALL perform no platform badge synchronization while disabled.

#### Scenario: Existing user opens settings
- **WHEN** no environment badge setting has been saved
- **THEN** the environment badge switch is off and no helper is active

### Requirement: macOS enable requires contextual Accessibility consent
On macOS the application SHALL explain why Accessibility access is needed before invoking the system permission prompt, and SHALL persist enabled state only after trust is confirmed.

#### Scenario: User grants permission
- **WHEN** the user turns the switch on, continues from the explanation, and grants Accessibility access
- **THEN** the enabled setting is saved and managed Codex instances are synchronized

#### Scenario: User cancels or denies permission
- **WHEN** the user cancels the explanation or Accessibility trust is not granted
- **THEN** the setting remains disabled and the application reports that the feature was not enabled

#### Scenario: User grants permission in System Settings
- **WHEN** the system permission request initially returns untrusted and the user grants access in System Settings
- **THEN** codex-switcher performs immediate, focus, visibility, and bounded authorization rechecks and automatically completes enablement without requiring another click

#### Scenario: A local unsigned update leaves a stale permission entry
- **WHEN** the user explicitly continues the enable flow while the current bundle is untrusted
- **THEN** codex-switcher resets only its own Accessibility entry before requesting access for the currently running bundle

### Requirement: Supported platforms receive managed instance identity
The application SHALL synchronize each live managed Codex App PID with its full environment name, deterministic monogram, and deterministic color to the active platform adapter.

#### Scenario: A new managed Codex instance launches
- **WHEN** badges are enabled and codex-switcher successfully launches a tracked Codex App process
- **THEN** the badge manager attempts to apply that environment's mark without delaying or failing the Codex launch

#### Scenario: Existing managed instances are present
- **WHEN** badges are enabled or the desktop application is activated
- **THEN** the badge manager reconciles all currently tracked live instances on a best-effort basis

### Requirement: Badge lifecycle is non-destructive
The application SHALL NOT modify, copy, replace, or re-sign Codex App and SHALL NOT automatically restart it when badge settings change.

#### Scenario: User enables badges
- **WHEN** synchronization cannot mark an existing window
- **THEN** the application leaves that window running and recommends reopening Codex App only as an optional recovery action

#### Scenario: User disables badges
- **WHEN** the user turns the setting off
- **THEN** the application stops badge work and removes only marks it owns without restarting Codex App

### Requirement: User feedback distinguishes complete and partial application
The application SHALL report successful, partial, permission-denied, and unsupported outcomes with actionable localized notices.

#### Scenario: All instances are marked
- **WHEN** enable synchronization resolves every tracked instance
- **THEN** the success notice says the feature is enabled and suggests reopening Codex App only if no effect is visible

#### Scenario: Some instances are unresolved
- **WHEN** enable synchronization leaves N tracked instances unresolved
- **THEN** the notice identifies N unresolved windows and suggests reopening Codex App

### Requirement: Runtime overhead is bounded
The badge manager SHALL serialize and coalesce synchronization, use bounded helper calls, and SHALL NOT run a continuous idle polling loop.

### Requirement: Dock badge placement follows Dock geometry only

On macOS, the badge overlay SHALL remain stable across application focus changes, SHALL follow the visibility lifecycle of the corresponding Dock item, and SHALL be present only where the Dock is available. Its AppKit collection behavior SHALL opt out of other applications' fullscreen window sets rather than relying only on post-transition visibility checks; a fullscreen Space SHALL never receive it.

#### Scenario: Another application has a similar Dock title

- **WHEN** a Dock application title merely contains `Codex` or `ChatGPT`, including `codex-switcher`
- **THEN** it is excluded from badge target discovery and cannot shift the environment-to-Codex-item mapping

#### Scenario: User switches app or Space

- **WHEN** badges are enabled and the user activates another app or opens ordinary windows
- **THEN** existing badges remain visible and their positions are not refreshed solely because of that activity

#### Scenario: User changes Space and the Dock retreats

- **WHEN** a scroll-based or AppKit `Swipe` trackpad gesture begins a Space transition
- **THEN** the event-driven native adapter hides badges before WindowServer moves either Space and restores them after the active-Space completion notification

#### Scenario: User scrolls horizontal application content

- **WHEN** horizontal input does not result in a Space change
- **THEN** badges restore after a bounded quiet interval without starting periodic polling

#### Scenario: Dock item moves or magnifies

- **WHEN** the Dock item is reordered, magnified, auto-hidden or restored, moved to the bottom, left, or right edge, moved to another display, or the Dock layout changes
- **THEN** the native observer coalesces the event and updates the affected badge positions from the item's actual accessibility rectangle without assuming a fixed Dock edge

#### Scenario: Dock is hidden or the current Space is fullscreen

- **WHEN** the Dock is configured to auto-hide, is not visible on the current display, or a fullscreen application owns the current Space
- **THEN** badges belonging to that Dock are hidden and are restored when the Dock becomes visible again

#### Scenario: A fullscreen Space is entering or leaving

- **WHEN** a display-sized application window begins intersecting the target display during a Space transition
- **THEN** the native observer hides the corresponding badges before the destination fullscreen Space is composited and restores them only after the fullscreen window has completely left the display

#### Scenario: Feature remains enabled while no lifecycle event occurs
- **WHEN** the desktop application and Codex windows are idle
- **THEN** the badge manager performs no periodic synchronization work

### Requirement: Unsupported platforms degrade safely
The desktop application SHALL expose the setting as unavailable on unsupported platforms and SHALL preserve all Codex launch behavior if a platform helper is missing or fails.

#### Scenario: Adapter fails during launch synchronization
- **WHEN** a platform adapter throws or times out after Codex App launches
- **THEN** the Codex launch still succeeds and badge status records an unresolved instance or diagnostic
