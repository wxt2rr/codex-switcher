import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  `inline-flex items-center justify-center gap-2
   rounded-[var(--radius-control)] text-sm font-medium
   transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)]
   disabled:pointer-events-none disabled:opacity-50
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background
   select-none whitespace-nowrap`,
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-none " +
          "hover:bg-foreground/90 active:bg-foreground/80",
        secondary:
          "ui-control-surface text-secondary-foreground " +
          "hover:bg-[var(--cs-surface-subtle)] active:bg-[var(--cs-surface-muted)]",
        outline:
          "ui-control-surface border border-[var(--cs-border-subtle)] bg-transparent text-foreground " +
          "shadow-none hover:bg-[var(--cs-surface-subtle)] active:bg-[var(--cs-surface-muted)]",
        ghost:
          "shadow-none " +
          "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-white " +
          "shadow-none " +
          "hover:bg-destructive/90 active:bg-destructive/80",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-lg px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
