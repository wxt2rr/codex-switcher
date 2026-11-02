import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SelectFieldItem } from "./select-field";
import { toSelectItems } from "./select-field";
import { isPointInsideHoverMenu, type HoverPoint } from "./hover-menu-intent";
import {
  SELECT_HOVER_CLOSE_DELAY,
  SELECT_HOVER_OPEN_DELAY,
  selectHoverCoordinator,
} from "./select-hover-coordinator";

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[12px] font-medium tracking-[0.01em] text-muted-foreground">{label}</label>
      {children}
      {(hint || error) && (
        <span
          className={cn(
            "text-[12px] leading-5 transition-colors",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "ui-control-surface h-9 w-full px-3",
        "text-[13px] text-foreground placeholder:text-muted-foreground",
        "outline-none",
        "focus:border-[var(--cs-border)] focus:ring-0 focus:ring-offset-0",
        props.className,
      )}
    />
  );
}

export function Select({
  value,
  onValueChange,
  items,
  placeholder,
  disabled,
  className,
  openOnHover = true,
}: {
  value?: string;
  onValueChange: (value: string) => void;
  items: SelectFieldItem[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  openOnHover?: boolean;
}) {
  const normalizedItems = toSelectItems(items);
  const selectedItem = normalizedItems.find((item) => item.value === value);
  const [open, setOpen] = useState(false);
  const selectId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const isHoveringRef = useRef(false);
  const lastPointerRef = useRef<HoverPoint | null>(null);

  function cancelClose() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function cancelOpen() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }

  function setOpenState(nextOpen: boolean) {
    openRef.current = nextOpen;
    setOpen(nextOpen);
  }

  function handleHoverOpen(event: { clientX: number; clientY: number }) {
    if (disabled) return;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    selectHoverCoordinator.activate(selectId);
    cancelClose();
    isHoveringRef.current = true;
    if (openRef.current) {
      cancelOpen();
      return;
    }
    cancelOpen();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      if (isHoveringRef.current && !openRef.current) {
        setOpenState(true);
      }
    }, SELECT_HOVER_OPEN_DELAY);
  }

  function handleHoverLeave(event: { clientX: number; clientY: number }) {
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    isHoveringRef.current = false;
    cancelOpen();
    scheduleClose(lastPointerRef.current);
  }

  function handleHoverContentEnter(event: { clientX: number; clientY: number }) {
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    isHoveringRef.current = true;
    cancelClose();
  }

  function handleHoverContentLeave(event: { clientX: number; clientY: number }) {
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    isHoveringRef.current = false;
    scheduleClose(lastPointerRef.current);
  }

  function scheduleClose(point?: HoverPoint) {
    cancelClose();
    if (point) lastPointerRef.current = point;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      const latestPoint = lastPointerRef.current;
      if (latestPoint && isPointInsideHoverMenu(
        latestPoint,
        triggerRef.current?.getBoundingClientRect() ?? null,
        contentRef.current?.getBoundingClientRect() ?? null,
        10,
      )) {
        isHoveringRef.current = true;
        return;
      }
      if (!isHoveringRef.current) {
        selectHoverCoordinator.release(selectId);
        setOpenState(false);
      }
    }, SELECT_HOVER_CLOSE_DELAY);
  }

  useEffect(() => {
    if (!openOnHover) return;

    return selectHoverCoordinator.register(selectId, {
      cancelPendingOpen: cancelOpen,
      close: () => {
        isHoveringRef.current = false;
        cancelClose();
        cancelOpen();
        setOpenState(false);
      },
    });
  }, [openOnHover, selectId]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cancelClose();
      cancelOpen();
    };
  }, []);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && openOnHover) {
      selectHoverCoordinator.activate(selectId);
      isHoveringRef.current = true;
    }
    if (!nextOpen) {
      isHoveringRef.current = false;
      cancelClose();
      cancelOpen();
      selectHoverCoordinator.release(selectId);
      openRef.current = false;
    }
    setOpenState(nextOpen);
  }

  return (
    <UiSelect value={value} onValueChange={onValueChange} disabled={disabled} open={open} onOpenChange={handleOpenChange}>
      <SelectTrigger
        ref={triggerRef}
        className={className}
        onPointerEnter={openOnHover ? handleHoverOpen : undefined}
        onPointerLeave={openOnHover ? handleHoverLeave : undefined}
      >
        {selectedItem?.iconUrl ? (
          <div className="flex min-w-0 items-center gap-2"><img src={selectedItem.iconUrl} alt="" className="size-[18px] shrink-0 object-contain" /><span className="truncate">{selectedItem.label}</span></div>
        ) : <SelectValue placeholder={placeholder} />}
      </SelectTrigger>
      <SelectContent
        ref={contentRef}
        onPointerEnter={openOnHover ? handleHoverContentEnter : undefined}
        onPointerLeave={openOnHover ? handleHoverContentLeave : undefined}
      >
        {normalizedItems.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            action={item.actionLabel ? (
              <button
                type="button"
                disabled={item.actionDisabled}
                aria-label={item.actionLabel}
                title={item.actionLabel}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!item.actionDisabled) item.onAction?.();
                  handleOpenChange(false);
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                className={cn(
                  "ml-auto flex size-6 shrink-0 items-center justify-center rounded-md",
                  item.actionDisabled
                    ? "cursor-default text-warm-500"
                    : "text-muted-foreground hover:bg-accent hover:text-warm-500",
                )}
              >
                {item.actionIcon}
              </button>
            ) : undefined}
          >
            <span className="flex min-w-0 items-center gap-2">{item.iconUrl ? <img src={item.iconUrl} alt="" className="size-[18px] shrink-0 object-contain" /> : null}<span className="truncate">{item.label}</span></span>
          </SelectItem>
        ))}
      </SelectContent>
    </UiSelect>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "ui-control-surface min-h-[120px] w-full px-3 py-2.5",
        "text-[13px] text-foreground placeholder:text-muted-foreground",
        "outline-none",
        "focus:border-[var(--cs-border)] focus:ring-0 focus:ring-offset-0",
        "resize-y",
        props.className,
      )}
    />
  );
}
