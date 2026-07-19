## ADDED Requirements

### Requirement: Documentation covers the supported user workflows
The website SHALL provide a Chinese documentation center at `/zh/docs/` with navigation and pages for installation, concepts, accounts, models and compatibility, environments, CLI/App launch, usage analytics, settings, and troubleshooting.

#### Scenario: New user follows the quick start
- **WHEN** a new user opens the documentation
- **THEN** the user can follow an ordered path from installation through creating an environment, adding an account, and launching CLI or App

#### Scenario: User looks up a specific feature
- **WHEN** a user selects an item in the documentation navigation
- **THEN** the site opens a stable URL with the relevant task instructions and links to related concepts

### Requirement: Documentation explains platform-specific behavior
The documentation SHALL include macOS unsigned-app handling, Windows SmartScreen and MSIX behavior, Codex installation paths, local routing ports, environment variables, and process lifecycle behavior.

#### Scenario: User encounters a platform launch issue
- **WHEN** a user opens the platform troubleshooting section
- **THEN** the page gives platform-specific commands or UI steps and a way to verify the fix

### Requirement: Documentation provides structured troubleshooting
The documentation SHALL index common errors including role incompatibility, reasoning, compaction, tool calls, route startup, missing paths, Windows process permissions, and unsupported provider formats.

#### Scenario: User searches an error message
- **WHEN** a user searches for or opens an error entry
- **THEN** the page presents the symptom, likely cause, remediation, and verification result in that order

### Requirement: Documentation supports client-side search
The documentation SHALL expose a search control that returns matching page titles and relevant text without requiring an account or server-side service.

#### Scenario: User searches for a feature
- **WHEN** a user enters a keyword such as `Chat 兼容` or `路由端口`
- **THEN** matching documentation pages are listed and selectable
