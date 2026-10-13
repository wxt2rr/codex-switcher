import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  `inline-flex items-center justify-center gap-2
   rounded-[var(--cs-radius-sm)] text-sm font-medium
   transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)]
   disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50
   focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1
   select-none whitespace-nowrap`,
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs " +
          "hover:bg-[var(--cs-primary-hover)] hover:shadow-sm " +
          "active:bg-[var(--cs-primary-hover)]",
        secondary:
          "bg-secondary text-secondary-foreground " +
          "hover:bg-accent hover:text-accent-foreground " +
          "active:bg-accent",
        outline:
          "border border-border bg-transparent text-foreground shadow-none " +
          "hover:bg-accent hover:border-[var(--cs-border-strong)] " +
          "active:bg-accent",
        ghost:
          "text-muted-foreground shadow-none " +
          "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-white shadow-xs " +
          "hover:opacity-90 active:opacity-95",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[var(--cs-radius-xs)] px-3 text-xs",
        lg: "h-10 rounded-[var(--cs-radius-md)] px-5 text-sm",
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
