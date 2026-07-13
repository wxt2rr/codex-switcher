# Sidebar Header and Environment Row Design

## Goal

Refine the desktop sidebar header so its collapse control aligns with the macOS traffic lights, and simplify environment rows by removing redundant field captions.

## Sidebar Header

- On macOS, detach the collapse/expand control from the brand row.
- While expanded, position the 36px control at the sidebar's upper-right edge so its center aligns with the traffic-light row.
- While collapsed, move the control below the traffic lights: center it horizontally in the 78px rail with a 32px top offset. This keeps the control visible without overlapping any traffic-light hit area.
- Remove the persistent gray control background. The button remains transparent at rest and gains only a subtle background on hover.
- Keep the control outside the draggable title-bar region so it remains clickable.
- Move the expanded `codex-switcher` brand row down by approximately 8px.
- Preserve current expanded/collapsed widths. The collapsed navigation begins below the relocated control.
- On Windows and Linux, preserve the existing shared brand/control row while applying the transparent button styling.

## Environment Rows

- Remove the `CODEX_HOME` and localized `当前目标 / Targets` captions.
- Vertically center the environment path in its column.
- Vertically center the CLI/App badges in their column.
- Preserve column widths, responsive hiding priorities, actions, routing badges, and alternating row backgrounds.

## Verification

- Layout helper tests cover expanded and collapsed macOS toggle positions, the lowered-brand class, and non-macOS fallbacks.
- Responsive source-contract tests ensure the removed captions no longer render.
- Web TypeScript validation, desktop regression tests, and production build must pass.
