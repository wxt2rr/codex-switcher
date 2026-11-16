# Desktop Release 106 CI Sandbox and Installer

## Goal
- 修复 v0.1.105 暴露的 CI/发布阻塞：Ubuntu 最新镜像的 Bubblewrap 网络命名空间限制，以及 Windows 安装冒烟测试失败。
- 推送补丁版本并触发新的桌面端发布流水线。

## Why Complex
- 同时涉及 CI 工作流、跨平台发布冒烟脚本、版本与发布标签，且需要依赖 GitHub Actions 的真实构建结果验证。

## Scope
- 相关模块：GitHub Actions CI、桌面端安装包验证、版本发布。
- 相关文件：`.github/workflows/ci.yml`、`scripts/ci-workflow.test.ts`、`scripts/package-install-smoke.mjs`、版本与发布说明文件。
- 兼容要求：保留 Linux/Windows 沙箱的 fail-closed 验证，不通过关闭沙箱或忽略失败来伪造成功。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 将 CI Linux 沙箱测试固定到支持 Bubblewrap loopback 的 Ubuntu 24.04 | `.github/workflows/ci.yml`, `scripts/ci-workflow.test.ts` | workflow contract test | done | CI 仅将 `desktop-non-macos` 的 Linux matrix 和条件固定为 `ubuntu-24.04`；workflow contract test 通过 |
| 2 | 将发布 Windows 安装验证固定到稳定 Runner，保留实际安装与回滚验证 | `.github/workflows/desktop-package.yml`, `scripts/desktop-package-workflow.test.ts` | workflow contract test、发布流水线 | done | 发布 job 固定到 `windows-2022`；两个 workflow contract test 均通过；NSIS 安装和回滚步骤仍保留 |
| 3 | 运行本地验证、更新版本与发布说明 | repository | tests/build/diff check | done | 定向 workflow tests 2 passed；跨平台测试 185 core + 245 gateway + 35 scripts 全部通过；桌面测试 638 passed、1 skipped、0 failed；`npm run desktop:build` 通过；版本更新为 desktop 0.1.106、root 0.8.22，CHANGELOG 与 release notes 已补充 |
| 4 | 提交、推送并触发新桌面版本发布 | git/GitHub Actions | workflow and release status | in_progress | `desktop-v0.1.106` 的主分支 CI 已全绿，但发布 job 在 Windows 2022 的 sandbox smoke 外层 15 秒超时；修复已完成，准备提交 v0.1.107 |
| 5 | 放宽 Windows sandbox smoke 的 launcher 外层等待并重新发布 | `scripts/windows-plugin-sandbox-smoke.cjs`, version/release files | desktop tests/build, CI, release workflow | done | launcher 外层等待从 15 秒提高到 60 秒，子进程仍保留 7 秒 fail-closed 超时；定向 workflow tests 2 passed，桌面测试 638 passed、1 skipped、0 failed，生产构建通过；版本升至 desktop 0.1.107、root 0.8.23 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 不以跳过安全测试或忽略安装失败作为修复。
