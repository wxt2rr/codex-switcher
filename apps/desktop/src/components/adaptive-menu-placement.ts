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
  boundaryPadding?: number;
};

export function resolveAdaptiveMenuLayout(input: AdaptiveMenuLayoutInput): AdaptiveMenuLayout {
  const gap = input.gap ?? 8;
  const boundaryPadding = input.boundaryPadding ?? 8;
  const spaceAbove = Math.max(0, input.triggerTop - input.boundaryTop - gap - boundaryPadding);
  const spaceBelow = Math.max(0, input.boundaryBottom - input.triggerBottom - gap - boundaryPadding);
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

export function isVerticalScrollBoundary(overflowY: string): boolean {
  return overflowY === "auto" || overflowY === "scroll";
}

function findVerticalScrollBoundary(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (isVerticalScrollBoundary(overflowY)) {
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
    const root = rootRef.current;
    const menuElement = menuRef.current;

    const update = () => {
      const trigger = root.getBoundingClientRect();
      const menu = menuElement.getBoundingClientRect();
      const boundaryElement = findVerticalScrollBoundary(root);
      const boundary = boundaryElement?.getBoundingClientRect();
      const nextLayout = resolveAdaptiveMenuLayout({
        triggerTop: trigger.top,
        triggerBottom: trigger.bottom,
        boundaryTop: Math.max(0, boundary?.top ?? 0),
        boundaryBottom: Math.min(window.innerHeight, boundary?.bottom ?? window.innerHeight),
        menuHeight: Math.max(menu.height, menuElement.scrollHeight),
      });
      setLayout((current) => (
        current.placement === nextLayout.placement && current.availableHeight === nextLayout.availableHeight
          ? current
          : nextLayout
      ));
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(root);
    resizeObserver.observe(menuElement);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  });

  return layout;
}

export function useAdaptiveMenuPlacement(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): AdaptiveMenuPlacement {
  return useAdaptiveMenuLayout(open, rootRef, menuRef).placement;
}
