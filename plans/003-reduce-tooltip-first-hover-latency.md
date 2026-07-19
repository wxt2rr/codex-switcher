# 003 — Reduce first-hover tooltip latency

- **Status**: TODO
- **Commit**: 8210b71
- **Severity**: LOW
- **Category**: Purpose & frequency / Easing & duration
- **Estimated scope**: 1 file, 1 provider configuration

## Problem

The shared tooltip provider waits 420ms before showing a tooltip. Tooltips are used across dense account, environment, usage, and settings controls, so the first hover feels unresponsive even though the actual tooltip entrance is already within the 125–200ms budget.

```tsx
// apps/desktop/src/components/ui/tooltip.tsx:5-7 — current
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={420} skipDelayDuration={180}>{children}</TooltipPrimitive.Provider>;
}
```

## Target

Reduce the initial delay to `300` ms and the skip window to `120` ms. Keep the existing 140ms enter / 100ms exit CSS motion and portal collision behavior. The shorter delay is still long enough to avoid accidental flashes, while moving across adjacent toolbar icons becomes effectively immediate after the first tooltip.

```tsx
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={120}>{children}</TooltipPrimitive.Provider>;
}
```

## Repo conventions to follow

- Tooltip content already uses the correct trigger-relative transform origin in `apps/desktop/src/components/ui/tooltip.tsx:25-31`.
- Tooltip enter and exit budgets are centralized as `--motion-tooltip-enter: 140ms` and `--motion-tooltip-exit: 100ms` in `apps/desktop/src/index.css:80-81`.

## Steps

1. Edit only `apps/desktop/src/components/ui/tooltip.tsx` and change the two provider timing values to 300 and 120.
2. Update the tooltip timing assertion in `apps/desktop/src/components/responsive-layout.test.ts` if one is added later; no CSS timing changes are required.

## Boundaries

- Do NOT change tooltip content, side, offset, collision padding, or animation classes.
- Do NOT remove the portal or trigger wrapper.
- Do NOT add tooltip motion to elements that currently have none.

## Verification

- **Mechanical**: run `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts` and `npm run --workspace appsdesktop build`.
- **Feel check**: hover a single icon briefly (under 300ms) and confirm no flash; hover until open and then move across adjacent icons, confirming the second tooltip opens without another long wait. At 10% playback, the tooltip should still enter from its trigger with the existing 140ms curve.
- Toggle reduced motion and confirm movement is removed while the tooltip still appears after the configured delay.
- **Done when**: first hover latency is 300ms, adjacent tooltip navigation uses the 120ms skip window, and no tooltip content regressions occur.
