# codex-switcher 项目分析

> 生成日期：2026-07-07 · 分析对象：`@wangxt0223/codex-switcher` v0.8.11（MIT，作者 wangxt）
> 仓库位置：项目根目录

---

## 1. 项目定位

`codex-switcher` 是一个**命令行 + 桌面端**工具，用于在同一台机器上管理 **Codex CLI / Codex App** 的「环境（env）+ 账号（account）」切换与隔离。

**痛点来源**（README 背景）：Codex 把登录态、会话历史、本地状态全部放在 `CODEX_HOME`（默认 `~/.codex`）。多个账号共用同一目录时，登录态会互相覆盖、会话数据混用。作者本人既有个人 Codex 账号又有公司 Codex 账号，因此需要稳定切换。

**核心洞察**：只要把「共享数据」和「账号凭证（auth.json）」拆开管理，同一 env 下切换账号时只替换 `auth.json`，不改动其它共享文件，即可实现干净切换。

---

## 2. 核心数据模型：env + account

| 概念 | 含义 | 存储位置 |
| --- | --- | --- |
| `env`（环境） | 一套本地工作目录（会话、缓存、配置等共享数据）。例：公司/个人/agent 各一个 | `~/.codex-envs/<env>/home` |
| `account`（账号） | 某个 env 下的登录身份，本质是该账号的 `auth.json` | `~/.codex-switcher/env-accounts/<env>/<account>/auth.json` |
| `target` | 切换目标：`cli` / `app` / `both`，分别记录当前 env+account 指针 | `~/.codex-switcher/current_cli`、`current_app` |

- 同一 env + 多 account：共享会话历史不丢，仅换额度信息。
- 多 env：不同项目/身份彻底隔离。
- 登录模式：`auth`（网页登录）、`apikey`（OpenAI API Key）、`sub2api`（导入 token JSON）。

---

## 3. 架构总览（四层 + 双栈 CLI）

```
launcher.cjs ──(Unix)──▶ Legacy Bash CLI/TUI   ─┐
            └─(Win)───▶ Node/TS CLI             ├─▶ packages/core (TS)
                                                 │     ├─ state/store（typed 状态 + 校验）
scripts/node-cli.ts + core-cli.ts ──────────────┤     ├─ domain（env/account service）
                                                 │     ├─ platform（codex-cli/app/discovery/runtime/proxy）
apps/desktop (Electron) ── IPC ──▶ core-cli 桥 ─┘     ├─ api（core-api/status/overview）
                                                       ├─ tui（交互式界面）
                                                       └─ tasks（任务抽象）
                                                            │
                                                            ▼
                              ~/.codex-switcher（指针+env-accounts+state）
                              ~/.codex-envs/<env>/home（共享数据）
                              ~/.codex（默认 home）
```

要点：
- **双栈 CLI**：macOS/类 Unix 默认走 Bash 版（`plugins/codex-switcher/scripts/codex-switcher`），Windows 默认走 Node/TS 版（`scripts/node-cli.ts`）。`codex-sw-node` 始终走 Node。
- **渐进迁移**：Node/TS 实现与 Bash 实现读写**同一套 legacy 目录布局**，因此若桌面/core 桥失败，Bash CLI 仍可读取同布局——回滚基于文件、无独立数据库。
- **核心层可复用**：`packages/core` 是纯 TS 库，被 CLI 兼容路径、TUI 读取路径、桌面 shell 桥共同复用。

---

## 4. 目录与模块职责

| 路径 | 作用 |
| --- | --- |
| `scripts/bin/codex-sw.cjs`, `codex-sw-node.cjs`, `launcher.cjs` | 可执行入口；平台分流 |
| `scripts/node-cli.ts` | 现代 TS/Node CLI；`normalizeArgv` 把 `env`/`ac`/`ops` 子命令归一化为 core 命令，再调 `runCoreCli` |
| `scripts/core-cli.ts` | 覆盖 core API 的薄桥（CLI 兼容、TUI 读、桌面桥共用） |
| `packages/core/src` | 核心 TS 库：`state` / `domain` / `platform` / `system` / `api` / `tui` / `tasks` |
| `plugins/codex-switcher/scripts/codex-switcher` | Legacy Bash CLI/TUI（Unix 默认入口）；含 `profile-metrics.py`、`test-switcher.sh` |
| `plugins/codex-switcher/skills` | Codex CLI 插件技能承载目录 |
| `apps/desktop` | Electron + React 19 桌面壳；main 进程 + preload IPC + `core-cli` 桥；Vite 构建、electron-builder 打包 |
| `openspec` | 变更提案与规格（OpenSpec 工作流）：`codex-multi-account-switching`、`desktop-gui-core-rewrite` |
| `docs` | 桌面架构、Windows/macOS 验收清单、发布/升级指南 |

---

## 5. 命令体系（摘录）

```
env ls | env new <env> [--empty|--from] | env use <env> [-t cli|app|both] | env rm
ac ls [--env] | ac login <ac> [--mode auth|apikey|sub2api] | ac relogin | ac base-url
ac use <ac> [-t ...] [--sync|--no-sync] | ac logout | ac rm
app restart-current | app launch-new | app stop-managed | app status | app logout
whoami | status | overview | tui | version | check | upgrade
ops list | ops proxy | ops import-default | ops init | ops recover | ops doctor | ops token-refresh
```

---

## 6. 平台与跨端实现

- **平台探测**：`platform/command-discovery.ts` 解析 codex 二进制、Codex App 路径、Windows launcher 命令、shell 初始化文件。
- **Token 自动续期**：
  - macOS：`launchd` LaunchAgent（~900s 间隔）。
  - Windows：`schtasks` 计划任务。
  - 续期机制很巧妙：用 `codex exec --skip-git-repo-check "reply with: ok"` 触发 Codex 自身刷新 token，再 diff 临时 `auth.json`，变化则写回并同步到 active target。输出含 `scanned/checked/refreshed/need_relogin`。
- **代理**：usage API 代理自动探测（手动 > env > macOS 系统代理）。
- **i18n**：Bash/桌面支持 zh/en/ja；**Node/TS CLI 仅英文**（`lang` 仅接受 `en`）——存在不一致。

---

## 7. 桌面版（Electron）

- 技术栈：Electron 31 + React 19 + TypeScript + Tailwind + shadcn/ui + Radix。
- 结构：main 进程 → preload（IPC）→ `core-cli` 本地桥 → `packages/core`；React 渲染。
- 已覆盖：overview、env/account 切换、env 创建、runtime base URL 更新、原生 login/relogin、删除确认、proxy、token refresh、doctor、recover、App 状态、CLI 启动、日志查看、高级命令桥接。结果区支持「结构化摘要 + 原始输出」双视图。
- **未完成**：应用图标、签名、公证、分发自动化（发行级能力）。

---

## 8. 状态与数据模型（`state/store.ts`）

`SwitcherState`（`schemaVersion=1`）：

```
{
  schemaVersion, generatedAt,
  targets: { cli: {env, account}, app: {env, account} },
  envs: { <env>: { name, path, accounts: { <ac>: { name, authMode, runtime, authData? } } } },
  tasks: { recent: TaskSummary[] }
}
```

- `load()` 时对 JSON 做**严格 schema 校验**，非法状态抛 `INVALID_STATE`/`STATE_IO_ERROR`。
- `save()` 用「写临时文件 + rename」保证原子性。
- 运行时账号配置（`AccountRuntimeSettings`）支持 `openaiBaseUrl` 自定义、独立模型（provider/model/apiKey/baseUrl）。

---

## 9. 测试与质量保障

- 源码约 **30,567 行**（不含 `node_modules`/`dist`），**60 个** `*.test.ts` 文件。
- 测试分层：`packages/core` 单元测试、`scripts` 的跨平台测试、`legacy` 兼容测试、Windows 手动验收清单（PowerShell 证据抓取）。
- CI 验证顺序（见 `docs/desktop-core-architecture.md`）：`npm ci` → `core:test` → `cli:test` → `core:build` → `desktop:build` → `desktop:test` → 运行/打包。

---

## 10. 设计与工程亮点

1. **隔离模型清晰**：共享数据 vs 账号凭证分离，切换只换 `auth.json`，概念简单且可靠。
2. **回滚安全**：双栈 CLI 共用 legacy 目录布局，无 opaque 数据库，出问题可退回 Bash。
3. **跨平台完备**：macOS/Windows 二进制探测、shell 初始化、代理、token 守护全覆盖。
4. **Token 续期巧妙**：借 Codex 自身机制刷新，而非逆向私有协议。
5. **状态校验严格**：load 时 schema 校验 + 原子写。
6. **工程纪律强**：60 个测试、OpenSpec 规格驱动开发、分平台验收清单。

---

## 11. 潜在风险与改进建议

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| 双栈 CLI 漂移 | Unix 走 Bash、Win 走 Node，两套命令实现易行为分叉 | 推动核心逻辑统一收敛到 `core-cli`/`packages/core`，Bash 仅作薄壳 |
| i18n 不一致 | Node CLI 仅英文，桌面支持多语 | 统一文案层，或明确标注 Node CLI 为 English-only |
| 桌面发行硬化缺失 | 缺少图标/签名/公证/分发 | 补 electron-builder 后处理与公证流水线 |
| Bash 入口仍是 Unix 默认 | 与现代 core 桥长期并存，维护成本高 | 设定迁移里程碑，将 Unix 默认切换至 Node 入口 |
| Tauri 残留资产 | 架构文档提及需清理历史 Tauri 二进制 | 清理 `apps/desktop` 下遗留 Tauri 资产 |

---

## 12. 关键文件索引

- 入口分流：`scripts/bin/launcher.cjs`
- Node CLI：`scripts/node-cli.ts`、`scripts/core-cli.ts`
- 核心状态：`packages/core/src/state/store.ts`
- 领域服务：`packages/core/src/domain/{env,account}-service.ts`
- 平台层：`packages/core/src/platform/{codex-cli,codex-app,command-discovery,runtime,proxy}.ts`
- 桌面桥：`apps/desktop/src/bridge.ts`、`apps/desktop/electron-dist/electron/main.*`
- Legacy Bash：`plugins/codex-switcher/scripts/codex-switcher`
- 规格：`openspec/changes/*/proposal.md`、`specs/*/spec.md`
- 桌面架构：`docs/desktop-core-architecture.md`

---

*本分析基于对仓库 README、CHANGELOG、package.json、launcher、node-cli、core state/store、desktop 架构文档、openspec 与目录结构的通读。*
