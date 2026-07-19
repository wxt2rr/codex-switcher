## ADDED Requirements

### Requirement: Data-driven provider routing registry
The system SHALL define provider IDs, aliases, detected/configured skill directories, isolation capability, and supported link modes in a versioned registry.

#### Scenario: Initial providers are enumerated
- **WHEN** provider routing settings are loaded
- **THEN** Codex, Claude Code, Qoder, ZCode, CodeBuddy/WorkBuddy, and Cursor are available with their detected or configured paths

#### Scenario: Default provider path is incorrect
- **WHEN** the user supplies a valid path override
- **THEN** subsequent dry runs and reconciliations use the override without changing canonical skill content

### Requirement: Global provider binding
The system SHALL treat Codex as the only environment-isolated provider and SHALL persist, for every non-Codex provider, either a disabled state or exactly one Codex source-environment binding.

#### Scenario: Initial binding state
- **WHEN** skill routing is first loaded
- **THEN** every Codex environment is available as an isolated inventory and every non-Codex provider binding is disabled

#### Scenario: Providers bind to different environments
- **WHEN** the user binds Cursor to Personal and Claude Code to Company
- **THEN** Cursor projects Personal skills and Claude Code projects Company skills independently

#### Scenario: Provider is selected during installation
- **WHEN** the user selects a global provider as an installation target and chooses one Codex source environment
- **THEN** the canonical skill is installed in that source environment when needed and the provider is enabled or rebound to project the complete source-environment skill set

#### Scenario: User disables a provider
- **WHEN** the user disables Cursor
- **THEN** the system removes only codex-switcher-owned Cursor projections and leaves every Codex environment and unmanaged Cursor content unchanged

#### Scenario: User changes a provider source
- **WHEN** the user changes Cursor from Personal to Company after confirming the dry run
- **THEN** owned Cursor projections are reconciled to Company while foreign entries remain unchanged

### Requirement: Canonical-to-provider projection
The system SHALL expose each selected environment skill to an enabled provider using a managed per-skill directory link or an explicit synchronized-copy fallback.

#### Scenario: Link-capable provider is reconciled
- **WHEN** an installed skill is enabled for a provider whose target supports directory links
- **THEN** the provider target contains a managed per-skill link resolving to the selected environment's canonical skill directory

#### Scenario: Link capability is unavailable
- **WHEN** the platform cannot create a supported directory link
- **THEN** reconciliation fails with capability guidance unless the user has explicitly enabled copy fallback for that provider

#### Scenario: Copy fallback is enabled
- **WHEN** a provider uses copy fallback and canonical content changes
- **THEN** reconciliation replaces only the owned synchronized copy and records the deployed content hash

### Requirement: Preserve unmanaged provider content
The router MUST NOT replace, delete, or adopt a real directory, file, or foreign link in a provider skill path unless the user completes an explicit import or conflict-resolution action.

#### Scenario: Target name conflicts with user content
- **WHEN** a target path already exists and is not owned by codex-switcher
- **THEN** the route is reported as conflicted and the existing target remains unchanged

#### Scenario: Provider contains unrelated skills
- **WHEN** codex-switcher reconciles its managed projections
- **THEN** unrelated unmanaged entries in the provider skills directory remain unchanged

### Requirement: Active environment routing for fixed provider homes
For a provider that scans one fixed global skill directory, the system SHALL maintain zero or one explicit Codex source binding and SHALL atomically reconcile only managed projections when that binding changes.

#### Scenario: Active environment changes
- **WHEN** the user or configured follow-mode changes the active skill environment from A to B
- **THEN** owned projections for A are replaced by owned projections for B and the current route is persisted

#### Scenario: Fixed-home provider is used concurrently
- **WHEN** a user attempts to assign two active environments simultaneously to one fixed-home provider
- **THEN** the system rejects the configuration and explains that the provider supports only one active projection

### Requirement: Codex environment inventories and global provider inventories
The system SHALL expose one inventory for each Codex environment and one inventory for each supported non-Codex global skill directory.

#### Scenario: Codex environments are listed
- **WHEN** Personal and Company Codex environments exist
- **THEN** the Skills page exposes `Codex · Personal` and `Codex · Company` tabs backed by their respective `<homePath>/skills` directories

#### Scenario: Global provider is listed
- **WHEN** Cursor support is available
- **THEN** the Skills page exposes one Cursor tab backed by `~/.cursor/skills` or its configured override

### Requirement: Routing audit, repair, and orphan cleanup
The system SHALL classify each expected projection as healthy, missing, stale, conflicted, copied-drifted, or orphaned and SHALL offer a dry run before repair.

#### Scenario: Managed link is missing
- **WHEN** an expected owned projection has been removed
- **THEN** audit reports it as missing and repair recreates it without redownloading the canonical skill

#### Scenario: Managed link points to the wrong environment
- **WHEN** an owned link resolves outside the expected canonical target
- **THEN** audit reports it as stale and repair replaces only that owned link

#### Scenario: Environment is deleted
- **WHEN** an environment with active projections is removed
- **THEN** the system removes or reroutes its owned projections before deleting its routing metadata and leaves canonical backup handling explicit

### Requirement: Cross-platform link behavior
The routing layer SHALL use platform capability detection and SHALL provide deterministic macOS/Linux symbolic-link and Windows directory-link/junction-compatible behavior.

#### Scenario: Windows lacks symbolic-link privilege
- **WHEN** symbolic directory links fail on Windows but a supported junction-compatible link can be created
- **THEN** the router uses the recorded junction-compatible mode without requiring a content copy

#### Scenario: Target and source prevent supported Windows links
- **WHEN** neither symbolic nor junction-compatible linking is possible for the selected paths
- **THEN** the router returns a structured unsupported-link result and offers explicit copy fallback
