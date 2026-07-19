## Context

当前仓库是 npm workspaces，桌面端使用 Electron、Vite、React 和 Tailwind CSS。视觉变量位于 `apps/desktop/src/index.css`，产品功能已经包括环境、账号、模型、CLI/App 启动、本地路由、用量统计和跨平台安装排障。

本变更新增独立静态网站，不把网站打包进 Electron，也不引入账号、数据库或服务端。网站需要同时承担产品介绍和可维护的使用文档，并保持与桌面端一致的浅色卡片式界面。

## Goals / Non-Goals

**Goals:**

- 新增可独立构建和部署的产品首页与中文文档中心。
- 复用桌面端的品牌 token，保证颜色、字体、边框、选中态和按钮语义一致。
- 用真实功能和截图介绍环境、账号、模型、路由、用量及跨平台启动。
- 支持静态 SEO、站点地图、响应式布局、文档搜索和 GitHub Release 下载。
- 不影响现有 Electron 工作区和桌面构建。

**Non-Goals:**

- 不在官网提供用户登录、账号同步或在线配置。
- 不实现官网内启动桌面应用。
- 不重写桌面端已有组件，也不复制参考站的视觉风格。
- 第一版不建设 CMS，文档以仓库内 MDX 文件维护。

## Decisions

### 1. 使用 Astro + Tailwind + MDX

Astro 负责静态路由、SEO 和文档生成，MDX 让产品内容与布局解耦，Tailwind 复用当前桌面端的设计语言。相比把文档继续堆在 React 页面里，Astro 的静态输出更适合 GitHub Pages；相比 Starlight，定制布局更容易保持当前软件的视觉密度。

### 2. 新增 `apps/website`，不嵌入 Electron

网站作为独立 workspace，拥有自己的开发、构建和预览脚本。桌面端只共享稳定的设计 token，不共享运行时状态或 Electron bridge，降低发布耦合和回归风险。

### 3. 提取共享设计 token

新增 `packages/design-tokens`，集中提供背景、文字、主色、选中边框、边框、卡片、危险色、圆角、阴影和字体变量。桌面端以兼容方式引入，网站直接引用；已有桌面端局部样式不在本变更中大范围重构。

### 4. 文档采用任务型信息架构

文档按“安装 → 概念 → 账号 → 模型兼容 → 环境 → CLI/App → 用量 → 设置 → 排障”组织，并为常见错误提供“现象 / 原因 / 解决 / 验证”结构。第一版默认中文，保留英文路由和内容目录扩展点。

### 5. 下载版本由 Release API 提供，构建时有回退

站点构建脚本读取公开 GitHub Release 的安装包名称、版本和校验值；网络不可用或 API 失败时使用 Releases 页面链接，不阻断站点构建。

### 6. 部署使用静态托管

新增 GitHub Actions，仅在网站目录或共享 token 变更时构建并部署到 GitHub Pages。发布失败不影响桌面发布流程；回滚通过回滚网站构建提交完成。

## Risks / Trade-offs

- [文档与功能漂移] → 将文档内容基于 README、桌面端文案和测试清单整理，并在 CI 中检查关键页面和链接。
- [Release API 限流或网络失败] → 构建时使用静态回退链接，下载入口始终可用。
- [共享 token 改动造成桌面端轻微视觉变化] → 仅提取稳定变量，执行桌面前端构建和现有桌面测试。
- [静态站点中文搜索能力有限] → 第一版构建搜索索引，采用客户端搜索；后续可替换为 Pagefind，不改文档格式。
- [GitHub Pages 子路径资源错误] → 配置统一 `base`、canonical 和 asset URL，并在 CI 运行预览 smoke test。

## Migration Plan

1. 创建网站 workspace、共享 token 和中文文档目录。
2. 本地完成首页、文档和静态构建验证。
3. 启用独立网站 workflow，先以预览构建验证，再开启 Pages 发布。
4. 若需要回滚，禁用 workflow 或回滚网站目录提交；桌面端无需迁移。

## Open Questions

- GitHub Pages 的正式自定义域名在部署时再确定；第一版使用仓库 Pages 地址。
- 英文正文在中文版本稳定后补齐，路由和组件先保持可扩展。
