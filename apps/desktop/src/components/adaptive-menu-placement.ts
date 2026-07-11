import { useLayoutEffect, useState, type RefObject } from "react";

export type AdaptiveMenuPlacement = "up" | "down";

export type AdaptiveMenuLayout = {
  placement: AdaptiveMenuPlacement;
  availableHeight: number;
};

type AdaptiveMenuLayoutInput = {
  triggerTop: number;
  triggerBottom: number;
  boundaryTop: number;
  boundaryBottom: number;
  menuHeight: number;
  gap?: number;
};

export function resolveAdaptiveMenuLayout(input: AdaptiveMenuLayoutInput): AdaptiveMenuLayout {
  const gap = input.gap ?? 8;
  const spaceAbove = Math.max(0, input.triggerTop - input.boundaryTop - gap);
  const spaceBelow = Math.max(0, input.boundaryBottom - input.triggerBottom - gap);
  const placement = spaceBelow >= input.menuHeight
    ? "down"
    : spaceAbove >= input.menuHeight || spaceAbove > spaceBelow
      ? "up"
      : "down";
  return {
    placement,
    availableHeight: placement === "up" ? spaceAbove : spaceBelow,
  };
}

export function resolveAdaptiveMenuPlacement(input: AdaptiveMenuLayoutInput): AdaptiveMenuPlacement {
  return resolveAdaptiveMenuLayout(input).placement;
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

export function useAdaptiveMenuLayout(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): AdaptiveMenuLayout {
  const [layout, setLayout] = useState<AdaptiveMenuLayout>({ placement: "down", availableHeight: 320 });

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !menuRef.current) return;

    const update = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      const boundaryElement = findVerticalScrollBoundary(rootRef.current!);
      const boundary = boundaryElement?.getBoundingClientRect();
      setLayout(resolveAdaptiveMenuLayout({
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

  return layout;
}

export function useAdaptiveMenuPlacement(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): AdaptiveMenuPlacement {
  return useAdaptiveMenuLayout(open, rootRef, menuRef).placement;
}
