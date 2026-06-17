## 1. Core Foundation

- [x] 1.1 Create the new TypeScript core workspace and define module boundaries for domain core, system adapters, and front-end adapters.
- [x] 1.2 Define the versioned core state schema for envs, accounts, target pointers, runtime settings, and migration metadata.
- [x] 1.3 Implement validated state load/save paths with typed operation results and error categories.

## 2. Legacy Compatibility and Migration

- [x] 2.1 Implement legacy state readers that can hydrate the new core model from the current Bash-managed directory layout.
- [x] 2.2 Implement backup, migration, validation, and rollback for upgrading legacy state into the core-managed schema.
- [x] 2.3 Add regression coverage for successful migration, partial corruption, and rollback behavior.

## 3. Core Switcher Operations

- [x] 3.1 Implement structured env operations for list, create, delete, inspect, and target selection.
- [x] 3.2 Implement structured account operations for list, login persistence, relogin update, switch, logout, remove, and runtime setting updates.
- [x] 3.3 Implement target-home configuration writers for auth material and runtime config injection into CLI/App `CODEX_HOME`.

## 4. Bridged Login and System Task Layer

- [x] 4.1 Implement the task runner abstraction for external or long-running operations with progress, logs, and typed final status.
- [x] 4.2 Implement bridged auth-based login and relogin flows through external `codex` interactions.
- [x] 4.3 Implement typed task adapters for proxy test, token refresh, App launch/restart, doctor, recover, import, and shell-init operations.

## 5. CLI and TUI Compatibility

- [x] 5.1 Add a structured command interface over the new core for status, env, account, runtime, and task operations.
- [x] 5.2 Refactor the existing CLI entrypoints to call the new core-backed operations while preserving current command semantics.
- [x] 5.3 Refactor the existing TUI flows to consume core-backed structured data and task results instead of shell-text parsing.

## 6. Desktop GUI Application

- [x] 6.1 Create the Electron desktop application shell and integrate it with the core through a stable local bridge.
- [x] 6.2 Implement GUI workflows for overview, env management, account management, runtime settings, and status inspection.
- [x] 6.3 Implement GUI workflows for proxy control, token refresh, diagnostics, logs, and App control with explicit bridged-task presentation.

## 7. Verification, Packaging, and Documentation

- [x] 7.1 Add automated tests for core state semantics, task execution, CLI compatibility, and critical GUI-backed flows.
- [x] 7.2 Update packaging and release workflows to build the core, preserve npm CLI delivery, and add desktop app artifacts.
- [x] 7.3 Document migration behavior, rollback, architecture boundaries, GUI support scope, and operator workflows.

## 8. Desktop GUI Completion Follow-up

- [x] 8.1 Implement native desktop login and relogin flows for `auth`, `apikey`, and `sub2api` without relying on Terminal handoff.
- [x] 8.2 Implement native desktop confirmation flows for destructive actions including env deletion and account deletion.
- [x] 8.3 Replace raw text result panels with structured desktop result views for proxy, token refresh, doctor, recover, app status, and logs.
- [x] 8.4 Verify packaged Electron behavior for the completed desktop workflows and update desktop-facing documentation to reflect final GUI scope.
