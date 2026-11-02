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
      <label className="text-[13px] font-medium text-neutral-700">{label}</label>
      {children}
      {(hint || error) && (
        <span
          className={cn(
            "text-xs transition-colors",
            error ? "text-rose-500" : "text-neutral-400",
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
        "h-9 w-full rounded-lg border border-transparent bg-[#f1f4f8] px-3 dark:bg-[#19212b]",
        "text-[13px] text-neutral-800 placeholder:text-neutral-400 dark:text-slate-100 dark:placeholder:text-muted-foreground",
        "outline-none transition-[background-color,color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:bg-[#e9eef5] dark:hover:bg-[#202a36]",
        "focus:border-transparent focus:ring-0 focus:ring-offset-0",
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

  useEffect(() => {
    if (!open || !openOnHover) return;

    function handlePointerMove(event: PointerEvent) {
      const point = { x: event.clientX, y: event.clientY };
      lastPointerRef.current = point;
      const isInside = isPointInsideHoverMenu(
        point,
        triggerRef.current?.getBoundingClientRect() ?? null,
        contentRef.current?.getBoundingClientRect() ?? null,
        10,
      );
      if (isInside) {
        isHoveringRef.current = true;
        cancelClose();
      } else {
        isHoveringRef.current = false;
        scheduleClose(point);
      }
    }

    document.addEventListener("pointermove", handlePointerMove, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      cancelClose();
    };
  }, [open, openOnHover, selectId]);

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
        "min-h-[120px] w-full rounded-lg border border-transparent bg-[#f1f4f8] px-3 py-2.5 dark:bg-[#19212b]",
        "text-[13px] text-neutral-800 placeholder:text-neutral-400 dark:text-slate-100 dark:placeholder:text-muted-foreground",
        "outline-none transition-[background-color,color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:bg-[#e9eef5] dark:hover:bg-[#202a36]",
        "focus:border-transparent focus:ring-0 focus:ring-offset-0",
        "resize-y",
        props.className,
      )}
    />
  );
}
