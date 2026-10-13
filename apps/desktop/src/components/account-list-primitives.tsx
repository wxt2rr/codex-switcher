import type { ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

import { Input } from "@/components/form-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ListPageFrame({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("desktop-page-frame h-full min-h-0 overflow-hidden px-6 pb-6 pt-6 xl:px-8 xl:pb-8 xl:pt-8", className)}>
      <PageScrollArea>
        <div className={cn("admin-page-content flex min-h-full w-full flex-col gap-4", contentClassName)}>{children}</div>
      </PageScrollArea>
    </section>
  );
}

export function PageScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("page-scroll-gutter h-full min-h-0 desktop-page-scroll", className)}>{children}</div>;
}

export function ListLoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="list-loading-state space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="list-loading-row rounded-[var(--cs-radius-md)] border border-border-subtle bg-card px-5 py-4">
          <div className="flex items-center gap-4">
            <span className="h-4 w-1/4 rounded bg-secondary/80" />
            <span className="h-3 flex-1 rounded bg-secondary/60" />
            <span className="h-8 w-20 rounded-lg bg-secondary/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListPageHeader({
  title,
  subtitle,
  search,
  searchPlaceholder,
  onSearchChange,
  showFilter = true,
  actions,
}: {
  title: string;
  subtitle: string;
  search?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  showFilter?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(0,1.8fr)] xl:items-start">
      <div>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-foreground">{title}</h2>
        <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{subtitle}</p>
      </div>

      <div className="responsive-toolbar flex min-w-0 items-center justify-start gap-2.5 xl:justify-end">
        {onSearchChange ? (
          <>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-[var(--cs-radius-sm)] border-border-subtle bg-secondary pl-10 text-[12px] shadow-none"
              />
            </div>
            {showFilter ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-9"
                aria-label="Filter"
                title="Filter"
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            ) : null}
          </>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

export function ListFilters({ children }: { children: ReactNode }) {
  return <div className="responsive-toolbar flex items-center gap-2.5">{children}</div>;
}

export function ListStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("responsive-record-scroll mt-1 min-h-0 flex-1 space-y-2.5", className)}>
      {children}
    </div>
  );
}

export function ListCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <article
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "management-list-card rounded-[var(--cs-radius-md)] border border-border-subtle bg-card px-5 py-4 shadow-xs",
        className,
      )}
    >
      {children}
    </article>
  );
}

export function SoftBadge({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: "brand" | "neutral" | "success" | "warn" | "danger" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2.5 text-[13px] font-medium",
        tone === "brand" && "bg-primary/10 text-primary",
        tone === "success" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        tone === "warn" && "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "info" && "bg-info/10 text-info",
        tone === "neutral" && "bg-secondary text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function RunStatusBadge({
  label,
  tone = "success",
}: {
  label: string;
  tone?: "success" | "warn" | "neutral" | "danger" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-2 text-[10px] font-semibold",
        tone === "success" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        tone === "warn" && "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "info" && "bg-info/10 text-info",
        tone === "neutral" && "bg-secondary text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function IconActionButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      className={cn(
        "motion-interactive-color responsive-action flex h-9 min-w-[64px] items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-[12px] font-medium",
        tone === "danger"
          ? "bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60"
          : active
            ? "ui-selected-control"
            : "bg-secondary text-foreground hover:bg-accent",
        disabled && "cursor-not-allowed opacity-55",
      )}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="responsive-action-label">{label}</span>
    </button>
  );
}

export function Pager({ totalLabel }: { totalLabel: string }) {
  return (
    <div className="mt-auto flex items-center justify-between pt-2 text-sm font-medium text-muted-foreground dark:text-muted-foreground">
      <span>{totalLabel}</span>
      <div className="flex items-center gap-3">
      <span className="flex h-8 items-center rounded-[var(--cs-radius-sm)] bg-secondary px-3 text-xs text-muted-foreground">
          Sort: Recent
        </span>
        <span className="flex h-8 items-center rounded-[var(--cs-radius-sm)] bg-secondary px-3 text-xs text-muted-foreground">10 / 页</span>
      </div>
    </div>
  );
}

export function EmptyList({ title }: { title: string }) {
  return (
    <div className="rounded-[var(--cs-radius-lg)] border border-dashed border-border-subtle bg-secondary/60 px-6 py-12 text-center text-sm font-semibold text-muted-foreground">
      {title}
    </div>
  );
}
