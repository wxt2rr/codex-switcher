# codex-switcher

中文 | [English](README.en.md)

`codex-switcher` 是一个面向 Codex CLI 与 Codex App 的轻量账号切换工具。
它通过为每个 profile 使用独立的 `CODEX_HOME` 目录实现账号隔离。

## 项目背景

最早我自己一直在用 Codex，公司配的是 Cursor，所以在我的电脑上两套账号互不影响。  
后来公司从 Cursor 切到 Codex 后，我就得在同一台电脑上同时用个人账号和公司账号，很快就遇到冲突：登录态会互相覆盖，切换也不顺手。

为了搞清楚原因，我看了下 Codex 的本地数据机制，发现思路其实很直接：只要把不同账号对应的本地目录隔离开，就能稳定切换。  
基于这个思路，我用 Codex 写了 `codex-switcher`，专门用来管理、切换和隔离我所有的 Codex 账号，现在日常在个人/公司账号之间切换方便很多。

## Codex 本地认证机制（简述）

简单说就是：Codex 会把“账号登录态 + 会话历史 + 一些本地状态”都放在 `CODEX_HOME` 这个目录里（默认一般是 `~/.codex`）。  
如果两个账号共用同一个目录，就很容易出现你登我下、我登你下，或者历史数据串在一起的问题。

`codex-switcher` 做的事情其实不复杂：给每个账号分一个独立目录（`~/.codex-profiles/<profile>`），然后在你执行命令或启动 App 时自动切到对应目录。这样每个账号的数据都各管各的，切换也就稳定了。

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
codex-switcher add work
codex-switcher add personal

codex-switcher use work --sync
codex-switcher login --sync
codex-switcher exec -- login status

codex-switcher switch personal --sync
codex-switcher app use personal
```

## 同步选项

- `login --sync`：将 `~/.codex` 同步到目标 profile（不包含 `auth.json`）。
- `use/switch --sync`：将当前 CLI profile 同步到目标 profile（不包含 `auth.json`）。
- `--no-sync`：不进行数据同步（默认）。

## 命令参考

命令默认用 `codex-switcher`，你也可以继续使用兼容别名 `codex-sw`。

| 分类 | 命令 | 说明 |
| --- | --- | --- |
| Profile 管理 | `codex-switcher add <profile>` | 新建 profile |
| Profile 管理 | `codex-switcher remove <profile> [--force]` | 删除 profile |
| Profile 管理 | `codex-switcher list` | 列出所有 profile |
| Profile 管理 | `codex-switcher current [cli\|app]` | 查看当前 CLI / App profile |
| Profile 管理 | `codex-switcher status` | 查看当前 profile 登录状态 |
| Profile 管理 | `codex-switcher use <profile> [--sync\|--no-sync]` | 切换当前 CLI profile |
| Profile 管理 | `codex-switcher switch <profile> [--sync\|--no-sync]` | `use` 的等价命令 |
| 数据迁移 | `codex-switcher import-default <profile> [--with-auth] [--force]` | 从 `~/.codex` 导入数据到 profile |
| CLI 登录态 | `codex-switcher login [profile] [--sync\|--no-sync]` | 登录指定或当前 CLI profile |
| CLI 登录态 | `codex-switcher logout [profile]` | 登出指定或当前 CLI profile |
| CLI 登录态 | `codex-switcher exec -- <codex args...>` | 在当前 CLI profile 下执行 codex 命令 |
| CLI 登录态 | `codex-switcher env [profile]` | 输出指定 profile 的 `CODEX_HOME` |
| App 控制 | `codex-switcher app open [profile]` | 用指定 profile 启动 App |
| App 控制 | `codex-switcher app use <profile>` | 切换 App profile（等价于 open） |
| App 控制 | `codex-switcher app logout [profile]` | 登出 App profile |
| App 控制 | `codex-switcher app status` | 查看 App 运行状态 |
| App 控制 | `codex-switcher app stop` | 停止由工具启动的 App 进程 |
| App 控制 | `codex-switcher app current` | 查看当前 App profile |
| 系统维护 | `codex-switcher check` | 基础环境与状态检查 |
| 系统维护 | `codex-switcher doctor [--fix]` | 诊断并可选自动修复 |
| 系统维护 | `codex-switcher recover [--dry-run]` | 恢复损坏的 current 指针 |
| 系统维护 | `codex-switcher init [--shell zsh\|bash] [--dry-run]` | 初始化 PATH 与快捷命令 |
| 系统维护 | `codex-switcher upgrade [--dry-run]` | 升级到最新版本 |

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
