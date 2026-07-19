# 006 — Make all management layouts viewport-adaptive

- **Status**: DONE
- **Commit**: 8210b71
- **Severity**: HIGH
- **Category**: Performance / Missed opportunities / Physicality & origin
- **Estimated scope**: 8–12 files, shared layout plus page-specific responsive rules

## Problem

The shell correctly uses `h-screen`, but several page components still rely on fixed widths/heights that become cramped or clipped in short and narrow windows. Examples:

```tsx
// apps/desktop/src/components/usage-charts.tsx:66 — current
return <div ref={containerRef} className="h-[280px] min-h-[280px] w-full" role="img" aria-label="Token usage trend" />;
```

```tsx
// apps/desktop/src/pages/usage-request-details-page.tsx:161-162 — current
<section className="min-h-[420px] overflow-hidden rounded-[14px] border border-black/[0.05] bg-white">
  <div className="overflow-auto">
```

```tsx
// apps/desktop/src/pages/models-page.tsx:175 — current
<ListCard key={model.id} className="responsive-record-row grid min-h-[86px] grid-cols-[minmax(220px,1fr)_minmax(160px,0.8fr)_auto] items-center gap-5">
```

The current container-query rules in `apps/desktop/src/index.css:574-690` cover account/environment/overview rows, but not all page cards, chart panels, filter toolbars, dialogs, or the height budget for short windows.

## Target

Every desktop page must satisfy these invariants:

- Width: content never causes page-level horizontal scroll; dense tables/toolbars may scroll inside their own bounded region.
- Height: the primary list/chart region consumes remaining viewport height with `min-height: 0`; fixed heights are replaced with `clamp()` or `max-height: calc(100dvh - <header budget>)`.
- Cards: card grids collapse at container widths, not only viewport widths; no card has content narrower than 0 due to long URLs/models.
- Modals/side panels: body scroll is contained inside the panel, with `max-height: min(720px, calc(100dvh - 2rem))`.
- Charts: width and height respond to `ResizeObserver` and `clamp()` sizing.
- Toolbars: controls wrap or use an internal horizontal scroll at compact widths without pushing the page shell wider.

Use `100dvh` with a fallback to `100vh`, `minmax(0, 1fr)`, `min-width: 0`, and existing `.admin-page-content` container queries. Do not hide content to make a screenshot fit.

## Repo conventions to follow

- `ListPageFrame` and `PageScrollArea` in `apps/desktop/src/components/account-list-primitives.tsx:7-27` are the shared layout boundary.
- Existing container-query setup is in `apps/desktop/src/index.css:496-507`.
- Existing dialog height containment is in `apps/desktop/src/components/admin-primitives.tsx:274-286`.
- Existing account row container rules begin at `apps/desktop/src/index.css:574`; extend these rules instead of adding per-page viewport media-query duplication.

## Steps

1. Add a shared `--desktop-content-height`/`min-height: 0` layout contract to `ListPageFrame`, `PageScrollArea`, and the shell main region, with `100dvh` fallback.
2. Audit every page under `apps/desktop/src/pages/` and replace fixed panel heights with `clamp()` or remaining-space grids; preserve intentional minimums for text editors and empty states.
3. Add container-query rules for models, skills, operations, usage summary/chart panels, request details filters/table, and pricing forms.
4. Ensure each grid child has `min-width: 0`, long URLs/models use truncation or internal scroll, and only the intended table/list region owns overflow.
5. Make the chart, donut, table, and side-panel dimensions use the shared height budget.
6. Add a viewport matrix test or browser checklist covering 1024×640, 1280×720, 1440×900, and a narrow 900×600 window; include a short-height case with an open dialog.

## Boundaries

- Do NOT change navigation, data loading, routes, or visual color tokens.
- Do NOT introduce page-level `overflow-x-hidden` that masks accidental overflow; fix the responsible child.
- Do NOT remove the existing right-side scrollbar placement or compact action affordances.
- Do NOT rely on a single screenshot width as the acceptance target.

## Verification

- **Mechanical**: run all desktop page/component tests and `npm run --workspace appsdesktop build`; add a browser smoke test if the project test harness supports it.
- **Viewport check**: exercise every navigation page at the four viewport sizes above. Confirm no body/page horizontal scrollbar, no clipped card actions, and exactly one intended vertical scroll region.
- Resize the window continuously while a chart, list, table, and dialog are visible; content must reflow without jumping or losing focus.
- Open long forms at 600px height; the panel body must scroll while header/actions remain reachable.
- **Done when**: all pages remain usable at compact width and height, with no content hidden solely because the viewport is short.
