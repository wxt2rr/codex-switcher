# Environment list cards

## Goal

Replace the environment page's table-like continuous list with the same independent row-card pattern used by the model page. Preserve the page's information density and all existing environment actions.

## Layout

- Keep the page title, subtitle, search/create toolbar, and three summary statistics unchanged.
- Render filtered environments inside the shared `ListStack` component.
- Render each environment as an independent `ListCard` with the model page's border, radius, spacing, and hover behavior.
- Remove the continuous bordered list surface, alternating row backgrounds, forced square corners, and divider-based table treatment.

Each environment card has three regions:

1. Identity: avatar, environment name, active CLI/App badges, account count, and enabled routing status.
2. Path: a subdued, truncated monospace path that remains selectable through its title tooltip.
3. Actions: route toggle, edit, configuration files, history, and delete.

## Responsive behavior

- Desktop keeps identity, path, and actions on one row.
- At narrower widths, hide or reduce the path region before compressing the identity or action controls.
- Reuse the existing responsive record and action primitives so controls remain reachable.

## Behavior and states

- Preserve filtering, empty results, dialogs, side panels, route state, busy state, and all callbacks.
- Keep destructive styling limited to delete.
- The empty state remains a standalone list card so it aligns with the model page.

## Verification

- Add structural tests requiring `ListStack` and independent `ListCard` environment records.
- Assert removal of the table-like outer list surface, alternating row backgrounds, and forced square corners.
- Run desktop tests and production build.
- Visually compare environment and model pages at desktop and compact widths.

## Scope

This change does not alter environment data, routing behavior, dialogs, history, or the usage trend chart.
