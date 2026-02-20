# Miya 审计与修复报告（最新）

- 生成日期: 2026-02-20
- 审计范围: `miya-src/**`（按高风险优先）
- 核验命令: `opencode debug config|skill|paths`, `bun run typecheck`, `bun run check:contracts`, `bun run test:core`, `bun run test:run`

## 1. 总结结论

- `typecheck`: 通过。
- `check:contracts`: 通过（3/3 required hooks）。
- `test:core`: 通过（核心 TS/Bun 测试全绿）。
- `gateway-ui` 全量 `vitest`: 仍有 `7` 个失败（集中在 `MemoryPage/TasksPage` 回归测试，均为超时）。
- 运行时配置诊断: `opencode debug config|skill|paths` 可执行并返回有效结果。

## 2. 本轮已修复问题

1. 测试编排错误导致 UI 测试在 Bun 无 DOM 环境误跑
- 文件: `miya-src/package.json`
- 修复: `test:core` 改为 `bun test --cwd src` + `bun test --cwd test`；UI 继续由 `gateway-ui` 的 `vitest` 执行。
- 结果: 核心测试与 UI 测试隔离，避免大量 `document/window is not defined` 误报。

2. `SecurityPage` 功能占位实现未接入真实网关方法
- 文件: `miya-src/gateway-ui/src/pages/SecurityPage.tsx`
- 修复: 去除 `console.log/TODO` 空实现，改为调用 `updateTrustMode` 与 `togglePolicyDomain`；并从 `configCenter.policyDomains` 提取策略域。
- 结果: 页面控制动作具备真实调用链。

3. `SecurityPage` 测试文件损坏与不可执行
- 文件: `miya-src/gateway-ui/src/pages/SecurityPage.test.tsx`
- 修复: 重建完整测试，覆盖渲染、Kill-Switch 确认分支、TrustMode 保存、策略域切换、加载态。
- 结果: 该文件 7/7 通过（定向执行）。

4. 空测试文件导致 Vitest Suite 直接失败
- 文件: `miya-src/gateway-ui/src/routes.integration.test.tsx`
- 修复: 增加最小可执行测试套件。
- 结果: suite 不再因 0 test 失败。

5. `App.behavior` 测试环境基址冲突
- 文件: `miya-src/gateway-ui/src/App.behavior.test.tsx`
- 修复: 路由重置从硬编码绝对 URL 改为 `history.replaceState(..., pathname)`；`GlobalRegistrator.unregister` 仅在本文件注册时执行。
- 结果: `App.behavior` 从 7 失败修复为全通过。

6. 测试契约回归保护
- 文件: `miya-src/test/unit/test-pipeline-contract.test.ts`
- 修复: 新增并对齐脚本契约断言，防止后续再次混跑。
- 结果: `test/unit` 通过。

## 3. 未闭合问题（仍需修复）

### P1（高）
1. `MemoryPage` 回归测试超时
- 文件: `miya-src/gateway-ui/src/pages/MemoryPage.test.tsx`
- 当前失败: 5 个（均 5000ms 超时）。
- 影响: 记忆模块回归可信度不足。

2. `TasksPage` 回归测试超时
- 文件: `miya-src/gateway-ui/src/pages/TasksPage.test.tsx`
- 当前失败: 2 个（均 5000ms 超时）。
- 影响: 作业中心端到端回归覆盖不完整。

### P2（中）
3. 多处测试 mock 写法告警（`vi.fn` 构造器 mock 方式不规范）
- 文件: `miya-src/gateway-ui/src/pages/MemoryPage.test.tsx`, `miya-src/gateway-ui/src/pages/TasksPage.test.tsx`
- 影响: 易引入假阳性/假阴性，且放大超时问题。

## 4. 关键执行证据

- `bun run test:core`: 通过。
- `bun run test:run -- src/pages/SecurityPage.test.tsx`: 通过（7/7）。
- `bun run test:run`（gateway-ui 全量）: 失败 7（Memory 5 + Tasks 2）。

## 5. 建议下一步（按收益排序）

1. 先重写 `MemoryPage/TasksPage` 的 gateway-client mock 为 class 实例 mock（避免 `vi.fn` 构造器警告），并将长链路断言拆为短链路。
2. 为 7 个超时用例加 deterministic fixture（固定路由 + 固定 RPC 返回 + 显式等待页面 ready 信号）。
3. 全量 UI 绿后再恢复 `bun run test` 的 CI 阻断门槛。
