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
    <section className={cn("h-full min-h-0 overflow-hidden px-6 pb-6 pt-6 xl:px-8 xl:pb-8 xl:pt-8", className)}>
      <PageScrollArea>
        <div className={cn("admin-page-content flex min-h-full w-full flex-col gap-4", contentClassName)}>{children}</div>
      </PageScrollArea>
    </section>
  );
}

export function PageScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("page-scroll-gutter h-full min-h-0", className)}>{children}</div>;
}

export function ListPageHeader({
  title,
  subtitle,
  search,
  searchPlaceholder,
  onSearchChange,
  actions,
}: {
  title: string;
  subtitle: string;
  search?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  actions?: ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(0,1.8fr)] xl:items-start">
      <div>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-neutral-950 dark:text-neutral-50">{title}</h2>
        <p className="mt-1 text-[13px] leading-6 text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>

      <div className="responsive-toolbar flex min-w-0 items-center justify-start gap-2.5 xl:justify-end">
        {onSearchChange ? (
          <>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-lg border-transparent bg-[#f3f4f6] pl-10 text-[12px] shadow-none dark:bg-[#1b2129]"
              />
            </div>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg bg-[#f3f4f6] text-slate-600 dark:bg-[#1b2129] dark:text-slate-300"
              aria-label="Filter"
              title="Filter"
            >
              <SlidersHorizontal className="size-3.5" />
            </button>
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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
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
}: {
  label: string;
  tone?: "brand" | "neutral" | "success" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2.5 text-[13px] font-medium",
        tone === "brand" && "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
        tone === "success" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        tone === "warn" && "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "neutral" && "bg-slate-100 text-slate-500 dark:bg-[#202733] dark:text-slate-300",
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
        "inline-flex h-5 items-center gap-1 rounded-md px-2 text-[10px] font-semibold",
        tone === "success" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
        tone === "warn" && "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "neutral" && "bg-slate-100 text-slate-500 dark:bg-[#202733] dark:text-slate-300",
      )}
    >
      <span className="size-1 rounded-full bg-current" />
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
    <div className="mt-auto flex items-center justify-between pt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
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
