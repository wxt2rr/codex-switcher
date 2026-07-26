## Context

The desktop account dialog currently has a single `sub2api` import mode implemented inside the Electron bridge. It accepts only one flat JSON object, requires an ID token that Sub2API treats as optional, and writes refresh and account identifiers at the wrong level of Codex's `auth.json`. The UI also shows an API-key-shaped placeholder and has no CPA source.

Sub2API and CLIProxyAPI (CPA) expose different external credential representations, but both ultimately describe a Codex ChatGPT session. These external formats are import sources, not durable runtime modes. The account manager and isolated environments must continue to see the imported result as a normal Codex authorization account.

Credential payloads contain long-lived secrets. Parsing and conversion therefore remain entirely local, raw payloads must not enter logs or saved application state, and validation errors must describe structure rather than values.

## Goals / Non-Goals

**Goals:**

- Present Sub2API and CPA as separate, understandable choices in account creation.
- Parse the official formats used by each source, including Sub2API's documented input variants.
- Normalize both sources through one typed internal credential model.
- Produce Codex-compatible `auth.json` files and default official routing.
- Validate a complete batch before writing and create directly without preview.
- Add focused parser, conversion, bridge, and UI contract tests.

**Non-Goals:**

- Calling a Sub2API or CPA server, importing through their administrative APIs, or validating tokens online.
- Persisting Sub2API/CPA as new core runtime authorization modes.
- Adding custom Base URLs, compatibility routing, token refresh, or remote account synchronization to the import dialog.
- Inferring or displaying token contents in a preview.

## Decisions

### Use source-specific adapters over one permissive parser

A new credential-import module will expose a shared normalized credential type and distinct Sub2API and CPA entry points. The Sub2API adapter will recognize its wrapper, nested/flat aliases, raw tokens, arrays, and line-delimited inputs. The CPA adapter will accept its flat Codex object and arrays and will validate a present `type` as `codex`.

This retains clear error messages and avoids accidentally accepting one provider's unrelated JSON under another provider label. A single unrestricted alias parser was considered, but it would make the separate UI choice cosmetic and weaken validation.

### Convert only to the official Codex runtime representation

The normalizer will build:

```json
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "access_token": "...",
    "id_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": "..."
}
```

Unavailable optional token fields will be omitted. A missing or invalid `last_refresh` will be replaced with the current ISO timestamp. External metadata such as email, expiry, and source type can assist deterministic naming but will not be copied into `auth.json`.

Keeping a source-shaped file was considered, but Codex would not reliably consume it and the app would need provider-specific behavior throughout the runtime.

### Treat source selection as transient bridge input

The renderer and preload bridge mode union will add `cpa` next to `sub2api`. Both paths will invoke a credential-import handler and save the resulting account with `preferredAuthMethod: "chatgpt"` and `openaiBaseUrlMode: "default"`. Core `AuthMode` remains unchanged.

This avoids migrations and preserves the existing account list, environment assignment, launch, and usage logic.

### Validate the entire batch before persistence

Parsing, required-field validation, duplicate-name generation, and target-name checks will complete before the first save. Multiple entries will use the entered account name as the first name and deterministic numeric suffixes for later entries.

An interactive preview was considered and rejected because the user explicitly wants one-click creation and a preview would expose secret-adjacent metadata without adding necessary control.

### Keep raw secrets out of observability

The parser will throw fixed structural errors containing the source and item position only. Bridge logging and result summaries will contain counts and account names, never the original payload or token fragments. The import payload exists only in the IPC request and local call stack.

## Risks / Trade-offs

- [External formats evolve] → Keep source parsing isolated, cover official aliases with tests, and fail closed with source-specific messages.
- [A save can fail after validation] → Validate all content and names first, then use the existing account persistence path and return the first safe persistence error; no invalid batch begins writing.
- [Raw access-token support is permissive] → Limit it to Sub2API because that source explicitly supports it; CPA remains JSON-only.
- [Imported access-only credentials may not refresh] → Preserve optional behavior allowed by the source and let Codex surface expiration normally; do not fabricate refresh credentials.
- [Existing legacy Sub2API users depend on flat JSON] → Retain the legacy flat snake-case representation as a supported Sub2API variant.

## Migration Plan

1. Add the source adapters and Codex auth builder with unit tests.
2. Extend the renderer/preload/bridge request contracts with the CPA mode and neutral credential payload field while accepting the legacy Sub2API payload field during transition.
3. Update the account dialog labels, placeholders, validation, and direct-create action.
4. Run desktop type checking, parser/bridge tests, renderer tests, and the production build.

Rollback removes the CPA renderer option and routes Sub2API back to the previous bridge handler. No persisted-account migration is required because all newly imported accounts use the existing Codex runtime format.

## Open Questions

None. The product decisions are fixed: separate Sub2API and CPA selection, direct creation, and default official routing for both.
