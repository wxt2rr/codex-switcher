## Context

codex-switcher already launches isolated Codex App processes and records each managed PID with its Codex environment name. macOS groups those processes behind visually identical Dock items and Windows produces indistinguishable taskbar buttons. The feature crosses persisted desktop settings, renderer permission UX, Electron IPC, launch lifecycle, and platform-native window integration. It must remain opt-in, avoid modifying Codex binaries, and impose no idle work when disabled.

## Goals / Non-Goals

**Goals:**

- Show a short environment monogram on every managed Codex App Dock/taskbar item that the platform adapter can resolve.
- Default the feature off and start no badge work while off.
- Explain and request macOS Accessibility permission only after an explicit first enable action.
- Apply to existing managed instances on a best-effort basis and automatically apply to future launches.
- Remove owned marks immediately when disabled and degrade without blocking Codex launches.
- Keep work event-driven and bounded.

**Non-Goals:**

- Modifying, copying, re-signing, or replacing the installed Codex App.
- Forcing a Codex restart when the setting changes.
- Identifying Codex processes that were not launched and tracked by codex-switcher.
- Guaranteeing an overlay when the operating system no longer exposes a stable Dock/taskbar item.

## Decisions

### Persist a single disabled-by-default setting and return runtime status

`desktop-settings.json` stores only `enabled`. The main process derives platform support, permission state, active marks, and unresolved instance counts at runtime. This keeps stale native state out of the settings file and lets the renderer present partial success accurately.

### Use a two-phase macOS permission flow

The renderer first shows a contextual explanation. Only its Continue action calls a dedicated main-process permission request, which uses Electron's macOS Accessibility trust API. The enabled setting is persisted only after trust succeeds. Cancel or denial leaves it off. Windows does not show this dialog because it does not require the same permission.

### Centralize behavior in an event-driven badge manager

An `AppEnvironmentBadgeManager` receives managed `{pid, environment}` instances and delegates to a platform adapter. It synchronizes at app startup, after successful Codex launches, after app activation, and after setting changes. Calls are serialized and coalesced. Disabled mode removes marks and keeps no timer. Adapter errors are diagnostics, never launch failures.

### Keep platform operations behind replaceable adapters

macOS uses a bundled N-API module loaded directly into the Electron main process to request Accessibility trust and discover matching Dock accessibility elements; Electron owns the click-through overlays. Keeping AX calls in the authorized app process avoids a separate-helper TCC identity mismatch. Dock discovery accepts only application Dock items whose trimmed title is exactly `Codex` or `ChatGPT`; substring matches such as `codex-switcher`, documents, and minimized windows are excluded before positional mapping. The native module observes Dock element move/resize/layout notifications and coalesces refreshes, so app focus and ordinary window activity do not reposition badges; only Dock geometry changes do. Since AppKit applies Space transition transforms even to stationary all-Spaces panels and the Dock's visual retreat is not reliably reflected in AX geometry, the adapter observes both scroll-based and AppKit `Swipe` trackpad gestures while badges are enabled. Global and local gesture monitors cover inactive and active application states without inspecting keyboard events. Horizontal gestures suppress marks before WindowServer starts the transition; the active-Space completion event restores them, with a bounded timeout for ordinary horizontal content scrolling. AX outward-motion detection remains a fallback for Dock auto-hide and edge changes. Panels use AppKit's primary fullscreen collection behavior—not `FullScreenNone`, which only prevents the panel itself from entering fullscreen—to opt out of other applications' fullscreen window sets, and explicitly omit auxiliary/all-applications behavior. Coordinate conversion is performed against the display containing each Dock element, rather than the active screen, so every Dock edge uses the same icon-relative placement logic. Multiple matching items are ordered along the geometry's dominant axis (X for a bottom Dock and Y for a left/right Dock) so badge identity remains aligned on every edge. Because Dock AX elements retain stale frames in fullscreen Spaces, discovery also checks for a layer-zero, display-sized application window as soon as it intersects the target display during a Space animation and refreshes again after active-Space changes. Windows uses a bundled PowerShell/.NET interop adapter to attach a taskbar overlay to resolved HWNDs. The manager treats missing or incompatible native resources as unsupported/partial rather than crashing.

For the first implementation, platform command generation and lifecycle are fully integrated and helper availability is explicitly reported. Native rendering can evolve independently without changing UI or persisted contracts.

### Derive deterministic monograms

The badge label uses the first visible grapheme of the environment name, uppercasing Latin text and falling back to `?`. A deterministic palette keyed by the full environment name reduces collisions. The full environment name remains the authoritative identity.

### Do not restart Codex automatically

Enabling synchronizes current tracked processes immediately. The success notice says that users can reopen Codex App if no effect is visible; partial success includes the unresolved count. Existing work is never interrupted merely to decorate an icon.

## Risks / Trade-offs

- [macOS Dock accessibility hierarchy changes between releases] → Keep discovery in a replaceable native module, validate elements defensively, and report unresolved instances.
- [Accessibility permission can be denied, revoked, or left stale after an unsigned local app update] → Reset only this bundle's stale TCC entry after an explicit Continue action, recheck immediately and for a bounded authorization window, and never persist a successful enable before trust.
- [Windows Store/AppID launches can lack a tracked PID] → Mark them unresolved and apply on a later lifecycle event when a window can be correlated.
- [Native helper missing, unsealed, or quarantined] → Ad-hoc seal unsigned macOS bundles after packing, strictly verify the complete bundle before publishing, fail closed at runtime, and preserve Codex launch behavior.
- [Multiple environments share the same initial] → Use deterministic colors; a future version can expand collisions to two graphemes without changing stored settings.
- [Frequent Dock/taskbar changes] → Coalesce event-driven synchronizations and avoid idle polling.

## Migration Plan

1. Ship the setting as disabled so existing installations are unchanged.
2. Include platform helper resources and verify their presence during packaging.
3. On first explicit enable, run the platform permission/capability flow and synchronize managed instances.
4. Roll back safely by removing the UI entry and manager startup call; an off/default setting leaves no native marks.

## Open Questions

- The macOS N-API module must be included in the release app signature and validated on the notarized release pipeline.
- Windows Store-packaged Codex correlation requires testing on supported Windows versions and may remain best-effort.
