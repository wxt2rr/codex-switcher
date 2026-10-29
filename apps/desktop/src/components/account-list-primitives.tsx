import type { ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

import { Input } from "@/components/form-primitives";
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
        <div key={index} className="list-loading-row rounded-[14px] border border-black/[0.05] bg-white px-5 py-4 dark:border-white/[0.07] dark:bg-[#141a22]">
          <div className="flex items-center gap-4">
            <span className="h-4 w-1/4 rounded bg-slate-200/80 dark:bg-slate-700/70" />
            <span className="h-3 flex-1 rounded bg-slate-200/70 dark:bg-slate-700/60" />
            <span className="h-8 w-20 rounded-lg bg-slate-200/70 dark:bg-slate-700/60" />
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
  layout = "inline",
}: {
  title: string;
  subtitle: string;
  search?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  showFilter?: boolean;
  actions?: ReactNode;
  layout?: "inline" | "stacked";
}) {
  const toolbar = (
    <div className={cn("responsive-toolbar flex min-w-0 items-center gap-2.5", layout === "inline" ? "justify-start xl:justify-end" : "flex-wrap")}>
      {onSearchChange ? (
        <>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className={cn(
                "h-8 w-full rounded-lg border-transparent pl-10 text-[12px] shadow-none",
                layout === "stacked" ? "bg-[#fbfbfc] focus:border-transparent focus:ring-0 dark:bg-[#1b2129]" : "bg-[#f3f4f6] dark:bg-[#1b2129]",
              )}
            />
          </div>
          {showFilter ? (
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#f3f4f6] text-muted-foreground dark:bg-[#1b2129] dark:text-muted-foreground/60"
              aria-label="Filter"
              title="Filter"
            >
              <SlidersHorizontal className="size-3.5" />
            </button>
          ) : null}
        </>
      ) : null}
      {actions}
    </div>
  );

  if (layout === "stacked") {
    return (
      <div className="flex shrink-0 flex-col gap-4">
        <div>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-neutral-950 dark:text-neutral-50">{title}</h2>
          <p className="mt-1 text-[13px] leading-6 text-muted-foreground dark:text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-[18px] bg-white px-3 py-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.03)] ring-1 ring-black/[0.04] dark:bg-[#141a22] dark:ring-white/[0.07]">
          {toolbar}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(0,1.8fr)] xl:items-start">
      <div>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-neutral-950 dark:text-neutral-50">{title}</h2>
        <p className="mt-1 text-[13px] leading-6 text-muted-foreground dark:text-muted-foreground">{subtitle}</p>
      </div>
      {toolbar}
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
      className={cn(
        "management-list-card rounded-[14px] border border-black/[0.05] bg-white px-5 py-4 dark:border-white/[0.07] dark:bg-[#141a22]",
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
  tone?: "brand" | "neutral" | "success" | "warn";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2.5 text-[13px] font-medium",
        tone === "brand" && "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground",
        tone === "success" && "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground",
        tone === "warn" && "bg-warm-50 text-warm-600 dark:bg-warm-950/50 dark:text-warm-300",
        tone === "neutral" && "bg-accent text-muted-foreground dark:bg-[#202733] dark:text-muted-foreground/60",
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
  tone?: "success" | "warn" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-2 text-[10px] font-semibold",
        tone === "success" && "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground",
        tone === "warn" && "bg-warm-50 text-warm-600 dark:bg-warm-950/50 dark:text-warm-300",
        tone === "neutral" && "bg-accent text-muted-foreground dark:bg-[#202733] dark:text-muted-foreground/60",
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
          ? "bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive dark:bg-destructive/30 dark:text-destructive dark:hover:bg-destructive/40"
          : active
            ? "ui-selected-control"
            : "bg-[#f7f8fa] text-neutral-800 hover:bg-[#eef1f4] dark:bg-[#1b2129] dark:text-slate-100 dark:hover:bg-[#232a34]",
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
        <span className="flex h-8 items-center rounded-lg bg-[#f3f4f6] px-3 text-xs text-slate-700 dark:bg-[#1b2129] dark:text-slate-200">
          Sort: Recent
        </span>
        <span className="flex h-8 items-center rounded-lg bg-[#f3f4f6] px-3 text-xs text-slate-700 dark:bg-[#1b2129] dark:text-slate-200">10 / 页</span>
      </div>
    </div>
  );
}

export function EmptyList({ title }: { title: string }) {
  return (
    <div className="rounded-[16px] bg-[#f5f6f8] px-6 py-12 text-center text-sm font-semibold text-neutral-500">
      {title}
    </div>
  );
}
