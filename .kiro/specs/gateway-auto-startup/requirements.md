# Requirements Document: Gateway Auto-Startup

## Introduction

本需求文档定义了 Miya Gateway 开机自启动功能的完整需求。该功能旨在实现电脑启动时自动运行 Miya Gateway,并在 OpenCode 启动时自动连接和打开控制面板,同时严格遵守"插件随 OpenCode 起落"的核心架构原则。

## Glossary

- **Miya_Gateway**: Miya 项目的 Web 控制平面,提供任务管理、配置、审计等功能
- **OpenCode**: AI 辅助编程平台,Miya 作为其插件运行
- **Daemon**: Miya 的后台守护进程,负责执行、媒体处理、通道收发等
- **Launcher**: 负责拉起和管理 Daemon 生命周期的组件
- **Control_Panel**: Gateway 的 Web UI 界面
- **Coupled_Mode**: 默认模式,Daemon 随 OpenCode 启停
- **Service_Mode**: 实验模式,Daemon 可独立于 OpenCode 运行
- **Autostart_Task**: Windows 计划任务,用于开机自启动
- **Lifecycle_State**: Daemon 的生命周期状态(STOPPED/STARTING/CONNECTED/DEGRADED/BACKOFF/STOPPING)

## Requirements

### Requirement 1: 开机自启动配置管理

**User Story:** 作为用户,我希望能够配置 Miya Gateway 是否开机自启动,以便在电脑启动后自动获得 Miya 的服务能力。

#### Acceptance Criteria

1. WHEN 用户访问 Gateway 控制面板配置页面 THEN THE System SHALL 显示开机自启动开关和当前状态
2. WHEN 用户启用开机自启动 THEN THE System SHALL 创建 Windows 计划任务并验证创建成功
3. WHEN 用户禁用开机自启动 THEN THE System SHALL 删除 Windows 计划任务并验证删除成功
4. THE System SHALL 持久化开机自启动配置到本地文件
5. WHEN 配置操作失败 THEN THE System SHALL 返回明确的错误原因和恢复建议

### Requirement 2: 开机自启动执行流程

**User Story:** 作为用户,我希望电脑启动后 Miya Gateway 能自动运行,以便无需手动启动即可使用 Miya 功能。

#### Acceptance Criteria

1. WHEN 系统启动且开机自启动已启用 THEN THE Autostart_Task SHALL 在用户登录后自动执行
2. WHEN Autostart_Task 执行 THEN THE System SHALL 启动 OpenCode 进程
3. WHEN OpenCode 启动 THEN THE Miya_Plugin SHALL 自动加载并拉起 Daemon
4. THE Autostart_Task SHALL 使用隐藏窗口模式执行,不干扰用户桌面
5. WHEN Autostart_Task 执行失败 THEN THE System SHALL 记录失败日志到本地文件

### Requirement 3: Daemon 生命周期管理

**User Story:** 作为系统架构师,我希望 Daemon 的生命周期严格遵循"随 OpenCode 起落"原则,以避免引入独立常驻进程的风险。

#### Acceptance Criteria

1. WHEN OpenCode 启动 THEN THE Launcher SHALL 检测并拉起 Daemon 进程
2. WHEN OpenCode 退出 THEN THE Launcher SHALL 回收 Daemon 进程
3. THE Daemon SHALL 不作为独立系统服务常驻运行
4. WHEN Daemon 崩溃或断连 THEN THE Launcher SHALL 按退避策略自动重连
5. THE Launcher SHALL 维护 Daemon 的 desired_state 和 lifecycle_state 状态机

### Requirement 4: Gateway 控制面板自动打开

**User Story:** 作为用户,我希望 OpenCode 启动后 Gateway 控制面板能自动在浏览器中打开,以便快速访问 Miya 的管理界面。

#### Acceptance Criteria

1. WHEN OpenCode 启动且 Miya 插件加载完成 THEN THE System SHALL 检测 Gateway 是否已运行
2. WHEN Gateway 已运行且自动打开 UI 已启用 THEN THE System SHALL 在默认浏览器中打开 Control_Panel
3. THE System SHALL 在 URL 中附带认证 token 以实现自动登录
4. WHEN 浏览器打开失败 THEN THE System SHALL 记录失败原因但不阻塞插件启动
5. THE System SHALL 提供配置选项允许用户禁用自动打开 UI 功能

### Requirement 5: 配置持久化与状态同步

**User Story:** 作为开发者,我希望所有配置和状态能够持久化并在重启后恢复,以确保系统行为的一致性。

#### Acceptance Criteria

1. THE System SHALL 将开机自启动配置保存到 `.opencode/miya/runtime/autostart.json`
2. THE System SHALL 将 Launcher 运行时状态保存到 `.opencode/miya/runtime/daemon/launcher.runtime.json`
3. WHEN 系统重启 THEN THE System SHALL 从持久化文件恢复配置和状态
4. THE System SHALL 在配置变更时原子性写入文件,避免数据损坏
5. WHEN 持久化文件损坏或缺失 THEN THE System SHALL 使用默认配置并记录警告

### Requirement 6: 错误处理与降级策略

**User Story:** 作为系统管理员,我希望系统能够优雅处理各种错误情况,并提供清晰的诊断信息。

#### Acceptance Criteria

1. WHEN 创建计划任务失败(权限不足) THEN THE System SHALL 返回 `autostart_enable_failed:insufficient_privileges` 错误
2. WHEN Daemon 连续启动失败超过阈值 THEN THE Launcher SHALL 进入 BACKOFF 状态并停止重试
3. WHEN Daemon 进入 BACKOFF 状态 THEN THE System SHALL 在 Gateway UI 显示失败原因和恢复建议
4. THE System SHALL 提供手动重置失败状态的接口
5. WHEN 平台不支持(非 Windows) THEN THE System SHALL 返回 `platform_not_supported` 并禁用自启动功能

### Requirement 7: 安全与权限控制

**User Story:** 作为安全工程师,我希望开机自启动功能遵循最小权限原则,并提供审计能力。

#### Acceptance Criteria

1. THE Autostart_Task SHALL 以当前用户权限运行,不请求管理员权限
2. THE System SHALL 记录所有开机自启动配置变更到审计日志
3. WHEN 检测到计划任务被外部修改 THEN THE System SHALL 在 Gateway UI 显示警告
4. THE System SHALL 验证计划任务的命令行参数,防止注入攻击
5. THE System SHALL 提供查询当前计划任务状态的接口

### Requirement 8: 跨模式兼容性

**User Story:** 作为架构师,我希望开机自启动功能能够兼容 Coupled Mode 和 Service Mode 两种运行模式。

#### Acceptance Criteria

1. WHEN 运行在 Coupled_Mode THEN THE Autostart_Task SHALL 启动 OpenCode,由 OpenCode 拉起 Daemon
2. WHEN 运行在 Service_Mode THEN THE Autostart_Task SHALL 直接启动 Daemon 作为独立服务
3. THE System SHALL 根据配置文件中的 `runtime.service_mode_experimental` 决定运行模式
4. WHEN 模式切换 THEN THE System SHALL 更新计划任务的启动命令
5. THE System SHALL 在 Gateway UI 显示当前运行模式和模式切换选项

### Requirement 9: 用户体验优化

**User Story:** 作为用户,我希望开机自启动过程流畅且不干扰正常使用,并能清楚了解系统状态。

#### Acceptance Criteria

1. THE Autostart_Task SHALL 在用户登录后延迟 5-10 秒执行,避免与系统启动项冲突
2. WHEN Daemon 启动中 THEN THE Gateway_UI SHALL 显示启动进度和当前阶段
3. THE System SHALL 在 Gateway UI 提供"禁用本次自启动"的快捷操作
4. WHEN 用户手动关闭 OpenCode THEN THE System SHALL 不自动重启,直到下次系统启动
5. THE System SHALL 提供开机自启动的诊断工具,检测常见问题并给出修复建议

### Requirement 10: 测试与可观测性

**User Story:** 作为测试工程师,我希望能够在测试环境中验证开机自启动功能,而不影响真实系统配置。

#### Acceptance Criteria

1. WHEN 环境变量 `MIYA_AUTOSTART_TEST_MODE=true` THEN THE System SHALL 模拟计划任务操作而不实际创建
2. THE System SHALL 在测试模式下将状态写入 `autostart.json` 的 `installed` 字段
3. THE System SHALL 提供 API 查询 Launcher 的完整状态快照
4. THE System SHALL 记录 Daemon 生命周期的所有状态转换到日志
5. THE System SHALL 在 Gateway UI 提供实时状态监控面板,显示 Daemon 连接状态、重试次数、失败原因等
