## Context

codex-switcher currently models an environment with a Codex home path and isolates accounts/configuration beneath that environment. It does not model skills, marketplace metadata, or the home/configuration paths of other coding providers. Users therefore install the same skill repeatedly into provider-specific directories and cannot reliably answer which revision is active in which environment.

The new feature crosses the core state model, Electron filesystem/network boundary, and desktop UI. It must work offline after a successful refresh, must not overwrite user-owned provider content, and must account for the fact that some providers support an environment-specific home while others only scan a fixed directory under the user's home.

As of this proposal, skills.sh is the strongest default discovery surface because it exposes all-time, trending, hot, official, and audit views. Its documented catalog API requires Vercel OIDC, so an untrusted desktop binary cannot mint credentials or safely embed a service token. The architecture therefore separates catalog discovery from source installation and does not depend on HTML scraping. Git/GitHub source URLs remain the installation source of truth.

## Goals / Non-Goals

**Goals:**

- Use every existing Codex home as an independently versioned skill library without introducing environments for other providers.
- Browse popular and official skill catalogs through replaceable adapters and a last-known-good cache.
- Install, uninstall, update, inspect, audit, repair, and roll back skills from the desktop application.
- Project canonical skills into Codex, Claude Code, Qoder, ZCode, CodeBuddy/WorkBuddy, Cursor, and future providers without duplicating normal updates.
- Preserve user-owned files and expose conflicts instead of silently overwriting them.
- Provide deterministic, testable behavior on macOS, Linux, and Windows.

**Non-Goals:**

- Operating a public skill marketplace or accepting publisher uploads.
- Guaranteeing that a third-party skill is safe merely because it is listed or audited by a marketplace.
- Loading/reloading skills inside an already-running provider process.
- Supporting simultaneous different skill environments for providers that only scan one fixed global directory.
- Executing a skill's scripts during installation.
- Replacing project-local, repository-committed skills in the first release.

## Decisions

### Use the existing Codex home as the isolated skill store

No new generic environment abstraction is added. Codex remains the only environment-aware provider and skills live directly under its existing home path:

```text
~/.codex-envs/<env>/home/
  skills/                       # directories loaded by Codex
    <skill-id>/SKILL.md
  .codex-switcher/
    skills.lock.json            # source, revision, integrity, state
    staging/
    backups/
    operation.lock
```

Custom Codex environments use `<configured-home>/skills` with lifecycle metadata under `<configured-home>/.codex-switcher`. Existing directories are scanned even when no lock entry exists and are shown as local/unmanaged skills.

Alternative: use one global canonical skill directory for every environment. Rejected because it breaks environment isolation and makes independent pins impossible.

### Keep one installed copy and project individual skills

Provider directories receive one managed link per canonical skill, not a link that replaces the entire provider `skills` directory. This preserves provider-native and user-created skills alongside managed ones. Every projection has a matching manifest record containing provider, target path, canonical target, link mode, and last reconciliation result.

A target entry is modified only when it is absent or is already owned by codex-switcher. A real directory, file, or foreign link with the same name becomes a visible conflict. The user can rename/import it or skip that provider; it is never silently deleted.

Alternative: link the whole provider skills directory. Rejected because it would hide or overwrite unmanaged provider-specific content.

### Route providers through a data-driven registry

The core owns a versioned provider registry rather than scattering path rules across UI code. Initial adapters are:

| Provider ID | Display aliases | Default skill directory | Route behavior |
| --- | --- | --- | --- |
| `codex` | Codex | `<env.homePath>/skills` | One inventory tab per Codex environment; no global binding |
| `claude-code` | Claude Code | `~/.claude/skills` | One global directory bound to zero or one Codex environment |
| `qoder` | Qoder, Qoder CN | `~/.qoder/skills` / `~/.qoder-cn/skills` | One global directory bound to zero or one Codex environment |
| `zcode` | ZCode | `~/.zcode/skills` | One global directory bound to zero or one Codex environment |
| `codebuddy` | CodeBuddy, WorkBuddy | detected/configured path, default `~/.codebuddy/skills` | One global directory bound to zero or one Codex environment |
| `cursor` | Cursor | `~/.cursor/skills` | One global directory bound to zero or one Codex environment |

Provider paths are editable because vendors may change them and WorkBuddy installations may differ. Users can also add a custom provider by supplying a display name and absolute Skill directory; custom providers use the same one-source binding and managed per-skill projection rules as built-in providers. New providers can be added through registry data plus a detector without changing skill lifecycle semantics. Custom targets cannot overlap Codex Skill roots or the application state directory.

Bindings are global and provider-owned, for example `cursor -> personal` and `claude-code -> company`. Non-Codex providers start disabled. Enabling one requires choosing exactly one existing Codex source environment and performs a dry run before projecting that environment's skills into the provider's global directory. Changing the source replaces only codex-switcher-owned projections. Disabling a provider removes only owned projections and preserves both Codex sources and unmanaged global content.

Different global providers may bind to different Codex environments at the same time, but one provider cannot merge multiple environments in the first release. This avoids ambiguous same-name/version collisions in a single directory.

Alternative: write copies to every provider directory. Rejected as the default because copies drift and make update/rollback ambiguous; it remains a deliberate fallback only.

### Use platform-specific link capabilities with an explicit fallback

On macOS/Linux the router uses relative symbolic directory links where possible. On Windows it first attempts a directory symbolic link, then a same-volume junction-compatible directory link. If policy/permissions or filesystem capabilities prevent links, the user may enable `copy` mode for that provider. Copy mode records the deployed content hash and is reconciled after every install/update/uninstall; the UI shows that it is a synchronized copy rather than a live link.

Capability detection happens before mutation and is cached per provider/volume. A failed link does not silently change to copy mode.

### Separate catalog adapters from installation transports

`SkillCatalogAdapter` exposes `list`, `search`, `detail`, and optional `audit`; normalized records contain a stable catalog ID, source URL, install URL, popularity fields, publisher, license, audit summary, and freshness timestamp.

The first release defines these adapters:

- `skills-sh`: primary popular/official catalog. It can use a user/configured compatible proxy or a future official desktop-safe credential flow. Without one, it supplies deep links and explains that in-app live results are unavailable.
- `git-catalog`: pulls allowlisted Git repositories containing one or more `SKILL.md` packages, including official provider collections.
- `local-source`: imports a local directory or direct Git URL without marketplace discovery.

No adapter parses marketplace HTML. Catalog failures fall back to a validated last-known-good cache with its age displayed. A conditional request/ETag and upstream cache directives control refresh; manual refresh bypasses only the local freshness window, not upstream rate limits.

Installation uses the record's immutable Git/source coordinates, not cached card text. A transport resolves a branch/tag to a commit, stages only the selected skill subtree, rejects path traversal and escaping links, validates `SKILL.md`, then commits it to the canonical store.

### Treat the lock file as authoritative lifecycle metadata

`skills.lock.json` is schema-versioned and stores the Codex environment name, installed skill ID/name, source kind, repository/install URL, source subpath, requested ref, resolved revision, installed/content hashes, timestamps, license/audit snapshot, and local-modification state. Global provider bindings and owned projection paths are stored separately under the switcher state directory. Catalog popularity is not authoritative state.

Update checks resolve the remote revision without changing files. Update replaces a clean installation transactionally and retains a backup. If the canonical content hash differs from the installed hash, the skill is `modified`; automatic update is blocked until the user chooses backup-and-replace. Uninstall removes only the lock-owned canonical directory and projections after conflict verification.

### Make mutations transactional and serialized per environment

Install/update/uninstall/reconcile operations acquire an environment operation lock. New content is downloaded into staging, validated, hashed, and atomically renamed. Provider routing is applied after the canonical commit. If routing fails, the canonical operation remains recorded as `installed_with_routing_errors` and the prior provider projection is restored when possible; repair can retry projection without redownloading.

Updates keep a bounded backup of the previous canonical directory. Lock writes use temp-file plus atomic rename. Progress events flow through the existing Electron task/result pattern so closing the page does not corrupt the operation.

### Put remote and executable-content trust decisions in the UI

Cards show publisher/source, resolved revision, license, marketplace audit status, and whether scripts/resources are present. Before first install or a permission-relevant update, the user sees the files and is warned that skills are executable instructions and may contain scripts. The installer never runs package hooks or skill scripts. URLs, archive entries, frontmatter, names, and filesystem paths are validated in the main process.

### Expose one bridge contract to the renderer

The renderer receives typed DTOs and invokes operations such as `listSkillCatalog`, `getSkillDetail`, `listEnvironmentSkills`, `installSkill`, `checkSkillUpdates`, `updateSkill`, `uninstallSkill`, `getSkillRoutes`, and `repairSkillRoutes`. Network, Git, and filesystem access remain in core/Electron; the renderer never receives filesystem mutation authority.

The Skills page follows existing query-based soft navigation (`?view=skills`) and adds a sidebar item. Its first horizontal tab is Marketplace, followed by `Codex · <environment>` tabs and one tab for every built-in or custom provider global directory. The scope strip remains horizontally scrollable without a visible scrollbar; a directional edge fade appears only when content remains on that side. A global sync drawer shows every non-Codex provider, its target path, enabled state, Codex source-environment selector, and custom-provider delete action. Provider tabs distinguish unmanaged local skills from managed links and show their Codex source.

Marketplace and Git installation are immediate and install the canonical skill into every Codex environment, matching the always-enabled Codex rows shown in the provider-sync drawer. Enabled global providers keep their existing single-source bindings; their source environments are deduplicated with the Codex install targets and their managed projections are reconciled after installation. Provider settings therefore control directory synchronization without adding a second target-selection step to each install.

## Risks / Trade-offs

- [skills.sh official API requires Vercel OIDC] -> Keep it behind an adapter, do not embed credentials or scrape HTML, ship Git catalog/live links as the no-backend baseline, and optionally deploy a narrow authenticated proxy later.
- [A third-party skill can contain malicious instructions or scripts] -> Validate structure and paths, display provenance/audit/files, never execute at install time, and require explicit confirmation.
- [Fixed provider directories cannot represent two active environments simultaneously] -> Make the active route explicit, reconcile atomically on environment switch, prefer isolated provider homes where supported, and document the concurrency limitation.
- [Windows link creation may require privileges or developer mode] -> Detect capabilities, support directory-link/junction semantics, and offer an explicit visible copy fallback.
- [Provider path conventions can change] -> Use a versioned registry with detection and user overrides, plus route diagnostics.
- [Manual edits could be lost on update] -> Compare content hashes, block unattended replacement, and create a backup before forced update.
- [A provider collision could overwrite unmanaged content] -> Only mutate owned links/copies and surface all foreign targets as conflicts.
- [Remote catalog or source is unavailable] -> Retain a timestamped last-known-good catalog and keep installed/local management fully offline.
- [Environment deletion could leave global links] -> Reconcile/remove owned projections before deleting an environment and keep repair/orphan cleanup available.

## Migration Plan

1. Extend environment state with a stable ID/root and migrate existing managed/custom environments without moving their current Codex home.
2. Add the skill lock/cache schemas and core services behind a disabled feature flag.
3. Add provider registry, path detection, link-capability probes, and dry-run reconciliation with tests on all platforms.
4. Enable local/Git installation and canonical inventory before enabling marketplace discovery.
5. Add Skills navigation/page, typed bridge calls, progress, confirmation, and diagnostics.
6. Enable catalog adapters and cache; expose skills.sh links even when live API access is not configured.
7. On first activation, scan provider directories and offer import/link/ignore choices; never auto-claim existing directories.
8. Enable active-environment reconciliation only after the user selects providers.

Rollback disables skill routing, removes only codex-switcher-owned provider projections, and leaves canonical environment skill directories and backups intact. State migration is additive; older application versions ignore the new files and fields where compatible.

## Open Questions

- Whether codex-switcher will operate a minimal Vercel-hosted skills.sh proxy or initially ship only Git catalogs plus external skills.sh links.
- The verified default WorkBuddy skill directory and whether it is actually an alias/distribution of CodeBuddy; until confirmed it remains a detected or user-configured adapter.
- Which providers support a reliable environment-specific home variable and can therefore avoid active-global projection in the first release.
