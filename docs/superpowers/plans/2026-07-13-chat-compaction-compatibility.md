# Chat Compaction Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Chat Completions accounts use Codex local text compaction while safely handling encrypted compaction history from native Responses sessions.

**Architecture:** Persist one account-level `safe` or `continuity` strategy and copy it into the local route. The pure Responses-to-Chat transformer recognizes encrypted compaction items: safe mode returns an actionable compatibility error, while continuity mode drops only opaque compaction markers and returns a warning that response conversion exposes to the user. Native Responses forwarding remains unchanged.

**Tech Stack:** TypeScript 5.6, Node test runner through `tsx --test`, Electron IPC, React 19.

## Global Constraints

- Chat route provider names must remain non-OpenAI and non-Azure so Codex selects local text compaction.
- Never parse, log, or persist `encrypted_content`.
- Never fabricate a native `/responses/compact` response.
- Native Responses routes remain pass-through.
- Default strategy is `safe`.

---

### Task 1: Persist The Account And Route Strategy

**Files:**
- Modify: `packages/core/src/state/store.ts`
- Modify: `packages/core/src/state/legacy.ts`
- Test: `packages/core/src/state/store.test.ts`
- Test: `packages/core/src/state/legacy-write.test.ts`
- Modify: `apps/desktop/electron/usage-routing-model.ts`
- Modify: `apps/desktop/electron/usage-store.ts`
- Test: `apps/desktop/electron/usage-store.test.ts`

**Interfaces:**
- Produces: `LongConversationStrategy = "safe" | "continuity"`.
- Produces: `AccountRuntimeSettings.compatibilityLongConversationStrategy`.
- Produces: `RouteTarget.longConversationStrategy`.

- [ ] Add failing round-trip tests proving missing values default to `safe` and `continuity` survives core-state, legacy, and route-store persistence.
- [ ] Run `pnpm --dir packages/core exec tsx --test src/state/store.test.ts src/state/legacy-write.test.ts` and `pnpm --dir apps/desktop exec tsx --test electron/usage-store.test.ts`; verify failures reference the missing strategy.
- [ ] Add the shared union type at each process boundary, validate only `safe` and `continuity`, and add a nullable `long_conversation_strategy` route column with migration/default handling.
- [ ] Re-run the focused tests and verify they pass.

### Task 2: Carry Strategy Through Bridge And Route Management

**Files:**
- Modify: `apps/desktop/electron/usage-router-manager.ts`
- Test: `apps/desktop/electron/usage-router-manager.test.ts`
- Modify: `apps/desktop/electron/bridge.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/desktop-model.ts`
- Test: `apps/desktop/src/bridge.test.ts`

**Interfaces:**
- Consumes: `LongConversationStrategy` from Task 1.
- Produces: `AccountCompatibilityRequest.longConversationStrategy`.
- Produces: `RoutableAccount.longConversationStrategy` and persisted `RouteTarget.longConversationStrategy`.

- [ ] Add failing tests proving enable/update sends the chosen strategy to the route and writes it back to account runtime.
- [ ] Run the manager and bridge tests and verify the strategy is currently absent.
- [ ] Extend IPC/preload/frontend types and `enableAccountCompatibility()` input; default omitted values to `safe` and preserve the value during route rehydration.
- [ ] Re-run focused manager and bridge tests.

### Task 3: Handle Opaque Compaction Items

**Files:**
- Modify: `apps/desktop/electron/openai-chat-compat/types.ts`
- Modify: `apps/desktop/electron/openai-chat-compat/request-transformer.ts`
- Test: `apps/desktop/electron/openai-chat-compat/request-transformer.test.ts`
- Modify: `apps/desktop/electron/openai-chat-compat/compatibility-handler.ts`
- Test: `apps/desktop/electron/openai-chat-compat/compatibility-handler.test.ts`
- Modify: `apps/desktop/electron/openai-chat-compat/response-transformer.ts`
- Modify: `apps/desktop/electron/openai-chat-compat/stream-transformer.ts`
- Test: `apps/desktop/electron/openai-chat-compat/response-transformer.test.ts`
- Test: `apps/desktop/electron/openai-chat-compat/stream-transformer.test.ts`

**Interfaces:**
- `transformResponsesRequest()` consumes `longConversationStrategy`.
- `TransformedChatRequest.warning?: string` is set only after lossy filtering.
- Safe mode throws `CompatibilityError("INCOMPATIBLE_COMPACTION", "当前会话包含无法转换的压缩历史，请新建窗口继续。", 409)`.
- Continuity mode drops `compaction` and `compaction_summary`, never reads `encrypted_content`, and returns `warning = "已使用可读取的历史继续，部分早期上下文可能丢失。"`.

- [ ] Add failing transformer tests for safe rejection, continuity filtering, retained surrounding messages/tool pairs, and no encrypted content in errors.
- [ ] Add `INCOMPATIBLE_COMPACTION` to the typed error union and implement one pre-scan of request input before ordinary item conversion.
- [ ] Pass route strategy through `compatibility-handler` and expose the continuity warning in both non-stream and stream Responses output before model text.
- [ ] Add response tests proving no warning appears for normal/local-compaction requests and exactly one warning appears after lossy filtering.
- [ ] Run all `electron/openai-chat-compat/*.test.ts` tests.

### Task 4: Add The Account Setting And Complete Verification

**Files:**
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Test: `apps/desktop/src/pages/accounts-page.test.ts` if present, otherwise `apps/desktop/src/components/desktop-shell.test.ts`
- Modify: `apps/desktop/src/i18n.ts` only if shared copy is required.

**Interfaces:**
- Consumes: `AccountCompatibilityRequest.longConversationStrategy`.
- Displays: `安全压缩（推荐）` and `连续性优先` with concise usage descriptions.

- [ ] Add a failing UI test proving the selector appears only for Chat compatibility accounts and defaults to safe mode.
- [ ] Add local state initialization, the two-option Select, concise descriptions, and submit the value when enabling/updating compatibility.
- [ ] Run focused UI tests.
- [ ] Run `pnpm --dir packages/core test` and the desktop test/typecheck commands defined in `apps/desktop/package.json`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes or secret-bearing fixtures.

