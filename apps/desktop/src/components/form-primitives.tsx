import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

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
        "text-[13px] text-neutral-800 placeholder:text-neutral-400 dark:text-slate-100 dark:placeholder:text-slate-500",
        "outline-none transition-all duration-150",
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
}: {
  value?: string;
  onValueChange: (value: string) => void;
  items: SelectFieldItem[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const normalizedItems = toSelectItems(items);

  return (
    <UiSelect value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {normalizedItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
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
        "text-[13px] text-neutral-800 placeholder:text-neutral-400 dark:text-slate-100 dark:placeholder:text-slate-500",
        "outline-none transition-all duration-150",
        "hover:bg-[#e9eef5] dark:hover:bg-[#202a36]",
        "focus:border-primary focus:ring-2 focus:ring-primary/15 focus:ring-offset-0",
        "resize-y",
        props.className,
      )}
    />
  );
}
