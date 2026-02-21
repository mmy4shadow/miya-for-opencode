# Miya 审计与修复报告（最新）

- 生成日期: 2026-02-21
- 审计范围: `miya-src/**`（Node 统一口径）
- 核验命令:
  - `npm --prefix miya-src run -s typecheck`
  - `npm --prefix miya-src run -s build`
  - `npm --prefix miya-src run -s check:contracts`
  - `npm --prefix miya-src run -s doc:lint`
  - `npm --prefix miya-src run -s test:core`
  - `npm --prefix miya-src run -s test:ui`
  - `npm --prefix miya-src run -s test:integration:report`
  - `npm --prefix miya-src run -s test`
  - `opencode debug config|skill|paths`

## 1. 总结结论

- 全部验收命令通过。
- `test:ui` 全量通过（`21` 文件，`223` 测试）。
- `test:integration:report` 通过（`ok=true`，报告写入 `miya-src/.opencode/miya/reports/integration-latest.json`）。
- 运行时诊断命令 `opencode debug config|skill|paths` 均可执行。
- 代码口径下（排除 `node_modules/dist/.opencode/log`）未发现 Bun 运行依赖，仅保留一条防回归断言字符串检查：
  - `miya-src/test/unit/test-pipeline-contract.test.ts`

## 2. 本轮修复与复发点落实

1. 集成测试依赖导出路径复发（R1）
- 症状: 集成测试报错 `Cannot find module ... @opencode-ai/plugin/dist/tool`。
- 根因: 依赖包 `@opencode-ai/plugin/dist/index.js` 使用 `export * from "./tool";`，在当前 Node/Vitest 链路下解析不稳定。
- 修复文件: `miya-src/tools/run-integration-suite.ts`
- 修复措施: 集成执行前自动补丁为 `./tool.js`，再启动 Vitest。

2. 复发点台账更新
- 文件: `miya-src/test/E2E_ACCEPTANCE_REGRESSION_GUARD.md`
- 状态: 已逐条回填 Runbook + R1~R5（含本轮 R1 与 UI `act(...)` 告警跟踪）。

## 3. 未闭合项（当前非阻断）

1. UI 测试存在大量 React `act(...)` 告警
- 现状: 不影响通过，但会污染 stderr，降低信噪比。
- 追踪: 已登记为复发点 `R5`。

## 4. 关键执行证据

- `typecheck/build/contracts/doc:lint/test:core/test:ui/test:integration:report/test`: 全部 `exit=0`。
- 集成报告: `miya-src/.opencode/miya/reports/integration-latest.json` -> `ok: true`, `exitCode: 0`。
- 运行时诊断: `opencode debug config|skill|paths` 均成功返回。

