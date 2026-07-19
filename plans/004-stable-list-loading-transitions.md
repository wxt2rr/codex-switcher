# 004 — Add stable list loading transitions

- **Status**: DONE
- **Commit**: 8210b71
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Interruptibility / Accessibility
- **Estimated scope**: 4–6 files, shared primitives plus page loading states

## Problem

Several high-traffic lists replace their entire content with text/spinners or leave stale geometry while async data loads. Examples include the Skills marketplace (`apps/desktop/src/pages/skills-page.tsx:329-332`), usage request details (`apps/desktop/src/pages/usage-request-details-page.tsx:200`), and model lists (`apps/desktop/src/pages/models-page.tsx:169-172`). The refresh icon spins, but the rows do not communicate which content is being replaced, so cards jump when data arrives.

```tsx
// apps/desktop/src/pages/skills-page.tsx:329-332 — current
{loading && !snapshot ? (
  <div className="flex h-48 items-center justify-center text-slate-400"><LoaderCircle className="size-5 animate-spin" /></div>
) : (
```

```tsx
// apps/desktop/src/pages/usage-request-details-page.tsx:200 — current
{!loading && data.items.length === 0 ? <div className="flex h-[320px] items-center justify-center text-sm text-slate-400">{zh ? "没有符合条件的请求" : "No matching requests"}</div> : null}
```

## Target

Create a shared `ListLoadingState` (or equivalent in `account-list-primitives.tsx`) that preserves the list's available height, renders 3–5 neutral row placeholders with `animate-pulse`, and uses an opacity crossfade when the real rows replace them. Animate only `opacity` and `transform`; do not animate height or margins. Keep the existing spinner for explicit refresh buttons, but do not show a full-page spinner when cached data is already present.

Required behavior:

- Initial load: stable placeholder rows, no layout collapse.
- Refresh with existing data: retain rows at 70% opacity and show the existing button spinner; do not blank the list.
- Empty state: render only after loading completes.
- Reduced motion: pulse becomes a static neutral placeholder and row crossfade is removed.

Use the existing `--ease-out` curve and keep row transitions at 160–200ms. Do not introduce keyframes for list entrances; CSS transitions are interruptible.

## Repo conventions to follow

- Shared list geometry lives in `apps/desktop/src/components/account-list-primitives.tsx:7-27` and `.responsive-record-scroll` in `apps/desktop/src/index.css:507-513`.
- Reduced-motion rules already live in `apps/desktop/src/index.css:547-575`.
- Existing data-value updates use the short `motion-value-update` pattern in `apps/desktop/src/index.css:400-405`; loading rows should be quieter and must not reuse that value-update keyframe.

## Steps

1. Add a shared loading-row primitive with configurable row count and `aria-busy="true"` to `account-list-primitives.tsx`.
2. Add shared CSS classes for loading opacity/transform transitions and a reduced-motion override in `index.css`.
3. Replace the Skills, Models, Accounts, Environments, Usage, and Usage Request Details blank/spinner list states with the primitive while retaining current cached data during refresh.
4. Add source-level tests covering stable loading geometry, `aria-busy`, and no `animate-pulse` movement under reduced motion.

## Boundaries

- Do NOT add staggered entrance animation to every row.
- Do NOT animate `height`, `width`, `margin`, `padding`, or table layout.
- Do NOT change fetch cadence, pagination, or empty-state copy.

## Verification

- **Mechanical**: run the desktop responsive-layout/page tests and `npm run --workspace appsdesktop build`.
- **Feel check**: throttle the network, load each management page, and confirm placeholders occupy the same visual region as final rows. Trigger refresh while rows are visible; rows must not disappear or jump.
- Toggle reduced motion and confirm placeholders remain visible but static.
- **Done when**: every async management list has stable initial geometry, refresh does not blank existing content, and empty states never flash before loading completes.
