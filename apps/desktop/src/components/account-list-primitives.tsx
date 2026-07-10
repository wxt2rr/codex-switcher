import type { ReactNode } from "react";
import { Command, Search, SlidersHorizontal } from "lucide-react";

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
    <section className={cn("h-full min-h-0 overflow-auto px-6 pb-6 pt-6 xl:px-8 xl:pb-8 xl:pt-8", className)}>
      <div className={cn("admin-page-content flex min-h-full w-full flex-col gap-4", contentClassName)}>{children}</div>
    </section>
  );
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
            <button
              type="button"
              className="hidden h-8 items-center gap-2 rounded-lg bg-[#f3f4f6] px-3 text-[12px] font-medium text-slate-500 dark:bg-[#1b2129] dark:text-slate-400 xl:flex"
            >
              <Command className="size-3.5" />
              K
            </button>
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

export function ListStack({ children }: { children: ReactNode }) {
  return <div className="responsive-record-scroll mt-1 space-y-2.5">{children}</div>;
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
        "rounded-[18px] bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.045)] dark:bg-[#141a22] dark:shadow-[0_10px_30px_rgba(0,0,0,0.24)]",
        className,
      )}
    >
      {children}
    </article>
  );
}

export function AvatarTile({
  label,
  index = 0,
}: {
  label: string;
  index?: number;
}) {
  const palettes = [
    "bg-slate-100 text-slate-700",
    "bg-stone-100 text-stone-700",
    "bg-zinc-100 text-zinc-700",
    "bg-neutral-100 text-neutral-700",
    "bg-sky-50 text-sky-700",
  ];

  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-[15px] text-[20px] font-semibold ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
        palettes[index % palettes.length],
      )}
    >
      {label.trim().charAt(0).toUpperCase() || "?"}
    </div>
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
        "inline-flex h-6 items-center rounded-lg px-2.5 text-[13px] font-medium",
        tone === "brand" && "bg-sky-50 text-sky-700",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "warn" && "bg-amber-50 text-amber-700",
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
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-semibold",
        tone === "success" && "bg-sky-50 text-sky-700",
        tone === "warn" && "bg-amber-50 text-amber-700",
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
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "responsive-action flex h-9 min-w-[64px] items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-[12px] font-medium transition",
        active
          ? "bg-slate-200 text-slate-900 dark:bg-[#2b3441] dark:text-white"
          : "bg-[#f7f8fa] text-neutral-800 hover:bg-[#eef1f4] dark:bg-[#1b2129] dark:text-slate-100 dark:hover:bg-[#232a34]",
        disabled && "cursor-not-allowed opacity-55",
      )}
      onClick={onClick}
      disabled={disabled}
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
