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

## 快速开始

```bash
# 在 default env 登录两个账号
codex-sw ac login personal --env default
codex-sw ac login work --env default

# 切换 CLI 账号并启动 codex
codex-sw ac use personal -t cli --launch

# 切换 App 账号并启动 App
codex-sw ac use work -t app --launch

# 新建 env 并登录账号
codex-sw env new project-a --empty
codex-sw ac login corp --env project-a
codex-sw ac use corp --env project-a -t both
```

## 核心命令

| 命令 | 说明 |
| --- | --- |
| `codex-sw env ls` | 列出环境 |
| `codex-sw env new <env> [--empty\|--from <src-env\|default>]` | 创建环境 |
| `codex-sw env use <env> [-t cli\|app\|both]` | 切换环境 |
| `codex-sw ac ls [--env <env>]` | 查看账号总览与用量（同 `ops list`） |
| `codex-sw ac login <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync]` | 登录账号 |
| `codex-sw ac use <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | 切换账号 |
| `codex-sw ac logout [account] [--env <env>] [-t cli\|app\|both]` | 注销账号 |
| `codex-sw whoami [-t cli\|app\|both]` | 查看当前 env/account |
| `codex-sw status` | 查看当前登录状态 |
| `codex-sw version` | 查看版本 |
| `codex-sw check` | 健康检查 |
| `codex-sw upgrade [--dry-run]` | 升级工具 |
| `codex-sw --help` | 查看核心命令帮助 |
| `codex-sw --help-all` | 查看完整命令帮助 |

## 运维命令

| 命令 | 说明 |
| --- | --- |
| `codex-sw ops list` | 查看账号列表与用量信息（同 `ac ls`） |
| `codex-sw ops proxy [<host:port>\|off\|test]` | 配置/测试用量 API 代理 |
| `codex-sw ops exec -- <codex args...>` | 在当前 CLI 上下文执行 codex |
| `codex-sw ops import-default <env> [--with-auth] [--force]` | 导入默认环境数据 |
| `codex-sw ops init [--shell zsh\|bash] [--dry-run]` | 初始化命令入口 |
| `codex-sw ops recover [--dry-run]` | 恢复指针 |
| `codex-sw ops doctor [--fix]` | 深度检查与修复 |

## 开发

```bash
npm run check
```

## 发布

```bash
npm login --registry https://registry.npmjs.org/
npm run release:npm
```
