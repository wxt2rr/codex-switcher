## ADDED Requirements

### Requirement: Environment-scoped canonical skill library
The system SHALL maintain one canonical skill library and lock manifest per environment root, and operations in one environment MUST NOT mutate another environment's canonical library.

#### Scenario: Same skill has different revisions across environments
- **WHEN** environment A installs revision X and environment B installs revision Y of the same skill
- **THEN** each environment reports and retains its own revision and content independently

#### Scenario: Existing custom environment is migrated
- **WHEN** an existing environment uses a home outside the managed environment directory
- **THEN** migration assigns it an explicit managed skill root without writing into the arbitrary home directory unless the user opts in

### Requirement: Canonical installation validation
The system SHALL stage an installation, resolve its immutable source revision, validate its selected subtree and `SKILL.md`, reject escaping paths or links, calculate integrity metadata, and atomically commit it.

#### Scenario: Valid Git skill is installed
- **WHEN** the user confirms a valid skill source and selected environment
- **THEN** the system installs only the selected skill subtree, records its resolved revision and hashes, and reports it as installed

#### Scenario: User selects multiple installation targets
- **WHEN** the user selects multiple Codex environments and/or global providers in the installation view
- **THEN** the system installs the canonical skill once in every required Codex source environment and reconciles each selected global provider through its chosen single source environment

#### Scenario: Archive attempts path traversal
- **WHEN** a source contains an entry or symbolic link that escapes the staged skill root
- **THEN** installation fails before canonical or provider paths are changed

#### Scenario: Skill includes scripts or resources
- **WHEN** the staged skill contains executable scripts or supporting resources
- **THEN** the confirmation view identifies those files and installation does not execute them

### Requirement: Installation inventory and lifecycle state
The system SHALL list environment skills with source, revision, integrity, update, local-modification, routing, and last-operation state.

#### Scenario: User switches environment on the Skills page
- **WHEN** the selected environment changes
- **THEN** installed status and available actions are recalculated from that environment's lock and canonical files

#### Scenario: Lock and files disagree
- **WHEN** an installed entry is missing, modified, or has a mismatched hash
- **THEN** the system reports a degraded or modified state and offers repair or removal without pretending it is healthy

### Requirement: Update checks and updates
The system SHALL check remote revisions without mutating installed files and SHALL update clean skills transactionally while preserving the prior version in a bounded backup.

#### Scenario: Update is available
- **WHEN** the source resolves to a newer revision than the locked revision
- **THEN** the skill is marked update-available without changing canonical or provider content

#### Scenario: Clean skill is updated
- **WHEN** the user updates an unmodified skill
- **THEN** the system validates and atomically installs the new revision, records it in the lock, reconciles routes, and retains the previous revision as a backup

#### Scenario: Locally modified skill is updated
- **WHEN** the current canonical content hash differs from its installed hash
- **THEN** automatic update is blocked until the user explicitly chooses backup-and-replace or cancels

### Requirement: Safe uninstall and rollback
The system SHALL remove only lock-owned canonical content and projections and SHALL support restoration from a retained backup after an update failure or user rollback.

#### Scenario: Installed skill is uninstalled
- **WHEN** the user confirms uninstall for one environment
- **THEN** owned provider projections and the owned canonical skill are removed while other environments and unmanaged provider content remain unchanged

#### Scenario: Update commit fails
- **WHEN** a failure occurs after the prior version has been backed up but before the new version is fully committed
- **THEN** the system restores the prior canonical version and lock state or reports an explicit recoverable degraded state

### Requirement: Serialized and observable operations
Install, update, uninstall, and repair operations SHALL be serialized per environment and SHALL emit structured progress and terminal results.

#### Scenario: Two mutations target the same environment
- **WHEN** one skill mutation is running and another is requested for the same environment
- **THEN** the second operation waits or returns a structured busy result without interleaving filesystem writes

#### Scenario: User leaves the Skills page during an operation
- **WHEN** the renderer navigates away after an operation starts
- **THEN** the main-process operation completes or fails independently and its final state remains queryable

### Requirement: Offline installed-skill management
The system SHALL allow inventory, uninstall, routing audit, and local repair without marketplace connectivity.

#### Scenario: Device is offline
- **WHEN** the device has no network access
- **THEN** installed skills remain visible and local lifecycle actions remain available while remote install and update checks report offline status

### Requirement: Bundled generated-image recovery compatibility skill
The desktop application SHALL offer a disabled-by-default setting that installs the bundled `recover-codex-generated-images` skill into every Codex environment and removes only application-owned copies when disabled.

#### Scenario: User enables generated-image recovery
- **WHEN** the user enables the generated-image compatibility setting
- **THEN** the bundled skill is installed into the `skills` directory of every existing Codex environment and newly created environments inherit it

#### Scenario: User disables generated-image recovery
- **WHEN** the user disables the generated-image compatibility setting
- **THEN** only copies marked as owned by codex-switcher are removed from all Codex environments

#### Scenario: A foreign same-name skill exists
- **WHEN** any environment contains an unowned `recover-codex-generated-images` directory
- **THEN** enablement reports a conflict and preserves the existing directory without overwriting it
