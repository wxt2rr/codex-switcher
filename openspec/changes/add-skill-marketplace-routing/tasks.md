## 1. State model and storage

- [x] 1.1 Resolve isolated Codex skill stores from existing environment home paths without adding environments for other providers.
- [ ] 1.2 Define versioned skill lock, catalog-cache, routing-manifest, backup, and operation-lock schemas with runtime validation.
- [x] 1.3 Implement atomic JSON writes, per-environment mutation locks, bounded backups, content hashing, and recovery helpers.
- [ ] 1.4 Add migration tests for managed environments, custom external homes, missing fields, and older state files.

## 2. Catalog and source acquisition

- [ ] 2.1 Define normalized catalog/source DTOs and the `SkillCatalogAdapter`/transport interfaces.
- [x] 2.2 Implement skills.sh adapter modes (configured proxy/CLI-compatible mode and link-only fallback) without HTML scraping or embedded credentials.
- [x] 2.3 Implement Git/repository and local-source discovery/acquisition, including branch/tag-to-commit resolution and selected-skill subpaths.
- [ ] 2.4 Implement conditional refresh, rate-limit/backoff handling, cache validation, stale/offline status, and duplicate merging.
- [x] 2.5 Add source validation for URLs, identifiers, frontmatter, archive paths, symlinks, size limits, and required `SKILL.md` fields.
- [ ] 2.6 Add unit/integration tests for live responses, malformed payloads, offline cache fallback, path traversal, and immutable revision recording.

## 3. Environment skill lifecycle

- [ ] 3.1 Implement canonical install staging, validation, hashing, atomic commit, lock update, and structured progress events.
- [ ] 3.2 Implement environment inventory with clean/modified/missing/update-available/degraded states.
- [ ] 3.3 Implement update check, clean update, modified-skill confirmation path, backup retention, rollback, and failed-commit recovery.
- [x] 3.4 Implement safe uninstall that removes only lock-owned canonical content and invokes routing cleanup.
- [ ] 3.5 Implement local/offline inventory, repair, and lifecycle operations independent of marketplace connectivity.
- [ ] 3.6 Add lifecycle tests for environment isolation, concurrent mutations, cancellation/navigation, rollback, and lock/file drift.
- [x] 3.7 Bundle the generated-image recovery compatibility Skill and add a persisted Settings toggle that safely installs or removes owned copies across all existing and newly created Codex environments.

## 4. Provider routing and platform adapters

- [x] 4.1 Add the versioned provider registry and initial Codex, Claude Code, Qoder, ZCode, CodeBuddy/WorkBuddy, and Cursor entries with aliases and path overrides.
- [x] 4.2 Implement global non-Codex provider bindings to zero or one Codex source environment and persist their target directories.
- [ ] 4.3 Implement macOS/Linux relative symbolic-directory links and Windows symbolic/junction-compatible capability probing.
- [ ] 4.4 Implement managed per-skill projection, copy fallback, ownership markers, conflict detection, and foreign-content preservation.
- [ ] 4.5 Implement dry-run audit, missing/stale/conflicted/copied-drifted/orphaned classification, repair, active-environment switch reconciliation, and environment-delete cleanup.
- [ ] 4.6 Add cross-platform routing tests with mocked filesystem capabilities, disabled defaults, source-binding changes, collision cases, and orphan cleanup.
- [x] 4.7 Persist custom provider definitions and expose safe create/delete operations through the typed Electron bridge.

## 5. Electron bridge and task integration

- [ ] 5.1 Add typed main-process bridge methods for catalog, inventory, detail, install, update, uninstall, route audit, route repair, and provider settings.
- [x] 5.2 Keep network/Git/filesystem work in core/Electron and map failures to existing structured operation/task results.
- [ ] 5.3 Add capability and permission diagnostics suitable for macOS/Linux/Windows link failures, stale caches, conflicts, and unavailable providers.
- [x] 5.4 Add bridge smoke tests and renderer-facing DTO contract tests.

## 6. Desktop Skills page

- [x] 6.1 Add `skills` to `NavView`, query-based initial view resolution, sidebar icon/label, and translated copy in supported UI languages.
- [x] 6.2 Build horizontal Marketplace, Codex-environment, and global-provider tabs with search/filter controls and loading/empty/error states.
- [ ] 6.3 Build skill cards and detail/confirmation dialogs showing provenance, revision, license, audit, files/scripts, installation state, and external links.
- [ ] 6.4 Add install/uninstall/update/check/repair actions with progress, success/error notices, disabled busy states, and post-mutation refresh behavior.
- [ ] 6.5 Add a global provider-sync drawer with enable controls, one Codex source selector per provider, target paths, dry-run summaries, and routing diagnostics.
- [ ] 6.6 Add renderer component/view-model tests for navigation, filtering, state badges, confirmation requirements, and operation refreshes.
- [x] 6.7 Unify marketplace and installed Skill cards, add explicit accessible detail drawers, and align provider-sync switches and Codex environment rows with the shared Settings visual system.
- [x] 6.8 Clarify provider-directory sync actions and explain that enabled providers receive Skills through managed symbolic links without separate installation.
- [x] 6.9 Fan out direct marketplace and Git installations to every always-enabled Codex environment before reconciling provider-directory bindings.
- [x] 6.10 Derive the provider-sync summary from all Codex environments and external provider bindings instead of a hard-coded external-provider count.
- [x] 6.11 Add custom provider controls and an overflow-aware, scrollbar-free horizontal scope strip with directional edge fades.

## 7. Documentation, rollout, and verification

- [ ] 7.1 Document canonical environment layout, provider path overrides, active-global limitations, Windows copy fallback, and manual conflict resolution.
- [x] 7.2 Document catalog trust boundaries, skills.sh authentication/proxy configuration, cache semantics, and source/license review expectations.
- [ ] 7.3 Gate the feature behind a migration-safe flag, run dry-run route reconciliation on upgrade, and add rollback/orphan repair guidance.
- [ ] 7.4 Run core, desktop, cross-platform, packaging, and manual smoke checks for install/update/uninstall across at least one Unix and Windows capability matrix.
