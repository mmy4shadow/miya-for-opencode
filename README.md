# miya-for-opencode
一个依托opencode的私人管家

插件源码在 `miya-src/`（包含 `src/` + 已构建的 `dist/`）。

本地开发请按 OpenCode 插件机制放置入口文件：
- 项目级：`.opencode/plugins/`
- 全局：`~/.config/opencode/plugins/`

如果本地插件依赖外部 npm 包，请把依赖写在 `.opencode/package.json`，并在该目录执行 `bun install`。

详细安装/运行说明见：`miya-src/README.md`。
