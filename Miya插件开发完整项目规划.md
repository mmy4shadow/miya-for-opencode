# Miya 插件开发完整项目规划（理想目标态）
核心点：1.像人类一样流畅控制电脑。2.极具特色且可持续适应的陪伴式聊天。3.深度绑定 OpenCode 与开源生态（如 OpenClaw），持续吸收上游能力演进。

## 0. 核心定位与设计宪法

### 0.1 核心定位
- Miya 是 OpenCode 的全自动控制平面（Automated Control Plane），兼具伴侣属性。
- 对外：像人类一样看屏幕、点鼠标、发消息、陪伴式对话。
- 对内：负责资源调度、上下文治理、执行审计与风险防护。

### 0.2 四大工程铁律（不可违背）
1. Audio First  
任何预计耗时大于 500ms 的动作，必须先触发本地音频填充（Filler Cue）掩盖体感延迟。

2. Adapter Protocol  
禁止在业务核心直接绑定外部生态库。外部能力统一通过 Miya Adapter（JSON-RPC/HTTP）接入独立进程。

3. VRAM Traffic Light  
交互任务对后台任务拥有绝对抢占权。LOW 训练任务必须支持超时熔断与强制终止。

4. Context Hygiene  
发往 OpenCode 的上下文必须模式化清洗：  
- Work 模式禁止混入“伴侣语气/情绪词”。  
- Chat 模式禁止混入“代码树/堆栈/工程噪声”。

## 1. 理想系统拓扑

- 采用 `Plugin (Light) <-> Daemon (Heavy)` 分离架构。
- 通信协议统一为 WebSocket RPC + 事件流。
- 所有副作用动作都需经过 OpenCode permission 体系（allow/ask/deny）。

## 2. 目录与模块目标形态（锁定）

```text
miya-src/
├── src/
│   ├── adapters/
│   │   ├── standard.ts
│   │   ├── openclaw/
│   │   │   ├── client.ts
│   │   │   ├── server.py
│   │   │   └── requirements.txt
│   ├── daemon/
│   │   ├── host.ts
│   │   ├── service.ts
│   │   ├── vram-mutex.ts
│   │   ├── audio-filler.ts
│   │   └── python-runtime.ts
│   ├── gateway/
│   │   ├── index.ts
│   │   ├── sanitizer.ts
│   │   ├── risk_engine.ts
│   │   └── optimistic.ts
│   └── ...
└── assets/
    └── audio_fillers/
```

## 3. 核心子系统理想设计

### 3.1 VRAM 调度器（稳定性基石）

优先级目标：
- CRITICAL：视觉识别、桌面控制相关链路（不可阻塞）。
- HIGH：交互反馈（生图、TTS、语音处理）。
- LOW：训练任务（LoRA/声音训练等）。

抢占目标：
- 当 CRITICAL/HIGH 进入且 LOW 正在运行时：
1. 先发软终止（SIGTERM）；
2. 最多等待 2 秒释放资源；
3. 未释放立即硬终止（SIGKILL）；
4. 训练任务按策略重排队（可恢复、可审计）。

### 3.2 Miya Adapter（扩展性基石）

适配器目标：
- 每个外部生态能力都通过 Adapter 接口接入，不污染核心业务层。
- Adapter 必须具备统一输入校验、权限注入、执行、输出证据化。

标准接口：

```ts
interface MiyaAdapter {
  validateInput(input: any): boolean;
  injectPermission(auditId: string): any;
  execute(input: any): Promise<any>;
  normalizeOutput(raw: any): EvidenceBundle;
}
```

环境隔离目标：
- 插件启动自动确保 `.opencode/miya/venv` 存在并可用。
- Python 侧适配器统一使用该 venv 执行。

### 3.3 乐观执行与 Audio First（体验基石）

目标执行流：
1. 用户指令进入后立即给出确认反馈（非阻塞）。
2. 100ms 内触发本地 filler（音频或可播放 cue）。
3. 后台并行预热模型与上下文定位。
4. 风控并行审查目标对象与内容。
5. 审查通过后执行有副作用动作；拒绝则给出可解释回退反馈。

红线：
- 乐观阶段不允许执行点击、发送、窗口置顶等副作用操作。

### 3.4 上下文清洗器（智能基石）

Work 模式目标：
- 删除伴侣话术干扰词（亲昵称呼、情绪指令、撒娇语气等）。
- 注入技术助手约束，确保任务导向输出。

Chat 模式目标：
- 删除代码上下文噪声（File Tree、堆栈、工程路径等）。
- 注入伴侣助手约束，确保温柔、自然、连贯。

模式切换目标：
- 自动判别 Work/Chat，模糊场景默认更安全（偏 Work）。

### 3.5 拟人化桌面控制闭环

目标闭环：
1. Look：视觉确认目标控件存在；
2. Feedback：给用户即时语音反馈；
3. Action：执行鼠标键盘动作；
4. Verify：二次视觉确认动作结果；
5. Completion：播报完成结果。

失败目标：
- 失败时必须显式反馈并产出错误报告；禁止静默重试。

## 4. OpenCode 深度绑定目标

- Miya 只做控制平面，不自建平行大模型入口。
- 文本/推理由 OpenCode 原生会话能力承载。
- 所有副作用执行都走 OpenCode 权限链路。
- Gateway 作为唯一控制面状态机；Web Console 只做无状态可视化与干预提交。

### 4.1 官方目录与事件链目标

- 目录契约（理想态必须满足）：
  - `.opencode/plugins/`
  - `.opencode/tools/`
  - `.opencode/package.json`
- 事件链契约（理想态必须完整观测）：
  - `tui.prompt.submit`
  - `tool.execute.before`
  - `tool.execute.after`
  - `permission.asked`
  - `permission.replied`
- 文档门禁契约（理想态必须自动化）：
  - `Doc Linter` 必须在 CI 中阻断文档与实现口径漂移。

## 5. 开源生态融合目标

- 通过 Ecosystem Bridge 接入 OpenClaw 等开源能力。
- 外部能力导入需要：
1. 版本锁定（Pin）；
2. 权限元数据完整；
3. 风险评估与审计字段可追溯；
4. 可回滚（rollback）。

## 6. 安全与治理目标

- 强制证据包：每个高风险动作必须留下可验证证据。
- Kill-Switch：支持按能力域快速熔断（outbound_send / desktop_control 等）。
- 输入输出双清洗：防注入、防越权、防人格污染。
- 资源治理：显存、并发、超时、重试、回退全部可配置并可审计。

## 7. 里程碑目标

### P0
- Audio First 基础闭环。
- VRAM 抢占闭环（软停+硬停）。
- Context Sanitizer 双模式落地。
- Adapter 标准协议与 OpenClaw 首个适配器打通。

### P1
- 人类式桌面控制完整闭环（Look-Action-Verify）。
- 伴侣对话长期记忆与自适应策略增强。
- Gateway 控制台可视化与风险干预完善。

### P2
- 生态桥接自动化（同步、兼容检测、回滚）。
- 多设备控制面与远程批准链路完善。
- 全量 KPI 仪表盘与自动化验收门禁。

## 8. 验收目标（Definition of Done）

- P95 交互体感延迟显著降低，长任务有稳定 filler 覆盖。
- 交互任务可稳定抢占训练任务，不出现显存互挤雪崩。
- Work/Chat 上下文隔离稳定，不出现角色污染。
- 外部生态能力通过 Adapter 协议接入，不侵入核心执行层。
- 所有关键副作用动作具备可回放证据包与审计记录。
