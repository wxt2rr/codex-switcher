# 005 — Animate usage chart updates safely

- **Status**: DONE
- **Commit**: 8210b71
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Performance / Accessibility
- **Estimated scope**: 2–3 files, chart runtime and usage chart wrapper

## Problem

The usage trend chart is created with ECharts and updated with `setOption`, but the wrapper does not explicitly control animation or show a stable loading state. The donut SVG has no reveal/update motion. During refreshes, a new dataset can redraw abruptly, while resizing can leave the chart visually stale until ECharts completes its next layout.

```tsx
// apps/desktop/src/components/usage-charts.tsx:45-64 — current
chart = createUsageTrendChart(container);
chartRef.current = chart;
chart.setOption(buildUsageTrendChartOption(latestTrendRef.current), { notMerge: true, lazyUpdate: true });
observer = new ResizeObserver(() => chart?.resize());
...
chartRef.current?.setOption(buildUsageTrendChartOption(trend), { notMerge: true, lazyUpdate: true });
```

## Target

Use a short, interruptible chart update animation for data changes and an opacity-only initial reveal:

- First render: `opacity: 0` to `opacity: 1` over 180ms ease-out on the chart wrapper.
- Data update: ECharts `animationDurationUpdate: 180`, `animationEasingUpdate: 'cubicOut'`; no animation on resize.
- Disable all chart animation when `prefers-reduced-motion: reduce` is active.
- Keep the chart container responsive with a CSS height using `clamp(220px, 32vh, 280px)` and `min-height: 220px`; do not hard-code a single 280px height.
- Add a viewBox-based donut stroke reveal using `stroke-dashoffset` only if it can be driven from existing values without a JS frame loop; otherwise leave the donut static.

## Repo conventions to follow

- `apps/desktop/src/components/usage-charts.tsx:45-64` already owns lifecycle and `ResizeObserver`; keep resize handling there.
- Chart options are centralized in `apps/desktop/src/components/usage-trend-chart-model.ts`; add animation options there rather than scattering them in the React component.
- The global motion curve is `--ease-out` in `apps/desktop/src/index.css:89`; use the ECharts equivalent only because ECharts cannot consume CSS variables.

## Steps

1. Add responsive container height classes and an opacity transition class to `UsageTrendChart`.
2. Add update animation options to `buildUsageTrendChartOption`, with an explicit reduced-motion parameter or runtime media-query check.
3. Ensure `ResizeObserver` calls `chart.resize({ animation: false })` (or the ECharts equivalent) so resizing never interpolates data.
4. Add tests for chart option animation values, reduced-motion behavior, and stable container sizing.

## Boundaries

- Do NOT add a requestAnimationFrame loop, blur filters, or animated layout properties.
- Do NOT animate tooltips, axes, or every data point independently.
- Do NOT change token aggregation, series colors, labels, or tooltip content.

## Verification

- **Mechanical**: run usage chart model tests, responsive-layout tests, and `npm run --workspace appsdesktop build`.
- **Feel check**: use the 5s refresh interval with a changing dataset; lines should interpolate once over 180ms and never restart continuously. Resize from a narrow to a wide window; the chart should snap to the new geometry without a second data animation.
- Enable reduced motion and confirm the chart appears without line interpolation while remaining readable.
- **Done when**: refreshes animate data changes once, resize is immediate, and chart height remains usable from short laptop windows to large monitors.
