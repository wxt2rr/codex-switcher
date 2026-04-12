# codex-switcher

中文 | [English](README.en.md)

`codex-switcher` 是一个面向 Codex CLI 与 Codex App 的轻量账号切换工具。
它基于 `env + account` 模型管理账号：`env` 共享数据目录，`account` 管理独立 `auth.json`。

## 项目背景

最早我自己一直在用 Codex，公司配的是 Cursor，所以在我的电脑上两套账号互不影响。  
后来公司从 Cursor 切到 Codex 后，我就得在同一台电脑上同时用个人账号和公司账号，很快就遇到冲突：登录态会互相覆盖，切换也不顺手。

为了搞清楚原因，我看了下 Codex 的本地数据机制，发现思路其实很直接：只要把不同账号对应的本地目录隔离开，就能稳定切换。  
基于这个思路，我用 Codex 写了 `codex-switcher`，专门用来管理、切换和隔离我所有的 Codex 账号，现在日常在个人/公司账号之间切换方便很多。

## Codex 本地认证机制（简述）

简单说就是：Codex 会把“账号登录态 + 会话历史 + 一些本地状态”都放在 `CODEX_HOME` 这个目录里（默认一般是 `~/.codex`）。  
如果两个账号共用同一个目录，就很容易出现你登我下、我登你下，或者历史数据串在一起的问题。

`codex-switcher` 做的事情其实不复杂：把“共享数据”和“账号凭证”解耦。  
默认 `env=default` 对应 `~/.codex`，同一 env 下切换账号只替换 `auth.json`，不动共享数据目录里的其它文件。

## 安装

### 方式 A：npm 全局安装

```bash
npm i -g @wangxt0223/codex-switcher
codex-switcher check
```

### 方式 B：源码安装

```bash
./scripts/install.sh
codex-switcher check
```

## 快速开始

```bash
codex-switcher account login personal --env default
codex-switcher account login work --env default
codex-switcher account use personal --env default

codex-switcher env create project-a --empty
codex-switcher account login corp --env project-a
codex-switcher account use corp --env project-a
```

## 同步选项

- 同一 env 下切账号：只替换 `auth.json`，不进行共享数据同步。
- `account login --sync`（跨 env 场景）：可将默认 env 数据同步到目标 env（不含 `auth.json`）。
- 兼容命令 `use/switch` 默认 `--launch=auto`：交互终端中切换后会自动启动 `codex` CLI。
- `use/switch --launch`：切换后立即启动 `codex` CLI。
- `use/switch --no-launch`：仅切换账号指针，不启动 `codex` CLI。
- `use/switch -- <codex args...>`：切换后直接执行 `codex` 参数（隐式启用 launch）。

## 命令参考

以下以 `codex-sw` 为例（`codex-switcher` 为等价兼容命令）：

| 分类 | 命令 | 说明 |
| --- | --- | --- |
| Env 管理 | `codex-sw env list` | 列出所有 env，并标记 CLI/App 当前 env |
| Env 管理 | `codex-sw env create <env> [--empty\|--from-default\|--from-env <src>]` | 创建 env（空目录或从已有 env 同步数据） |
| Env 管理 | `codex-sw env use <env> [--target cli\|app\|both]` | 切换 CLI/App 使用的 env |
| Env 管理 | `codex-sw env remove <env> [--force]` | 删除 env（必要时强制） |
| Env 管理 | `codex-sw env current [cli\|app]` | 查看当前 env 指针 |
| Env 管理 | `codex-sw env path [env]` | 输出 env 对应 `CODEX_HOME` 导出语句 |
| 账号管理 | `codex-sw account list [--env <env>]` | 列出 env 下账号并标记当前账号 |
| 账号管理 | `codex-sw account add <account> [--env <env>]` | 创建账号槽位（不登录） |
| 账号管理 | `codex-sw account remove <account> [--env <env>] [--force]` | 删除账号槽位 |
| 账号管理 | `codex-sw account login <account> [--env <env>] [--target cli\|app\|both] [--sync\|--no-sync]` | 在目标 env 登录并保存账号 `auth.json` |
| 账号管理 | `codex-sw account use <account> [--env <env>] [--target cli\|app\|both] [--sync\|--no-sync]` | 切换到目标账号 |
| 账号管理 | `codex-sw account logout [account] [--env <env>] [--target cli\|app\|both]` | 注销账号（删除对应 auth） |
| 账号管理 | `codex-sw account current [cli\|app]` | 查看当前 env/account 指针 |
| 用量代理 | `codex-sw proxy [<host:port>\|off\|test]` | 设置/关闭/测试“用量 API”代理（仅影响 `list`） |
| 查询执行 | `codex-sw list` | 展示 `ENV/HOME/ACCOUNT/EMAIL/PLAN/5H/WEEKLY/SOURCE` |
| 查询执行 | `codex-sw status` | 检查 CLI/App 当前登录状态 |
| 查询执行 | `codex-sw current [cli\|app]` | 查看当前 env/account |
| 查询执行 | `codex-sw exec -- <codex args...>` | 在当前 CLI env/account 下执行 `codex` |
| 兼容命令 | `codex-sw login [account] [--sync\|--no-sync]` | 登录当前 CLI 账号（兼容入口） |
| 兼容命令 | `codex-sw logout [account]` | 注销当前 CLI 账号（兼容入口） |
| 兼容命令 | `codex-sw use <account> [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | 切换 CLI 账号（兼容入口） |
| 兼容命令 | `codex-sw switch <account> [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | `use` 的等价命令 |
| 兼容命令 | `codex-sw add <account>` | `account add` 的兼容入口 |
| 兼容命令 | `codex-sw remove <account> [--force]` | `account remove` 的兼容入口 |
| 兼容命令 | `codex-sw import-default <env> [--with-auth] [--force]` | 从默认 env 导入数据到指定 env |
| App 管理 | `codex-sw app open [account] [-- <app args...>]` | 以指定账号打开 Codex App |
| App 管理 | `codex-sw app use <account> [-- <app args...>]` | 切换 App 到指定账号（内部等价于 open） |
| App 管理 | `codex-sw app logout [account]` | 注销 App 当前账号 |
| App 管理 | `codex-sw app status` | 查看 App 管理进程状态 |
| App 管理 | `codex-sw app stop` | 停止由工具托管启动的 App 进程 |
| App 管理 | `codex-sw app current` | 查看 App 当前 env/account |
| 维护命令 | `codex-sw init [--shell zsh\|bash] [--dry-run]` | 初始化 PATH 快捷命令 |
| 维护命令 | `codex-sw upgrade [--dry-run]` | 升级到最新 npm 版本 |
| 维护命令 | `codex-sw recover [--dry-run]` | 自动恢复损坏指针 |
| 维护命令 | `codex-sw version` | 输出当前工具版本号 |
| 维护命令 | `codex-sw check` | 基础健康检查 |
| 维护命令 | `codex-sw doctor [--fix]` | 深度检查并可选自动修复 |
| 维护命令 | `codex-sw --help` | 查看完整帮助 |

插件侧详细说明：

- 中文：`plugins/codex-switcher/README.md`
- English：`plugins/codex-switcher/README.en.md`

## 开发

```bash
npm run check
```

## 发布到 npm

```bash
npm login --registry https://registry.npmjs.org/
npm run release:npm
```

## 升级

```bash
codex-switcher upgrade
```

## 文档

- `docs/macos-manual-checklist.md`
- `docs/upgrade.md`
- `docs/publish.md`
