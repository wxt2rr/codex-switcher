import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

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
import { isPointInsideHoverMenu } from "./hover-menu-intent";

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
      <label className="text-[12px] font-medium text-neutral-700">{label}</label>
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
        "focus:border-primary focus:ring-2 focus:ring-primary/15 focus:ring-offset-0",
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
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isHoveringRef = useRef(false);

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

  function handleHoverOpen() {
    if (disabled) return;
    cancelClose();
    cancelOpen();
    isHoveringRef.current = true;
    // Small delay to prevent accidental opens when moving quickly past
    openTimerRef.current = window.setTimeout(() => {
      if (isHoveringRef.current) {
        setOpen(true);
      }
    }, 40);
  }

  function handleHoverLeave() {
    isHoveringRef.current = false;
    cancelOpen();
    // Immediate close when leaving, no delay
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 50);
  }

  function scheduleClose(point?: { x: number; y: number }) {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      if (point && isPointInsideHoverMenu(
        point,
        triggerRef.current?.getBoundingClientRect() ?? null,
        contentRef.current?.getBoundingClientRect() ?? null,
        6,
      )) return;
      // Always close if we're not hovering
      if (!isHoveringRef.current) {
        setOpen(false);
      }
    }, 50);
  }

  useEffect(() => {
    if (!open || !openOnHover) return;

    function handlePointerMove(event: PointerEvent) {
      const point = { x: event.clientX, y: event.clientY };
      const isInside = isPointInsideHoverMenu(
        point,
        triggerRef.current?.getBoundingClientRect() ?? null,
        contentRef.current?.getBoundingClientRect() ?? null,
        6,
      );
      if (isInside) {
        isHoveringRef.current = true;
        cancelClose();
      } else {
        // Only close if we're not hovering over another Select
        // Use a small delay to allow for smooth transitions between Selects
        if (!isHoveringRef.current) {
          scheduleClose(point);
        }
      }
    }

    // Use a unique identifier for this Select instance
    const instanceId = Math.random().toString(36).substr(2, 9);
    (window as any).__selectInstances = (window as any).__selectInstances || new Map();
    (window as any).__selectInstances.set(instanceId, { close: () => setOpen(false) });

    document.addEventListener("pointermove", handlePointerMove, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      (window as any).__selectInstances?.delete(instanceId);
      cancelClose();
      cancelOpen();
    };
  }, [open, openOnHover]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cancelClose();
      cancelOpen();
    };
  }, []);

  return (
    <UiSelect value={value} onValueChange={onValueChange} disabled={disabled} open={open} onOpenChange={setOpen}>
      <SelectTrigger
        ref={triggerRef}
        className={className}
        onMouseEnter={openOnHover ? handleHoverOpen : undefined}
        onMouseLeave={openOnHover ? handleHoverLeave : undefined}
      >
        {selectedItem?.iconUrl ? (
          <div className="flex min-w-0 items-center gap-2"><img src={selectedItem.iconUrl} alt="" className="size-[18px] shrink-0 object-contain" /><span className="truncate">{selectedItem.label}</span></div>
        ) : <SelectValue placeholder={placeholder} />}
      </SelectTrigger>
      <SelectContent ref={contentRef}>
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
                  setOpen(false);
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
        "focus:border-primary focus:ring-2 focus:ring-primary/15 focus:ring-offset-0",
        "resize-y",
        props.className,
      )}
    />
  );
}
