import { useLayoutEffect, useState, type RefObject } from "react";

export type AdaptiveMenuPlacement = "up" | "down";

export function resolveAdaptiveMenuPlacement(input: {
  triggerTop: number;
  triggerBottom: number;
  boundaryTop: number;
  boundaryBottom: number;
  menuHeight: number;
  gap?: number;
}): AdaptiveMenuPlacement {
  const gap = input.gap ?? 8;
  const spaceAbove = input.triggerTop - input.boundaryTop - gap;
  const spaceBelow = input.boundaryBottom - input.triggerBottom - gap;
  if (spaceBelow >= input.menuHeight) return "down";
  if (spaceAbove >= input.menuHeight) return "up";
  return spaceAbove > spaceBelow ? "up" : "down";
}

function findVerticalScrollBoundary(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function useAdaptiveMenuPlacement(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): AdaptiveMenuPlacement {
  const [placement, setPlacement] = useState<AdaptiveMenuPlacement>("down");

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !menuRef.current) return;

    const update = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      const boundaryElement = findVerticalScrollBoundary(rootRef.current!);
      const boundary = boundaryElement?.getBoundingClientRect();
      setPlacement(resolveAdaptiveMenuPlacement({
        triggerTop: trigger.top,
        triggerBottom: trigger.bottom,
        boundaryTop: Math.max(0, boundary?.top ?? 0),
        boundaryBottom: Math.min(window.innerHeight, boundary?.bottom ?? window.innerHeight),
        menuHeight: menu.height,
      }));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, rootRef, menuRef]);

  return placement;
}
