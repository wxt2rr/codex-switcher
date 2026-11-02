import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import { useDelayedUnmount } from "./use-delayed-unmount";

const dialogOverlayClass =
  "motion-dialog-overlay fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center overflow-y-auto bg-[var(--cs-overlay-scrim)] px-6 py-4";
const dialogSurfaceClass =
  "motion-dialog-enter ui-overlay-surface w-full bg-popover p-6";

function DialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.body);
}

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
        "flex flex-col gap-2",
        "md:flex-row md:items-end md:justify-between",
      )}
    >
      <div>
        <h2 className="text-[22px] font-semibold tracking-[-0.035em] text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** A compact section heading used inside settings and detail surfaces. */
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        {description ? <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
}: {
  value: T;
  items: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="ui-segmented-control" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          className={cn("ui-segmented-item", value === item.value && "ui-segmented-item-active")}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ui-settings-row", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        {description ? <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={cn("ui-toggle", checked && "ui-toggle-checked", disabled && "ui-toggle-disabled")}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle-thumb" aria-hidden="true" />
    </button>
  );
}

export function StatusMessage({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "error";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("ui-status-message", `ui-status-message-${tone}`)} role={tone === "error" ? "alert" : undefined}>
      {title ? <div className="text-[13px] font-semibold">{title}</div> : null}
      <div className={cn(title && "mt-1", "text-[12px] leading-5")}>{children}</div>
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
        "ui-surface-muted flex flex-col gap-2.5 px-3 py-2.5 shadow-[var(--cs-shadow-xs)]",
        "lg:flex-row lg:items-center lg:justify-between",
      )}
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
        "ui-surface overflow-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-2 px-5 py-3",
          "md:flex-row md:items-start md:justify-between",
        )}
      >
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p> : null}
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
          <tr className="bg-[var(--cs-surface-muted)]">
            {columns.map((column) => (
              <th
                key={column}
                className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
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
          ? "bg-primary/10"
          : "odd:bg-[var(--cs-surface)] even:bg-[var(--cs-surface-muted)] hover:bg-accent",
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
    <td className={cn("px-5 py-3 align-middle text-[13px] text-foreground", className)}>
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
            "rounded-lg bg-muted/60",
            "px-6 py-8 text-center",
          )}
        >
          <div className="text-sm font-semibold text-muted-foreground">{title}</div>
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
        "rounded-lg bg-muted/70 px-3.5 py-2",
      )}
    >
      <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
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
  scrollable = true,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  closeLabel?: string;
  scrollable?: boolean;
  children: ReactNode;
}) {
  const mounted = useDelayedUnmount(open);
  if (!mounted) return null;

  return (
    <DialogPortal>
      <div data-state={open ? "open" : "closed"} className={dialogOverlayClass}>
        <div
          data-state={open ? "open" : "closed"}
          className={cn(
            dialogSurfaceClass,
            "flex max-h-[min(720px,calc(100dvh-2rem))] max-w-[520px] flex-col overflow-hidden rounded-[var(--radius-surface)]",
            !scrollable && "h-[min(720px,calc(100dvh-2rem))]",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
              {description ? <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className="motion-interactive-color inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className={cn("mt-6 pr-1", scrollable ? "min-h-0 overflow-y-auto" : "min-h-0 flex flex-1 flex-col overflow-hidden")}>
            {children}
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}

/* ─── Confirm Dialog ─── */

export function ConfirmDialog({
  open,
  title,
  description,
  impact,
  confirmLabel,
  confirmDisabled = false,
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
  confirmDisabled?: boolean;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const mounted = useDelayedUnmount(open);
  if (!mounted) return null;

  return (
    <DialogPortal>
      <div data-state={open ? "open" : "closed"} className={dialogOverlayClass}>
        <div data-state={open ? "open" : "closed"} className={cn(dialogSurfaceClass, "max-w-[460px] rounded-[var(--radius-surface)]")}>
          <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
          {description ? <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{description}</p> : null}
          {impact && (
            <div className="ui-surface-muted mt-4 p-4">
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
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}

/* ─── Progress / result dialog ─── */

export function ProgressDialog({
  open,
  title,
  phase,
  children,
  confirmLabel = "OK",
  busyLabel = "Working…",
  showRunningIcon = true,
  showBusyLabel = true,
  onConfirm,
}: {
  open: boolean;
  title: string;
  phase: "running" | "success" | "error";
  children: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  showRunningIcon?: boolean;
  showBusyLabel?: boolean;
  onConfirm?: () => void;
}) {
  const mounted = useDelayedUnmount(open);
  if (!mounted) return null;

  const isRunning = phase === "running";
  const Icon = isRunning ? LoaderCircle : phase === "success" ? CircleCheck : CircleAlert;
  const iconClass = isRunning
    ? "text-muted-foreground"
    : phase === "success"
      ? "text-primary"
      : "text-destructive";

  return (
    <DialogPortal>
      <div
        data-state={open ? "open" : "closed"}
        className={dialogOverlayClass}
        role="dialog"
        aria-modal="true"
        aria-busy={isRunning}
      >
        <div data-state={open ? "open" : "closed"} className={cn(dialogSurfaceClass, "max-w-[480px] rounded-[var(--radius-surface)]")}>
          <div className="flex items-start gap-3">
            {(!isRunning || showRunningIcon) ? <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass, isRunning && "animate-spin")} aria-hidden="true" /> : null}
            <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
          </div>
          <div className="ui-surface-muted mt-4 p-4">{children}</div>
          {isRunning && showBusyLabel ? (
            <div className="mt-5 text-right text-[13px] text-muted-foreground">{busyLabel}</div>
          ) : !isRunning ? (
            <div className="mt-5 flex justify-end">
              <Button onClick={onConfirm}>{confirmLabel}</Button>
            </div>
          ) : null}
        </div>
      </div>
    </DialogPortal>
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
        ? "border-border bg-muted text-foreground"
        : "border-border bg-muted/60 text-foreground";

  return (
    <section
      className="ui-surface overflow-hidden shadow-[var(--cs-shadow-xs)]"
    >
      <div className="px-5 py-3.5">
        <h3 className="text-[16px] font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
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
                  <div className="text-[12px] font-bold uppercase tracking-[0.18em] opacity-70">
                    {section.title}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {section.entries.map((entry) => (
                      <div
                        key={`${section.title}-${entry.label}-${entry.value}`}
                        className="ui-surface-muted flex items-start justify-between gap-4 px-3 py-2 text-[13px] text-foreground"
                      >
                        <span className="text-muted-foreground">{entry.label}</span>
                        <span className="text-right font-medium">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="ui-empty-state px-4 py-8 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        )}

        <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {rawOutputLabel}
          </div>
          <pre
            className={cn(
              "min-h-[240px] overflow-auto rounded-lg",
              "ui-surface-muted p-4 text-xs leading-6 text-muted-foreground",
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
