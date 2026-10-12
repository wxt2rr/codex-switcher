# Usage router Our Free Model fixes

## Goal
修复 test 环境通过使用量路由调用 Our Free Model 时的认证失败，并避免模型发现成功后继续使用已不存在的历史模型绑定。

## Tasks

- [done] 让 usage-router 子进程加载与桌面主进程相同的 provider plugin data 目录
- [done] 在模型发现成功时过滤或清理已失效的历史模型绑定，同时保留发现失败时的历史模型兜底
- [done] 运行构建和静态校验，检查变更范围
