## Why

Agent skills are currently installed independently into each coding provider's home directory, which creates duplicated files, inconsistent versions, and no unified inventory. A dedicated Skills page can make popular catalogs discoverable while treating each existing Codex environment as an isolated skill source and projecting one chosen source into the global skill directory used by Claude Code, Qoder, ZCode, CodeBuddy/WorkBuddy, Cursor, and future providers.

## What Changes

- Add a desktop Skills page whose first tab is Marketplace, followed by every Codex environment and then each supported provider's global skill directory.
- Add install, uninstall, single-skill update, bulk update check, and refresh operations, all scoped to the selected codex-switcher environment.
- Use each Codex environment's existing `<homePath>/skills` directory as its isolated skill store; non-Codex providers keep their normal global directories such as `~/.cursor/skills`.
- Add a provider routing registry for Codex, Claude Code, Qoder, ZCode, CodeBuddy/WorkBuddy, Cursor, and configurable future providers.
- Add global provider bindings: each non-Codex provider is disabled by default or bound to exactly one Codex source environment, and only bound providers receive managed projections.
- Reconcile provider projections with symbolic links on macOS/Linux and a declared Windows strategy using directory links/junction-compatible links with an explicit copy fallback.
- Add transactional staging, source/revision pinning, integrity metadata, conflict detection, rollback, repair, and orphan-link cleanup for lifecycle operations.
- Treat marketplace metadata as untrusted remote data: validate skill structure and paths, show source/license/audit information, and require confirmation before installing executable content.
- Preserve offline usability with a last-known-good catalog cache and continue supporting manually installed local/Git skills.

## Capabilities

### New Capabilities

- `skill-marketplace-discovery`: Discover, search, filter, cache, and inspect skills from pluggable marketplace/catalog sources.
- `environment-skill-management`: Install, inventory, uninstall, and update canonical skills independently inside each environment.
- `skill-provider-routing`: Project one environment's canonical skills into supported provider directories and audit or repair routing drift.

### Modified Capabilities

None.

## Impact

- Desktop renderer: navigation model, i18n copy, Skills page, cards, detail/confirmation flows, progress and error states.
- Electron bridge/main process: network catalog adapters, Git/archive acquisition, filesystem transactions, provider path detection, link creation, and privileged error reporting.
- Core package: skill domain models, environment-scoped store/lock schema, lifecycle service, provider routing registry, reconciliation, and platform adapters.
- Local data: new `skills/`, skill lock/manifest, staging, backup, and catalog-cache data beneath managed environment/state roots.
- External systems: skills.sh and source repositories such as GitHub; all remote access is timeout-, cache-, and failure-aware.
- Dependencies: a Git/archive transport and YAML/frontmatter parser may be added or implemented with existing runtime facilities; no hosted backend is required for the first release.
