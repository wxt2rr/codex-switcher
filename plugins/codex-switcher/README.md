# codex-switcher

中文 | [English](README.en.md)

为 Codex CLI 与 Codex App 提供基于 **env + account** 的账号切换能力。

## 核心设计

- 内置默认 env：`default`，对应 `~/.codex`（可由 `CODEX_SWITCHER_DEFAULT_HOME` 覆盖）。
- 自定义 env 数据目录：`~/.codex-envs/<env>/home`（共享 history/sessions/config 等数据）。
- 账号凭证目录：`~/.codex-switcher/env-accounts/<env>/<account>/auth.json`（每账号独立 auth）。
- 同一 env 下切账号只替换 `auth.json`，不做 sync。
- 当前指针：
  - `~/.codex-switcher/current_cli_env`
  - `~/.codex-switcher/current_cli_account`
  - `~/.codex-switcher/current_app_env`
  - `~/.codex-switcher/current_app_account`

## 命令

```bash
codex-switcher env list
codex-switcher env create <env> [--empty|--from-default|--from-env <src>]
codex-switcher env use <env> [--target cli|app|both]
codex-switcher env remove <env> [--force]
codex-switcher env current [cli|app]
codex-switcher env path [env]

codex-switcher ac list [--env <env>]
codex-switcher ac add <account> [--env <env>]
codex-switcher ac remove <account> [--env <env>] [--force]
codex-switcher ac login <account> [--env <env>] [--target cli|app|both] [--sync|--no-sync]
codex-switcher ac use <account> [--env <env>] [--target cli|app|both] [--sync|--no-sync] [--launch|--no-launch] [-- <codex args...>]
codex-switcher ac logout [account] [--env <env>] [--target cli|app|both]
codex-switcher ac current [cli|app]

codex-switcher proxy [<host:port>|off|test]

codex-switcher list
codex-switcher status
codex-switcher current [cli|app]
codex-switcher exec -- <codex args...>

codex-switcher app open [account] [-- <app args...>]
codex-switcher app use <account> [-- <app args...>]
codex-switcher app logout [account]
codex-switcher app status
codex-switcher app stop
codex-switcher app current

codex-switcher version
```

## 典型流程

```bash
# 1) 默认 env(default=~/.codex) 下登录两个账号
codex-switcher ac login personal --env default
codex-switcher ac login work --env default

# 2) 同 env 切账号（仅替换 auth.json）
codex-switcher ac use personal --env default
codex-switcher ac use work --env default

# 3) 新建业务 env，并在该 env 下登录/切换账号
codex-switcher env create project-a --empty
codex-switcher ac login corp --env project-a
codex-switcher ac use corp --env project-a
```

## list 输出

`codex-switcher list` 默认输出：

`ENV / HOME / ACCOUNT / EMAIL / PLAN / 5H USAGE / WEEKLY USAGE / SOURCE`

其中用量数据策略为：

- 默认优先 API（`chatgpt.com/backend-api/wham/usage`）
- API 失败自动回退本地 `sessions/*.jsonl`
- `5H USAGE` / `WEEKLY USAGE` 的重置时间统一为 `MM-DD HH:MM`（例如 `89% (04-19 11:45)`）
- `SOURCE` 独立显示 `api` 或 `local`
- 可通过 `codex-switcher proxy 127.0.0.1:7899` 为该用量 API 单独配置代理（仅影响 `list`）
- 未手动设置时会自动检测环境变量/系统代理并用于用量 API 请求

## 命令兼容性

`ac` 与 `account` 是等价入口。历史一级命令 `login/logout/add/remove/use/switch` 已移除，请使用分组命令 `env` 与 `ac(account)`。

## 验证

```bash
./plugins/codex-switcher/scripts/test-switcher.sh
```
