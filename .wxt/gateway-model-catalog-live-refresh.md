# Gateway Model Catalog Live Refresh

## Goal
- Ensure gateway model catalog changes are fully written before a Codex App instance starts and make already-running instances reload the affected environment's model list.

## Why Complex
- Crosses Electron bridge synchronization, Codex App lifecycle, gateway catalog generation, and regression tests.

## Scope
- 相关模块/类：Electron bridge target synchronization and Codex App window lifecycle.
- 相关文件：`apps/desktop/electron/bridge.ts`, `apps/desktop/electron/bridge-smoke.test.ts`, `apps/desktop/electron/app-window-lifecycle.test.ts`.
- 兼容要求：保留多窗口数量、环境隔离和 Windows packaged App 行为；未运行的环境不启动新实例。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Serialize active App target synchronization and launch per environment | `apps/desktop/electron/bridge.ts` | bridge smoke/typecheck | complete | Added a shared App target lifecycle queue and unlocked internal paths for nested synchronization |
| 2 | Restart running instances after gateway model binding/catalog changes | `apps/desktop/electron/bridge.ts` | bridge/core tests | complete | Model discovery, save/delete, and account/model binding mutations now serialize final JSON writes with catalog projection; active environment restarts after synchronization and inactive environments remain lazy |
| 3 | Add regression coverage for sequencing and selective refresh | `apps/desktop/electron/bridge-smoke.test.ts`, lifecycle tests | targeted test commands | complete | Added bridge source regression; bridge smoke + app-window lifecycle tests: 37 passed |
| 4 | Run full relevant verification and record residual risk | repository test/build scripts | build + tests | complete | Desktop suite: 489 passed, 1 skipped; `npm run desktop:build` passed; `tsc --noEmit` passed |
| 5 | Refresh a running App after account model discovery | `apps/desktop/electron/bridge.ts`, `apps/desktop/electron/bridge-smoke.test.ts` | bridge smoke + desktop tests | complete | Successful discovery now uses the same `restartRunningApp` path as binding changes, preventing a stale App Server catalog when discovery finishes after App launch; bridge smoke 32/32 passed, Electron typecheck and desktop build passed |
| 6 | Make the account-card primary App/CLI action directly clickable | `apps/desktop/src/pages/accounts-page.tsx` | web typecheck + desktop build | complete | The primary target segment now invokes its default action directly; the dropdown remains available for alternate launch strategies |
| 7 | Merge Codex App and standalone CLI bundled model catalogs | `apps/desktop/electron/account-model-catalog.ts`, `apps/desktop/electron/bridge.ts` | catalog tests + desktop build | complete | App synchronization now reads the embedded CodexCLI catalog first and merges standalone CLI-only models, so App-only official models such as `gpt-6.1-sol` remain visible alongside provider-qualified routes; targeted tests 72/72 passed and desktop build passed |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
