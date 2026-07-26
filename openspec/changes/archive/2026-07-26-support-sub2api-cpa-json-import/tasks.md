## 1. Credential normalization

- [x] 1.1 Add typed Sub2API and CPA parsers with source-specific validation and batch support
- [x] 1.2 Add the official Codex `auth.json` builder with nested refresh and account token fields
- [x] 1.3 Cover supported formats, malformed batches, and secret-safe errors with unit tests

## 2. Desktop bridge and persistence

- [x] 2.1 Extend renderer, preload, and Electron login contracts with a separate CPA mode and neutral credential payload
- [x] 2.2 Replace the legacy Sub2API handler with validate-first batch import for both sources
- [x] 2.3 Force imported accounts to ChatGPT authorization and default official Base URL routing

## 3. Account dialog

- [x] 3.1 Add separate Sub2API and CPA choices, labels, and source-appropriate JSON placeholders
- [x] 3.2 Hide Base URL and compatibility controls for both modes and import immediately without preview
- [x] 3.3 Report safe validation errors and successful single or batch creation through the existing feedback UI

## 4. Verification

- [x] 4.1 Update bridge and renderer contract tests for the two independent modes
- [x] 4.2 Run desktop type checking, focused tests, the full desktop test suite, and the production build
