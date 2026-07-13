# Icon Button Hover Labels Design

## Goal

Every icon-only desktop action must expose its existing accessible name as a visible hover description, including controls whose text is hidden by responsive layouts.

## Design

- Shared `IconActionButton` always sets both `aria-label` and `title` from its `label` prop.
- Raw icon-only buttons set `title` to the same localized value used by `aria-label`.
- Buttons that already render visible text keep their current appearance and behavior.
- Existing custom help popovers remain unchanged; they already provide richer hover content.

## Verification

- A source-contract test checks that the shared component binds `title={label}`.
- TypeScript checks and the desktop regression suite must continue to pass.
