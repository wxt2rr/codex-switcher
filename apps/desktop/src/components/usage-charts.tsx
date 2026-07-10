import type { EChartsType } from "echarts/core";
import { useEffect, useRef } from "react";

import type { UsageAggregate, UsageTrendPoint } from "../desktop-model";
import { buildUsageTrendChartOption } from "./usage-trend-chart-model";

const colors = ["#3b82f6", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444"];

export function UsageDonut({ models }: { models: UsageAggregate[] }) {
  const total = models.reduce((sum, item) => sum + item.totalTokens, 0);
  let offset = 0;
  return (
    <div className="relative mx-auto size-[210px]">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-label="Model distribution">
        <circle cx="60" cy="60" r="43" fill="none" stroke="#eef2f7" strokeWidth="17" />
        {models.map((item, index) => {
          const percent = total > 0 ? item.totalTokens / total : 0;
          const dash = percent * 270.18;
          const node = <circle key={item.key} cx="60" cy="60" r="43" fill="none"
            stroke={colors[index % colors.length]} strokeWidth="17" strokeDasharray={`${dash} ${270.18 - dash}`}
            strokeDashoffset={-offset} />;
          offset += dash;
          return node;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] text-slate-400">Token</span>
        <span className="text-lg font-semibold text-neutral-950">{formatCompact(total)}</span>
      </div>
    </div>
  );
}

export function UsageTrendChart({ trend }: { trend: UsageTrendPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const latestTrendRef = useRef(trend);
  latestTrendRef.current = trend;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let chart: EChartsType | null = null;
    void import("./usage-trend-chart-runtime").then(({ createUsageTrendChart }) => {
      if (disposed) return;
      chart = createUsageTrendChart(container);
      chartRef.current = chart;
      chart.setOption(buildUsageTrendChartOption(latestTrendRef.current), { notMerge: true, lazyUpdate: true });
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(container);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(buildUsageTrendChartOption(trend), { notMerge: true, lazyUpdate: true });
  }, [trend]);

  return <div ref={containerRef} className="h-[280px] min-h-[280px] w-full" role="img" aria-label="Token usage trend" />;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
