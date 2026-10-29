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
        <div className="text-[15px] font-semibold tracking-tight text-foreground">{title}</div>
        <div className="mt-1 text-[13px] leading-5 text-muted-foreground">{subtitle}</div>
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
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div key={value} className="motion-value-update mt-2 text-[2rem] font-semibold leading-none tracking-tight text-foreground">{value}</div>
      {hint ? <div className="mt-2 text-[13px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-muted/80 px-4 py-3">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div key={value} className="motion-value-update mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

export function BigNumber({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-muted/80 px-4 py-5">
      <div key={value} className="motion-value-update text-4xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-2 text-sm font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

export function StatCard({ label, value, helper, valueClassName }: { label: string; value: string; helper: ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0 px-5 py-3">
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      <div key={value} className={cn("motion-value-update mt-1 text-[20px] font-semibold tracking-[-0.03em] text-foreground", valueClassName)}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{helper}</div>
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
        ? "border border-border bg-muted text-foreground"
        : "border border-border/60 bg-accent text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-0.5",
        "text-xs font-semibold",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}
