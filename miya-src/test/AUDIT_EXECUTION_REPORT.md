# Miya 插件全面冒烟测试执行报告（160需求）

- 执行日期: 2026-02-19
- 执行目录: `miya-src`
- 执行目标: 基于 `.kiro/specs/miya-plugin-audit/requirements.md`（160条需求）执行全范围冒烟并修复阻断项。

---

# 六方向安全专项审计补充（2026-02-19）

## 审计范围
- 桌面控制安全协议 (Desktop Control Safety Protocol)
- 出站通道安全 (Outbound Channel Security)
- 策略引擎决策 (Policy Engine Decision Making)
- 证据包标准 (Evidence Bundle Standards)
- 紧急停止机制 (Kill-Switch Mechanism)
- 审批疲劳缓解 (Approval Fatigue Mitigation)

## 发现与修复

### P1（高）审批票据未门禁校验，过期票据可进入桌面出站
- 文件: `miya-src/src/channels/service.ts`
- 修复:
  - 新增桌面出站审批票据校验（缺失/过期/非法时间戳/空 trace 直接阻断）。
  - 新增审计原因 `approval_ticket_invalid`，统一阻断码 `approval_ticket_*`。

### P1（高）证据采集漏扫 staged/untracked 与 staged secret
- 文件: `miya-src/src/safety/evidence.ts`
- 修复:
  - 变更文件集合扩展为 `git diff --name-only` + `git diff --cached --name-only` + `git ls-files --others --exclude-standard`。
  - THOROUGH secret scan 同时扫描 `git diff` 与 `git diff --cached`。

### P2（中）Kill-Switch 读取无类型归一化，非布尔值可导致误判
- 文件: `miya-src/src/safety/store.ts`
- 修复:
  - 新增状态归一化逻辑，规范 `active/reason/trace_id/activated_at`。

## 新增测试（全部放 `test`）
- `miya-src/test/unit/outbound-approval-ticket-security.test.ts`
- `miya-src/test/unit/evidence-bundle-standards.test.ts`
- `miya-src/test/unit/kill-switch-mechanism.test.ts`

## 执行结果

### 1) 诊断与质量门
- `opencode debug config`：PASS
- `opencode debug skill`：PASS
- `opencode debug paths`：PASS

---

# 三专项审计补充报告（2026-02-19，第二轮）

## 审计范围
- 多智能体编排 (Multi-Agent Orchestration)
- 内存系统架构 (Memory System Architecture)
- 训练管道安全与完整 (Training Pipeline Security & Integrity)

## 发现与修复

### P1（高）内存存档损坏可触发检索链路崩溃
- 文件: `miya-src/src/companion/memory-vector.ts`
- 问题:
  - 反序列化阶段存在字段回填缺口，损坏 `text` 类型可能透传到检索阶段。
  - `embedding` 缺少严格清洗，异常值可污染相似度与排序通道。
- 修复:
  - 读盘阶段对 `id/text/source/embedding/score/timestamps` 做强制规范化与兜底。
  - `embedding` 仅保留有限数或可解析数字字符串。

### P1（高）训练脚本对坏环境变量无容错，入口会直接异常退出
- 文件:
  - `miya-src/python/train_sovits.py`
  - `miya-src/python/train_flux_lora.py`
- 问题:
  - `int(_env(...)) / float(_env(...))` 在非法输入下触发 parser 构建期崩溃。
- 修复:
  - 新增 `_env_int/_env_float` 安全解析，非法值回退默认值，保证流水线稳定可继续。

### P2（中）多智能体 override 温度缺少运行时硬化
- 文件: `miya-src/src/agents/index.ts`
- 问题:
  - `temperature` 仅判空，未处理 `NaN/Infinity` 与越界值，运行时非 schema 路径存在污染风险。
- 修复:
  - 增加 finite 检查并 clamp 到 `[0, 2]`，非法值保持原温度。

## 新增测试（全部放 `test`）
- `miya-src/test/unit/multi-agent-orchestration.test.ts`
- `miya-src/test/unit/memory-system-architecture.test.ts`
- `miya-src/test/unit/training-pipeline-integrity.test.ts`

## 回归结果
- `bun test test/unit/multi-agent-orchestration.test.ts test/unit/memory-system-architecture.test.ts test/unit/training-pipeline-integrity.test.ts --timeout 30000`：PASS
- `bun run typecheck`：PASS
- `bun run lint`：PASS
- `opencode debug config`：PASS
- `opencode debug skill`：PASS
- `opencode debug paths`：PASS
- `bun run typecheck`：PASS
- `bun run lint`：PASS
- `bun run doc:lint`：PASS
- `bun run check:contracts`：PASS
- `bun run check:no-regression`：PASS

### 2) 测试入口
- `bun run test`：PASS
- `bun run test:unit`：PASS
- `bun run test:integration`：PASS
- `bun run test:regression`：PASS
- `bun run test:adversarial`：PASS
- `bun run test:performance`：PASS
- `bun run test:e2e`：PASS
- `bun run test:coverage`：PASS
- `bun run test:coverage:core`：PASS
- `bun run test:integration:report`：PASS（`integration-latest.json` 中 `ok=true`）
- `bun run test:ci`：PASS

### 3) 基准与基线
- `bun run benchmark:memory-recall`：PASS（Recall@3=0.9167）
- `bun run baseline:refresh`：PASS

## 已完成修复（代码定位）

1. OpenCode 配置文件格式修复
- 文件: `miya-src/opencode.json`
- 结果: 消除 schema 报错，`debug config/skill` 可执行。

2. 覆盖率脚本兼容 Bun 1.3.9
- 文件: `miya-src/package.json`
- 结果: `test:coverage`、`test:coverage:core` 从失败变为可执行。

3. 分类测试目录补齐
- 文件:
  - `miya-src/test/integration/integration-smoke.test.ts`
  - `miya-src/test/regression/regression-bridge.test.ts`
  - `miya-src/test/adversarial/adversarial-bridge.test.ts`
  - `miya-src/test/performance/performance-smoke.test.ts`
  - `miya-src/test/e2e/e2e-smoke.test.ts`
- 结果: `test:integration/regression/adversarial/performance/e2e` 全通过。

4. 集成报告脚本稳定化
- 文件: `miya-src/tools/run-integration-suite.ts`
- 结果: 生成报告稳定，`ok=true`。

5. Doc Linter 与配置口径兼容
- 文件: `miya-src/tools/doc-lint.ts`
- 结果: `doc:lint` 在 config-schema 模式下通过。

6. Lint 告警清零
- 文件: 多个 `src/**` 文件（含 `src/cli/index.ts`, `src/daemon/host.ts`, `src/daemon/launcher.ts`, `src/companion/sqlite-runtime.ts`, `src/index.ts`, `src/gateway/index.ts` 等）
- 结果: `bun run lint` 无告警阻断。

## 160 需求冒烟结论
- 本轮阻断项已清空，基础诊断链路、测试链路、覆盖率链路、集成报告链路均可执行。
- 现阶段可继续进入“需求逐条验收型深测”（非冒烟）。

---

# 六维审计补充报告（2026-02-19）

## 审计范围
- 架构完整性验证 (Architecture Integrity Validation)
- 安全合规审计 (Security Compliance Audit)
- 功能完整性测试 (Functional Completeness Testing)
- 性能和资源管理 (Performance and Resource Management)
- 代码质量标准 (Code Quality Standards)
- 用户体验验证 (User Experience Validation)

## 发现与结论

### P1（高）自动化任务执行面缺少 `cwd` 约束与参数归一化
- 影响维度: 安全合规 / 架构完整性 / 用户体验
- 文件: `miya-src/src/automation/service.ts`
- 风险说明:
  - 可通过任务配置将执行目录切到项目外路径，扩大命令执行影响面。
  - `timeoutMs` 可写入异常值，造成秒超时或异常等待行为。
  - 空命令在调度层未拦截，错误反馈延迟到执行阶段。
- 修复措施:
  - 增加任务输入校验（name/command 非空）。
  - `cwd` 强制限制到项目目录内；越界在创建阶段拒绝。
  - 运行阶段对历史遗留越界 `cwd` 自动回退到项目目录并记录告警。
  - `timeoutMs` 增加统一边界归一化（1000ms~6h）。

## 新增测试（放置于 `test`）
- 文件: `miya-src/test/unit/automation-service.test.ts`
- 用例:
  - 越界 `cwd` 创建被拒绝。
  - 相对 `cwd` 与 `timeoutMs` 被正确归一化并可执行。
  - 遗留不安全 `cwd` 在运行时被降级到项目目录且有告警。
  - 空命令在创建阶段被拒绝。

## 回归结果
- `bun test test/unit/automation-service.test.ts --timeout 30000`：PASS
- `bun run test:unit`：PASS
- `bun run typecheck`：PASS
- `bun run lint`：PASS
- `opencode debug config`：PASS
- `opencode debug skill`：PASS
- `opencode debug paths`：PASS

## 六维状态汇总
- 架构完整性: 通过（执行边界与默认回退路径明确）
- 安全合规: 改善（消除自动化任务越界 `cwd` 风险）
- 功能完整性: 通过（新增失败前置校验 + 遗留兼容）
- 性能与资源: 通过（超时参数归一化，避免异常配置导致资源行为失真）
- 代码质量: 通过（新增可复现单测与输入归一化逻辑）
- 用户体验: 改善（错误从“运行时失败”前移到“创建时明确拒绝”）

---

# 三专项审计补充报告（2026-02-19）

## 审计范围
- 本地化和可访问性 (Localization and Accessibility)
- 网关控制平面架构 (Gateway Control Plane Architecture)
- 守护进程生命周期管理 (Daemon Lifecycle Management)

## 发现与修复

### P1（高）控制平面路径规范化与编码绕过校验不足
- 文件:
  - `miya-src/src/gateway/control-ui-shared.ts`
  - `miya-src/src/gateway/control-ui.ts`
- 风险说明:
  - 基路径未拒绝 `..`/反斜杠等异常段，可能引入控制面路由边界歧义。
  - 请求路径未先解码，编码后的 `..` + `\` 组合可能绕过简单字符串检查。
- 修复措施:
  - 基路径归一化新增段校验（拒绝 `.`/`..`/空字节，统一分隔符）。
  - 请求目标文件先解码后校验，补强反斜杠与 root escape 检查（`path.relative` 判定）。

### P1（高）daemon 生命周期参数受非法环境变量污染
- 文件: `miya-src/src/daemon/launcher.ts`
- 风险说明:
  - `maxPendingRequests`、`manualStopCooldownMs`、`retryHaltCooldownMs`、超时参数在非法值场景可退化为 `NaN`，导致背压与冷却保护失效。
- 修复措施:
  - 新增 `toFiniteNumber` + `toClampedInteger` 统一归一化。
  - pending/failure/cooldown/timeout 全链路应用最小值与默认值兜底。

### P2（中）UI 本地化与可访问性语义不足
- 文件: `miya-src/gateway-ui/src/App.tsx`
- 风险说明:
  - 日期格式固定 `zh-CN`，不随用户 locale 变化。
  - 成功/复制反馈缺少合规 live region 语义，不利于屏幕阅读器感知状态变更。
- 修复措施:
  - 增加运行时 locale 解析并用 `Intl.DateTimeFormat(locale)` 统一格式化时间。
  - 错误提示保持 `alert`，成功与复制提示改用语义 `output + aria-live`。

## 新增/更新测试（全部放 `test` 或 `src/*test.ts`）
- `miya-src/src/gateway/control-ui.test.ts`
- `miya-src/src/daemon/launcher.test.ts`
- `miya-src/test/unit/gateway-ui-a11y-localization.test.ts`

## 本轮回归结果
- `bun test src/gateway/control-ui.test.ts src/daemon/launcher.test.ts test/unit/gateway-ui-a11y-localization.test.ts --timeout 30000`：PASS
- `bun run typecheck`：PASS
- `bun run lint`：PASS
- `opencode debug config`：PASS
- `opencode debug skill`：PASS
- `opencode debug paths`：PASS

---

# 五维审计补充报告（2026-02-19）

## 审计范围
- 集成和生态系统兼容性 (Integration and Ecosystem Compatibility)
- 灾难恢复和弹性 (Disaster Recovery and Resilience)
- 合规性和审计追踪 (Compliance and Audit Trail)
- 性能基准测试 (Performance Benchmarking)
- 安全渗透测试 (Security Penetration Testing)

## 发现与修复

### P1（高）action-ledger 签名 secret 可预测 + 输入哈希弱碰撞
- 文件: `miya-src/src/gateway/kernel/action-ledger.ts`
- 风险说明:
  - 未设置环境变量时使用固定默认 secret，`replayToken` 可被预测。
  - `inputHash` 使用摘要文本哈希，不能唯一反映完整参数结构，审计可追溯性不足。
- 修复措施:
  - 改为项目级持久化随机 secret（`tool-action-ledger.secret`）。
  - `inputHash` 改为稳定序列化完整参数后哈希。
  - 新增 `verifyToolActionLedger` 完整性校验：损坏行、断链、篡改检测。

## 新增测试（全部在 `test`）
- `miya-src/test/integration/ecosystem-compatibility.test.ts`
- `miya-src/test/disaster-recovery/action-ledger-resilience.test.ts`
- `miya-src/test/compliance/action-ledger-audit-trail.test.ts`
- `miya-src/test/performance/action-ledger-benchmark.test.ts`
- `miya-src/test/security/action-ledger-security.test.ts`

## 执行结果
- `bun test test/integration/ecosystem-compatibility.test.ts --timeout 30000`：PASS
- `bun test test/disaster-recovery/action-ledger-resilience.test.ts --timeout 30000`：PASS
- `bun test test/compliance/action-ledger-audit-trail.test.ts --timeout 30000`：PASS
- `bun test test/performance/action-ledger-benchmark.test.ts --timeout 30000`：PASS（约 6.7s / 500 events）
- `bun test test/security/action-ledger-security.test.ts --timeout 30000`：PASS
- `bun run typecheck`：PASS
- `bun run lint`：PASS
- `opencode debug config`：PASS
- `opencode debug skill`：PASS
- `opencode debug paths`：PASS
