# Usage Trend Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display continuous, range-aware usage curves with complete per-time-bucket hover details.

**Architecture:** The Electron usage store chooses an adaptive SQL aggregation bucket and zero-fills missing buckets. A focused renderer chart model converts snapshots to ECharts options, while the React component owns one responsive ECharts instance and updates it in place.

**Tech Stack:** TypeScript, React 19, Electron, sql.js, ECharts 6, Node test runner.

## Global Constraints

- Use 5-minute, 1-hour, 6-hour, and 1-day buckets at the approved range thresholds.
- Missing buckets must represent zero usage rather than interpolated usage.
- Tooltip content must include all token categories, cache hit rate, actual cost, and standard cost.
- ECharts must be imported from `echarts/core` with only required modules registered.
- Existing manual and scheduled refresh behavior must remain unchanged.

---

### Task 1: Continuous usage buckets

**Files:**
- Modify: `apps/desktop/electron/usage-store.ts`
- Test: `apps/desktop/electron/usage-store.test.ts`

**Interfaces:**
- Produces: `resolveUsageTrendBucketMs(rangeMs: number): number` and continuous `UsageTrendPoint[]` returned by `queryUsage`.

- [ ] **Step 1: Add failing tests for adaptive bucket sizes and missing-bucket zero filling.**
- [ ] **Step 2: Run `npx tsx --test apps/desktop/electron/usage-store.test.ts` and confirm the new assertions fail.**
- [ ] **Step 3: Implement bucket selection, aligned range generation, and merge SQL rows into zero-valued buckets.**
- [ ] **Step 4: Run the focused store test and confirm it passes.**

### Task 2: ECharts option model

**Files:**
- Create: `apps/desktop/src/components/usage-trend-chart-model.ts`
- Create: `apps/desktop/src/components/usage-trend-chart-model.test.ts`
- Modify: `apps/desktop/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `UsageTrendPoint[]`.
- Produces: `buildUsageTrendChartOption(trend: UsageTrendPoint[], locale?: string): EChartsCoreOption` and tooltip formatting helpers.

- [ ] **Step 1: Add ECharts as a desktop workspace dependency.**
- [ ] **Step 2: Write failing tests for five series, dual axes, timestamps, null cost rendering, and tooltip detail.**
- [ ] **Step 3: Run the focused chart-model test and confirm it fails.**
- [ ] **Step 4: Implement the chart option and tooltip model with local-time formatting.**
- [ ] **Step 5: Run the focused chart-model test and confirm it passes.**

### Task 3: Responsive interactive chart component

**Files:**
- Modify: `apps/desktop/src/components/usage-charts.tsx`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: `buildUsageTrendChartOption` and `UsageTrendPoint[]`.
- Produces: a responsive `UsageTrendChart` that updates one ECharts instance in place.

- [ ] **Step 1: Replace the SVG trend implementation with an ECharts container using `useEffect`, `ResizeObserver`, and instance cleanup.**
- [ ] **Step 2: Register only `LineChart`, `GridComponent`, `LegendComponent`, `TooltipComponent`, and `CanvasRenderer`.**
- [ ] **Step 3: Add the chart-model test to `test:desktop` and run the focused renderer tests.**

### Task 4: Verification

**Files:**
- Verify: `apps/desktop/electron/usage-store.test.ts`
- Verify: `apps/desktop/src/components/usage-trend-chart-model.test.ts`

**Interfaces:**
- Produces: fresh test and build evidence.

- [ ] **Step 1: Run the focused usage store and chart-model tests.**
- [ ] **Step 2: Run the desktop test suite and record any pre-existing unrelated failure separately.**
- [ ] **Step 3: Run `npm run build --workspace apps/desktop`.**
- [ ] **Step 4: Inspect the final diff against every requirement in the design spec.**
