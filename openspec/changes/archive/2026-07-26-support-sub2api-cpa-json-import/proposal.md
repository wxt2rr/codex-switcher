## Why

The desktop account dialog exposes a `sub2api` mode, but its parser accepts only one legacy flat JSON shape, produces an invalid Codex token layout, and cannot import the current Sub2API or CLIProxyAPI (CPA) formats. Users need a one-click, local, secret-safe path from either external format to an isolated Codex account.

## What Changes

- Keep Sub2API and CPA as separate selectable account creation modes.
- Accept each source's official Codex credential JSON variants, including common camel-case, snake-case, nested-token, raw-token, array, and line-delimited forms where the source supports them.
- Normalize imported credentials and write Codex's official `auth.json` structure with `refresh_token` and `account_id` inside `tokens`.
- Create accounts immediately without a preview step; validate all entries before writing and return a batch result summary.
- Hide Base URL and compatibility fields for both import modes and force Codex's default official routing.
- Preserve compatibility with the existing legacy Sub2API flat JSON input while preventing raw tokens from entering logs or persisted source payloads.

## Capabilities

### New Capabilities

- `external-codex-credential-import`: Source-specific Sub2API and CPA selection, official-format parsing, secure normalization, direct single/batch account creation, and Codex auth artifact generation.

### Modified Capabilities

None.

## Impact

- Desktop account-mode types, account creation dialog, renderer bridge, preload contract, and Electron main handlers.
- New isolated credential-import parser and tests.
- Legacy account artifact generation and Codex `auth.json` layout.
- Desktop copy and account-page contract tests; no new runtime dependency or network integration.
