# Account menu adaptive placement

## Goal

Account action menus should open downward by default and flip upward when the visible area below the trigger cannot contain the menu. The menu must remain usable near the bottom of the window and inside scrollable account lists.

## Design

- Reuse `useAdaptiveMenuLayout` for the account target and row action menus.
- Treat the browser viewport and the nearest genuinely scrollable vertical ancestor as placement boundaries. Layout-only `overflow: hidden` and `overflow: clip` ancestors are not scroll viewports.
- Reserve an 8px trigger gap and an 8px viewport safety inset.
- Measure the menu's natural content height so an existing `max-height` does not make a clipped menu appear to fit.
- Prefer downward placement when it fits. Otherwise choose upward placement when it fits or offers more usable room.
- Recalculate after rendering, scrolling, resizing, and menu size changes. Rechecking after render supports menus whose DOM is mounted after their logical open state changes.
- Constrain the selected side with `max-height` and preserve internal scrolling for menus that fit neither side.

## Verification

- Unit-test placement at top, middle, and bottom positions, including constrained scroll containers.
- Unit-test that non-scrollable clipping ancestors do not become placement boundaries.
- Verify delayed mounting and resize observation remain part of the hook contract.
- Run the desktop component tests and type checking.
- Visually verify a bottom account row opens its CLI menu upward without clipping.

## Scope

This change only adjusts shared menu measurement and placement. It does not change menu contents, launch behavior, or submenu horizontal placement.
