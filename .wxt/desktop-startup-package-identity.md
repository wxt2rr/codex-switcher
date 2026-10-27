# Desktop startup package identity

## Goal
- Ensure the distributed desktop package contains the startup-loop fix and cannot be confused with an older artifact carrying the same version.

## Why Complex
- The issue crosses Electron startup restoration, packaged release metadata, and artifact verification.
- A same-version stale app can remain installed even when the workspace has a newer build.

## Scope
- 相关模块/类：Electron gateway restoration, desktop package metadata, release verification.
- 相关文件：`apps/desktop/electron/bridge.ts`, `apps/desktop/electron/account-model-catalog.ts`, `packages/core/src/system/atomic-file.ts`, `packages/core/src/state/legacy.ts`, `apps/desktop/package.json`, release artifacts.
- 兼容要求：保持现有账号/网关配置与 Codex App 数据，不主动启动或重启 Codex App 进行验证。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Confirm installed package differs from fixed workspace artifact | Installed app and `apps/desktop/release` | Inspect package metadata and bundled bridge source | done | Installed 0.1.83 is from Oct 26 and still has `catalogVersion + 1`; latest release artifact contains `findRunningManagedAppEnvironments`. |
| 2 | Bump desktop release identity to avoid stale same-version installation | `apps/desktop/package.json` | Build/package reports 0.1.84 | done | `apps/desktop/package.json` now reports version `0.1.84`. |
| 3 | Build and package the fixed desktop artifact | Desktop build/package outputs | `desktop:build`, `desktop:package:mac`, package verification | done | `desktop:build`, `desktop:package:mac`, and `package:verify` passed; DMG/ZIP artifacts exist for x64 and arm64. |
| 4 | Validate artifact contents and summarize residual risks | Release archive and source diff | Inspect package version and startup-loop guards; `git diff --check` | done | 0.1.84 arm64 app.asar contains `findRunningManagedAppEnvironments`, stable catalog versions, and no startup full-refresh call; desktop tests 492 passed/1 skipped; `git diff --check` passed. |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
