## Why

`codex-switcher` 当前把核心能力、交互逻辑和系统集成都集中在一个 Bash 脚本里，这让 CLI/TUI 迭代还能维持，但已经不适合继续扩展到桌面 GUI。要把产品做稳，必须先把状态管理、账号切换、配置写入、系统任务和登录流程桥接抽成结构化 core，再让多种前端共用。

## What Changes

- 引入一个可复用的本地 core，统一负责 env/account 状态、配置读写、账号切换、登录桥接、proxy、token refresh、App/CLI 启动与系统操作。
- 将现有 Bash 脚本从“唯一实现”降级为迁移参考与兼容入口，逐步改成调用 core 的薄封装。
- 为 core 定义稳定的结构化接口与事件模型，支持 CLI、TUI 和桌面 GUI 共用。
- 增加从现有 Bash 状态布局到新 core 数据模型的迁移与回滚机制。
- 新增桌面 GUI 能力，覆盖 env/account 管理、状态查看、proxy、token refresh、App 控制和诊断类主流程。
- 明确哪些系统级动作通过 core 原生实现，哪些仍以受控子进程桥接外部 `codex` 或系统命令。

## Capabilities

### New Capabilities
- `switcher-core-platform`: 定义并实现可复用的本地 core、状态模型、命令接口和迁移机制。
- `desktop-gui-management`: 提供桌面 GUI，对 core 能力进行可视化管理与状态展示。
- `login-bridge-and-system-tasks`: 统一封装登录桥接、App 拉起、token refresh、诊断修复和系统级任务执行。

### Modified Capabilities
- None.

## Impact

- Affected code: `plugins/codex-switcher/scripts/codex-switcher`、安装脚本、测试脚本、打包与发布流程。
- New code: core 模块、桌面应用、bridge/API 层、迁移与兼容适配层。
- Affected systems: 本地状态目录、`CODEX_HOME` 配置写入、Codex CLI/App 拉起流程、launchd token refresh 守护。
- API impact: 需要新增结构化 CLI/IPC 接口，逐步替代当前面向终端文本输出的命令模式。
- Operational impact: 需要设计从现有 Bash 状态到新 core 的安全迁移、回滚和兼容窗口。
