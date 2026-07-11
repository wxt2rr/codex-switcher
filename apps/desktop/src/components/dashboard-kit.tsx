import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

/* ============================================================
   DASHBOARD PRIMITIVES
   Shared display components used across dashboards
   ============================================================ */

export function DashboardCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "rounded-[14px] border border-border bg-white p-5",
        "animate-fade-in-up",
        className,
      )}
    >
      {children}
    </article>
  );
}

export function DashboardCardHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-neutral-800">{title}</div>
        <div className="mt-1 text-[13px] leading-5 text-neutral-400">{subtitle}</div>
      </div>
      {actionLabel ? (
        <Button size="sm" variant="outline" onClick={onAction} className="shrink-0">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function MetricBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[13px] font-medium text-neutral-400">{label}</div>
      <div key={value} className="motion-value-update mt-2 text-[2rem] font-semibold leading-none tracking-tight text-neutral-800">{value}</div>
      {hint ? <div className="mt-2 text-[13px] text-neutral-400">{hint}</div> : null}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-3">
      <div className="text-[13px] font-medium text-neutral-400">{label}</div>
      <div key={value} className="motion-value-update mt-1 text-sm font-medium text-neutral-700">{value}</div>
    </div>
  );
}

export function BigNumber({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-5">
      <div key={value} className="motion-value-update text-4xl font-semibold tracking-tight text-neutral-800">{value}</div>
      <div className="mt-2 text-sm font-medium text-neutral-400">{label}</div>
    </div>
  );
}

export function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="min-w-0 px-5 py-3">
      <div className="text-[12px] font-medium text-slate-500">{label}</div>
      <div key={value} className="motion-value-update mt-1 text-[20px] font-semibold tracking-[-0.03em] text-neutral-950">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{helper}</div>
    </div>
  );
}

export function StatusPill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: "ok" | "warn" | "neutral";
  icon?: ReactNode;
}) {
  const className =
    tone === "ok"
      ? "border border-primary/20 bg-primary/10 text-primary"
      : tone === "warn"
        ? "border border-neutral-200 bg-neutral-50 text-neutral-700"
        : "border border-neutral-200/60 bg-neutral-100 text-neutral-500";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5",
        "text-xs font-semibold",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}
