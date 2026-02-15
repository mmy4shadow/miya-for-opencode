# Miya Gateway V5.0 终极融合方案（批判性完善版）
**在 V4.0 的“可控可审计”之上，解决“审批疲劳 / 情感断层 / 工程地狱 / 协商死锁”，做到落地顺滑、体验不断连。**

> 版本定位：**V5.0 不是推翻 V4.0，而是在不破坏 V4.0 安全边界与证据闭环的前提下，把体验与工程风险“砍掉尖刺”。**  
> 关键变化：
> - 用 **动态信任阈值（Trust Score + 三级提示）**解决 Approval Fatigue（审批疲劳）  
> - 用 **人格化封装层（Holographic Persona Layer）**让“专业不冷漠”  
> - 将 VRAM Hydraulics **分阶段降维落地**：P0 用“红绿灯互斥 + TTL + OS Page Cache 预热”，P2 才进阶三层液压机  
> - 协商协议新增 **Fixability（可修复性）**，明确 Soft Block / Hard Block，杜绝死循环  
> - 证据包升级为 **富媒体可预览**（音频播放/ASR、图像、diff、before-after）并在桌控类动作增加 **Simulation 预演视图**  
> - Windows 后台采集承认现实：用 **Capture Capability Tree**（WGC/PrintWindow/DXGI/UIA）+ 置信度/限制提示，避免“黑屏当真”

---

## 0. 先把“不会做/做不到”写死（防方案自相矛盾）

1) **不做“每一条信息都弹窗审批”**：会导致审批疲劳，最终用户会无脑全批准，安全机制失效。NIST 已明确指出“authentication fatigue”会导致用户为消除烦扰而随手批准请求。  
2) **不承诺 Windows 任意窗口都能后台无遮挡截取**：PrintWindow 依赖目标窗口处理 WM_PRINT/WM_PRINTCLIENT，可能返回空白且是阻塞调用；DXGI/WGC 也存在不可捕获区（安全桌面/受保护内容等）。  
3) **不在 Day 1 重新发明操作系统**：P0-P1 不做复杂 pinned memory/跨进程共享 CUDA context；优先保证稳定、可杀可恢复。  
4) **不允许“协商通道绕过安全闸门”**：协商只允许结构化“改错”，不允许“讨价还价”。

> 依据：  
> - PrintWindow 为同步阻塞且由目标窗口实现绘制，UI线程调用会导致无响应风险。  
> - Desktop Duplication API 需要处理旋转、指针形状等细节。  
> - WGC 可用 CreateForWindow(HWND) 直接对窗口创建捕获项，但仍有权限/边框等约束。  
> - 过多通知/弹窗会“太嘈杂”，微软通知指南明确强调通知应有价值且不要打扰。

---

## 1. V5.0 体验目标（可验收口径）

### 1.1 “不打断”与“不断连”并存
- **低风险、高信任**：自动放行，仅审计（不弹窗）  
- **中风险或中信任**：Toast/小条提示，默认继续执行，但提供“一键撤销/拦截”  
- **高风险或低信任**：阻断弹窗 + 证据富媒体预览 + 必须人工确认

### 1.2 “专业”与“女友=助理”不冲突
- 数据展示保持工业风，但每条拦截/提示都有 **人格化封装**（同一信息两层呈现：结构化原因 + Miya 的一句话解释）
- “可解释性 ≠ 冷漠”：解释要“短、准、带建议”，不写作文，不卖萌拖慢决策

### 1.3 工程实现分阶段
- P0：能跑、稳、不卡、不会因为炫技把自己搞死
- P1：把证据、协商、采集盲区补齐，系统可信度提升
- P2：再引入更复杂的“液压机”高级策略（Warm Pool / 分层 Offload）

---

## 2. 安全与体验的统一：Dynamic Trust Thresholding（动态信任阈值）

> 这是 V5.0 的“体验发动机”。核心思想：**审批不是二元开关，而是“风险 × 信任 × 上下文”的函数**。  
> 它直接解决 Approval Fatigue，同时也防“疲劳式攻击”。

### 2.1 Trust Score 的对象与维度
对三类对象分别维护信任分：
1) **Target 信任**：联系人/域名/路径（例如：WeChat_ID_妈妈）  
2) **Source 信任**：网页域名/仓库/文档来源（例如：learn.microsoft.com）  
3) **Action 信任**：动作类型（outbound_send / desktop_click / fs_write …）在特定上下文下的历史表现

每个对象保存：
- approved_count_10 / denied_count_10（10次窗口统计）
- last_decision_ts
- risk_overrides（是否曾发生高风险回滚/事故）
- trust_score（0~100）

### 2.2 信任分更新（10 次窗口 + 你原来的“有效率降权”规则）
以 10 次为一个窗口：
- useful = 通过且未回滚、未触发二次拦截、未出现证据不确定性  
- useless = 被拒、被回滚、或多次触发同类误报  
规则：
- useful < useless × 1.5 → **降权**（减少从该来源检索/学习）  
- useful < useless → **自动拉黑**（除非你手动解封）

> 这条规则不只用于“学习来源”，同样适用于 **目标联系人、工具调用、桌控动作**。

### 2.3 三档提示（解决审批疲劳）
结合微软通知设计原则“通知不应太嘈杂、可禁止提示但仍入通知中心”：

**(A) Silent Audit（静默）**  
条件：High Trust（≥90）且 Low Risk  
行为：自动执行；写 audit；仅在 Activity Stream 记录，不弹窗。

**(B) Toast Gate（轻打断）**  
条件：Medium Trust（50~90）或 Medium Risk  
行为：弹出 toast（3~5 秒），默认继续执行；提供“立即暂停/撤销”按钮。  
如系统检测用户处于焦点会话/专注模式，可自动降噪（只入通知中心）。

**(C) Modal Approval（阻断）**  
条件：Low Trust（<50）或 High Risk 或 evidence confidence 低  
行为：弹窗阻断；必须完成证据预览与确认。

> 说明：这个分级机制直接降低“中断地狱”，并与 NIST 提到的疲劳风险形成对抗：把高频低风险动作从“每动必审”中剥离出来，只在必要时阻断。

### 2.4 UI：Trust Radar（信任雷达）
- Nexus 首页新增：本 session 的 **Source/Target/Action** 三维信任雷达 + 近期波动原因（点击可回看审计）
- Sentinel 页：每张审批卡显示该 Target 的 trust_score + 最近 10 次决策概览

---

## 3. 协商协议升级：Hierarchical Error Codes + Fixability（防死锁）

> 解决你指出的 Negotiation Deadlock：Agent 不知道“这能不能修”，就会反复重写。

### 3.1 拒绝响应统一格式
```json
{
  "status": "denied",
  "ticketId": "ticket-998",
  "reason_code": "target_blacklisted",
  "fixability": "impossible",
  "message": "Target is in blacklist.",
  "budget": { "auto_retry": 0, "human_edit": 0 }
}
```

```json
{
  "status": "denied",
  "ticketId": "ticket-999",
  "reason_code": "tone_risky",
  "fixability": "rewrite",
  "suggestion": { "rewrite_style": "polite", "max_len": 220 },
  "budget": { "auto_retry": 1, "human_edit": 1 }
}
```

### 3.2 Fixability 枚举（最小集合）
- **impossible**：硬拒绝（目标黑名单、能力域关闭、政策不允许）→ Agent 直接终止并向用户解释  
- **rewrite**：可重写（语气、格式、长度、敏感词）  
- **reduce_scope**：可缩小范围（移除附件、改成草稿、改成只读）  
- **need_evidence**：证据不足（需要可捕获的收件人证据/文件预览）  
- **retry_later**：资源不足（VRAM/锁）→ 进入等待队列或降参重试

### 3.3 协商预算（硬上限）
- 每 ticket：最多 1 次 auto retry + 1 次 human edit  
- 当 fixability = impossible 时，budget 必为 0，Plugin/Agent 必须停止重试

---

## 4. “情感不断连”：Holographic Persona Layer（人格化封装，不破坏可解释性）

> 你批判“专业≠冷漠”是对的；但要避免把 UI 变成无用装饰。V5 用“微交互 + 文案封装”实现最小成本注入灵魂。

### 4.1 两层输出（同一事实两种表达）
每条拦截/提示都包含：
1) **结构化解释**：reason_code / risk / evidence confidence / policy_hash  
2) **Miya 批注**（一句话）：短、明确、给建议（可开关）

示例：
- 结构化：`Risk=High, reason=tone_risky, fixability=rewrite`  
- 批注：*“这句太冲了，发出去就很难收回。我帮你改成更委婉的版本？”*

### 4.2 Miya’s Insight（内心独白栏，低成本高价值）
Nexus 顶部 HUD 下方增加 40px 文本流：  
- “我正在监视微信窗口…检测到鼠标移动，暂停自动操作…”  
- “显存 80%，为了不卡，我把 FLUX 从 VRAM 卸载了（可在任务页恢复）”  
每一句必须对应一个 auditId（可点击跳转证据）。

### 4.3 状态替身（可选、可关闭）
一个极简抽象“呼吸球/盾牌态”仅用于表达：
- VRAM 压力（吃力）
- 安全拦截（盾牌）
- 空闲（呼吸）
不承诺 Live2D（避免把你拖进美术地狱）。

---

## 5. 证据系统升级：富媒体预览 + 桌控 Simulation 预演

### 5.1 Evidence Pack V5 目录标准
audit/<id>/
- meta.json（含 capture_method/confidence/limitations/mime/hashes/policy_hash）
- screenshot.png（可选）
- ocr.json（可选，含 bbox）
- audio.wav（可选） + asr.json（可选）
- diff.patch（写盘/改代码必备）
- before.png / after.png（可选）
- sim.json（桌控预演：轨迹/点击点/目标控件）
- logs.txt

### 5.2 Sentinel 证据组件（必须）
- Image Preview + bbox overlay（圈出“收件人昵称/头像位置”）
- Audio Player + waveform + ASR text 对照
- Diff Viewer（patch）
- Before/After Slider（UI/生成图）
- **Simulation View（桌控预演）**：
  - 在截图上叠加虚线轨迹 + 半透明光标 + 点击点
  - 让你一眼看出“点发送”还是“点删除”

### 5.3 受限证据静态服务（只读）
浏览器不可靠直接读本地文件，Daemon 提供：
- GET /evidence/<ticketId>/<file>  
并做：路径白名单 + mime 白名单 + hash 校验 + CSP + nosniff

---

## 6. Windows 后台采集：Capture Capability Tree（承认黑屏/遮挡现实）

### 6.1 捕获链（按优先级）
1) **WGC by HWND（优先）**：CreateForWindow(HWND)  
2) **PrintWindow（次选）**：同步阻塞，需后台线程/独立进程调用  
3) **DXGI Desktop Duplication（兜底）**：处理旋转/鼠标指针等  
4) **UIA-only（文本优先）**：能证明“目标是谁”就尽量别截图

### 6.2 证据“不确定性”产品化
meta.json 必须写：
- capture_method: wgc/printwindow/dxgi/uia_only
- confidence: 0~1
- limitations: secure_desktop / protected_content_suspected / occluded_frame / minimized_window …

confidence < 阈值时：
- 外发默认转草稿或拒绝（Hard/Semi-hard 规则）
- 桌控必须强制你点一次“确认预演正确”

---

## 7. 显存调度：从“液压机”降维到“红绿灯”（P0-P1），再升级回液压机（P2）

> 你指出“液压机实现地狱”是对的。V5 把显存设计成 **可进化**：先稳定落地，再逐步增强。

### 7.1 P0-P1：Traffic Light Scheduler（红绿灯）
**互斥组（Mutex Groups）**：
- Group_Heavy_VRAM = { FLUX / ComfyUI, SoVITS, Qwen-VL }  
规则：同一时间只允许一个在 VRAM active（拿到 lease 才能启动）。

**随用随载 + TTL**：
- 模型用完即卸载；但设置 **30s TTL**，减少频繁切换加载成本。  
- 预热只做 **OS Page Cache**：提前读权重文件到文件缓存，不抢 VRAM。

**抢占（Preempt）**：
- 前台交互（生图/视觉/语音）优先级高，抢占训练
- 训练必须独立进程，可杀可重排队

> 这阶段的优势：实现简单、最稳定、最可控（不碰复杂 pinned memory/跨进程 CUDA）。

### 7.2 P2：VRAM Hydraulics（进阶液压机）
在 Traffic Light 已稳定后再引入：
- Hotset（常驻 1~2）+ cooldown + swap_budget
- Warm Pool（RAM 预热池）
- 分层 offload（按库能力）  
  - Diffusers/Accelerate 的 CPU offload/dispatch 概念可以借鉴（但不强绑定某实现）。

---

## 8. 学习闸门去“中断化”：Learning Must Not Interrupt（除非要写入长期记忆/策略）

> V4 的学习摘要卡如果“逢学必弹”，会直接把你烦死。V5 把“学习”分层。

### 8.1 学习分层（3 层）
- **Ephemeral（临时缓存）**：只用于当前推理，不写入记忆库 → 不打断  
- **Candidate（候选记忆）**：进入“候选队列”，Toast 提示可一键采纳/拒绝 → 轻打断  
- **Persistent（长期记忆/策略）**：写入 Fact DB/Allowlist/Blacklist/Policy → 必须阻断审批（Modal）

### 8.2 你原来的“10次窗口降权/拉黑”只对 Persistent 生效
- 临时缓存不会触发你那套严苛统计
- 只有当 Miya 试图把来源纳入“长期可自动信任/可自动执行”时，才强制你批准

---

## 9. OpenCode 联动：让 Gateway 真正成为“外挂仪表盘”

Nexus 首页实时显示：
- sessionId（当前会话）
- activeTool（正在调用的 tool + args 摘要 + 耗时）
- permission 状态（ask/allow/deny）
- pending tickets 数
- 当前 killswitch 模式（外发/桌控/全停）

并且：
- Daemon 的 deny/negotiation 响应必须结构化回灌给 Agent（避免无限重试）

---

## 10. 反作弊与合规（特别是“外发/桌控”）

你提到“像人类一样控制已登录账号，小心被封号”。我不会提供规避平台检测的策略或“隐身自动化”技巧。  
V5 的正确做法：
- 默认 **草稿优先**：高风险外发先生成草稿与证据，让你最终点击发送
- 明确能力域开关：外发/桌控可一键熔断
- 所有外发动作可回放审计与撤销（能撤销的就撤销）

---

## 11. 落地顺序（保证 Day 1 能用）

### P0（先活下来）
1) Trust Score 基础版 + 三档提示（Silent/Toast/Modal）
2) Fixability 字段 + Hard/Soft Block（杜绝协商死循环）
3) Miya’s Insight 文本流（每条可点回审计）
4) Evidence Pack 基础预览（图像 + OCR）
5) Traffic Light Scheduler（互斥组 + TTL + 预读到 Page Cache）

### P1（可信、顺滑）
6) 富媒体证据：音频播放+ASR、diff viewer、before/after
7) 桌控 Simulation 预演视图
8) Capture Capability Tree + 置信度/限制提示
9) 学习分层（Ephemeral/Candidate/Persistent）+ 候选队列 Toast

### P2（完全体）
10) VRAM Hydraulics 进阶（hotset/warm/offload）
11) Memory Graph 可视化（力导图）
12) 状态替身（可选）

---

## 12. DoD（12 条硬指标，满足才算“没有问题”）
1. 低风险高信任动作不弹窗，只审计（解决审批疲劳）。
2. 中风险弹 Toast，可拦截可撤销（不打断工作流）。
3. 高风险必须 Modal + 富媒体证据预览（敢点批准）。
4. 拒绝响应包含 fixability；impossible 时 Agent 不重试。
5. 协商有预算上限，超限自动终止并提示。
6. PrintWindow 调用不在 UI 线程；失败/黑屏会反映在 confidence/limitations。
7. WGC/PrintWindow/DXGI/UIA 降级链可用，且 UI 显示“证据不确定性”。
8. 显存调度 P0 用互斥组 + TTL，避免复杂 CUDA context 地狱。
9. 训练可被抢占，且能恢复排队，OOM 有降参重试按钮。
10. Nexus 实时显示 session/tool/permission/killswitch，并有审计跳转。
11. 学习不会“逢学必弹”，只有写入长期记忆/策略才阻断。
12. 所有副作用动作都有 evidence pack，且可清理、可脱敏、只本地保存。

---

## 13. 关键参考（用于你写文档/验收时引用）
- “疲劳式批准”风险：NIST 提到 authentication fatigue，会导致用户为消除烦扰而随手批准请求。  
- Windows 捕获：WGC 可 CreateForWindow(HWND) 创建捕获项；PrintWindow 是同步阻塞并由目标窗口绘制；Desktop Duplication 需要处理旋转、指针等。  
- 通知设计：微软指南强调通知应有价值、不要太嘈杂，并支持把通知直接放入通知中心以降低打扰；Fluent Toast 组件提供 confirmation/progress/communication 类型。  
- 大模型/扩散模型内存优化：Diffusers/Accelerate 文档提供 CPU offload、device map、disk offload 等概念，可作为 P2 的设计参考。

---

# 附录 A：V5 事件/命令最小集合（便于你直接写 schema）

### A.1 Daemon → Gateway/Plugin
- system.stats
- vram.update (active_group, lease_owner, ttl)
- trust.update (entity, score, window_stats)
- security.request_approval (ticket, fixability, budget, evidence_index)
- security.decision (ticket, allow/deny/modify)
- job.progress / job.preempted / job.failed (oom, retry_suggested)
- audit.append (auditId, summary, pointers)
- opencode.session.update / opencode.tool.call / opencode.permission.update
- insight.append (text, auditId)

### A.2 Gateway → Daemon
- trust.set_mode (silent/toast/modal thresholds)
- security.approve/deny/request_rewrite/modify
- vram.reserve/release / vram.release_all
- model.prewarm_to_pagecache (path)
- job.pause/resume/cancel/prioritize/retry_downgrade
- policy.allowlist.add/remove / blacklist.add/remove
- killswitch.set_mode

---

# 附录 B：Trust Score 建议初始参数（你可按体验调整）
- 初始 trust_score：50  
- 每次“通过且无回滚”：+5（上限 100）  
- 每次“拒绝”：-8（下限 0）  
- evidence confidence 低：额外 -10  
- 高危回滚/事故：直接降到 20 并触发 Modal 强制审查

