# MIYA 记忆文档

更新时间：2026-02-11

## 控制台左侧实现（Windows）

- 不修改 OpenCode 源码。
- 使用外置贴边方案 `Miya Dock`（`tools/miya-dock/`）实现“视觉等价左侧内嵌”。
- Dock 是无边框 Edge App 窗口：默认折叠 `20px`，展开 `420px`，贴在 OpenCode 左侧并跟随移动/缩放。
- 右侧 OpenCode 主界面保持不变，不被改造。

## Gateway 运行时状态

- Miya Gateway 启动后写入：`.opencode/miya/gateway.json`
- 字段：`url` / `port` / `pid` / `startedAt` / `status`
- `status` 规则：
  - 正常运行：`running`
  - kill-switch 激活：`killswitch`

## 启动路径

1. 打开 OpenCode（加载 Miya 插件）。
2. 如需手动触发 Gateway：运行命令 `/miya-gateway-start`。
3. 双击 `tools/miya-dock/miya-launch.bat` 启动侧栏。

## 运行时安全与提交

- Dock 缓存/配置目录固定在 `tools/miya-dock/.edge-profile/`。
- 仓库已忽略 `tools/miya-dock/.edge-profile/**`、`*.log`、`*.pid`、`.tmp/**`、AHK 安装包。
- auto-git-push 硬排除上述路径，避免缓存被自动 stage/push。
