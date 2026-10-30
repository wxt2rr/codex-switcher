import { useCallback, useEffect, useRef, useState } from "react";

import { useDelayedUnmount } from "./use-delayed-unmount";

export const HOVER_MENU_OPEN_DELAY = 100;
export const HOVER_MENU_CLOSE_DELAY = 180;

/**
 * Stable hover state for menus that render in the same DOM subtree as their
 * trigger. A delayed close keeps the pointer bridge usable while the menu is
 * positioned away from the trigger; pointer handlers on the root keep the
 * whole trigger/menu region as one hover target.
 */
export function useHoverMenuState({
  disabled = false,
  exitDuration = 140,
}: {
  disabled?: boolean;
  exitDuration?: number;
} = {}) {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelOpen = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const setOpen = useCallback((nextOpen: boolean) => {
    cancelOpen();
    cancelClose();
    openRef.current = nextOpen;
    setOpenState(nextOpen);
  }, [cancelClose, cancelOpen]);

  const openOnHover = useCallback(() => {
    if (disabled) return;
    cancelClose();
    cancelOpen();
    if (openRef.current) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      if (!disabled) {
        openRef.current = true;
        setOpenState(true);
      }
    }, HOVER_MENU_OPEN_DELAY);
  }, [cancelClose, cancelOpen, disabled]);

  const closeOnHover = useCallback(() => {
    cancelOpen();
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (!openRef.current) return;
      openRef.current = false;
      setOpenState(false);
    }, HOVER_MENU_CLOSE_DELAY);
  }, [cancelClose, cancelOpen]);

  useEffect(() => {
    return () => {
      cancelOpen();
      cancelClose();
    };
  }, [cancelClose, cancelOpen]);

  return {
    open,
    mounted: useDelayedUnmount(open, exitDuration),
    setOpen,
    openOnHover,
    closeOnHover,
  };
}
