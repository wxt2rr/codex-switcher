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

### 源码安装

```bash
./scripts/install.sh
codex-sw check
```

## 快速开始（推荐 TUI）

### 方式一：TUI（推荐）

```bash
# 直接进入 TUI（等同于 codex-sw tui）
codex-sw
```

#### TUI 截图占位（后续替换）

- 首页：
  `![TUI Home](docs/images/tui-home.png)`
- 切换流程：
  `![TUI Switch](docs/images/tui-switch.png)`
- 状态页：
  `![TUI Status](docs/images/tui-status.png)`

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
| `codex-sw ac login <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--mode auth\|apikey]` | 登录账号 |
| `codex-sw ac use <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | 切换账号 |
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
| `codex-sw --help` | 查看核心命令帮助 |
| `codex-sw --help-all` | 查看完整命令帮助 |
