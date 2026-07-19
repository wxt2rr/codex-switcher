import type { EChartsType } from "echarts/core";
import { useEffect, useId, useRef, useState } from "react";

import type { UsageAggregate, UsageTrendPoint } from "../desktop-model";
import { buildUsageTrendChartOption } from "./usage-trend-chart-model";

const colors = ["#3b82f6", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444"];

export function UsageDonut({ models }: { models: UsageAggregate[] }) {
  const maskId = useId().replace(/:/g, "");
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [drawn, setDrawn] = useState(reduceMotion);
  const total = models.reduce((sum, item) => sum + item.totalTokens, 0);
  const circumference = 2 * Math.PI * 43;
  let offset = 0;

  useEffect(() => {
    if (reduceMotion) return;
    const frame = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [reduceMotion]);

  return (
    <div className="relative mx-auto size-[210px]">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-label="Model distribution">
        <defs>
          <mask id={maskId}>
            <circle
              cx="60"
              cy="60"
              r="43"
              fill="none"
              stroke="white"
              strokeWidth="18"
              strokeDasharray={circumference}
              strokeDashoffset={drawn ? 0 : circumference}
              className="usage-donut-reveal"
            />
          </mask>
        </defs>
        <circle cx="60" cy="60" r="43" fill="none" stroke="#eef2f7" strokeWidth="17" />
        <g mask={`url(#${maskId})`}>
          {models.map((item, index) => {
            const percent = total > 0 ? item.totalTokens / total : 0;
            const dash = percent * circumference;
            const node = <circle key={item.key} cx="60" cy="60" r="43" fill="none"
              stroke={colors[index % colors.length]} strokeWidth="17" strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset} className="usage-donut-segment" />;
            offset += dash;
            return node;
          })}
        </g>
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
  const motionRef = useRef(true);
  const [ready, setReady] = useState(false);
  latestTrendRef.current = trend;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let chart: EChartsType | null = null;
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    motionRef.current = motion;
    void import("./usage-trend-chart-runtime").then(({ createUsageTrendChart }) => {
      if (disposed) return;
      chart = createUsageTrendChart(container);
      chartRef.current = chart;
      chart.setOption(buildUsageTrendChartOption(latestTrendRef.current, undefined, motion), { notMerge: true, lazyUpdate: true });
      setReady(true);
      observer = new ResizeObserver(() => chart?.resize({ animation: { duration: 0 } }));
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
    chartRef.current?.setOption(buildUsageTrendChartOption(trend, undefined, motionRef.current), { notMerge: true, lazyUpdate: true });
  }, [trend]);

  return <div ref={containerRef} data-ready={ready} className="usage-trend-chart w-full" role="img" aria-label="Token usage trend" />;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
