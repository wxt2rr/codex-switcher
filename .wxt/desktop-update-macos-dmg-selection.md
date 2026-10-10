# 桌面更新-macOS 优先 DMG 安装包

## Goal
- 让 macOS 自更新下载标准 DMG 安装包，避免下载 ZIP 后直接运行解压出来的 `.app`，确保用户可以通过 Finder 将新版本替换到 Applications。

## Why Complex
- 同时涉及 GitHub 更新索引生成、客户端兼容选择、单元测试和已有发布流程，且需要兼容已经发布的重复平台资产清单。

## Scope
- 相关模块：GitHub Release 更新索引、平台安装包选择、更新流程测试。
- 相关文件：`scripts/create-update-index.mjs`、`scripts/create-update-index.test.mjs`、`apps/desktop/electron/github-update.ts`、`apps/desktop/electron/github-update.test.ts`。
- 兼容要求：保留 ZIP 作为手动下载资产；仅更新索引和客户端自更新路径优先 DMG；不触碰现有未跟踪构建产物。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立 macOS 安装包优先级和索引去重规则 | `scripts/create-update-index.mjs` | 生成索引时每个平台仅保留首选资产 | done | 索引按平台去重，DMG 优先于 ZIP；Linux AppImage 优先于 deb |
| 2 | 让客户端兼容旧清单并优先选择 DMG | `apps/desktop/electron/github-update.ts` | 重复 macOS 资产测试选择 `mac-dmg` | done | 新增首选资产选择器，旧清单含 ZIP/DMG 时仍选择 DMG |
| 3 | 更新回归测试与文档说明 | 两个测试文件、`.wxt` | 相关测试和 `git diff --check` | done | 索引测试改为断言每个平台只保留一个资产；新增旧清单 DMG 优先测试；安装提示说明拖入 Applications |
| 4 | 完整验证并交付 | 更新模块 | 桌面更新测试、跨平台脚本测试 | done | 定向测试 8 项通过；桌面全量测试 453 通过、1 跳过；桌面构建和发布工作流测试通过；`git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- DMG 优先；只有同一平台没有 DMG 时才允许 ZIP 作为降级资产。
- ZIP 仍保留在 GitHub Release，供用户手动下载使用。
