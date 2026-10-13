import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={420} skipDelayDuration={180}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  content,
  children,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "z-[70] max-w-[280px] rounded-lg bg-neutral-950 px-3 py-2 text-[11px] font-medium leading-5 text-white shadow-md",
            "motion-tooltip-content origin-[var(--radix-tooltip-content-transform-origin)]",
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-neutral-950" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
