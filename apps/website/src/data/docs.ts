export interface DocNavigationItem {
  slug: string;
  title: string;
  description: string;
  group: string;
  keywords: string;
}

export const docsNavigation: DocNavigationItem[] = [
  { slug: "getting-started", title: "快速开始", description: "从安装到第一次启动", group: "开始使用", keywords: "安装 创建环境 添加账号 CLI App" },
  { slug: "installation", title: "安装与首次启动", description: "macOS、Windows 与源码安装", group: "开始使用", keywords: "macOS Windows xattr SmartScreen MSIX npm" },
  { slug: "concepts", title: "环境与账号", description: "理解 env、account 和运行目标", group: "核心概念", keywords: "env account CODEX_HOME CLI App 当前窗口" },
  { slug: "accounts", title: "账号管理", description: "Auth、API Key 与账号复制", group: "配置管理", keywords: "Auth API Key sub2api 复制 独立授权" },
  { slug: "models", title: "模型与兼容模式", description: "自定义模型和 Chat 兼容", group: "配置管理", keywords: "Responses Chat Completions developer reasoning compaction tool call" },
  { slug: "environments", title: "环境管理", description: "创建、切换、删除和清理", group: "配置管理", keywords: "环境 历史 删除 保留天数 365" },
  { slug: "launch", title: "启动 CLI 与 App", description: "窗口、环境和账号切换规则", group: "运行方式", keywords: "CLI App 新开窗口 当前窗口 覆盖 MSIX 环境变量" },
  { slug: "routing", title: "本地路由", description: "端口、进程和兼容转换", group: "运行方式", keywords: "路由 端口 代理 localhost Base URL 进程" },
  { slug: "usage", title: "用量与请求详情", description: "Token、趋势、筛选和明细", group: "观察与维护", keywords: "用量 Token Input Output Cache 请求详情 分页" },
  { slug: "settings", title: "设置", description: "路径、终端、历史和生命周期", group: "观察与维护", keywords: "设置 默认终端 自动恢复 路由 历史 日志" },
  { slug: "troubleshooting", title: "故障排查", description: "按错误信息定位问题", group: "观察与维护", keywords: "developer reasoning compaction list_apps kill EPERM ENOENT 登录" },
];

export const docsGroups = Array.from(new Set(docsNavigation.map((item) => item.group)));
