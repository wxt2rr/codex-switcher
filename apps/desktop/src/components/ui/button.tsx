import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  `inline-flex items-center justify-center gap-2
   rounded-lg text-sm font-medium
   transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)]
   disabled:pointer-events-none disabled:opacity-50
   focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1
   select-none whitespace-nowrap`,
  {
    variants: {
      variant: {
        default:
          "bg-neutral-950 text-white dark:bg-neutral-100 dark:text-neutral-950 " +
          "shadow-none " +
          "hover:bg-neutral-800 dark:hover:bg-white " +
          "active:bg-neutral-900 dark:active:bg-neutral-200",
        secondary:
          "bg-[#f3f4f6] text-neutral-800 dark:bg-[#1b2129] dark:text-slate-100 " +
          "hover:bg-[#eceef1] dark:hover:bg-[#232a34] " +
          "active:bg-[#e7e9ed] dark:active:bg-[#28303a]",
        outline:
          "border border-transparent bg-[#f7f8fa] dark:bg-[#161c24] dark:text-slate-100 " +
          "shadow-none " +
          "hover:bg-[#eef1f4] dark:hover:bg-[#1d2430] " +
          "active:bg-[#e8ebef] dark:active:bg-[#222a35]",
        ghost:
          "shadow-none " +
          "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-rose-600 text-white " +
          "shadow-none " +
          "hover:bg-rose-700 " +
          "active:bg-rose-700",
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
