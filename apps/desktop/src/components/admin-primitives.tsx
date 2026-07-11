import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

/* ============================================================
   ADMIN PRIMITIVES
   Shared layout components for admin pages.
   All cards, tables, panels, dialogs.
   ============================================================ */

/* ─── Page Header ─── */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 animate-fade-in-up",
        "md:flex-row md:items-end md:justify-between",
      )}
    >
      <div>
        <h2 className="text-[24px] font-semibold tracking-[-0.03em] text-neutral-950">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] leading-6 text-neutral-500">
            {description}
          </p>
        ) : null}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/* ─── Page Toolbar ─── */

export function PageToolbar({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-[14px] border border-black/[0.05] bg-white px-3 py-2.5",
        "animate-fade-in-up",
        "lg:flex-row lg:items-center lg:justify-between",
      )}
      style={{ animationDelay: "50ms" }}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
      )}
    </div>
  );
}

/* ─── Table Card ─── */

export function TableCard({
  title,
  subtitle,
  children,
  aside,
  className,
  contentClassName,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[14px] border border-black/[0.05] bg-white animate-fade-in-up",
        className,
      )}
      style={{ animationDelay: "100ms" }}
    >
      <div
        className={cn(
          "flex flex-col gap-2 px-5 py-3",
          "md:flex-row md:items-start md:justify-between",
        )}
      >
        <div>
          <h3 className="text-[15px] font-semibold text-neutral-950">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12px] text-neutral-500">{subtitle}</p> : null}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

/* ─── Data Table ─── */

export function DataTable({
  columns,
  children,
  className,
}: {
  columns: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-auto", className)}>
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-[#f5f6f8]">
            {columns.map((column) => (
              <th
                key={column}
                className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* ─── Data Row ─── */

export function DataRow({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <tr
      className={cn(
        "transition-colors duration-100",
        active
          ? "bg-sky-50/60"
          : "odd:bg-white even:bg-[#fcfcfd] hover:bg-neutral-50/80",
      )}
    >
      {children}
    </tr>
  );
}

/* ─── Data Cell ─── */

export function DataCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-5 py-3 align-middle text-[13px] text-neutral-700", className)}>
      {children}
    </td>
  );
}

/* ─── Empty Table State ─── */

export function EmptyTableState({
  colSpan,
  title,
}: {
  colSpan: number;
  title: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-10">
        <div
          className={cn(
            "rounded-lg bg-neutral-50/60",
            "px-6 py-8 text-center",
          )}
        >
          <div className="text-sm font-semibold text-neutral-600">{title}</div>
        </div>
      </td>
    </tr>
  );
}

/* ─── Toolbar Stat ─── */

export function ToolbarStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg bg-neutral-50/70 px-3.5 py-2",
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-neutral-700">{value}</div>
    </div>
  );
}

/* ─── Side Panel ─── */

export function SidePanel({
  open,
  title,
  description,
  onClose,
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(17,24,39,0.16)] px-6 backdrop-blur-[2px] animate-fade-in">
      <div className="w-full max-w-[560px] overflow-auto rounded-[20px] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.16)] animate-scale-in">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[20px] font-semibold tracking-[-0.03em] text-neutral-950">{title}</h3>
            {description ? <p className="mt-1 text-[13px] leading-6 text-neutral-500">{description}</p> : null}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className="mt-5 rounded-[16px] bg-[#f7f8fa] p-4">{children}</div>
      </div>
    </div>
  );
}

/* ─── Confirm Dialog ─── */

export function ConfirmDialog({
  open,
  title,
  description,
  impact,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "destructive",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  impact?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/28 px-6 animate-fade-in">
      <div className="w-full max-w-[480px] rounded-[20px] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.16)] animate-scale-in">
        <h3 className="text-[20px] font-semibold tracking-[-0.03em] text-neutral-950">{title}</h3>
        {description ? <p className="mt-2 text-[13px] leading-6 text-neutral-500">{description}</p> : null}
        {impact && (
          <div className="mt-4 rounded-[16px] bg-[#f5f6f8] p-4">
            {impact}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2.5">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Summary Panel ─── */

export function SummaryPanel({
  summary,
  rawOutput,
  emptyLabel,
  title = "Result",
  subtitle = "Structured feedback first, raw output second.",
  rawOutputLabel = "Raw Output",
}: {
  summary: {
    title: string;
    status: string;
    tone: "ok" | "warn" | "neutral";
    sections: Array<{
      title: string;
      entries: Array<{
        label: string;
        value: string;
        tone?: "ok" | "warn" | "neutral";
      }>;
    }>;
  } | null;
  rawOutput: string;
  emptyLabel: string;
  title?: string;
  subtitle?: string;
  rawOutputLabel?: string;
}) {
  const toneClassName =
    summary?.tone === "ok"
      ? "border-primary/20 bg-primary/10 text-primary"
      : summary?.tone === "warn"
        ? "border-neutral-200 bg-neutral-50 text-neutral-700"
        : "border-neutral-100 bg-neutral-50/60 text-neutral-700";

  return (
    <section
      className="rounded-[18px] bg-white shadow-[0_12px_36px_rgba(15,23,42,0.045)] animate-fade-in-up"
      style={{ animationDelay: "150ms" }}
    >
      <div className="px-5 py-3.5">
        <h3 className="text-[16px] font-semibold text-neutral-950">{title}</h3>
        <p className="mt-1 text-[12px] text-neutral-500">{subtitle}</p>
      </div>
      <div className="space-y-4 px-5 py-5">
        {summary ? (
          <div className={cn("rounded-[16px] px-4 py-4", toneClassName)}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">{summary.title}</div>
                <div className="mt-1 text-sm opacity-90">{summary.status}</div>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {summary.sections.map((section) => (
                <div key={section.title}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-70">
                    {section.title}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {section.entries.map((entry) => (
                      <div
                        key={`${section.title}-${entry.label}-${entry.value}`}
                        className="flex items-start justify-between gap-4 rounded-lg bg-white/80 px-3 py-2 text-[13px] text-neutral-700"
                      >
                        <span className="text-neutral-400">{entry.label}</span>
                        <span className="text-right font-medium">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-8 text-sm text-neutral-400">
            {emptyLabel}
          </div>
        )}

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-400">
            {rawOutputLabel}
          </div>
          <pre
            className={cn(
              "min-h-[240px] overflow-auto rounded-lg",
              "bg-[#fafafa] p-4 text-xs leading-6 text-neutral-500",
              "font-mono",
            )}
          >
            {rawOutput || emptyLabel}
          </pre>
        </div>
      </div>
    </section>
  );
}
