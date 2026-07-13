# Model Management Interaction Design

## Goal

Replace the always-visible model editor with a conventional list-management flow and separate model content editing from account relationship management.

## List State

- The page defaults to a full-width model list.
- `Add model` is the only primary page action.
- Each model row shows display name, slug, binding count, and `Bind`, `Edit`, `Delete` actions.
- Empty state explains that no custom models exist and does not render a disabled editor.

## Model Editor

- Add and edit open the same side panel.
- Form mode contains only `slug` and `display_name`.
- JSON mode uses the complete file shape `{ "models": [entry] }` and requires exactly one model.
- The form and JSON modes share one canonical entry and preserve advanced JSON fields.
- Save is the only primary panel action. Cancel closes without mutation.

## Account Binding

- Bind opens a separate side panel.
- Accounts are grouped by environment and filterable by environment or account name.
- Checkbox changes remain local until `Save bindings` is pressed.
- The model list shows only a binding count, not a dense set of account tags.
- Saving bindings immediately rematerializes catalogs for currently active affected accounts.

## Deletion

- Delete opens a confirmation dialog.
- The dialog states how many accounts will be unbound.
- Confirming removes the model and all of its bindings.

## Motion

- List actions are immediate.
- Existing side-panel and confirmation transitions are reused.
- No additional decorative motion is introduced.
