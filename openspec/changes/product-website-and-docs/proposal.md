## Why

codex-switcher 目前依赖 README 和零散工程文档介绍产品，缺少面向新用户的独立入口、清晰的功能说明以及可检索的使用指南。随着桌面端已覆盖环境、账号、模型、路由、用量和跨平台启动能力，需要一个与应用视觉一致、可独立发布的网站来降低理解和安装成本。

## What Changes

- 新增独立静态产品网站，提供产品定位、核心概念、功能介绍、真实界面预览、下载入口和常见问题。
- 新增中文使用文档中心，覆盖安装、环境、账号、模型兼容、CLI/App 启动、本地路由、用量统计、设置和故障排查。
- 网站复用桌面端的品牌颜色、字体、圆角、边框、阴影和交互状态，但不依赖 Electron 运行。
- 网站支持响应式布局、文档搜索、SEO、站点地图和 GitHub Release 下载回退。
- 新增站点构建、测试和 GitHub Pages 部署流程，不改变现有桌面端业务逻辑。

## Capabilities

### New Capabilities
- `product-website`: 独立产品首页、下载入口、响应式品牌展示和 SEO 能力。
- `user-documentation`: 按任务组织的中文使用文档、导航、搜索和故障排查能力。
- `website-delivery`: 网站的工作区集成、构建验证、静态部署及版本下载链接管理。

### Modified Capabilities

无。

## Impact

- 新增 `apps/website` 工作区及 Astro、Tailwind、MDX 等静态站点依赖。
- 根工作区增加网站开发、构建和检查命令。
- 新增网站资源、产品截图、文档内容和 GitHub Pages 工作流。
- 网站读取公开 GitHub Release 信息，不新增服务端、数据库、登录或云端账号同步。
