# Usage Trend Time-Series Design

## Goal

Render usage statistics as a meaningful time series for the selected range and expose the full usage breakdown for each time bucket on hover.

## Data Aggregation

The Electron usage store remains the source of truth for aggregation. It selects a bucket size from the requested range:

- Up to 6 hours: 5-minute buckets.
- More than 6 hours and up to 48 hours: 1-hour buckets.
- More than 48 hours and up to 14 days: 6-hour buckets.
- More than 14 days: 1-day buckets.

The store aligns the range to bucket boundaries and returns every bucket between the aligned start and end. Missing buckets contain zero requests and tokens, `null` costs, and a `null` cache hit rate. This keeps the chart's time axis continuous without inventing usage.

## Chart

The web renderer uses ECharts through `echarts/core` and registers only the line chart, tooltip, grid, legend, dataset, and canvas renderer modules required by this view. The chart instance is created once, resized with its container, updated when the snapshot changes, and disposed when the component unmounts.

The left Y axis represents tokens and plots Input, Output, Cache Creation, and Cache Read. The right Y axis represents Cache Hit Rate from 0% to 100%, rendered as a purple dashed line. Token series use distinct blue, green, amber, and cyan colors. Symbols remain hidden normally and appear for the hovered axis point.

The X axis is a time axis. ECharts chooses non-overlapping labels based on available width. Labels and tooltip timestamps use the user's local time.

## Hover Details

Axis-triggered tooltips show one bucket at a time with:

- Local date and time.
- Input.
- Output.
- Cache Creation.
- Cache Read.
- Cache Hit Rate.
- Actual cost.
- Standard cost.

Token values use compact formatting with the exact value available in the label. Costs use currency formatting when present and `-` when unavailable. A vertical axis pointer connects the tooltip to the selected time bucket.

## Refresh Behavior

Existing manual and scheduled page refreshes continue to load snapshots. Updating a snapshot calls `setOption` on the existing chart instance so the chart does not flash or lose its responsive dimensions.

## Verification

- Unit tests cover bucket-size selection and zero-filled ranges.
- Renderer tests cover conversion from `UsageTrendPoint` values into ECharts series data and tooltip content.
- Desktop TypeScript build and focused desktop tests must pass.
