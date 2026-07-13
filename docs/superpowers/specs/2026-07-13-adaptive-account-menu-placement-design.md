# Account menu adaptive placement

## Goal

Account action menus should open downward by default and flip upward when the visible area below the trigger cannot contain the menu. The menu must remain usable near the bottom of the window and inside scrollable account lists.

## Design

- Reuse `useAdaptiveMenuLayout` for account menus.
- Treat the browser viewport and the nearest vertical `auto` or `scroll` ancestor as placement boundaries. Layout-only `overflow: hidden` and `overflow: clip` ancestors are not scroll viewports.
- Reserve an 8px trigger gap and an 8px visible-boundary inset.
- Measure the menu's natural content height so an existing `max-height` does not make clipped content appear to fit.
- Prefer downward placement when it fits. Otherwise choose upward placement when it fits or offers more usable room.
- Recalculate after rendering, scrolling, resizing, and menu size changes. Rechecking after render supports menus whose DOM is mounted after their logical open state changes.
- Constrain the selected side with `max-height` and preserve internal scrolling when neither side fits.

## Verification

- Unit-test placement at top, middle, and bottom positions.
- Unit-test scroll-boundary classification.
- Verify delayed mounting and resize observation remain part of the hook contract.
- Run the desktop component tests and production build.

## Scope

This change only adjusts shared menu measurement and placement. It does not change menu contents, launch behavior, or submenu horizontal placement.
