# codex-switcher

中文 | [English](README.en.md)

为 Codex CLI 与 Codex App 提供基于 profile 的账号切换能力。

## 核心设计

- 一个 profile 对应一个独立 `CODEX_HOME`：`~/.codex-profiles/<profile>`
- CLI 命令在当前 CLI profile 下执行
- App 在当前 App profile 下重启
- 当前指针存储在 `~/.codex-switcher/current_cli` 与 `~/.codex-switcher/current_app`

## 命令

```bash
codex-switcher add <profile>
codex-switcher remove <profile> [--force]
codex-switcher list
codex-switcher import-default <profile> [--with-auth] [--force]
codex-switcher use <profile> [--sync|--no-sync]
codex-switcher switch <profile> [--sync|--no-sync]
codex-switcher current [cli|app]
codex-switcher status

codex-switcher exec -- <codex args...>
codex-switcher login [profile] [--sync|--no-sync]
codex-switcher logout [profile]
codex-switcher env [profile]

codex-switcher app open [profile]
codex-switcher app use <profile>
codex-switcher app logout [profile]
codex-switcher app status
codex-switcher app stop

codex-switcher init [--shell zsh|bash]
codex-switcher upgrade [--dry-run]
codex-switcher recover
codex-switcher check
codex-switcher doctor [--fix]
```

## 典型流程

```bash
codex-switcher add work
codex-switcher add personal

codex-switcher use work --sync
codex-switcher login --sync
codex-switcher exec -- login status

codex-switcher switch personal --sync
codex-switcher app use personal
```

## 迁移已有数据

如果你原本在 `~/.codex` 下使用 Codex，可先导入到某个 profile：

```bash
codex-switcher import-default work
```

默认会迁移记录/项目等数据，但不包含 `auth.json`。
如需连登录态一起导入：

```bash
codex-switcher import-default work --with-auth
```

## 同步行为

- `login --sync`：从默认 `~/.codex` 覆盖同步到目标 profile，排除 `auth.json`。
- `use/switch --sync`：从当前 CLI profile 覆盖同步到目标 profile，排除 `auth.json`。
- `--no-sync`：显式关闭同步（默认行为）。

示例：

```bash
codex-switcher login work --sync
codex-switcher switch personal --sync
codex-switcher use work --no-sync
```

## 升级

```bash
codex-switcher upgrade
```

## 说明

- macOS 下 Codex App 是单实例；切换 App profile 需要重启。
- `codex-switcher app stop` 仅停止由 `codex-switcher` 启动并跟踪的 App 进程。
- `codex-switcher app open/use <profile>` 要求该 profile 已存在且已登录。
- `--sync` 为覆盖策略（不是合并）：源目录覆盖目标目录，`auth.json` 除外。
- `codex-switcher status` 返回码：
  - `0`：当前 CLI/App profile 均已登录
  - `1`：至少一个当前 profile 未登录
  - `2`：指针或 profile 完整性异常（可执行 `codex-switcher recover`）

## 验证

```bash
./plugins/codex-switcher/scripts/test-switcher.sh
```

## 兼容命令

`codex-sw` 作为兼容入口保留，行为与 `codex-switcher` 一致。
