## Context

The desktop bridge currently calls `restartCurrentCodexApp` after every App account switch. The core runtime scopes managed processes by environment and gives executable launches an isolated `--user-data-dir`, but the desktop layer does not remember how many App windows an environment owns. Windows packaged-App activation also returns no manageable PID, so desired window count must be persisted independently of process records.

## Goals / Non-Goals

**Goals:**

- Let the globally active App account add managed windows without changing credentials.
- Persist a bounded desired window count per environment, defaulting to one.
- Replace every managed window in the selected environment during an account switch and reopen the saved count.
- Preserve managed windows belonging to other environments where the platform supports isolated instances.
- Provide equivalent launch intent on macOS, Windows executable aliases, and Windows packaged-App activation.

**Non-Goals:**

- Tracking windows opened directly outside codex-switcher.
- Restoring the exact conversation selected inside every App window; the App profile owns its own navigation restoration.
- Guaranteeing isolated simultaneous environments when Windows only exposes an `AppsFolder` packaged activation target.
- Unbounded window creation; the desired count is capped at eight.

## Decisions

### Persist desired count by environment

Store `appWindowCounts` in the existing desktop settings file and normalize every value to 1-8. Account switches do not reset the count because all accounts in one environment share the same managed-window layout. Environment rename/delete migrates or removes the setting.

Alternative considered: infer count only from PID records. This fails for packaged Windows activation and after crashes, and does not satisfy persistence.

### Add a distinct multi-window launch strategy

Extend the existing launch strategy union with `multi-window`. The bridge rejects it unless the selected account is already the active App target. A successful launch increments persisted count; failed launches leave the previous count intact.

Alternative considered: a separate IPC method. Keeping it in `switchAccount` preserves the current account action pipeline and busy/error handling while enforcing the same validation in one backend boundary.

### Reconcile the whole environment on switching

For normal App launch/switch, stop all managed instances scoped to the environment, launch the first replacement, then launch the remaining saved slots serially. Serial launch avoids profile ID collisions and makes partial failure observable. If a later slot fails, persist the number that actually launched rather than claiming a larger layout.

### Handle Windows packaged activation explicitly

Executable aliases use the existing isolated profile and PID records. For an `AppsFolder` target, stop the packaged App process set once, materialize the selected environment into the default home once, then invoke activation once per desired slot. Packaged activation decides whether each request creates a new window; codex-switcher records the desired count because no child PID is returned.

## Risks / Trade-offs

- [Packaged Windows App may coalesce repeated activation] -> Keep the feature available but document that actual new-window behavior depends on the installed App package; executable aliases remain the preferred path.
- [Partial relaunch opens fewer windows] -> Persist the successfully launched count and return an actionable error without repeatedly retrying.
- [Stale managed PID records] -> Reuse the existing stale-record cleanup before relaunch.
- [Rapid repeated multi-open clicks] -> Reuse the managed App action queue and desktop busy state; persist only after launch success.
- [Settings refer to deleted environments] -> Remove on delete and migrate on rename.

## Migration Plan

Existing installations have no `appWindowCounts` value and therefore normalize to one window per environment. Rollback is safe because older versions ignore the additive settings field and retain existing managed-instance files.

## Open Questions

None.
