# codex-switcher

中文 | [English](README.en.md)

`codex-switcher` 用于管理 Codex CLI / Codex App 的 `env + account` 切换。

## 项目背景

最早我自己一直在用 Codex，公司配的是 Cursor，所以在我的电脑上两套账号互不影响。  
后来公司从 Cursor 切到 Codex 后，我就得在同一台电脑上同时用个人账号和公司账号，很快就遇到冲突：登录态会互相覆盖，切换也不顺手。

为了搞清楚原因，我看了下 Codex 的本地数据机制，发现思路其实很直接：只要把不同账号对应的本地目录隔离开，就能稳定切换。  
基于这个思路，我用 Codex 写了 `codex-switcher`，专门用来管理、切换和隔离我所有的 Codex 账号。

## Codex 本地认证机制（简述）

Codex 会把“账号登录态 + 会话历史 + 一些本地状态”都放在 `CODEX_HOME` 这个目录里（默认一般是 `~/.codex`）。  
如果多个账号共用同一个目录，就容易出现登录态互相覆盖、会话数据混用的问题。

`codex-switcher` 的核心做法是把“共享数据”和“账号凭证”拆开管理：  
同一 env 下切换账号只替换 `auth.json`，不改动该 env 下其它共享数据文件。

## 安装

### npm 全局安装

```bash
npm i -g @wangxt0223/codex-switcher
codex-sw check
```

### 平台支持现状

- 当前默认入口：`codex-sw`
- macOS / 类 Unix 终端下：`codex-sw` 默认继续走 Bash 版入口，保持现有工作流稳定
- Windows 下：`codex-sw` / `codex-switcher` / `codex-sw-node` 安装后默认走 Node/TypeScript CLI 入口
- Windows 原生支持：`cmd`、PowerShell、Windows Terminal
- `codex-sw-node` 仍保留为显式 Node 入口，便于脚本化调用、验证与排障
- macOS 当前仍以现有 Bash 入口为默认工作流，避免打断已有使用习惯

## 桌面版（Electron）

当前仓库已经包含一个可运行的 Electron 桌面版，位置在 `apps/desktop`。

- 前端构建：`npm run desktop:build`
- 本地开发：`npm run desktop:dev`
- Electron 运行：`npm run desktop:electron`
- 桌面测试：`npm run desktop:test`
- 目录打包：`npm run package:dir --workspace ./apps/desktop`

说明：

- 当前桌面版已经覆盖：overview、env/account 切换、env 创建、runtime base URL 更新、原生 login/relogin、账号与环境删除确认、proxy、token refresh、doctor、recover、App 状态、CLI 启动、日志查看和高级命令桥接。
- 操作结果已支持结构化摘要视图，同时保留原始输出，适合排障。
- 当前桌面壳使用 Electron，复用 Node/TypeScript core bridge；仓库内已验证前端构建、主进程构建、桌面测试，以及目录打包后的 App 启动。
- 当前未完成的主要是发行级能力，例如应用图标、签名、公证和分发流程。
- 详细架构和迁移说明见 [docs/desktop-core-architecture.md](docs/desktop-core-architecture.md)。

### 桌面安装包安全提示

当前 macOS 和 Windows 安装包均未进行代码签名。请只从本仓库的 GitHub Release 下载，并在确认文件来源可信后继续以下操作。

macOS 安装完成后，如果系统提示应用“已损坏”或无法打开，请在终端执行：

```bash
xattr -dr com.apple.quarantine "/Applications/codex-switcher.app"
open "/Applications/codex-switcher.app"
```

Windows 下载或安装时可能出现 Microsoft Defender SmartScreen 风险提示。确认安装包来自本仓库 GitHub Release 后，可选择“更多信息”→“仍要运行”，或在浏览器下载提示中选择保留，然后继续安装。

### 源码安装

```bash
./scripts/install.sh
codex-sw check
```

- Windows 下从源码安装建议直接运行：`node scripts/bin/codex-sw-node.cjs install --shell powershell`
- 如果你使用 `cmd`，可改用：`node scripts/bin/codex-sw-node.cjs install --shell cmd`
- 如果你主要通过 Windows Terminal 启动 PowerShell，可改用：`node scripts/bin/codex-sw-node.cjs install --shell windows-terminal`
- Windows 下从源码卸载建议直接运行：`node scripts/bin/codex-sw-node.cjs uninstall --shell powershell`
- 如果需要同时清理 switcher 状态和 env home，可直接追加：`--purge`
- Windows 真机验收清单见 [docs/windows-manual-checklist.md](docs/windows-manual-checklist.md)
- Windows 真机验收可直接从：`powershell -ExecutionPolicy Bypass -File .\scripts\windows-manual-start.ps1 -EvidencePath .\windows-manual-evidence.txt -ResultPath .\windows-manual-result.md` 开始
- 在源码仓库里，也可以直接运行：`npm run windows:manual:start`
- 如需在 Codex App 外部终端重新打开生命周期敏感测试，可运行：`npm run test:lifecycle`
- 只想重抓命令证据时，可运行：`npm run windows:manual:capture`
- 只想重建预填充结果模板时，可运行：`npm run windows:manual:result-template`

## 快速开始（推荐 TUI）

### 方式一：TUI（推荐）

```bash
# 直接进入 TUI（等同于 codex-sw tui）
codex-sw
```

#### TUI 

- 首页：
  </br>
  ![TUI Home](https://github.com/wxt2rr/codex-switcher/blob/main/images/home.png)
- 环境/账号管理：
  </br>
  ![TUI Switch](https://github.com/wxt2rr/codex-switcher/blob/main/images/accounts.png)
  </br>
  ![TUI Switch](https://github.com/wxt2rr/codex-switcher/blob/main/images/env.png)
- 账号信息（订阅类型/5小时使用量/本周使用量/刷新时间）：
  </br>
  ![TUI Status](https://github.com/wxt2rr/codex-switcher/blob/main/images/status.png)

### 方式二：CLI（次选）

```bash
# 在 default env 登录两个账号
codex-sw ac login personal --env default
codex-sw ac login work --env default

# 切换 CLI 账号并启动 codex
codex-sw ac use personal -t cli

# 切换 App 账号并启动 App
codex-sw ac use work -t app

# 新建 env 并登录账号
codex-sw env new project-a --empty
codex-sw ac login corp --env project-a
codex-sw ac use corp --env project-a -t both
```

## env / account 是什么（先看这个）

- `env`：一套本地工作目录（会话、缓存、配置等共享数据）。
  - 拿我自己来说，我目前创建了3个env，一个是公司使用的，一个是个人使用，一个是给自己的agent使用，这样的话每个环境之间的对话历史、配置数据都是隔离的，互不影响
- `account`：该 env 下的登录身份（本质是该账号的 `auth.json`）。
  - 拿我自己来说，我的个人环境下有3个账号，当在同一个环境下切换账号时，当前的对话历史配置不会丢失，只是切换了账号额度信息
- 常见用法：
  - 同一项目、不同身份：`同一个 env + 多个 account`
  - 不同项目隔离：`多个 env`（每个 env 里再按需放多个 account）

## 按场景上手

### 场景 1：你已经在本机登录过 Codex（已有 `~/.codex` 默认环境）

目标：直接在 `default` 环境下新增账号并切换。

```bash
$ codex-sw check
version: 0.7.1
check: ok

$ codex-sw ac login work --env default --mode auth
Logged in account: default/work

$ codex-sw ac use work --env default -t cli
Switched cli account to: default/work
```

### 场景 2：你是全新机器，从没登录过 Codex

目标：先建环境，再登录账号，最后切换到可用状态。

```bash
$ codex-sw check
version: 0.7.1
check: ok

$ codex-sw env new project-a --empty
Created env: project-a

$ codex-sw ac login corp --env project-a --mode auth
Logged in account: project-a/corp

$ codex-sw ac use corp --env project-a -t both
Switched both account to: project-a/corp

$ codex-sw whoami -t both
cli: project-a/corp
app: project-a/corp
```

### 场景 3：使用 API Key（交互输入）

目标：不走网页登录，直接保存 API Key 账号并立刻可切换使用。

```bash
$ codex-sw ac login my-api --env default --mode apikey
Enter OpenAI API key: sk-xxxxxxxxxxxxxxxx
Base URL [1] default [2] custom (default: 1): 1
API key saved successfully for account: default/my-api
Logged in account: default/my-api

$ codex-sw ac use my-api --env default -t cli
Switched cli account to: default/my-api
```

### 场景 4：同一台机器，CLI 用公司号，App 用个人号

```bash
$ codex-sw ac login company --env default --mode auth
Logged in account: default/company

$ codex-sw ac login personal --env default --mode auth
Logged in account: default/personal

$ codex-sw ac use company --env default -t cli
Switched cli account to: default/company

$ codex-sw ac use personal --env default -t app
Switched app account to: default/personal

$ codex-sw whoami -t both
cli: default/company
app: default/personal
```

## 核心命令

| 命令 | 说明 |
| --- | --- |
| `codex-sw env ls` | 列出环境 |
| `codex-sw env new <env> [--empty\|--from <src-env\|default>]` | 创建环境 |
| `codex-sw env use <env> [-t cli\|app\|both]` | 切换环境 |
| `codex-sw env rm <env> [--force]` | 删除环境（需二次 `y/n` 确认） |
| `codex-sw ac ls [--env <env>]` | 查看账号总览 |
| `codex-sw ac login <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--mode auth\|apikey\|sub2api]` | 登录账号 |
| `codex-sw ac relogin [account] [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--mode auth\|apikey\|sub2api]` | 重新登录已有账号（可交互选择环境/账号/模式） |
| `codex-sw ac base-url <account> [--env <env>] [--mode default\|custom]` | 修改 API key 账号的 OpenAI Base URL |
| `codex-sw ac use <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync]` | 切换账号 |
| `codex-sw app restart-current` | 重启当前 `app` 指针对应的 APP 实例 |
| `codex-sw app launch-new` | 基于当前 `app` 指针新开一个 APP 实例 |
| `codex-sw app stop-managed` | 停止当前由 switcher 管理的 APP 进程 |
| `codex-sw app status` | 查看当前 `app` 指针对应的 APP 进程状态 |
| `codex-sw app logout [account]` | 仅注销当前 `app` 指针对应账号 |
| `codex-sw ac logout [account] [--env <env>] [-t cli\|app\|both]` | 注销账号 |
| `codex-sw ac rm <account> [--env <env>] [--force]` | 删除账号（需二次 `y/n` 确认） |
| `codex-sw whoami [-t cli\|app\|both]` | 查看当前 env/account |
| `codex-sw status` | 查看当前登录状态 |
| `codex-sw lang [en]` | 界面语言（仅英文） |
| `codex-sw` | 默认进入交互式 TUI（等同于 `codex-sw tui`） |
| `codex-sw tui` | 打开交互式 TUI（支持执行全部 CLI 命令） |
| `codex-sw version` | 查看版本 |
| `codex-sw check` | 健康检查 |
| `codex-sw upgrade [--dry-run]` | 升级工具 |
| `codex-sw ops list` | 列出 env / home / account / current 标记总览 |
| `codex-sw ops proxy [show\|test\|off\|<host:port>\|<scheme://host:port>]` | 查看、设置或测试 usage API 代理 |
| `codex-sw ops init [--shell zsh\|bash\|powershell\|cmd\|windows-terminal\|wt] [--dry-run]` | 安装 shell 初始化片段与 launcher |
| `codex-sw ops import-default <env> [--with-auth] [--force]` | 把默认环境数据导入到目标 env |
| `codex-sw ops recover [--dry-run]` | 修复损坏的当前指针并回写 target home |
| `codex-sw ops doctor [--fix]` | 查看平台/路径/二进制探测结果，并可执行基础修复 |
| `codex-sw ops token-refresh start` | 启动 token 自动续期守护（Windows 计划任务 / macOS launchd） |
| `codex-sw ops token-refresh stop` | 停止 token 自动续期守护 |
| `codex-sw ops token-refresh status` | 查看 token 自动续期守护状态与日志路径 |
| `codex-sw ops token-refresh run-once` | 立即执行一次 token 续期扫描 |
| `codex-sw --help` | 查看核心命令帮助 |
| `codex-sw --help-all` | 查看完整命令帮助 |

## Token 自动续期与日志

```bash
# 启动守护
codex-sw ops token-refresh start

# 查看状态
codex-sw ops token-refresh status

# 立即执行一次扫描（会打印 scanned/skipped/refreshed/changed/failed/need_relogin）
codex-sw ops token-refresh run-once
```

在 TUI 首页可进入 `Logs` 查看续期日志（`q` / `Esc` 返回）。
当输出出现 `need_relogin` 时，表示该账号的 refresh token 已不可用，需要执行 `codex-sw ac relogin <account> --env <env>`。

`apikey` 模式下，登录/重登录时会额外询问 OpenAI Base URL。
`default` 表示不注入 `OPENAI_BASE_URL`；`custom` 会按账号保存并在 CLI/App 启动时自动注入。
`status` 和 TUI 状态卡片会显示当前账号使用的 `base_url`。
