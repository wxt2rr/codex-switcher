# 服务商账号连接与品牌图标

## Goal

把服务商页明确成“服务商目录 + 环境账号连接”的入口：服务商只描述静态能力和协议，账号连接承载环境归属与凭据，模型绑定继续在模型页维护。同时使用成熟的 AI 服务商品牌图标库，避免继续维护手写字母图标。

## Scope

- 服务商卡片和连接面板的文案改为账号连接语义。
- 保留现有 `importProviderCredential` 作为一次性“创建环境账号并写入凭据”的向导入口，不改变现有凭据存储协议。
- 使用 LobeHub Icons 的官方静态 SVG CDN 显示内置服务商图标。
- 图标加载失败、离线或自定义服务商时回退到安全的本地文字标记。
- 保留 Lucide 作为操作类图标库，不将品牌图标与通用操作图标混用。

## Non-goals

- 本次不引入新的服务商凭据数据库或迁移现有账号数据。
- 本次不把第三方品牌 SVG 复制进仓库；运行时使用官方静态资源，失败时保证界面仍可用。
- 本次不改变模型绑定、路由选择或凭据刷新后端逻辑。

## Implementation tasks

- [done] 调整 Provider 页的 Provider / Account / Credential 语义和中英文文案。
- [done] 增加 LobeHub Icons 的服务商 slug 映射、双 CDN 尝试和本地兜底。
- [done] 为图标 URL、未知服务商和页面语义补充测试。
- [done] 执行桌面测试、构建和 diff 校验。

## Verification

- `npm run desktop:test`
- `npm run desktop:build`
- `git diff --check`

## Evidence log

- 2026-10-09：核对 Magpie 官方 reference，确认其使用 LobeHub Icons；核对 LobeHub 官方文档，确认 SVG CDN URL 及 unpkg / npmmirror 两个官方示例。
- 2026-10-09：`npm run desktop:test` 通过，424 项测试中 423 项通过、1 项按环境跳过。
- 2026-10-09：`npm run desktop:build` 通过，Vite 产物正常生成。
- 2026-10-09：`git diff --check` 通过。
- 2026-10-09：npm registry 当前无法解析，未增加无法验证的运行时依赖；改用官方 SVG CDN，并保留本地兜底，避免影响构建和离线可用性。
