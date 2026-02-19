# Requirements Document: Miya Plugin Audit and Testing Specification

## Introduction

This document defines the comprehensive audit and testing requirements for the Miya plugin - an OpenCode plugin that provides multi-agent orchestration, local AI capabilities (image/voice generation), desktop control (QQ/WeChat automation), and companion-style interaction. The audit specification ensures architectural integrity, security compliance, functional completeness, performance standards, code quality, and user experience validation.

## Glossary

- **System**: The Miya plugin and its associated daemon processes
- **Gateway**: The control plane that manages task routing, policy enforcement, and state management
- **Daemon**: The execution layer that handles local model inference, training, and system automation
- **Agent**: One of the six capability domains (Task Manager, Code Search, Docs Helper, Arch Advisor, Code Fixer, UI Designer)
- **Kill-Switch**: Emergency capability domain shutdown mechanism
- **Outbound_Send**: The capability domain for external message sending (QQ/WeChat only)
- **Desktop_Control**: The capability domain for keyboard/mouse/window automation
- **Evidence_Bundle**: Structured proof package for auditable actions
- **Policy_Engine**: The decision-making system (represented by Arch Advisor) that evaluates risks
- **Allowlist**: Approved recipients for outbound messaging
- **VRAM_Budget**: GPU memory allocation constraints for training/inference
- **Semantic_Summary**: Human-readable conclusion layer over raw evidence
- **Memory_Domain**: Categorization of memory (work/relationship/episodic/semantic)
- **Training_Preset**: Standardized training configuration level (0.0-1.0 scale)
- **Intake_Gate**: Knowledge ingestion approval mechanism for external information
- **Self_Approval**: Automated approval mechanism with evidence requirements
- **UIA**: Windows UI Automation accessibility API
- **Persona_Layer**: Personality and tone configuration system
- **Ralph_Loop**: Self-correction execution loop (write→test→fix→verify)
- **PlanBundle**: Atomic task execution unit with approval and verification requirements

## Requirements

### Requirement 1: Architecture Integrity Validation

**User Story:** As a system architect, I want to verify the complete implementation of the six-agent architecture and Gateway control plane, so that the system operates according to design specifications.

#### Acceptance Criteria

1. THE System SHALL implement all six Agent capability domains (Task Manager, Code Search, Docs Helper, Arch Advisor, Code Fixer, UI Designer) with distinct responsibilities
2. THE Gateway SHALL maintain a single WebSocket control plane for all daemon communication
3. THE System SHALL enforce strict Plugin-Daemon process isolation with no direct service calls
4. THE System SHALL align all event hooks with OpenCode official event system (tui.prompt.submit, tool.execute.before/after, session.start/end, permission.asked/replied)
5. THE Gateway SHALL implement dual-form architecture (terminal process + Web control console)
6. THE System SHALL maintain single source of truth for policy configuration at `.opencode/miya/policy.json`

### Requirement 2: Security Compliance Audit

**User Story:** As a security auditor, I want to verify that all security mechanisms are properly implemented and cannot be bypassed, so that user data and system integrity are protected.

#### Acceptance Criteria

1. WHEN any outbound message is attempted, THE System SHALL verify recipient against allowlist before execution
2. WHEN a capability domain triggers Kill-Switch, THE System SHALL immediately halt that domain and generate semantic summary report
3. WHEN external information suggests configuration changes, THE Intake_Gate SHALL require explicit user approval before proceeding
4. THE System SHALL enforce that QQ/WeChat are the ONLY allowed outbound channels
5. THE System SHALL encrypt all locally stored sensitive data (credentials, tokens, session summaries)
6. WHEN privilege barriers are detected, THE System SHALL block desktop_control operations and report blocked_by_privilege status
7. THE System SHALL maintain immutable audit logs for all policy decisions with auditId and policy-hash
8. WHEN memory write operations are requested, THE System SHALL require evidence and approval before activation
9. THE System SHALL enforce three-factor decision fusion (content + recipient tier + intent confidence) for sensitive outbound operations
10. THE System SHALL implement rate limiting and anti-spam protection for all outbound channels

### Requirement 3: Functional Completeness Testing

**User Story:** As a QA engineer, I want to verify that all core functionalities work correctly across normal and edge case scenarios, so that users can rely on the system.

#### Acceptance Criteria

1. WHEN image generation is requested, THE System SHALL use local FLUX models and respect VRAM budget constraints
2. WHEN voice cloning is requested, THE System SHALL train using GPT-SoVITS locally without external API calls
3. WHEN ASR is needed, THE System SHALL use local Whisper with automatic model downgrade on VRAM pressure
4. WHEN desktop control is executed, THE System SHALL follow UIA-first protocol with visual fallback
5. WHEN QQ/WeChat sending is attempted, THE System SHALL capture before/after screenshots and verify receipt
6. THE Memory_System SHALL implement pending/active/reflect lifecycle with decay and conflict resolution
7. THE Training_System SHALL implement checkpoint strategies and OOM prevention with automatic downgrade
8. THE System SHALL support scheduled tasks with time-based triggers and approval templates
9. THE Ralph_Loop SHALL implement progress-driven retry with budget constraints (time/cost/risk)
10. WHEN user is actively using the computer, THE System SHALL respect Human-Mutex and queue desktop operations

### Requirement 4: Performance and Resource Management

**User Story:** As a system administrator, I want to ensure the system operates within resource constraints and maintains responsive performance, so that it doesn't degrade user experience.

#### Acceptance Criteria

1. THE System SHALL implement global VRAM semaphore to prevent memory conflicts between models
2. WHEN training jobs are queued, THE System SHALL only execute during idle windows (user inactive >= 5 minutes)
3. WHEN interactive tasks arrive during training, THE System SHALL terminate training within 1-2 seconds and release VRAM
4. THE System SHALL implement heterogeneous scheduling (NPU > GPU > CPU) with automatic fallback
5. THE System SHALL enforce backpressure limits (max_in_flight, max_queue, queue_timeout_ms) on Gateway-Daemon communication
6. THE System SHALL implement model dynamic loading/unloading with LRU caching strategy
7. THE System SHALL limit temporary image storage to 20GB with automatic LRU cleanup
8. THE System SHALL clean temporary voice files after 7 days or successful send confirmation
9. THE ASR_System SHALL maintain queue threshold <= 200ms with device fallback on timeout
10. THE Desktop_Control SHALL target P95 latency < 8 seconds for QQ/WeChat send operations

### Requirement 5: Code Quality Standards

**User Story:** As a developer, I want to ensure code meets quality standards and is maintainable, so that the system can evolve safely.

#### Acceptance Criteria

1. THE System SHALL maintain TypeScript type safety across all modules
2. THE System SHALL implement comprehensive error handling with structured error types
3. THE System SHALL achieve minimum 80% test coverage for core modules (gateway, channels, safety, policy)
4. THE System SHALL pass Doc Linter validation ensuring planning-code consistency
5. THE System SHALL enforce no direct service calls from plugin to daemon (isolation guard tests must pass)
6. THE System SHALL implement idempotency keys for all state-changing operations
7. THE System SHALL use semantic versioning for all external dependencies with hash verification
8. THE System SHALL document all public APIs with JSDoc comments
9. THE System SHALL pass static analysis (ESLint, TypeScript compiler) without errors
10. THE System SHALL implement regression test suite covering critical paths (outbound safety, approval fatigue, mixed mode, cross-domain memory)

### Requirement 6: User Experience Validation

**User Story:** As an end user, I want the system to be intuitive, responsive, and helpful, so that I can accomplish tasks efficiently.

#### Acceptance Criteria

1. WHEN errors occur, THE System SHALL provide semantic summaries with recovery suggestions (not just error codes)
2. THE Gateway_Web_Console SHALL display real-time status for jobs, memory, evidence, and policy state
3. WHEN approval is required, THE System SHALL present structured summaries with clear options (approve/deny/trial)
4. THE System SHALL implement approval fatigue suppression (silent threshold, plan bundle, deduplication)
5. WHEN Human-Mutex timeout occurs 3 times, THE System SHALL enter 15-minute cooldown with gentle notification
6. THE System SHALL provide wake word interaction with dynamic phrase pool (avoiding mechanical responses)
7. THE System SHALL maintain persona consistency across work/chat modes with automatic mode detection
8. WHEN desktop control fails, THE System SHALL provide actionable next steps (not just "failed")
9. THE System SHALL support one-click memory management (view/edit/archive/export) in Gateway console
10. THE System SHALL display training progress and allow cancellation without system instability

### Requirement 7: Integration and Ecosystem Compatibility

**User Story:** As a plugin developer, I want to ensure Miya integrates properly with OpenCode and external ecosystems, so that it leverages existing capabilities.

#### Acceptance Criteria

1. THE System SHALL register all tools following OpenCode official plugin directory structure (opencode.json, .opencode/plugins/, .opencode/tools/)
2. THE System SHALL use OpenCode permission system (allow/ask/deny) as final execution gate
3. THE Ecosystem_Bridge SHALL validate external skills with version locking and hash verification
4. THE System SHALL detect and report conflicts when importing skills with duplicate names
5. THE System SHALL map external capabilities to OpenCode permission metadata
6. THE System SHALL support OpenClaw-style node registration with capability declaration
7. THE System SHALL implement MCP protocol compatibility for tool invocation
8. THE System SHALL maintain compatibility with oh-my-opencode orchestration patterns
9. THE System SHALL provide migration path for existing OpenCode configurations
10. THE System SHALL document all breaking changes and provide upgrade guides

### Requirement 8: Disaster Recovery and Resilience

**User Story:** As a system operator, I want the system to recover gracefully from failures, so that work is not lost and safety is maintained.

#### Acceptance Criteria

1. WHEN daemon crashes, THE System SHALL restart with exponential backoff and restore session state
2. WHEN WebSocket connection drops, THE System SHALL implement heartbeat detection and automatic reconnection
3. WHEN training OOM occurs, THE System SHALL automatically downgrade to lighter strategy and resume from last checkpoint
4. WHEN desktop control is interrupted, THE System SHALL mark task as paused and require visual verification before resume
5. THE System SHALL implement 60-second suicide timer for orphaned daemon processes
6. WHEN policy file is corrupted, THE System SHALL refuse execution and alert user
7. THE System SHALL maintain audit log integrity even during system failures
8. WHEN evidence bundle generation fails, THE System SHALL block action execution
9. THE System SHALL implement rollback capability for failed configuration changes
10. WHEN Kill-Switch is triggered, THE System SHALL preserve all in-flight task state for post-mortem analysis

### Requirement 9: Compliance and Audit Trail

**User Story:** As a compliance officer, I want complete audit trails for all system actions, so that operations can be reviewed and verified.

#### Acceptance Criteria

1. THE System SHALL generate unique auditId for every state-changing operation
2. THE System SHALL include policy-hash in all audit records to detect configuration drift
3. THE System SHALL maintain evidence bundles with minimum required fields per action type (fs_write, shell_exec, desktop_control, outbound_send, memory_write, training, media_generate)
4. THE System SHALL implement semantic evidence layer with frozen reason enum (v1.0)
5. THE System SHALL record all Kill-Switch triggers with full context and recovery conditions
6. THE System SHALL maintain immutable event ledger for gateway method invocations
7. THE System SHALL provide audit query interface with filtering by time/domain/risk-level
8. THE System SHALL export audit logs in machine-readable format (JSON/JSONL)
9. THE System SHALL implement audit log rotation with configurable retention policy
10. THE System SHALL verify audit log integrity using cryptographic signatures

### Requirement 10: Performance Benchmarking

**User Story:** As a performance engineer, I want to measure system performance against defined benchmarks, so that regressions can be detected.

#### Acceptance Criteria

1. THE System SHALL measure and report memory recall precision (Recall@K) for retrieval operations
2. THE System SHALL track interruption rate (user confirmations per session) as negative metric
3. THE System SHALL measure persona consistency score across 50-turn conversations
4. THE System SHALL benchmark QQ/WeChat send latency with P50/P95/P99 percentiles
5. THE System SHALL measure training job startup time and checkpoint write latency
6. THE System SHALL track VRAM utilization and model swap frequency
7. THE System SHALL measure Gateway-Daemon RPC latency and backpressure rejection rate
8. THE System SHALL benchmark ASR processing latency and device fallback frequency
9. THE System SHALL measure approval fatigue metrics (silent approvals vs explicit asks)
10. THE System SHALL track mode detection accuracy (work vs chat vs mixed)

### Requirement 11: Security Penetration Testing

**User Story:** As a security researcher, I want to verify the system resists common attack vectors, so that vulnerabilities are identified before exploitation.

#### Acceptance Criteria

1. WHEN prompt injection is attempted via web content, THE Intake_Gate SHALL detect and block configuration changes
2. WHEN recipient spoofing is attempted, THE System SHALL detect mismatch and trigger Kill-Switch
3. WHEN privilege escalation is attempted, THE System SHALL detect and refuse execution
4. WHEN policy file tampering is detected, THE System SHALL refuse to execute and alert
5. WHEN memory injection is attempted, THE System SHALL detect suspicious patterns and require approval
6. WHEN rate limit bypass is attempted, THE System SHALL enforce cooldown periods
7. WHEN evidence bundle forgery is attempted, THE System SHALL detect hash mismatches
8. WHEN allowlist bypass is attempted via UI manipulation, THE System SHALL verify through multiple channels
9. WHEN training resource exhaustion is attempted, THE System SHALL enforce VRAM budgets
10. WHEN daemon isolation bypass is attempted, THE System SHALL detect and block direct service calls

### Requirement 12: Localization and Accessibility

**User Story:** As a Chinese-speaking user, I want the system to communicate in Chinese with proper cultural context, so that interactions feel natural.

#### Acceptance Criteria

1. THE Gateway_Web_Console SHALL display all UI text in Chinese
2. THE System SHALL generate semantic summaries in Chinese
3. THE System SHALL use culturally appropriate phrases for wake words and responses
4. THE System SHALL format dates and times according to Chinese conventions
5. THE System SHALL provide Chinese error messages with technical details in English as fallback
6. THE System SHALL support Chinese input for all text fields without encoding issues
7. THE System SHALL handle mixed Chinese-English content in memory and evidence
8. THE System SHALL provide Chinese documentation for all user-facing features
9. THE System SHALL use appropriate honorifics and tone based on relationship context
10. THE System SHALL support screen readers for Gateway Web Console accessibility

### Requirement 13: Gateway Control Plane Architecture

**User Story:** As a system architect, I want to verify the Gateway implements proper control plane patterns, so that all system operations are centralized and auditable.

#### Acceptance Criteria

1. THE Gateway SHALL maintain single WebSocket RPC endpoint for all daemon communication
2. THE Gateway SHALL implement protocol versioning with backward compatibility negotiation
3. THE Gateway SHALL enforce idempotency keys for all state-changing requests
4. THE Gateway SHALL implement request timeout with configurable limits (default 30s)
5. THE Gateway SHALL maintain bounded job queue with max_in_flight and max_queue limits
6. THE Gateway SHALL broadcast health metrics (uptime, memory, wsConnections) every 2.5 seconds
7. THE Gateway SHALL implement token-based authentication for Web console access
8. THE Gateway SHALL support graceful shutdown with in-flight request completion
9. THE Gateway SHALL implement method-level access control based on capability domains
10. THE Gateway SHALL log all method invocations to immutable action ledger

### Requirement 14: Daemon Lifecycle Management

**User Story:** As a system operator, I want the daemon to manage its lifecycle properly, so that resources are not leaked and state is consistent.

#### Acceptance Criteria

1. THE Daemon SHALL start only when OpenCode plugin activates
2. THE Daemon SHALL terminate within 60 seconds if WebSocket connection is lost
3. THE Daemon SHALL implement heartbeat protocol with 10-second interval
4. THE Daemon SHALL restore session state after reconnection
5. THE Daemon SHALL implement exponential backoff for reconnection attempts (max 5 retries)
6. THE Daemon SHALL log stdout/stderr to daemon/host.stdout.log and daemon/host.stderr.log
7. THE Daemon SHALL capture unhandled exceptions to daemon/host.crash.log
8. THE Daemon SHALL release all GPU resources before termination
9. THE Daemon SHALL persist job queue state to disk for recovery
10. THE Daemon SHALL implement graceful degradation when system resources are constrained

### Requirement 15: Multi-Agent Orchestration

**User Story:** As a task coordinator, I want agents to collaborate effectively without context pollution, so that complex tasks are completed correctly.

#### Acceptance Criteria

1. THE Task_Manager SHALL decompose tasks into subtasks with clear dependencies
2. THE Task_Manager SHALL dispatch subtasks to appropriate agents based on capability matching
3. THE Task_Manager SHALL aggregate results from multiple agents with conflict resolution
4. THE Task_Manager SHALL implement progress tracking with verifiable milestones
5. THE Task_Manager SHALL enforce budget constraints (time, cost, retries) per PlanBundle
6. THE Code_Search SHALL execute searches in isolated subagent sessions
7. THE Docs_Helper SHALL maintain source whitelist/blacklist with hit rate statistics
8. THE Arch_Advisor SHALL provide risk assessment with evidence for all high-risk operations
9. THE Code_Fixer SHALL implement Ralph Loop with stderr feedback and retry limits
10. THE UI_Designer SHALL generate artifacts (images, voice) using local models only

### Requirement 16: Memory System Architecture

**User Story:** As a memory system designer, I want to verify the memory system implements proper lifecycle and retrieval, so that information is accurate and relevant.

#### Acceptance Criteria

1. THE Memory_System SHALL implement three-tier lifecycle (ephemeral, candidate, persistent)
2. THE Memory_System SHALL maintain separate domains (work_memory, relationship_memory)
3. THE Memory_System SHALL implement exponential decay with configurable lambda per memory type
4. THE Memory_System SHALL detect conflicts and trigger resolution wizard
5. THE Memory_System SHALL implement dual-recall (semantic + lexical) with fusion scoring
6. THE Memory_System SHALL maintain source evidence (message_id, source_type) for all memories
7. THE Memory_System SHALL implement pending approval queue for new memories
8. THE Memory_System SHALL support cross-domain writes with explicit approval and evidence
9. THE Memory_System SHALL implement reflection worker with async queue and write budget
10. THE Memory_System SHALL provide drift detection (stale, conflict, timeout) with archive strategy

### Requirement 17: Training Pipeline Safety

**User Story:** As a training engineer, I want to verify training operations are safe and resource-aware, so that system stability is maintained.

#### Acceptance Criteria

1. THE Training_System SHALL calculate VRAM budget before starting any training job
2. THE Training_System SHALL implement automatic downgrade strategy on OOM detection
3. THE Training_System SHALL terminate training within 1-2 seconds when user becomes active
4. THE Training_System SHALL implement checkpoint strategy per model (FLUX: 50 steps, GPT-SoVITS: 100 steps)
5. THE Training_System SHALL enforce minimum checkpoint interval (5 minutes for voice)
6. THE Training_System SHALL implement I/O throttling with low priority for checkpoint writes
7. THE Training_System SHALL detect disk contention and defer checkpoint writes
8. THE Training_System SHALL implement training preset system (0.0-1.0 scale, default 0.5)
9. THE Training_System SHALL maintain training audit log with parameters and outcomes
10. THE Training_System SHALL support training cancellation without daemon crash

### Requirement 18: Desktop Control Safety Protocol

**User Story:** As a desktop automation engineer, I want to verify desktop control follows safety protocols, so that operations are accurate and auditable.

#### Acceptance Criteria

1. THE Desktop_Control SHALL implement UIA-first protocol with visual fallback
2. THE Desktop_Control SHALL capture before/after screenshots for all operations
3. THE Desktop_Control SHALL verify window focus before and after each action
4. THE Desktop_Control SHALL implement coordinate caching with pixel fingerprint validation
5. THE Desktop_Control SHALL detect privilege barriers and refuse operations with blocked_by_privilege
6. THE Desktop_Control SHALL implement Human-Mutex with 20-second timeout
7. THE Desktop_Control SHALL implement three-strike cooldown (15 minutes) on repeated timeouts
8. THE Desktop_Control SHALL verify recipient match against allowlist before sending
9. THE Desktop_Control SHALL implement send fingerprint to prevent duplicate sends
10. THE Desktop_Control SHALL support UI resilience with pause/resume and visual verification

### Requirement 19: Outbound Channel Security

**User Story:** As a security engineer, I want to verify outbound channels are properly secured, so that unauthorized sends are prevented.

#### Acceptance Criteria

1. THE Outbound_System SHALL restrict sends to QQ/WeChat only (all other channels inbound-only)
2. THE Outbound_System SHALL verify recipient against allowlist before every send
3. THE Outbound_System SHALL implement rate limiting with configurable cooldown periods
4. THE Outbound_System SHALL implement anti-spam protection with rhythm variation
5. THE Outbound_System SHALL capture send receipt confirmation or mark as uncertain
6. THE Outbound_System SHALL implement three-factor decision fusion (content, recipient tier, intent)
7. THE Outbound_System SHALL enforce confidence thresholds (safe >0.85, gray 0.5-0.85, danger <0.5)
8. THE Outbound_System SHALL trigger Kill-Switch on recipient mismatch
9. THE Outbound_System SHALL maintain send history with fingerprints for deduplication
10. THE Outbound_System SHALL support send preview mode (draft only, no actual send)

### Requirement 20: Policy Engine Decision Making

**User Story:** As a policy administrator, I want to verify the policy engine makes consistent decisions, so that security rules are enforced uniformly.

#### Acceptance Criteria

1. THE Policy_Engine SHALL load policy from single source of truth (.opencode/miya/policy.json)
2. THE Policy_Engine SHALL verify policy-hash on every decision to detect drift
3. THE Policy_Engine SHALL implement risk tier classification (LIGHT, STANDARD, THOROUGH)
4. THE Policy_Engine SHALL enforce evidence requirements per risk tier
5. THE Policy_Engine SHALL implement capability domain mapping to OpenCode permissions
6. THE Policy_Engine SHALL support Self-Approval with token validation
7. THE Policy_Engine SHALL implement Intake Gate for external information approval
8. THE Policy_Engine SHALL maintain decision audit trail with reasoning
9. THE Policy_Engine SHALL support policy rollback with version history
10. THE Policy_Engine SHALL implement emergency override with mandatory audit

### Requirement 21: Evidence Bundle Standards

**User Story:** As an auditor, I want to verify evidence bundles meet standards, so that all actions are properly documented.

#### Acceptance Criteria

1. THE Evidence_System SHALL include auditId, policy-hash, and capability domain ticket in all bundles
2. THE Evidence_System SHALL implement semantic summary layer with frozen reason enum (v1.0)
3. THE Evidence_System SHALL include key assertions with evidence pointers
4. THE Evidence_System SHALL provide operator next steps in semantic summaries
5. THE Evidence_System SHALL capture action-specific evidence (fs_write: git diff, shell_exec: stdout/stderr, desktop_control: screenshots)
6. THE Evidence_System SHALL implement evidence bundle versioning (current: V5)
7. THE Evidence_System SHALL support evidence bundle export in machine-readable format
8. THE Evidence_System SHALL implement evidence integrity verification with hashes
9. THE Evidence_System SHALL maintain evidence retention policy with configurable duration
10. THE Evidence_System SHALL support evidence bundle replay for debugging

### Requirement 22: Kill-Switch Mechanism

**User Story:** As a safety engineer, I want to verify Kill-Switch operates correctly, so that dangerous operations can be halted immediately.

#### Acceptance Criteria

1. THE Kill_Switch SHALL support per-capability-domain shutdown (not global)
2. THE Kill_Switch SHALL trigger on predefined conditions (recipient mismatch, privilege barrier, OOM, injection risk)
3. THE Kill_Switch SHALL generate semantic summary report with recovery conditions
4. THE Kill_Switch SHALL preserve in-flight task state for post-mortem
5. THE Kill_Switch SHALL require manual unlock from "owner tier" or Gateway console
6. THE Kill_Switch SHALL log all triggers with full context to audit trail
7. THE Kill_Switch SHALL support capability domain dependencies (e.g., outbound_send requires desktop_control)
8. THE Kill_Switch SHALL implement cooldown period before allowing re-enable
9. THE Kill_Switch SHALL notify through multiple channels (OpenCode UI, Gateway console, audio alert)
10. THE Kill_Switch SHALL support test mode for validation without actual shutdown

### Requirement 23: Approval Fatigue Mitigation

**User Story:** As a user, I want the system to minimize unnecessary approvals, so that I'm not constantly interrupted.

#### Acceptance Criteria

1. THE Approval_System SHALL implement silent threshold with TTL per risk tier (LIGHT: 60min, STANDARD: 15min, THOROUGH: 0min)
2. THE Approval_System SHALL support plan bundle approval (approve multiple actions at once)
3. THE Approval_System SHALL implement deduplication for identical action fingerprints
4. THE Approval_System SHALL track approval patterns and suggest whitelist additions
5. THE Approval_System SHALL implement approval history with rollback capability
6. THE Approval_System SHALL support approval templates for recurring tasks
7. THE Approval_System SHALL provide approval preview with impact assessment
8. THE Approval_System SHALL implement approval delegation for trusted contexts
9. THE Approval_System SHALL track approval fatigue metrics (approvals per session)
10. THE Approval_System SHALL support batch approval with risk summary

### Requirement 24: Persona and Tone Management

**User Story:** As a user, I want consistent personality across interactions, so that the experience feels natural and coherent.

#### Acceptance Criteria

1. THE Persona_System SHALL load persona configuration from companion profile
2. THE Persona_System SHALL implement mode detection (work, chat, mixed) with automatic switching
3. THE Persona_System SHALL apply zero-persona to execution agents (Fixer, Search, Advisor)
4. THE Persona_System SHALL apply full persona to presentation agents (Manager, Designer)
5. THE Persona_System SHALL implement tone rewriter for final user-facing responses
6. THE Persona_System SHALL maintain persona consistency across 50-turn conversations
7. THE Persona_System SHALL support persona customization through wizard
8. THE Persona_System SHALL implement context-aware phrase selection for wake words
9. THE Persona_System SHALL support multiple persona profiles with switching
10. THE Persona_System SHALL track persona effectiveness metrics (user satisfaction, engagement)

### Requirement 25: Ecosystem Bridge Integration

**User Story:** As an integration engineer, I want to verify external skill integration is safe and compatible, so that ecosystem resources can be leveraged.

#### Acceptance Criteria

1. THE Ecosystem_Bridge SHALL validate external skills with version locking and hash verification
2. THE Ecosystem_Bridge SHALL detect naming conflicts and provide resolution strategies
3. THE Ecosystem_Bridge SHALL implement dependency allowlist with trust evaluation
4. THE Ecosystem_Bridge SHALL enforce sandbox execution for non-official dependencies
5. THE Ecosystem_Bridge SHALL map external permissions to OpenCode permission metadata
6. THE Ecosystem_Bridge SHALL implement skill compatibility matrix checking
7. THE Ecosystem_Bridge SHALL support skill rollback on integration failure
8. THE Ecosystem_Bridge SHALL maintain skill registry with metadata and provenance
9. THE Ecosystem_Bridge SHALL implement smoke tests for imported skills
10. THE Ecosystem_Bridge SHALL provide skill governance dashboard in Gateway console

### Requirement 26: Diagnostic and Observability

**User Story:** As a system operator, I want comprehensive diagnostics, so that I can troubleshoot issues effectively.

#### Acceptance Criteria

1. THE System SHALL implement health check endpoint with component status
2. THE System SHALL expose metrics endpoint with Prometheus-compatible format
3. THE System SHALL implement structured logging with log levels and correlation IDs
4. THE System SHALL provide diagnostic commands (opencode debug config, opencode debug skill, opencode debug paths)
5. THE System SHALL implement performance profiling with flamegraph export
6. THE System SHALL track key metrics (latency, throughput, error rate, resource utilization)
7. THE System SHALL implement distributed tracing for cross-component operations
8. THE System SHALL provide real-time dashboard in Gateway console
9. THE System SHALL implement alerting for critical conditions (OOM, Kill-Switch, daemon crash)
10. THE System SHALL support diagnostic data export for support tickets

### Requirement 27: Configuration Management

**User Story:** As a system administrator, I want centralized configuration management, so that settings are consistent and auditable.

#### Acceptance Criteria

1. THE System SHALL load configuration from .opencode/miya/ directory structure
2. THE System SHALL support configuration override via environment variables
3. THE System SHALL validate configuration schema on load with clear error messages
4. THE System SHALL implement configuration versioning with migration support
5. THE System SHALL support configuration hot-reload for non-critical settings
6. THE System SHALL maintain configuration audit trail with change history
7. THE System SHALL implement configuration backup and restore
8. THE System SHALL provide configuration editor in Gateway console
9. THE System SHALL support configuration templates for common scenarios
10. THE System SHALL implement configuration validation with dry-run mode

### Requirement 28: Testing Infrastructure

**User Story:** As a QA engineer, I want comprehensive testing infrastructure, so that quality can be verified systematically.

#### Acceptance Criteria

1. THE System SHALL implement unit tests with minimum 80% coverage for core modules
2. THE System SHALL implement integration tests covering critical workflows
3. THE System SHALL implement regression test suite with baseline validation
4. THE System SHALL implement adversarial tests for security-critical paths
5. THE System SHALL implement performance benchmarks with threshold validation
6. THE System SHALL implement property-based tests for core algorithms
7. THE System SHALL implement end-to-end tests with real daemon interaction
8. THE System SHALL implement test fixtures with reproducible scenarios
9. THE System SHALL implement test isolation to prevent cross-test contamination
10. THE System SHALL implement continuous integration with automated test execution

### Requirement 29: Documentation and Knowledge Base

**User Story:** As a developer, I want comprehensive documentation, so that I can understand and extend the system.

#### Acceptance Criteria

1. THE System SHALL provide architecture documentation with component diagrams
2. THE System SHALL provide API documentation with request/response examples
3. THE System SHALL provide configuration reference with all available options
4. THE System SHALL provide troubleshooting guide with common issues and solutions
5. THE System SHALL provide security guide with threat model and mitigations
6. THE System SHALL provide development guide with setup instructions
7. THE System SHALL provide testing guide with test execution instructions
8. THE System SHALL provide deployment guide with production considerations
9. THE System SHALL provide changelog with version history and breaking changes
10. THE System SHALL implement Doc Linter to ensure documentation-code consistency

### Requirement 30: Backward Compatibility and Migration

**User Story:** As a system maintainer, I want smooth upgrades, so that existing installations can be updated safely.

#### Acceptance Criteria

1. THE System SHALL implement semantic versioning for all releases
2. THE System SHALL provide migration scripts for breaking changes
3. THE System SHALL support configuration migration with automatic conversion
4. THE System SHALL maintain backward compatibility for at least one major version
5. THE System SHALL implement deprecation warnings with migration guidance
6. THE System SHALL provide rollback capability for failed upgrades
7. THE System SHALL implement data migration with validation and rollback
8. THE System SHALL support parallel installation for testing upgrades
9. THE System SHALL provide upgrade checklist with pre/post validation steps
10. THE System SHALL implement compatibility testing against previous versions

### Requirement 31: Placeholder Implementation Detection

**User Story:** As a code auditor, I want to identify placeholder implementations that have no actual effect, so that non-functional code can be flagged for completion.

#### Acceptance Criteria

1. WHEN a function returns hardcoded values without processing inputs, THE Audit SHALL flag it as placeholder
2. WHEN a configuration option exists but is never read or used, THE Audit SHALL flag it as ineffective
3. WHEN an event handler is registered but contains only logging without action, THE Audit SHALL flag it as placeholder
4. WHEN a class method exists but always throws "not implemented" errors, THE Audit SHALL flag it as incomplete
5. WHEN a feature flag exists but both branches execute identical code, THE Audit SHALL flag it as redundant
6. WHEN a validation function always returns true without checking, THE Audit SHALL flag it as bypassed
7. WHEN a retry mechanism exists but max_retries is hardcoded to 1, THE Audit SHALL flag it as ineffective
8. WHEN a cache is implemented but cache_size is 0 or cache is never queried, THE Audit SHALL flag it as unused
9. WHEN a permission check exists but is commented out or always passes, THE Audit SHALL flag it as security risk
10. WHEN a monitoring metric is collected but never exported or displayed, THE Audit SHALL flag it as wasted

### Requirement 32: Partial Implementation Gap Analysis

**User Story:** As a technical lead, I want to identify features that are partially implemented but don't achieve intended functionality, so that completion priorities can be set.

#### Acceptance Criteria

1. WHEN Gateway domain methods exist but delegate to centralized index.ts, THE Audit SHALL flag incomplete domain separation
2. WHEN memory reflection triggers exist but extraction logic uses placeholder prompts, THE Audit SHALL flag incomplete intelligence
3. WHEN training preset configuration exists but all presets use identical parameters, THE Audit SHALL flag incomplete differentiation
4. WHEN approval fatigue mitigation is configured but silent threshold is never applied, THE Audit SHALL flag incomplete implementation
5. WHEN evidence bundle versioning exists but old versions are not migrated, THE Audit SHALL flag incomplete compatibility
6. WHEN persona mode detection exists but always defaults to single mode, THE Audit SHALL flag incomplete switching
7. WHEN VRAM budget calculation exists but is not enforced before model loading, THE Audit SHALL flag incomplete safety
8. WHEN skill conflict detection exists but resolution strategy is manual-only, THE Audit SHALL flag incomplete automation
9. WHEN audit log rotation is configured but old logs are never deleted, THE Audit SHALL flag incomplete cleanup
10. WHEN health check endpoint exists but returns cached stale data, THE Audit SHALL flag incomplete freshness

### Requirement 33: Ineffective Implementation Detection

**User Story:** As a quality engineer, I want to identify implementations that exist but don't work correctly, so that bugs can be prioritized.

#### Acceptance Criteria

1. WHEN Kill-Switch is triggered but capability domain continues executing, THE Audit SHALL flag ineffective shutdown
2. WHEN allowlist check passes but recipient verification is skipped, THE Audit SHALL flag ineffective security
3. WHEN Human-Mutex timeout occurs but operation proceeds anyway, THE Audit SHALL flag ineffective locking
4. WHEN policy-hash mismatch is detected but execution continues, THE Audit SHALL flag ineffective validation
5. WHEN evidence bundle is incomplete but action is marked successful, THE Audit SHALL flag ineffective auditing
6. WHEN memory decay is calculated but weights are not updated in retrieval, THE Audit SHALL flag ineffective aging
7. WHEN training OOM is detected but downgrade strategy is not applied, THE Audit SHALL flag ineffective recovery
8. WHEN backpressure limit is reached but requests are queued indefinitely, THE Audit SHALL flag ineffective throttling
9. WHEN semantic summary is generated but original error is not included, THE Audit SHALL flag ineffective reporting
10. WHEN configuration hot-reload is triggered but cached values are not invalidated, THE Audit SHALL flag ineffective refresh

### Requirement 34: Integration Boundary Testing

**User Story:** As an integration tester, I want to verify all component boundaries work correctly, so that integration failures are caught early.

#### Acceptance Criteria

1. WHEN Plugin sends RPC to Daemon but Daemon is not running, THE System SHALL return connection error within 5 seconds
2. WHEN Gateway receives malformed WebSocket frame, THE System SHALL reject with protocol error and maintain connection
3. WHEN Daemon crashes during job execution, THE System SHALL detect within 30 seconds and mark job as failed
4. WHEN OpenCode permission is denied but Self-Approval token exists, THE System SHALL respect OpenCode decision
5. WHEN external skill returns unexpected schema, THE System SHALL validate and reject with clear error
6. WHEN memory database is locked by another process, THE System SHALL retry with exponential backoff up to 3 times
7. WHEN training process is killed externally, THE System SHALL detect zombie process and clean up resources
8. WHEN Gateway Web console loses WebSocket connection, THE System SHALL reconnect automatically within 10 seconds
9. WHEN policy file is modified during execution, THE System SHALL detect hash change and reload or reject
10. WHEN multiple sessions request desktop control simultaneously, THE System SHALL serialize with Input_Mutex

### Requirement 35: State Machine Correctness

**User Story:** As a state machine designer, I want to verify all state transitions are valid and complete, so that invalid states are prevented.

#### Acceptance Criteria

1. WHEN training job transitions from queued to running, THE System SHALL verify VRAM budget is available
2. WHEN memory transitions from pending to active, THE System SHALL verify approval evidence exists
3. WHEN capability domain transitions to Kill-Switch, THE System SHALL prevent transition back without manual unlock
4. WHEN daemon transitions to disconnected, THE System SHALL cancel all in-flight jobs
5. WHEN approval transitions to expired, THE System SHALL reject associated action execution
6. WHEN wizard transitions to failed, THE System SHALL preserve partial state for resume
7. WHEN job transitions to degraded, THE System SHALL record degradation reason and strategy
8. WHEN session transitions to ended, THE System SHALL trigger memory reflection if threshold met
9. WHEN policy transitions to new version, THE System SHALL migrate or reject incompatible rules
10. WHEN node transitions to offline, THE System SHALL redistribute queued tasks to available nodes

### Requirement 36: Error Handling Completeness

**User Story:** As a reliability engineer, I want to verify all error paths are handled properly, so that failures are graceful.

#### Acceptance Criteria

1. WHEN file system is full during evidence write, THE System SHALL fail action and alert operator
2. WHEN network timeout occurs during external skill call, THE System SHALL retry with backoff or fail gracefully
3. WHEN JSON parsing fails on configuration load, THE System SHALL use defaults and log error with file location
4. WHEN database constraint violation occurs on memory write, THE System SHALL detect conflict and trigger resolution
5. WHEN GPU driver error occurs during inference, THE System SHALL fallback to CPU and log hardware issue
6. WHEN WebSocket send fails due to buffer full, THE System SHALL apply backpressure and reject new requests
7. WHEN permission check throws exception, THE System SHALL default to deny and log security incident
8. WHEN audit log write fails, THE System SHALL block action execution and alert operator
9. WHEN training checkpoint write fails, THE System SHALL retry once then abort training with error
10. WHEN evidence bundle generation throws exception, THE System SHALL capture stack trace and fail action

### Requirement 37: Concurrency and Race Condition Testing

**User Story:** As a concurrency expert, I want to identify race conditions and deadlocks, so that multi-threaded issues are prevented.

#### Acceptance Criteria

1. WHEN multiple sessions write to same memory key simultaneously, THE System SHALL serialize writes with locking
2. WHEN training job and inference request compete for VRAM, THE System SHALL use semaphore to prevent conflict
3. WHEN policy file is reloaded during decision making, THE System SHALL use consistent snapshot for entire decision
4. WHEN daemon reconnects while jobs are being dispatched, THE System SHALL prevent duplicate job execution
5. WHEN multiple agents request tool execution simultaneously, THE System SHALL queue with fair scheduling
6. WHEN evidence bundle is being written while audit query reads, THE System SHALL use read-write lock
7. WHEN configuration is hot-reloaded during request processing, THE System SHALL complete request with old config
8. WHEN Kill-Switch is triggered during action execution, THE System SHALL interrupt safely without corruption
9. WHEN multiple approval requests arrive for same action, THE System SHALL deduplicate and show single prompt
10. WHEN session cleanup runs while new session starts, THE System SHALL prevent cleanup of active session

### Requirement 38: Resource Leak Detection

**User Story:** As a performance engineer, I want to identify resource leaks, so that long-running stability is ensured.

#### Acceptance Criteria

1. WHEN daemon crashes, THE Audit SHALL verify all GPU memory is released
2. WHEN WebSocket connection closes, THE Audit SHALL verify all event listeners are removed
3. WHEN training job completes, THE Audit SHALL verify checkpoint files are closed
4. WHEN temporary files are created, THE Audit SHALL verify cleanup on success and failure paths
5. WHEN subprocesses are spawned, THE Audit SHALL verify proper termination and zombie prevention
6. WHEN timers are created, THE Audit SHALL verify cancellation on component unmount
7. WHEN database connections are opened, THE Audit SHALL verify proper closure in finally blocks
8. WHEN file handles are opened for evidence, THE Audit SHALL verify closure even on exception
9. WHEN memory caches grow unbounded, THE Audit SHALL verify LRU eviction is working
10. WHEN event subscriptions are created, THE Audit SHALL verify unsubscribe on cleanup

### Requirement 39: Security Vulnerability Scanning

**User Story:** As a security auditor, I want to scan for common vulnerabilities, so that security risks are identified.

#### Acceptance Criteria

1. THE Audit SHALL scan for SQL injection vulnerabilities in database queries
2. THE Audit SHALL scan for command injection vulnerabilities in shell execution
3. THE Audit SHALL scan for path traversal vulnerabilities in file operations
4. THE Audit SHALL scan for XSS vulnerabilities in Web console rendering
5. THE Audit SHALL scan for CSRF vulnerabilities in Gateway API endpoints
6. THE Audit SHALL scan for insecure deserialization in RPC message handling
7. THE Audit SHALL scan for hardcoded credentials in source code and configuration
8. THE Audit SHALL scan for weak cryptographic algorithms in encryption code
9. THE Audit SHALL scan for missing input validation on user-controlled data
10. THE Audit SHALL scan for privilege escalation paths in permission checks

### Requirement 40: Performance Regression Detection

**User Story:** As a performance engineer, I want to detect performance regressions, so that degradation is caught before release.

#### Acceptance Criteria

1. THE Audit SHALL measure Gateway RPC latency and fail if P95 exceeds baseline by 20%
2. THE Audit SHALL measure memory consumption and fail if growth exceeds 15% from baseline
3. THE Audit SHALL measure startup time and fail if exceeds 10 seconds
4. THE Audit SHALL measure evidence bundle generation time and fail if exceeds 500ms
5. THE Audit SHALL measure database query time and fail if exceeds 100ms for simple queries
6. THE Audit SHALL measure model loading time and fail if exceeds 30 seconds
7. THE Audit SHALL measure desktop control operation time and fail if P95 exceeds 10 seconds
8. THE Audit SHALL measure memory retrieval time and fail if exceeds 200ms
9. THE Audit SHALL measure configuration reload time and fail if exceeds 1 second
10. THE Audit SHALL measure audit log write throughput and fail if below 100 entries/second

### Requirement 41: Test Organization and Structure

**User Story:** As a test maintainer, I want all tests organized in a unified structure, so that tests are discoverable and maintainable.

#### Acceptance Criteria

1. THE System SHALL place all test files in `test/` directory at repository root
2. THE System SHALL mirror source structure in test directory (e.g., `test/gateway/`, `test/channels/`)
3. THE System SHALL name test files with `.test.ts` suffix matching source files
4. THE System SHALL organize tests by category (unit/, integration/, regression/, adversarial/, performance/)
5. THE System SHALL provide test fixtures in `test/fixtures/` directory
6. THE System SHALL provide test utilities in `test/utils/` directory
7. THE System SHALL document test execution instructions in `test/README.md`
8. THE System SHALL provide test configuration in `test/config/` directory
9. THE System SHALL generate test coverage reports in `test/coverage/` directory
10. THE System SHALL maintain test baseline data in `test/baselines/` directory

### Requirement 42: Audit Report Generation

**User Story:** As a project manager, I want comprehensive audit reports, so that status and issues are clearly communicated.

#### Acceptance Criteria

1. THE Audit SHALL generate summary report with pass/fail counts per requirement category
2. THE Audit SHALL generate detailed report with specific findings and evidence
3. THE Audit SHALL generate priority matrix (P0/P1/P2) for identified issues
4. THE Audit SHALL generate risk assessment with severity and likelihood ratings
5. THE Audit SHALL generate compliance checklist with regulatory requirements
6. THE Audit SHALL generate performance benchmark report with trend analysis
7. THE Audit SHALL generate security vulnerability report with CVE references
8. THE Audit SHALL generate code quality metrics report with technical debt estimation
9. THE Audit SHALL generate test coverage report with uncovered critical paths
10. THE Audit SHALL generate executive summary with key findings and recommendations



### Requirement 43: Configuration Drift Detection

**User Story:** As a configuration manager, I want to detect when runtime configuration drifts from declared defaults, so that inconsistencies are identified.

#### Acceptance Criteria

1. WHEN SlimCompat schema default is false but runtime treats undefined as true, THE Audit SHALL flag configuration semantic conflict
2. WHEN command templates are overwritten unconditionally instead of only when missing, THE Audit SHALL flag user customization risk
3. WHEN configuration keys exist in schema but are never referenced in code, THE Audit SHALL flag dead configuration
4. WHEN configuration values are read but never validated against schema, THE Audit SHALL flag validation bypass
5. WHEN environment variables override configuration but are not documented, THE Audit SHALL flag hidden behavior
6. WHEN configuration changes require restart but hot-reload is claimed, THE Audit SHALL flag misleading capability
7. WHEN default values in code differ from schema defaults, THE Audit SHALL flag inconsistency
8. WHEN configuration migration exists but old keys are still read, THE Audit SHALL flag incomplete migration
9. WHEN configuration is cached but cache invalidation is missing, THE Audit SHALL flag stale data risk
10. WHEN configuration precedence order is undocumented or inconsistent, THE Audit SHALL flag ambiguity

### Requirement 44: Event System Integrity

**User Story:** As an event system architect, I want to verify event flow is correct and complete, so that event-driven logic works reliably.

#### Acceptance Criteria

1. WHEN tool.execute.before fires but tool.execute.after is not guaranteed, THE Audit SHALL flag incomplete event pairing
2. WHEN event handlers throw exceptions but errors are silently swallowed, THE Audit SHALL flag error suppression
3. WHEN events are emitted but no handlers are registered, THE Audit SHALL flag potential dead events
4. WHEN event handlers modify shared state without synchronization, THE Audit SHALL flag race condition risk
5. WHEN event emission order is critical but not enforced, THE Audit SHALL flag ordering dependency
6. WHEN events carry sensitive data but are logged without redaction, THE Audit SHALL flag data leak risk
7. WHEN event handlers are async but caller doesn't await, THE Audit SHALL flag fire-and-forget risk
8. WHEN event subscription cleanup is missing on component unmount, THE Audit SHALL flag memory leak
9. WHEN events are used for critical flow control but have no delivery guarantee, THE Audit SHALL flag reliability risk
10. WHEN event schema changes but consumers are not validated, THE Audit SHALL flag breaking change risk

### Requirement 45: Data Validation Completeness

**User Story:** As a data integrity engineer, I want to verify all inputs are properly validated, so that invalid data is rejected early.

#### Acceptance Criteria

1. WHEN user input is passed to shell commands without sanitization, THE Audit SHALL flag command injection risk
2. WHEN file paths are constructed from user input without validation, THE Audit SHALL flag path traversal risk
3. WHEN numeric inputs are not range-checked before use, THE Audit SHALL flag overflow/underflow risk
4. WHEN string inputs are not length-limited before storage, THE Audit SHALL flag buffer overflow risk
5. WHEN enum values are not validated against allowed set, THE Audit SHALL flag invalid state risk
6. WHEN timestamps are not validated for reasonable range, THE Audit SHALL flag time manipulation risk
7. WHEN URLs are not validated before fetch, THE Audit SHALL flag SSRF risk
8. WHEN JSON is parsed without schema validation, THE Audit SHALL flag type confusion risk
9. WHEN regex patterns are constructed from user input, THE Audit SHALL flag ReDoS risk
10. WHEN database queries use string concatenation instead of parameterization, THE Audit SHALL flag SQL injection risk

### Requirement 46: Logging and Observability Gaps

**User Story:** As an operations engineer, I want to identify logging gaps, so that troubleshooting is effective.

#### Acceptance Criteria

1. WHEN critical errors occur but are not logged with stack traces, THE Audit SHALL flag insufficient error context
2. WHEN state transitions occur but are not logged, THE Audit SHALL flag observability gap
3. WHEN performance-critical operations complete but duration is not logged, THE Audit SHALL flag missing metrics
4. WHEN external API calls are made but request/response are not logged, THE Audit SHALL flag integration blind spot
5. WHEN security decisions are made but reasoning is not logged, THE Audit SHALL flag audit trail gap
6. WHEN logs contain sensitive data without redaction, THE Audit SHALL flag privacy violation
7. WHEN log levels are inconsistent (debug for errors, error for info), THE Audit SHALL flag misclassification
8. WHEN logs lack correlation IDs for distributed operations, THE Audit SHALL flag traceability gap
9. WHEN logs are written synchronously in hot paths, THE Audit SHALL flag performance impact
10. WHEN log rotation is not configured, THE Audit SHALL flag disk space risk

### Requirement 47: Dependency and Import Analysis

**User Story:** As a dependency manager, I want to analyze dependency usage, so that unused or risky dependencies are identified.

#### Acceptance Criteria

1. WHEN dependencies are declared in package.json but never imported, THE Audit SHALL flag unused dependencies
2. WHEN dependencies have known security vulnerabilities, THE Audit SHALL flag CVE references
3. WHEN dependencies are imported but only for types, THE Audit SHALL flag potential devDependency
4. WHEN dependencies have incompatible licenses, THE Audit SHALL flag legal risk
5. WHEN dependencies are outdated by more than 2 major versions, THE Audit SHALL flag maintenance risk
6. WHEN dependencies have circular imports, THE Audit SHALL flag architectural issue
7. WHEN dependencies are imported with wildcard (*), THE Audit SHALL flag namespace pollution
8. WHEN dependencies are dynamically required without error handling, THE Audit SHALL flag runtime failure risk
9. WHEN dependencies bundle native code without platform checks, THE Audit SHALL flag portability risk
10. WHEN dependencies are forked or patched locally, THE Audit SHALL flag maintenance burden

### Requirement 48: API Contract Validation

**User Story:** As an API designer, I want to verify API contracts are consistent, so that breaking changes are prevented.

#### Acceptance Criteria

1. WHEN Gateway RPC methods change signatures but version is not bumped, THE Audit SHALL flag breaking change
2. WHEN required fields are added to existing interfaces, THE Audit SHALL flag backward incompatibility
3. WHEN error codes are changed or removed, THE Audit SHALL flag client impact
4. WHEN response schemas are modified without migration, THE Audit SHALL flag data corruption risk
5. WHEN API deprecation warnings are missing for removed endpoints, THE Audit SHALL flag poor UX
6. WHEN API documentation is out of sync with implementation, THE Audit SHALL flag documentation drift
7. WHEN API rate limits are not enforced consistently, THE Audit SHALL flag fairness issue
8. WHEN API authentication is optional but should be required, THE Audit SHALL flag security gap
9. WHEN API responses lack proper HTTP status codes, THE Audit SHALL flag protocol violation
10. WHEN API versioning strategy is inconsistent across endpoints, THE Audit SHALL flag confusion risk

### Requirement 49: Database Schema and Query Analysis

**User Story:** As a database administrator, I want to analyze database usage, so that schema and query issues are identified.

#### Acceptance Criteria

1. WHEN database tables are created but never queried, THE Audit SHALL flag unused schema
2. WHEN database queries use SELECT * instead of explicit columns, THE Audit SHALL flag performance risk
3. WHEN database indexes are missing on frequently queried columns, THE Audit SHALL flag slow query risk
4. WHEN database transactions are not properly committed or rolled back, THE Audit SHALL flag data consistency risk
5. WHEN database connections are not pooled, THE Audit SHALL flag resource exhaustion risk
6. WHEN database migrations are not idempotent, THE Audit SHALL flag rerun failure risk
7. WHEN database constraints are missing for data integrity, THE Audit SHALL flag corruption risk
8. WHEN database queries are vulnerable to N+1 problem, THE Audit SHALL flag performance issue
9. WHEN database schema changes are not versioned, THE Audit SHALL flag migration chaos risk
10. WHEN database backups are not tested for restore, THE Audit SHALL flag disaster recovery gap

### Requirement 50: File System Operations Safety

**User Story:** As a file system engineer, I want to verify file operations are safe, so that data loss is prevented.

#### Acceptance Criteria

1. WHEN files are written without atomic operations, THE Audit SHALL flag partial write risk
2. WHEN files are deleted without backup or confirmation, THE Audit SHALL flag data loss risk
3. WHEN file permissions are not checked before operations, THE Audit SHALL flag access denied risk
4. WHEN file paths are not normalized, THE Audit SHALL flag path traversal risk
5. WHEN file operations don't handle ENOENT errors, THE Audit SHALL flag crash risk
6. WHEN temporary files are not cleaned up on error paths, THE Audit SHALL flag disk space leak
7. WHEN file locks are not acquired for concurrent access, THE Audit SHALL flag corruption risk
8. WHEN file encoding is assumed without detection, THE Audit SHALL flag mojibake risk
9. WHEN file size is not checked before reading, THE Audit SHALL flag memory exhaustion risk
10. WHEN symbolic links are followed without validation, THE Audit SHALL flag security risk

### Requirement 51: Memory Management Patterns

**User Story:** As a memory safety engineer, I want to analyze memory usage patterns, so that leaks and inefficiencies are identified.

#### Acceptance Criteria

1. WHEN large objects are kept in memory after use, THE Audit SHALL flag memory retention
2. WHEN closures capture large contexts unnecessarily, THE Audit SHALL flag closure bloat
3. WHEN event listeners accumulate without cleanup, THE Audit SHALL flag listener leak
4. WHEN caches grow unbounded without eviction, THE Audit SHALL flag cache bloat
5. WHEN circular references prevent garbage collection, THE Audit SHALL flag GC obstruction
6. WHEN large buffers are allocated synchronously, THE Audit SHALL flag UI freeze risk
7. WHEN memory-intensive operations lack progress reporting, THE Audit SHALL flag UX issue
8. WHEN memory usage is not monitored or alerted, THE Audit SHALL flag observability gap
9. WHEN memory limits are not enforced for user-controlled operations, THE Audit SHALL flag DoS risk
10. WHEN memory profiling is not available in production, THE Audit SHALL flag debugging difficulty

### Requirement 52: Async/Promise Handling

**User Story:** As an async programming expert, I want to verify promise handling is correct, so that async bugs are prevented.

#### Acceptance Criteria

1. WHEN promises are created but not awaited or caught, THE Audit SHALL flag unhandled rejection risk
2. WHEN async functions are called without await in critical paths, THE Audit SHALL flag race condition
3. WHEN promise chains lack error handlers, THE Audit SHALL flag silent failure risk
4. WHEN Promise.all is used without considering partial failure, THE Audit SHALL flag all-or-nothing issue
5. WHEN async operations are not cancelled on component unmount, THE Audit SHALL flag memory leak
6. WHEN async operations lack timeout, THE Audit SHALL flag hang risk
7. WHEN async operations are retried without backoff, THE Audit SHALL flag thundering herd risk
8. WHEN async operations modify shared state without locking, THE Audit SHALL flag race condition
9. WHEN async operations are nested deeply, THE Audit SHALL flag callback hell
10. WHEN async operations lack progress tracking, THE Audit SHALL flag UX issue

### Requirement 53: Type Safety and TypeScript Usage

**User Story:** As a type safety advocate, I want to verify TypeScript is used effectively, so that type errors are caught at compile time.

#### Acceptance Criteria

1. WHEN any type is used instead of specific types, THE Audit SHALL flag type safety bypass
2. WHEN type assertions (as) are used without runtime validation, THE Audit SHALL flag unsafe cast
3. WHEN non-null assertions (!) are used without null checks, THE Audit SHALL flag potential crash
4. WHEN interfaces are not exported for public APIs, THE Audit SHALL flag poor API design
5. WHEN union types lack discriminators, THE Audit SHALL flag type narrowing difficulty
6. WHEN optional chaining (?.) is overused instead of proper null handling, THE Audit SHALL flag lazy coding
7. WHEN type guards are missing for runtime type checks, THE Audit SHALL flag type confusion risk
8. WHEN generic types lack constraints, THE Audit SHALL flag overly permissive types
9. WHEN enums are used instead of union types, THE Audit SHALL flag runtime overhead
10. WHEN TypeScript strict mode is not enabled, THE Audit SHALL flag weak type checking

### Requirement 54: Error Message Quality

**User Story:** As a user support engineer, I want to verify error messages are helpful, so that users can self-diagnose issues.

#### Acceptance Criteria

1. WHEN errors show only error codes without descriptions, THE Audit SHALL flag poor UX
2. WHEN errors lack actionable next steps, THE Audit SHALL flag insufficient guidance
3. WHEN errors expose internal implementation details, THE Audit SHALL flag information leak
4. WHEN errors are in English but UI is Chinese, THE Audit SHALL flag localization gap
5. WHEN errors lack context about what operation failed, THE Audit SHALL flag ambiguity
6. WHEN errors don't distinguish user errors from system errors, THE Audit SHALL flag confusion risk
7. WHEN errors lack links to documentation, THE Audit SHALL flag discoverability issue
8. WHEN errors are logged but not shown to user, THE Audit SHALL flag silent failure
9. WHEN errors are shown to user but not logged, THE Audit SHALL flag debugging difficulty
10. WHEN errors lack unique identifiers for support tickets, THE Audit SHALL flag support burden

### Requirement 55: UI/UX Consistency

**User Story:** As a UX designer, I want to verify UI consistency, so that user experience is coherent.

#### Acceptance Criteria

1. WHEN button labels are inconsistent (确定 vs 确认 vs OK), THE Audit SHALL flag terminology inconsistency
2. WHEN color schemes differ between Gateway console and OpenCode, THE Audit SHALL flag visual inconsistency
3. WHEN loading states are missing for async operations, THE Audit SHALL flag poor feedback
4. WHEN success/error notifications disappear too quickly, THE Audit SHALL flag missed feedback
5. WHEN form validation errors appear in different locations, THE Audit SHALL flag inconsistent patterns
6. WHEN keyboard shortcuts are not documented or inconsistent, THE Audit SHALL flag accessibility issue
7. WHEN responsive design breaks on different screen sizes, THE Audit SHALL flag layout issue
8. WHEN icons are used without text labels, THE Audit SHALL flag ambiguity
9. WHEN navigation breadcrumbs are missing or incorrect, THE Audit SHALL flag orientation issue
10. WHEN empty states lack helpful guidance, THE Audit SHALL flag poor onboarding

### Requirement 56: Internationalization (i18n) Completeness

**User Story:** As an i18n engineer, I want to verify all user-facing text is translatable, so that localization is complete.

#### Acceptance Criteria

1. WHEN UI text is hardcoded in components instead of i18n keys, THE Audit SHALL flag untranslatable text
2. WHEN date/time formatting doesn't respect locale, THE Audit SHALL flag localization bug
3. WHEN number formatting doesn't respect locale (comma vs period), THE Audit SHALL flag display issue
4. WHEN pluralization rules are hardcoded instead of using i18n, THE Audit SHALL flag grammar issue
5. WHEN text concatenation is used instead of template strings, THE Audit SHALL flag word order issue
6. WHEN error messages are not in i18n catalog, THE Audit SHALL flag missing translations
7. WHEN UI layout breaks with longer translated text, THE Audit SHALL flag layout issue
8. WHEN currency symbols are hardcoded, THE Audit SHALL flag localization gap
9. WHEN cultural assumptions are embedded (e.g., name order), THE Audit SHALL flag cultural bias
10. WHEN RTL languages are not supported, THE Audit SHALL flag accessibility gap

### Requirement 57: Accessibility (a11y) Compliance

**User Story:** As an accessibility advocate, I want to verify accessibility standards are met, so that all users can use the system.

#### Acceptance Criteria

1. WHEN images lack alt text, THE Audit SHALL flag screen reader issue
2. WHEN interactive elements lack keyboard navigation, THE Audit SHALL flag keyboard-only user issue
3. WHEN color is the only indicator of state, THE Audit SHALL flag color-blind user issue
4. WHEN focus indicators are removed or invisible, THE Audit SHALL flag navigation issue
5. WHEN form inputs lack labels, THE Audit SHALL flag screen reader issue
6. WHEN ARIA attributes are missing or incorrect, THE Audit SHALL flag assistive technology issue
7. WHEN heading hierarchy is incorrect (h1 → h3), THE Audit SHALL flag structure issue
8. WHEN contrast ratios don't meet WCAG standards, THE Audit SHALL flag readability issue
9. WHEN time-based content lacks pause controls, THE Audit SHALL flag seizure risk
10. WHEN error announcements are not made to screen readers, THE Audit SHALL flag feedback gap

### Requirement 58: Build and Deployment Process

**User Story:** As a DevOps engineer, I want to verify build and deployment processes are robust, so that releases are reliable.

#### Acceptance Criteria

1. WHEN build fails but exit code is 0, THE Audit SHALL flag false success
2. WHEN build artifacts include source maps in production, THE Audit SHALL flag security risk
3. WHEN build process doesn't verify checksums, THE Audit SHALL flag integrity risk
4. WHEN deployment doesn't include rollback procedure, THE Audit SHALL flag recovery gap
5. WHEN environment-specific configs are committed to repo, THE Audit SHALL flag secret leak risk
6. WHEN build dependencies are not locked, THE Audit SHALL flag reproducibility issue
7. WHEN build process doesn't run tests, THE Audit SHALL flag quality gate missing
8. WHEN deployment doesn't include health checks, THE Audit SHALL flag blind deployment
9. WHEN build artifacts are not versioned, THE Audit SHALL flag traceability gap
10. WHEN deployment doesn't include database migration, THE Audit SHALL flag data inconsistency risk

### Requirement 59: Code Duplication and Maintainability

**User Story:** As a code maintainer, I want to identify code duplication, so that maintenance burden is reduced.

#### Acceptance Criteria

1. WHEN identical code blocks exist in multiple files, THE Audit SHALL flag duplication with refactoring suggestion
2. WHEN similar logic exists with minor variations, THE Audit SHALL flag near-duplication
3. WHEN copy-paste errors are detected (same variable names, different contexts), THE Audit SHALL flag potential bug
4. WHEN utility functions are reimplemented instead of reused, THE Audit SHALL flag missed abstraction
5. WHEN configuration patterns are duplicated, THE Audit SHALL flag configuration bloat
6. WHEN test setup code is duplicated, THE Audit SHALL flag test fixture opportunity
7. WHEN error handling patterns are duplicated, THE Audit SHALL flag middleware opportunity
8. WHEN validation logic is duplicated, THE Audit SHALL flag schema opportunity
9. WHEN constants are redefined in multiple places, THE Audit SHALL flag single source of truth violation
10. WHEN documentation is duplicated and out of sync, THE Audit SHALL flag maintenance burden

### Requirement 60: Technical Debt Quantification

**User Story:** As a technical lead, I want to quantify technical debt, so that prioritization decisions are data-driven.

#### Acceptance Criteria

1. THE Audit SHALL calculate code complexity metrics (cyclomatic complexity, cognitive complexity)
2. THE Audit SHALL measure test coverage percentage per module
3. THE Audit SHALL count TODO/FIXME/HACK comments with categorization
4. THE Audit SHALL measure documentation coverage (public APIs without JSDoc)
5. THE Audit SHALL count deprecated API usages
6. THE Audit SHALL measure dependency freshness (days since last update)
7. THE Audit SHALL count security vulnerabilities by severity
8. THE Audit SHALL measure code churn (lines changed per file over time)
9. THE Audit SHALL calculate technical debt ratio (remediation cost / development cost)
10. THE Audit SHALL generate technical debt heatmap by module


### Requirement 61: Six-Agent Collaboration Testing

**User Story:** As an agent orchestration tester, I want to verify the six agents collaborate correctly, so that complex tasks are completed through proper coordination.

#### Acceptance Criteria

1. WHEN Task Manager dispatches to Code Search, THE System SHALL verify search results are returned and integrated
2. WHEN Docs Helper is queried, THE System SHALL verify source whitelist/blacklist is enforced
3. WHEN Arch Advisor provides risk assessment, THE System SHALL verify evidence bundle is generated
4. WHEN Code Fixer executes Ralph Loop, THE System SHALL verify stderr feedback triggers retry
5. WHEN UI Designer generates artifacts, THE System SHALL verify local models are used (not external APIs)
6. WHEN multiple agents run in parallel, THE System SHALL verify context isolation prevents pollution
7. WHEN agent handoff occurs, THE System SHALL verify state is properly transferred
8. WHEN agent fails, THE System SHALL verify fallback or error propagation to Task Manager
9. WHEN agent exceeds budget (time/cost/retries), THE System SHALL verify termination and reporting
10. WHEN agents share memory context, THE System SHALL verify proper domain separation (work vs relationship)

### Requirement 62: Gateway Method Domain Separation

**User Story:** As a Gateway architect, I want to verify domain separation is complete, so that methods are properly organized.

#### Acceptance Criteria

1. WHEN gateway/methods/channels.ts is examined, THE Audit SHALL verify methods are implemented (not just shells)
2. WHEN gateway/methods/security.ts is examined, THE Audit SHALL verify security logic is not in index.ts
3. WHEN gateway/methods/nodes.ts is examined, THE Audit SHALL verify node management is self-contained
4. WHEN gateway/methods/companion.ts is examined, THE Audit SHALL verify companion logic is domain-isolated
5. WHEN gateway/methods/memory.ts is examined, THE Audit SHALL verify memory operations are encapsulated
6. WHEN new gateway method is added, THE Audit SHALL verify it's added to appropriate domain file
7. WHEN gateway/index.ts is examined, THE Audit SHALL verify it only contains routing and registration
8. WHEN domain methods are called, THE Audit SHALL verify cross-domain dependencies are minimal
9. WHEN domain methods fail, THE Audit SHALL verify errors are properly propagated to caller
10. WHEN domain methods are tested, THE Audit SHALL verify unit tests exist per domain

### Requirement 63: QQ/WeChat Desktop Control Workflow

**User Story:** As a desktop automation tester, I want to verify QQ/WeChat control workflow is complete and safe, so that sends are accurate and auditable.

#### Acceptance Criteria

1. WHEN QQ/WeChat send is initiated, THE System SHALL verify UIA window detection succeeds before proceeding
2. WHEN recipient search is performed, THE System SHALL verify allowlist match before continuing
3. WHEN focus is changed to chat window, THE System SHALL verify window title matches expected recipient
4. WHEN message is typed, THE System SHALL verify input simulation completes without interruption
5. WHEN send button is clicked, THE System SHALL verify click coordinates are validated
6. WHEN send receipt is checked, THE System SHALL verify message bubble appears in chat history
7. WHEN Human-Mutex timeout occurs, THE System SHALL verify operation is paused (not failed)
8. WHEN three-strike cooldown triggers, THE System SHALL verify 15-minute cooldown is enforced
9. WHEN privilege barrier is detected, THE System SHALL verify blocked_by_privilege is reported
10. WHEN send fingerprint matches recent send, THE System SHALL verify duplicate prevention works

### Requirement 64: Local Model Training Pipeline

**User Story:** As a training pipeline tester, I want to verify training operations are safe and effective, so that models are trained without system instability.

#### Acceptance Criteria

1. WHEN image training is requested, THE System SHALL verify FLUX model path is resolved correctly
2. WHEN voice training is requested, THE System SHALL verify GPT-SoVITS model path is resolved correctly
3. WHEN training starts, THE System SHALL verify VRAM budget calculation is performed
4. WHEN VRAM is insufficient, THE System SHALL verify automatic downgrade to lighter strategy
5. WHEN training checkpoint is reached, THE System SHALL verify checkpoint write completes
6. WHEN user becomes active during training, THE System SHALL verify training terminates within 2 seconds
7. WHEN training OOM occurs, THE System SHALL verify process is terminated and requeued with lighter config
8. WHEN training completes, THE System SHALL verify model artifacts are saved with hash
9. WHEN training fails, THE System SHALL verify failure reason is logged with recovery suggestion
10. WHEN training preset is 0.5, THE System SHALL verify parameters match documented defaults

### Requirement 65: Memory Lifecycle and Reflection

**User Story:** As a memory system tester, I want to verify memory lifecycle is correct, so that memories are accurate and relevant.

#### Acceptance Criteria

1. WHEN new memory is created, THE System SHALL verify it starts in pending state
2. WHEN memory is approved, THE System SHALL verify transition to active with evidence
3. WHEN memory conflicts with existing, THE System SHALL verify conflict resolution wizard triggers
4. WHEN memory is not accessed for 30 days, THE System SHALL verify exponential decay is applied
5. WHEN reflection worker runs, THE System SHALL verify async queue processes messages
6. WHEN reflection extracts triplets, THE System SHALL verify confidence scores are assigned
7. WHEN memory is queried, THE System SHALL verify dual-recall (semantic + lexical) is used
8. WHEN cross-domain write is attempted, THE System SHALL verify approval and evidence are required
9. WHEN memory drift is detected, THE System SHALL verify archive strategy is executed
10. WHEN memory is deleted, THE System SHALL verify soft delete (not physical) is performed

### Requirement 66: Multimodal Generation (Image/Voice)

**User Story:** As a multimodal tester, I want to verify image and voice generation work correctly, so that artifacts are generated locally.

#### Acceptance Criteria

1. WHEN image generation is requested, THE System SHALL verify FLUX model is loaded locally
2. WHEN voice generation is requested, THE System SHALL verify GPT-SoVITS model is loaded locally
3. WHEN generation completes, THE System SHALL verify artifact is saved to correct directory (lin shi vs chang qi)
4. WHEN generation fails, THE System SHALL verify fallback strategy is attempted
5. WHEN VRAM is constrained, THE System SHALL verify model swapping occurs
6. WHEN generation is cancelled, THE System SHALL verify resources are released
7. WHEN artifact is referenced in evidence, THE System SHALL verify hash is recorded
8. WHEN temporary artifacts exceed quota, THE System SHALL verify LRU cleanup is triggered
9. WHEN artifact is promoted to long-term, THE System SHALL verify metadata is attached
10. WHEN generation uses training preset 0.5, THE System SHALL verify parameters match defaults

### Requirement 67: Vision and ASR Processing

**User Story:** As a vision/ASR tester, I want to verify visual understanding and speech recognition work correctly, so that perception is accurate.

#### Acceptance Criteria

1. WHEN screenshot is captured, THE System SHALL verify capture method (WGC/PrintWindow/DXGI) succeeds
2. WHEN OCR is performed, THE System SHALL verify text extraction is accurate
3. WHEN visual element is located, THE System SHALL verify coordinates are returned
4. WHEN ASR is requested, THE System SHALL verify Whisper model is loaded
5. WHEN ASR processes audio, THE System SHALL verify transcription is returned
6. WHEN NPU is available, THE System SHALL verify ASR uses NPU first
7. WHEN NPU is unavailable, THE System SHALL verify fallback to GPU then CPU
8. WHEN ASR queue exceeds 200ms, THE System SHALL verify device fallback is triggered
9. WHEN vision confidence is low, THE System SHALL verify automatic upgrade to higher quality capture
10. WHEN vision/ASR fails, THE System SHALL verify error is logged with recovery suggestion

### Requirement 68: Persona and Mode Detection

**User Story:** As a persona tester, I want to verify persona system works correctly, so that interactions feel natural and consistent.

#### Acceptance Criteria

1. WHEN work mode is detected, THE System SHALL verify zero-persona is applied to execution agents
2. WHEN chat mode is detected, THE System SHALL verify full persona is applied to presentation agents
3. WHEN mixed mode is detected, THE System SHALL verify both work and chat can proceed in same turn
4. WHEN mode confidence is low, THE System SHALL verify conservative fallback to work mode
5. WHEN persona profile is updated, THE System SHALL verify changes are reflected in responses
6. WHEN wake word is detected, THE System SHALL verify dynamic phrase pool is used (not mechanical response)
7. WHEN persona consistency is measured, THE System SHALL verify score across 50-turn conversation
8. WHEN tone rewriter is applied, THE System SHALL verify final response matches persona
9. WHEN persona conflicts with safety, THE System SHALL verify safety takes precedence
10. WHEN persona is customized via wizard, THE System SHALL verify preferences are persisted

### Requirement 69: Scheduled Tasks and Proactive Behavior

**User Story:** As a scheduling tester, I want to verify scheduled tasks work correctly, so that proactive behavior is reliable.

#### Acceptance Criteria

1. WHEN scheduled task is configured, THE System SHALL verify time trigger is registered
2. WHEN scheduled task time arrives, THE System SHALL verify task is executed
3. WHEN user is active during scheduled task, THE System SHALL verify Human-Mutex is respected
4. WHEN scheduled task requires approval, THE System SHALL verify pre-approval template is checked
5. WHEN scheduled task fails, THE System SHALL verify retry or notification occurs
6. WHEN proactive ping is triggered, THE System SHALL verify quiet_hours are respected
7. WHEN proactive ping is sent, THE System SHALL verify it's marked with proactive_ping capability domain
8. WHEN user is in full-screen/gaming, THE System SHALL verify proactive behavior is suppressed
9. WHEN scheduled task completes, THE System SHALL verify completion is logged
10. WHEN scheduled task is cancelled, THE System SHALL verify cleanup occurs

### Requirement 70: Policy Engine and Self-Approval

**User Story:** As a policy tester, I want to verify policy engine makes correct decisions, so that security rules are enforced.

#### Acceptance Criteria

1. WHEN policy file is loaded, THE System SHALL verify schema validation passes
2. WHEN policy-hash is calculated, THE System SHALL verify it matches expected format
3. WHEN action is evaluated, THE System SHALL verify risk tier is assigned correctly
4. WHEN Self-Approval token is presented, THE System SHALL verify token validity and scope
5. WHEN Intake Gate is triggered, THE System SHALL verify external information approval is required
6. WHEN policy decision is made, THE System SHALL verify reasoning is logged to audit trail
7. WHEN policy is updated, THE System SHALL verify version history is maintained
8. WHEN policy rollback is requested, THE System SHALL verify previous version is restored
9. WHEN emergency override is used, THE System SHALL verify mandatory audit is created
10. WHEN policy drift is detected, THE System SHALL verify execution is blocked

### Requirement 71: Kill-Switch Trigger and Recovery

**User Story:** As a safety tester, I want to verify Kill-Switch operates correctly, so that dangerous operations are halted.

#### Acceptance Criteria

1. WHEN recipient mismatch is detected, THE System SHALL verify outbound_send Kill-Switch triggers
2. WHEN privilege barrier is detected, THE System SHALL verify desktop_control Kill-Switch triggers
3. WHEN OOM is detected, THE System SHALL verify training Kill-Switch triggers
4. WHEN injection risk is detected, THE System SHALL verify memory_write Kill-Switch triggers
5. WHEN Kill-Switch triggers, THE System SHALL verify semantic summary is generated
6. WHEN Kill-Switch triggers, THE System SHALL verify in-flight tasks are preserved for post-mortem
7. WHEN Kill-Switch triggers, THE System SHALL verify notification is sent through multiple channels
8. WHEN Kill-Switch recovery is attempted, THE System SHALL verify manual unlock is required
9. WHEN Kill-Switch is unlocked, THE System SHALL verify unlock is logged to audit trail
10. WHEN Kill-Switch test mode is used, THE System SHALL verify no actual shutdown occurs

### Requirement 72: Evidence Bundle Generation and Validation

**User Story:** As an evidence tester, I want to verify evidence bundles are complete and valid, so that all actions are properly documented.

#### Acceptance Criteria

1. WHEN fs_write is executed, THE System SHALL verify git diff or file hash is included
2. WHEN shell_exec is executed, THE System SHALL verify stdout/stderr and exit code are included
3. WHEN desktop_control is executed, THE System SHALL verify before/after screenshots are included
4. WHEN outbound_send is executed, THE System SHALL verify recipient proof and send receipt are included
5. WHEN memory_write is executed, THE System SHALL verify source evidence and approval are included
6. WHEN training is executed, THE System SHALL verify VRAM budget and strategy are included
7. WHEN evidence bundle is generated, THE System SHALL verify semantic summary is included
8. WHEN evidence bundle is generated, THE System SHALL verify frozen reason enum is used
9. WHEN evidence bundle is queried, THE System SHALL verify integrity hash is validated
10. WHEN evidence bundle is exported, THE System SHALL verify machine-readable format is used

### Requirement 73: Approval Fatigue and Plan Bundle

**User Story:** As an approval tester, I want to verify approval fatigue mitigation works, so that users are not over-interrupted.

#### Acceptance Criteria

1. WHEN silent threshold is configured, THE System SHALL verify TTL is enforced per risk tier
2. WHEN plan bundle is created, THE System SHALL verify multiple actions are grouped
3. WHEN plan bundle is approved, THE System SHALL verify planApprovalId is generated
4. WHEN action fingerprint matches recent approval, THE System SHALL verify deduplication works
5. WHEN approval pattern is detected, THE System SHALL verify whitelist suggestion is made
6. WHEN approval history is queried, THE System SHALL verify rollback capability exists
7. WHEN approval template is used, THE System SHALL verify recurring tasks are streamlined
8. WHEN approval preview is shown, THE System SHALL verify impact assessment is included
9. WHEN approval delegation is configured, THE System SHALL verify trusted contexts are honored
10. WHEN approval fatigue metrics are measured, THE System SHALL verify approvals per session are tracked

### Requirement 74: Ecosystem Bridge and Skill Sync

**User Story:** As an ecosystem tester, I want to verify external skill integration is safe, so that ecosystem resources can be leveraged.

#### Acceptance Criteria

1. WHEN external skill is imported, THE System SHALL verify version locking and hash verification
2. WHEN skill naming conflict is detected, THE System SHALL verify resolution strategy is provided
3. WHEN skill dependency is checked, THE System SHALL verify allowlist is enforced
4. WHEN skill is executed, THE System SHALL verify sandbox isolation for non-official dependencies
5. WHEN skill permissions are mapped, THE System SHALL verify OpenCode permission metadata is created
6. WHEN skill compatibility is checked, THE System SHALL verify compatibility matrix is consulted
7. WHEN skill integration fails, THE System SHALL verify rollback is performed
8. WHEN skill registry is queried, THE System SHALL verify metadata and provenance are available
9. WHEN skill smoke test is run, THE System SHALL verify basic functionality is validated
10. WHEN skill governance dashboard is viewed, THE System SHALL verify all skills are listed with status

### Requirement 75: Daemon Lifecycle and Reconnection

**User Story:** As a daemon tester, I want to verify daemon lifecycle is managed correctly, so that resources are not leaked.

#### Acceptance Criteria

1. WHEN OpenCode starts, THE System SHALL verify daemon is launched automatically
2. WHEN daemon starts, THE System SHALL verify WebSocket connection is established
3. WHEN daemon heartbeat is sent, THE System SHALL verify response is received within 10 seconds
4. WHEN WebSocket connection drops, THE System SHALL verify reconnection with exponential backoff
5. WHEN daemon crashes, THE System SHALL verify crash log is written
6. WHEN daemon is orphaned, THE System SHALL verify 60-second suicide timer triggers
7. WHEN daemon terminates, THE System SHALL verify GPU resources are released
8. WHEN daemon restarts, THE System SHALL verify session state is restored
9. WHEN daemon job queue is persisted, THE System SHALL verify recovery on restart
10. WHEN daemon is under resource constraint, THE System SHALL verify graceful degradation

### Requirement 76: Gateway Backpressure and Queue Management

**User Story:** As a backpressure tester, I want to verify queue management works correctly, so that system doesn't become overloaded.

#### Acceptance Criteria

1. WHEN Gateway queue reaches max_in_flight, THE System SHALL verify new requests are queued
2. WHEN Gateway queue reaches max_queue, THE System SHALL verify new requests are rejected
3. WHEN Gateway request exceeds queue_timeout_ms, THE System SHALL verify timeout rejection
4. WHEN Daemon is busy, THE System SHALL verify backpressure is applied to Gateway
5. WHEN backpressure is active, THE System SHALL verify metrics are exposed (in_flight, queued, rejected)
6. WHEN backpressure clears, THE System SHALL verify queued requests are processed
7. WHEN backpressure rejection occurs, THE System SHALL verify clear error message is returned
8. WHEN backpressure is sustained, THE System SHALL verify alerting is triggered
9. WHEN backpressure configuration is changed, THE System SHALL verify hot-reload works
10. WHEN backpressure metrics are queried, THE System SHALL verify P95 queue wait time is available

### Requirement 77: Configuration Hot-Reload and Validation

**User Story:** As a configuration tester, I want to verify configuration management works correctly, so that settings are consistent.

#### Acceptance Criteria

1. WHEN configuration is loaded, THE System SHALL verify schema validation passes
2. WHEN configuration has errors, THE System SHALL verify clear error messages are shown
3. WHEN configuration is updated, THE System SHALL verify hot-reload for non-critical settings
4. WHEN configuration version changes, THE System SHALL verify migration is applied
5. WHEN configuration is backed up, THE System SHALL verify backup is restorable
6. WHEN configuration audit trail is queried, THE System SHALL verify change history is available
7. WHEN configuration editor is used, THE System SHALL verify validation before save
8. WHEN configuration template is applied, THE System SHALL verify common scenarios are supported
9. WHEN configuration dry-run is performed, THE System SHALL verify validation without applying
10. WHEN environment variable overrides configuration, THE System SHALL verify precedence is correct

### Requirement 78: Diagnostic Commands and Health Checks

**User Story:** As a diagnostic tester, I want to verify diagnostic capabilities work correctly, so that troubleshooting is effective.

#### Acceptance Criteria

1. WHEN opencode debug config is run, THE System SHALL verify configuration is displayed
2. WHEN opencode debug skill is run, THE System SHALL verify loaded skills are listed
3. WHEN opencode debug paths is run, THE System SHALL verify plugin paths are shown
4. WHEN health check endpoint is queried, THE System SHALL verify component status is returned
5. WHEN metrics endpoint is queried, THE System SHALL verify Prometheus-compatible format is used
6. WHEN structured logs are written, THE System SHALL verify correlation IDs are included
7. WHEN performance profiling is enabled, THE System SHALL verify flamegraph can be exported
8. WHEN key metrics are tracked, THE System SHALL verify latency/throughput/error rate are available
9. WHEN distributed tracing is used, THE System SHALL verify cross-component operations are traced
10. WHEN diagnostic data is exported, THE System SHALL verify support ticket format is used

### Requirement 79: Regression Test Suite Execution

**User Story:** As a regression tester, I want to verify regression tests cover critical paths, so that regressions are caught.

#### Acceptance Criteria

1. WHEN outbound safety regression test runs, THE System SHALL verify allowlist enforcement
2. WHEN approval fatigue regression test runs, THE System SHALL verify silent threshold works
3. WHEN mixed mode regression test runs, THE System SHALL verify work and chat can coexist
4. WHEN cross-domain memory regression test runs, THE System SHALL verify approval is required
5. WHEN regression test suite runs, THE System SHALL verify all tests pass
6. WHEN regression test fails, THE System SHALL verify clear failure reason is provided
7. WHEN regression baseline is updated, THE System SHALL verify new baseline is validated
8. WHEN regression test is added, THE System SHALL verify it's added to suite
9. WHEN regression test is removed, THE System SHALL verify justification is documented
10. WHEN regression test suite is run in CI, THE System SHALL verify failures block merge

### Requirement 80: Performance Benchmark Execution

**User Story:** As a performance tester, I want to verify performance benchmarks are executed correctly, so that performance is validated.

#### Acceptance Criteria

1. WHEN memory recall benchmark runs, THE System SHALL verify Recall@K is measured
2. WHEN interruption rate benchmark runs, THE System SHALL verify approvals per session are counted
3. WHEN persona consistency benchmark runs, THE System SHALL verify 50-turn conversation score is calculated
4. WHEN QQ/WeChat send latency benchmark runs, THE System SHALL verify P50/P95/P99 are measured
5. WHEN training startup benchmark runs, THE System SHALL verify time to first checkpoint is measured
6. WHEN VRAM utilization benchmark runs, THE System SHALL verify peak and average are tracked
7. WHEN Gateway RPC latency benchmark runs, THE System SHALL verify P95 is compared to baseline
8. WHEN ASR processing benchmark runs, THE System SHALL verify latency and device fallback are measured
9. WHEN approval fatigue benchmark runs, THE System SHALL verify silent approvals vs explicit asks are counted
10. WHEN mode detection benchmark runs, THE System SHALL verify accuracy (work vs chat vs mixed) is calculated

### Requirement 81: Test Migration and Consolidation

**User Story:** As a test infrastructure maintainer, I want all existing tests migrated to a unified test directory, so that tests are discoverable and maintainable.

#### Acceptance Criteria

1. THE System SHALL identify all existing test files scattered across the codebase (*.test.ts, *.spec.ts, test-*.ts)
2. THE System SHALL create unified test directory structure at `test/` with subdirectories mirroring source structure
3. THE System SHALL migrate all unit tests to `test/unit/` preserving relative paths from source
4. THE System SHALL migrate all integration tests to `test/integration/` with clear naming
5. THE System SHALL migrate all regression tests to `test/regression/` with baseline references
6. THE System SHALL migrate all adversarial tests to `test/adversarial/` with attack scenario documentation
7. THE System SHALL migrate all performance tests to `test/performance/` with benchmark baselines
8. THE System SHALL update all test import paths to reflect new locations
9. THE System SHALL update test runner configuration to use new test directory
10. THE System SHALL verify all migrated tests still pass after migration

### Requirement 82: Placeholder Function Deep Scan

**User Story:** As a code quality auditor, I want to systematically identify all placeholder functions that have no real effect, so that non-functional code is flagged.

#### Acceptance Criteria

1. WHEN function body only contains `return true` or `return false` without logic, THE Audit SHALL flag as placeholder
2. WHEN function body only contains `console.log()` or `logger.debug()` without action, THE Audit SHALL flag as no-op
3. WHEN function body only contains `throw new Error("Not implemented")`, THE Audit SHALL flag as stub
4. WHEN function returns hardcoded mock data without processing inputs, THE Audit SHALL flag as fake implementation
5. WHEN function has TODO/FIXME comments indicating incomplete implementation, THE Audit SHALL flag as work-in-progress
6. WHEN async function immediately resolves without async operations, THE Audit SHALL flag as unnecessary async
7. WHEN function parameters are declared but never referenced in body, THE Audit SHALL flag as unused parameters
8. WHEN function has empty try-catch blocks that swallow errors, THE Audit SHALL flag as error suppression
9. WHEN function conditionals have identical code in all branches, THE Audit SHALL flag as redundant branching
10. WHEN function is exported but never imported anywhere, THE Audit SHALL flag as dead code

### Requirement 83: Configuration Effectiveness Audit

**User Story:** As a configuration auditor, I want to verify all configuration options are actually used, so that dead configuration is removed.

#### Acceptance Criteria

1. WHEN configuration key is defined in schema but never read in code, THE Audit SHALL flag as unused config
2. WHEN configuration key is read but value is immediately overridden, THE Audit SHALL flag as ineffective config
3. WHEN configuration key has default value that is never changed, THE Audit SHALL flag as unnecessary config
4. WHEN configuration key is documented but not in schema, THE Audit SHALL flag as documentation drift
5. WHEN configuration key is in schema but not documented, THE Audit SHALL flag as undocumented config
6. WHEN configuration validation exists but is never called, THE Audit SHALL flag as bypassed validation
7. WHEN configuration migration exists but old keys are still supported, THE Audit SHALL flag as incomplete migration
8. WHEN configuration hot-reload is claimed but requires restart, THE Audit SHALL flag as misleading capability
9. WHEN configuration precedence is ambiguous (env vs file vs default), THE Audit SHALL flag as confusion risk
10. WHEN configuration is environment-specific but not validated per environment, THE Audit SHALL flag as deployment risk

### Requirement 84: Event Handler Effectiveness Testing

**User Story:** As an event system auditor, I want to verify all event handlers perform meaningful actions, so that no-op handlers are identified.

#### Acceptance Criteria

1. WHEN event handler only logs event without action, THE Audit SHALL flag as logging-only handler
2. WHEN event handler is registered but never triggered in normal flow, THE Audit SHALL flag as unreachable handler
3. WHEN event handler throws errors that are silently caught, THE Audit SHALL flag as error suppression
4. WHEN event handler modifies state that is never read, THE Audit SHALL flag as ineffective state change
5. WHEN event handler calls functions that are placeholders, THE Audit SHALL flag as chained no-op
6. WHEN event handler has conditional logic that always evaluates to same branch, THE Audit SHALL flag as dead branch
7. WHEN event handler is async but doesn't await any operations, THE Audit SHALL flag as unnecessary async
8. WHEN event handler duplicates logic from another handler, THE Audit SHALL flag as redundant handler
9. WHEN event handler is registered multiple times for same event, THE Audit SHALL flag as duplicate registration
10. WHEN event handler cleanup is missing on component unmount, THE Audit SHALL flag as memory leak risk

### Requirement 85: Gateway Domain Method Implementation Depth

**User Story:** As a Gateway architecture auditor, I want to verify domain methods are fully implemented (not just shells), so that domain separation is real.

#### Acceptance Criteria

1. WHEN gateway/methods/channels.ts is examined, THE Audit SHALL verify each method has >10 lines of logic (not just delegation)
2. WHEN gateway/methods/security.ts is examined, THE Audit SHALL verify security checks are implemented (not just pass-through)
3. WHEN gateway/methods/nodes.ts is examined, THE Audit SHALL verify node management logic exists (not just stubs)
4. WHEN gateway/methods/companion.ts is examined, THE Audit SHALL verify companion interaction logic is complete
5. WHEN gateway/methods/memory.ts is examined, THE Audit SHALL verify memory operations have validation and error handling
6. WHEN domain method delegates to index.ts, THE Audit SHALL flag as incomplete domain separation
7. WHEN domain method only wraps another function without added logic, THE Audit SHALL flag as unnecessary wrapper
8. WHEN domain method has no unit tests, THE Audit SHALL flag as untested implementation
9. WHEN domain method has no error handling, THE Audit SHALL flag as unsafe implementation
10. WHEN domain method has no documentation, THE Audit SHALL flag as undocumented API

### Requirement 86: Memory Reflection Intelligence Verification

**User Story:** As a memory system auditor, I want to verify memory reflection uses real intelligence (not placeholder prompts), so that memory extraction is meaningful.

#### Acceptance Criteria

1. WHEN reflection prompt is examined, THE Audit SHALL verify it contains specific extraction instructions (not generic "extract memories")
2. WHEN reflection result is parsed, THE Audit SHALL verify structured output (triplets, confidence scores) is extracted
3. WHEN reflection confidence is low, THE Audit SHALL verify memory is marked as pending (not auto-approved)
4. WHEN reflection extracts conflicting memories, THE Audit SHALL verify conflict resolution is triggered
5. WHEN reflection runs, THE Audit SHALL verify it processes actual conversation content (not placeholder text)
6. WHEN reflection queue is full, THE Audit SHALL verify backpressure prevents queue overflow
7. WHEN reflection fails, THE Audit SHALL verify retry with exponential backoff (not immediate retry)
8. WHEN reflection extracts duplicate memory, THE Audit SHALL verify deduplication logic works
9. WHEN reflection extracts cross-domain memory, THE Audit SHALL verify approval requirement is enforced
10. WHEN reflection performance is measured, THE Audit SHALL verify extraction latency is within acceptable range

### Requirement 87: Training Preset Differentiation Testing

**User Story:** As a training system auditor, I want to verify training presets produce different configurations, so that preset system is not fake.

#### Acceptance Criteria

1. WHEN training preset 0.0 is used, THE Audit SHALL verify parameters differ from preset 0.5
2. WHEN training preset 1.0 is used, THE Audit SHALL verify parameters differ from preset 0.5
3. WHEN training preset affects batch size, THE Audit SHALL verify batch size changes across presets
4. WHEN training preset affects learning rate, THE Audit SHALL verify learning rate changes across presets
5. WHEN training preset affects checkpoint frequency, THE Audit SHALL verify checkpoint frequency changes across presets
6. WHEN training preset affects VRAM budget, THE Audit SHALL verify VRAM allocation changes across presets
7. WHEN training preset is invalid (<0 or >1), THE Audit SHALL verify validation error is raised
8. WHEN training preset is not specified, THE Audit SHALL verify default 0.5 is used
9. WHEN training preset documentation is examined, THE Audit SHALL verify each preset's parameters are documented
10. WHEN training preset is changed mid-training, THE Audit SHALL verify error or graceful handling

### Requirement 88: Approval Fatigue Silent Threshold Enforcement

**User Story:** As an approval system auditor, I want to verify silent threshold is actually applied (not just configured), so that approval fatigue mitigation works.

#### Acceptance Criteria

1. WHEN action is within silent threshold TTL, THE Audit SHALL verify approval is skipped
2. WHEN action is outside silent threshold TTL, THE Audit SHALL verify approval is requested
3. WHEN silent threshold is configured for LIGHT risk tier, THE Audit SHALL verify 60-minute TTL is enforced
4. WHEN silent threshold is configured for STANDARD risk tier, THE Audit SHALL verify 15-minute TTL is enforced
5. WHEN silent threshold is configured for THOROUGH risk tier, THE Audit SHALL verify 0-minute TTL (always ask) is enforced
6. WHEN silent threshold cache is examined, THE Audit SHALL verify recent approvals are stored with timestamps
7. WHEN silent threshold cache expires, THE Audit SHALL verify expired entries are removed
8. WHEN silent threshold is bypassed by user preference, THE Audit SHALL verify user preference takes precedence
9. WHEN silent threshold metrics are measured, THE Audit SHALL verify silent approvals are counted separately
10. WHEN silent threshold is disabled, THE Audit SHALL verify all actions require explicit approval

### Requirement 89: Evidence Bundle Version Migration Testing

**User Story:** As an evidence system auditor, I want to verify old evidence bundle versions are migrated, so that compatibility is maintained.

#### Acceptance Criteria

1. WHEN evidence bundle V1 is loaded, THE Audit SHALL verify migration to V5 is attempted
2. WHEN evidence bundle V2 is loaded, THE Audit SHALL verify migration to V5 is attempted
3. WHEN evidence bundle V3 is loaded, THE Audit SHALL verify migration to V5 is attempted
4. WHEN evidence bundle V4 is loaded, THE Audit SHALL verify migration to V5 is attempted
5. WHEN evidence bundle migration fails, THE Audit SHALL verify clear error message with version info
6. WHEN evidence bundle migration succeeds, THE Audit SHALL verify migrated bundle passes V5 validation
7. WHEN evidence bundle has unknown version, THE Audit SHALL verify rejection with version mismatch error
8. WHEN evidence bundle migration is tested, THE Audit SHALL verify all fields are preserved or mapped
9. WHEN evidence bundle migration adds new required fields, THE Audit SHALL verify defaults are provided
10. WHEN evidence bundle migration is documented, THE Audit SHALL verify migration guide exists

### Requirement 90: Persona Mode Switching Verification

**User Story:** As a persona system auditor, I want to verify persona mode actually switches (not always defaults to single mode), so that mode detection works.

#### Acceptance Criteria

1. WHEN work-only conversation is detected, THE Audit SHALL verify mode is set to "work" (not "mixed")
2. WHEN chat-only conversation is detected, THE Audit SHALL verify mode is set to "chat" (not "mixed")
3. WHEN mixed conversation is detected, THE Audit SHALL verify mode is set to "mixed"
4. WHEN mode confidence is measured, THE Audit SHALL verify confidence score is calculated (not hardcoded)
5. WHEN mode switches from work to chat, THE Audit SHALL verify persona is applied to responses
6. WHEN mode switches from chat to work, THE Audit SHALL verify persona is removed from execution agents
7. WHEN mode detection uses keywords, THE Audit SHALL verify keyword list is not empty or placeholder
8. WHEN mode detection uses ML model, THE Audit SHALL verify model is loaded and inference runs
9. WHEN mode detection fails, THE Audit SHALL verify conservative fallback to work mode
10. WHEN mode detection metrics are measured, THE Audit SHALL verify accuracy across test conversations

### Requirement 91: VRAM Budget Enforcement Before Model Loading

**User Story:** As a resource management auditor, I want to verify VRAM budget is enforced before model loading (not just calculated), so that OOM is prevented.

#### Acceptance Criteria

1. WHEN model loading is requested, THE Audit SHALL verify VRAM budget calculation runs first
2. WHEN VRAM budget is insufficient, THE Audit SHALL verify model loading is blocked (not attempted)
3. WHEN VRAM budget is sufficient, THE Audit SHALL verify model loading proceeds
4. WHEN VRAM budget calculation fails, THE Audit SHALL verify conservative fallback (assume insufficient)
5. WHEN multiple models compete for VRAM, THE Audit SHALL verify semaphore prevents concurrent loading
6. WHEN model is loaded, THE Audit SHALL verify actual VRAM usage is tracked
7. WHEN model is unloaded, THE Audit SHALL verify VRAM is released and budget is updated
8. WHEN VRAM budget is exceeded, THE Audit SHALL verify automatic model unloading (LRU)
9. WHEN VRAM budget metrics are measured, THE Audit SHALL verify peak and average utilization
10. WHEN VRAM budget is configured, THE Audit SHALL verify configuration is validated (not negative or >100%)

### Requirement 92: Skill Conflict Resolution Automation

**User Story:** As an ecosystem auditor, I want to verify skill conflict resolution has automation (not just manual), so that conflicts are handled efficiently.

#### Acceptance Criteria

1. WHEN skill naming conflict is detected, THE Audit SHALL verify automatic resolution strategy is attempted
2. WHEN skill version conflict is detected, THE Audit SHALL verify automatic version selection (latest stable)
3. WHEN skill dependency conflict is detected, THE Audit SHALL verify dependency resolution algorithm runs
4. WHEN automatic resolution succeeds, THE Audit SHALL verify user is notified of resolution
5. WHEN automatic resolution fails, THE Audit SHALL verify manual resolution wizard is triggered
6. WHEN skill conflict resolution is logged, THE Audit SHALL verify resolution strategy is documented
7. WHEN skill conflict resolution uses heuristics, THE Audit SHALL verify heuristics are documented
8. WHEN skill conflict resolution is tested, THE Audit SHALL verify common conflict scenarios are covered
9. WHEN skill conflict resolution metrics are measured, THE Audit SHALL verify auto-resolution success rate
10. WHEN skill conflict resolution is disabled, THE Audit SHALL verify all conflicts require manual resolution

### Requirement 93: Audit Log Rotation and Cleanup

**User Story:** As an audit system auditor, I want to verify audit log rotation actually deletes old logs (not just configures retention), so that disk space is managed.

#### Acceptance Criteria

1. WHEN audit log retention period expires, THE Audit SHALL verify old logs are deleted
2. WHEN audit log rotation runs, THE Audit SHALL verify rotation is logged with timestamp
3. WHEN audit log rotation fails, THE Audit SHALL verify error is logged and alerting is triggered
4. WHEN audit log rotation is configured, THE Audit SHALL verify configuration is validated (positive retention days)
5. WHEN audit log rotation is disabled, THE Audit SHALL verify logs are never deleted
6. WHEN audit log rotation is tested, THE Audit SHALL verify old logs are actually removed from disk
7. WHEN audit log rotation preserves recent logs, THE Audit SHALL verify retention period is respected
8. WHEN audit log rotation is scheduled, THE Audit SHALL verify schedule is honored (daily/weekly)
9. WHEN audit log rotation metrics are measured, THE Audit SHALL verify disk space freed
10. WHEN audit log rotation is documented, THE Audit SHALL verify retention policy is clear

### Requirement 94: Health Check Data Freshness

**User Story:** As a monitoring auditor, I want to verify health check returns fresh data (not cached stale data), so that health status is accurate.

#### Acceptance Criteria

1. WHEN health check endpoint is queried, THE Audit SHALL verify data is generated on-demand (not from cache)
2. WHEN health check includes timestamp, THE Audit SHALL verify timestamp is current (within 1 second)
3. WHEN health check includes component status, THE Audit SHALL verify status is queried from actual components
4. WHEN health check includes metrics, THE Audit SHALL verify metrics are current (not stale)
5. WHEN health check is cached for performance, THE Audit SHALL verify cache TTL is short (<5 seconds)
6. WHEN health check cache is invalidated, THE Audit SHALL verify next query returns fresh data
7. WHEN health check fails to get fresh data, THE Audit SHALL verify error is returned (not stale data)
8. WHEN health check is tested, THE Audit SHALL verify data changes when component status changes
9. WHEN health check is documented, THE Audit SHALL verify caching behavior is documented
10. WHEN health check metrics are measured, THE Audit SHALL verify query latency is acceptable

### Requirement 95: Kill-Switch Capability Domain Shutdown Verification

**User Story:** As a safety auditor, I want to verify Kill-Switch actually stops capability domain (not just logs), so that dangerous operations are halted.

#### Acceptance Criteria

1. WHEN Kill-Switch is triggered for outbound_send, THE Audit SHALL verify no sends occur after trigger
2. WHEN Kill-Switch is triggered for desktop_control, THE Audit SHALL verify no desktop operations occur after trigger
3. WHEN Kill-Switch is triggered for training, THE Audit SHALL verify training is terminated within 2 seconds
4. WHEN Kill-Switch is triggered for memory_write, THE Audit SHALL verify no memory writes occur after trigger
5. WHEN Kill-Switch is triggered, THE Audit SHALL verify in-flight operations are cancelled (not completed)
6. WHEN Kill-Switch is triggered, THE Audit SHALL verify queued operations are rejected (not executed)
7. WHEN Kill-Switch is triggered, THE Audit SHALL verify capability domain state is set to "disabled"
8. WHEN Kill-Switch is unlocked, THE Audit SHALL verify capability domain state is set to "enabled"
9. WHEN Kill-Switch is tested in test mode, THE Audit SHALL verify no actual shutdown occurs
10. WHEN Kill-Switch metrics are measured, THE Audit SHALL verify trigger count and recovery time

### Requirement 96: Allowlist Recipient Verification Bypass Detection

**User Story:** As a security auditor, I want to verify allowlist check cannot be bypassed, so that unauthorized sends are prevented.

#### Acceptance Criteria

1. WHEN recipient is not in allowlist, THE Audit SHALL verify send is blocked (not just logged)
2. WHEN allowlist check is skipped in code path, THE Audit SHALL flag as security vulnerability
3. WHEN allowlist check passes but recipient verification fails, THE Audit SHALL verify send is blocked
4. WHEN allowlist is empty, THE Audit SHALL verify all sends are blocked
5. WHEN allowlist is modified during send, THE Audit SHALL verify consistent snapshot is used
6. WHEN allowlist check uses case-insensitive match, THE Audit SHALL verify normalization is consistent
7. WHEN allowlist check uses regex, THE Audit SHALL verify regex is not vulnerable to bypass
8. WHEN allowlist check is tested, THE Audit SHALL verify bypass attempts are blocked
9. WHEN allowlist check metrics are measured, THE Audit SHALL verify block rate and false positive rate
10. WHEN allowlist check is documented, THE Audit SHALL verify security implications are clear

### Requirement 97: Human-Mutex Timeout Operation Continuation Detection

**User Story:** As a concurrency auditor, I want to verify operations do not proceed after Human-Mutex timeout, so that locking is effective.

#### Acceptance Criteria

1. WHEN Human-Mutex timeout occurs, THE Audit SHALL verify operation is paused (not continued)
2. WHEN Human-Mutex timeout occurs 3 times, THE Audit SHALL verify 15-minute cooldown is enforced
3. WHEN Human-Mutex is released, THE Audit SHALL verify paused operation can resume
4. WHEN Human-Mutex is held by another operation, THE Audit SHALL verify new operation waits
5. WHEN Human-Mutex timeout is configured, THE Audit SHALL verify timeout value is validated (positive)
6. WHEN Human-Mutex timeout is tested, THE Audit SHALL verify timeout actually triggers
7. WHEN Human-Mutex metrics are measured, THE Audit SHALL verify timeout frequency and duration
8. WHEN Human-Mutex is documented, THE Audit SHALL verify timeout behavior is clear
9. WHEN Human-Mutex is disabled, THE Audit SHALL verify all operations proceed without waiting
10. WHEN Human-Mutex deadlock is detected, THE Audit SHALL verify automatic deadlock resolution

### Requirement 98: Policy-Hash Mismatch Execution Continuation Detection

**User Story:** As a policy auditor, I want to verify execution stops when policy-hash mismatches (not continues), so that policy drift is prevented.

#### Acceptance Criteria

1. WHEN policy-hash mismatch is detected, THE Audit SHALL verify execution is blocked (not continued)
2. WHEN policy-hash mismatch is detected, THE Audit SHALL verify clear error message is shown
3. WHEN policy-hash mismatch is detected, THE Audit SHALL verify audit log entry is created
4. WHEN policy-hash mismatch is detected, THE Audit SHALL verify alerting is triggered
5. WHEN policy-hash is recalculated, THE Audit SHALL verify calculation is deterministic
6. WHEN policy file is modified, THE Audit SHALL verify policy-hash is updated
7. WHEN policy-hash is tested, THE Audit SHALL verify mismatch detection works
8. WHEN policy-hash metrics are measured, THE Audit SHALL verify mismatch frequency
9. WHEN policy-hash is documented, THE Audit SHALL verify calculation algorithm is documented
10. WHEN policy-hash validation is disabled, THE Audit SHALL verify warning is logged

### Requirement 99: Evidence Bundle Incomplete Action Success Detection

**User Story:** As an evidence auditor, I want to verify actions are not marked successful when evidence is incomplete, so that audit trail is complete.

#### Acceptance Criteria

1. WHEN evidence bundle is missing required fields, THE Audit SHALL verify action is marked as failed
2. WHEN evidence bundle generation fails, THE Audit SHALL verify action is blocked (not executed)
3. WHEN evidence bundle is incomplete, THE Audit SHALL verify clear error message indicates missing fields
4. WHEN evidence bundle validation runs, THE Audit SHALL verify all required fields are checked
5. WHEN evidence bundle is tested, THE Audit SHALL verify incomplete bundles are rejected
6. WHEN evidence bundle metrics are measured, THE Audit SHALL verify completion rate
7. WHEN evidence bundle is documented, THE Audit SHALL verify required fields per action type are listed
8. WHEN evidence bundle is generated, THE Audit SHALL verify generation errors are logged
9. WHEN evidence bundle is stored, THE Audit SHALL verify storage errors block action
10. WHEN evidence bundle is queried, THE Audit SHALL verify incomplete bundles are flagged

### Requirement 100: Memory Decay Weight Update in Retrieval Verification

**User Story:** As a memory system auditor, I want to verify memory decay weights are actually used in retrieval (not just calculated), so that aging works.

#### Acceptance Criteria

1. WHEN memory decay is calculated, THE Audit SHALL verify decay weight is stored with memory
2. WHEN memory retrieval runs, THE Audit SHALL verify decay weight is applied to relevance score
3. WHEN memory is not accessed for 30 days, THE Audit SHALL verify decay weight reduces score
4. WHEN memory is frequently accessed, THE Audit SHALL verify decay weight is refreshed
5. WHEN memory decay lambda is configured, THE Audit SHALL verify lambda is validated (positive)
6. WHEN memory decay is tested, THE Audit SHALL verify old memories rank lower than recent ones
7. WHEN memory decay metrics are measured, THE Audit SHALL verify average memory age
8. WHEN memory decay is documented, THE Audit SHALL verify decay formula is documented
9. WHEN memory decay is disabled, THE Audit SHALL verify all memories have equal weight
10. WHEN memory decay is applied, THE Audit SHALL verify decay does not cause negative scores

### Requirement 101: User Workflow Completeness Testing

**User Story:** As an end user, I want all workflows to be complete from start to finish, so that I can accomplish tasks without getting stuck.

#### Acceptance Criteria

1. WHEN user initiates QQ/WeChat send, THE System SHALL verify complete workflow (allowlist check → window detection → recipient search → message input → send → receipt verification)
2. WHEN user initiates image generation, THE System SHALL verify complete workflow (request → VRAM check → model load → generation → artifact save → evidence bundle)
3. WHEN user initiates voice training, THE System SHALL verify complete workflow (audio upload → validation → VRAM check → training → checkpoint → completion notification)
4. WHEN user views memory in Gateway console, THE System SHALL verify complete workflow (query → display → edit → save → confirmation)
5. WHEN user approves action, THE System SHALL verify complete workflow (request → display → user decision → execution → result feedback)
6. WHEN user triggers Kill-Switch, THE System SHALL verify complete workflow (trigger → shutdown → semantic summary → unlock UI)
7. WHEN user configures policy, THE System SHALL verify complete workflow (edit → validate → save → reload → confirmation)
8. WHEN user imports external skill, THE System SHALL verify complete workflow (select → validate → conflict check → install → smoke test → activation)
9. WHEN user schedules task, THE System SHALL verify complete workflow (configure → validate → schedule → execution → result notification)
10. WHEN user troubleshoots error, THE System SHALL verify complete workflow (error display → diagnostic info → suggested actions → resolution → confirmation)

### Requirement 102: Error Recovery Path Completeness

**User Story:** As an end user, I want clear recovery paths when errors occur, so that I'm not left in a broken state.

#### Acceptance Criteria

1. WHEN daemon crashes, THE System SHALL provide recovery action (restart daemon button in Gateway console)
2. WHEN WebSocket disconnects, THE System SHALL show reconnection status and manual reconnect option
3. WHEN training OOM occurs, THE System SHALL offer retry with lighter preset or cancel options
4. WHEN desktop control fails, THE System SHALL provide retry, skip, or manual completion options
5. WHEN policy file is corrupted, THE System SHALL offer restore from backup or reset to defaults options
6. WHEN evidence bundle generation fails, THE System SHALL show what's missing and allow manual completion
7. WHEN memory conflict is detected, THE System SHALL provide resolution wizard with merge/keep/discard options
8. WHEN skill import fails, THE System SHALL show specific error and offer rollback or fix options
9. WHEN approval timeout occurs, THE System SHALL allow re-request or cancel options
10. WHEN configuration validation fails, THE System SHALL highlight errors and offer fix suggestions

### Requirement 103: UI Feedback Loop Completeness

**User Story:** As an end user, I want immediate feedback for all actions, so that I know the system is responding.

#### Acceptance Criteria

1. WHEN user clicks button in Gateway console, THE System SHALL show loading state within 100ms
2. WHEN long operation is running, THE System SHALL show progress bar or spinner with estimated time
3. WHEN operation completes, THE System SHALL show success notification with summary
4. WHEN operation fails, THE System SHALL show error notification with actionable next steps
5. WHEN user input is invalid, THE System SHALL show inline validation error immediately
6. WHEN system is processing, THE System SHALL disable submit buttons to prevent double-submission
7. WHEN background job is running, THE System SHALL show status indicator in Gateway console
8. WHEN user hovers over element, THE System SHALL show tooltip with explanation
9. WHEN user navigates away during operation, THE System SHALL show confirmation dialog
10. WHEN operation is queued, THE System SHALL show queue position and estimated wait time

### Requirement 104: Configuration Discoverability Testing

**User Story:** As an end user, I want to easily discover and understand configuration options, so that I can customize the system.

#### Acceptance Criteria

1. WHEN user opens Gateway console settings, THE System SHALL display all configuration categories with descriptions
2. WHEN user hovers over configuration option, THE System SHALL show tooltip with explanation and default value
3. WHEN user changes configuration, THE System SHALL show preview of impact before saving
4. WHEN configuration has dependencies, THE System SHALL show related options and explain relationships
5. WHEN configuration is invalid, THE System SHALL show validation error with example of valid value
6. WHEN configuration is advanced, THE System SHALL hide by default with "Show Advanced" toggle
7. WHEN configuration is changed, THE System SHALL indicate if restart is required
8. WHEN configuration has presets, THE System SHALL offer preset selection with descriptions
9. WHEN user searches configuration, THE System SHALL filter options and highlight matches
10. WHEN configuration is documented, THE System SHALL provide link to detailed documentation

### Requirement 105: Permission Request Clarity Testing

**User Story:** As an end user, I want to understand why permissions are requested, so that I can make informed decisions.

#### Acceptance Criteria

1. WHEN permission is requested, THE System SHALL show clear explanation of what action requires it
2. WHEN permission is requested, THE System SHALL show evidence bundle summary with key details
3. WHEN permission is requested, THE System SHALL show risk level (LIGHT/STANDARD/THOROUGH) with color coding
4. WHEN permission is requested, THE System SHALL show previous similar approvals for context
5. WHEN permission is requested, THE System SHALL offer approve/deny/trial options with explanations
6. WHEN permission is denied, THE System SHALL explain consequences and offer alternatives
7. WHEN permission is approved, THE System SHALL show confirmation and allow undo within 5 seconds
8. WHEN permission is for plan bundle, THE System SHALL show all actions in bundle with individual details
9. WHEN permission request times out, THE System SHALL show timeout reason and allow re-request
10. WHEN permission is requested repeatedly, THE System SHALL offer "always allow" option with warning

### Requirement 106: Memory Management User Interface

**User Story:** As an end user, I want to easily manage memories through Gateway console, so that I can control what the system remembers.

#### Acceptance Criteria

1. WHEN user opens memory view, THE System SHALL display memories grouped by domain (work/relationship)
2. WHEN user searches memories, THE System SHALL filter by keyword and highlight matches
3. WHEN user clicks memory, THE System SHALL show full details (content, source, timestamp, confidence)
4. WHEN user edits memory, THE System SHALL show inline editor with save/cancel buttons
5. WHEN user deletes memory, THE System SHALL show confirmation dialog with impact warning
6. WHEN user archives memory, THE System SHALL move to archive section (not delete)
7. WHEN user exports memories, THE System SHALL offer format selection (JSON/CSV) and download
8. WHEN user views memory conflicts, THE System SHALL show conflict resolution wizard
9. WHEN user views memory statistics, THE System SHALL show count by domain, age distribution, confidence distribution
10. WHEN user refreshes memory view, THE System SHALL show loading state and update with latest data

### Requirement 107: Training Progress Visibility

**User Story:** As an end user, I want to see detailed training progress, so that I know what's happening and can intervene if needed.

#### Acceptance Criteria

1. WHEN training starts, THE System SHALL show notification with model type and estimated duration
2. WHEN training is running, THE System SHALL show progress bar with percentage and current step
3. WHEN training reaches checkpoint, THE System SHALL show checkpoint saved notification
4. WHEN training is interrupted by user activity, THE System SHALL show pause notification with resume option
5. WHEN training completes, THE System SHALL show success notification with model location and quality metrics
6. WHEN training fails, THE System SHALL show error notification with failure reason and retry option
7. WHEN training is queued, THE System SHALL show queue position and estimated start time
8. WHEN training is cancelled, THE System SHALL show confirmation dialog with partial progress info
9. WHEN training uses downgraded preset, THE System SHALL show notification explaining why
10. WHEN multiple trainings are running, THE System SHALL show list with individual progress

### Requirement 108: Desktop Control Operation Transparency

**User Story:** As an end user, I want to see what desktop control operations are doing, so that I can trust the automation.

#### Acceptance Criteria

1. WHEN desktop control starts, THE System SHALL show notification with operation description
2. WHEN window is being searched, THE System SHALL show "Searching for [app name]" status
3. WHEN recipient is being verified, THE System SHALL show "Verifying recipient [name]" status
4. WHEN message is being typed, THE System SHALL show "Typing message" status with preview
5. WHEN send button is being clicked, THE System SHALL show "Sending message" status
6. WHEN receipt is being verified, THE System SHALL show "Verifying send receipt" status
7. WHEN Human-Mutex is waiting, THE System SHALL show countdown timer and reason
8. WHEN operation completes, THE System SHALL show success notification with before/after screenshots
9. WHEN operation fails, THE System SHALL show error notification with failure point and recovery options
10. WHEN operation is paused, THE System SHALL show pause reason and resume/cancel options

### Requirement 109: Skill Management User Experience

**User Story:** As an end user, I want to easily manage external skills, so that I can extend system capabilities.

#### Acceptance Criteria

1. WHEN user opens skill management, THE System SHALL display installed skills with status (active/inactive/error)
2. WHEN user searches for skills, THE System SHALL show available skills from ecosystem with ratings
3. WHEN user views skill details, THE System SHALL show description, permissions, dependencies, and reviews
4. WHEN user installs skill, THE System SHALL show progress (download → validate → install → activate)
5. WHEN skill installation fails, THE System SHALL show specific error and offer troubleshooting steps
6. WHEN user activates skill, THE System SHALL show confirmation and list new capabilities
7. WHEN user deactivates skill, THE System SHALL show confirmation and list affected capabilities
8. WHEN user updates skill, THE System SHALL show changelog and breaking changes warning
9. WHEN user uninstalls skill, THE System SHALL show confirmation and cleanup options
10. WHEN skill has conflict, THE System SHALL show conflict details and resolution options

### Requirement 110: Audit Trail User Interface

**User Story:** As an end user, I want to easily review audit trail, so that I can understand what the system has done.

#### Acceptance Criteria

1. WHEN user opens audit view, THE System SHALL display recent actions with timestamps and descriptions
2. WHEN user filters audit trail, THE System SHALL offer filters (time range, domain, risk level, user)
3. WHEN user clicks audit entry, THE System SHALL show full evidence bundle with all details
4. WHEN user searches audit trail, THE System SHALL filter by keyword and highlight matches
5. WHEN user exports audit trail, THE System SHALL offer format selection (JSON/CSV/PDF) and download
6. WHEN user views audit statistics, THE System SHALL show charts (actions per day, risk distribution, approval rate)
7. WHEN user views Kill-Switch history, THE System SHALL show all triggers with recovery status
8. WHEN user views policy changes, THE System SHALL show version history with diffs
9. WHEN user views evidence bundle, THE System SHALL show semantic summary and raw evidence
10. WHEN user refreshes audit view, THE System SHALL show loading state and update with latest data

### Requirement 111: Notification System Completeness

**User Story:** As an end user, I want comprehensive notifications for important events, so that I'm always informed.

#### Acceptance Criteria

1. WHEN daemon crashes, THE System SHALL send notification through multiple channels (OpenCode UI, Gateway console, audio alert)
2. WHEN Kill-Switch triggers, THE System SHALL send urgent notification with semantic summary
3. WHEN training completes, THE System SHALL send notification with model quality metrics
4. WHEN scheduled task executes, THE System SHALL send notification with execution result
5. WHEN approval is required, THE System SHALL send notification with action summary
6. WHEN error occurs, THE System SHALL send notification with error description and recovery steps
7. WHEN configuration changes, THE System SHALL send notification with change summary
8. WHEN skill is updated, THE System SHALL send notification with changelog
9. WHEN memory conflict is detected, THE System SHALL send notification with resolution request
10. WHEN system health degrades, THE System SHALL send notification with diagnostic info

### Requirement 112: Onboarding and First-Time User Experience

**User Story:** As a first-time user, I want guided onboarding, so that I can quickly understand and use the system.

#### Acceptance Criteria

1. WHEN user first opens Gateway console, THE System SHALL show welcome wizard with overview
2. WHEN user completes setup, THE System SHALL offer guided tour of key features
3. WHEN user encounters feature for first time, THE System SHALL show contextual help tooltip
4. WHEN user makes mistake, THE System SHALL show helpful error message with learning resources
5. WHEN user opens empty section, THE System SHALL show empty state with "Get Started" guide
6. WHEN user configures policy, THE System SHALL offer preset templates (strict/balanced/permissive)
7. WHEN user adds first memory, THE System SHALL show explanation of memory system
8. WHEN user schedules first task, THE System SHALL show example templates
9. WHEN user imports first skill, THE System SHALL show safety guidelines
10. WHEN user completes onboarding, THE System SHALL offer link to full documentation

### Requirement 113: Keyboard Navigation and Accessibility

**User Story:** As a keyboard-only user, I want full keyboard navigation, so that I can use the system without a mouse.

#### Acceptance Criteria

1. WHEN user presses Tab, THE System SHALL move focus to next interactive element with visible indicator
2. WHEN user presses Shift+Tab, THE System SHALL move focus to previous interactive element
3. WHEN user presses Enter on button, THE System SHALL activate button action
4. WHEN user presses Escape in dialog, THE System SHALL close dialog
5. WHEN user presses Arrow keys in list, THE System SHALL navigate list items
6. WHEN user presses Space on checkbox, THE System SHALL toggle checkbox
7. WHEN user presses Ctrl+F in view, THE System SHALL focus search input
8. WHEN user presses Ctrl+S in editor, THE System SHALL save changes
9. WHEN user presses ? key, THE System SHALL show keyboard shortcuts help
10. WHEN user uses screen reader, THE System SHALL announce all state changes and errors

### Requirement 114: Search and Filter Functionality

**User Story:** As an end user, I want powerful search and filter capabilities, so that I can quickly find what I need.

#### Acceptance Criteria

1. WHEN user searches memories, THE System SHALL support full-text search with highlighting
2. WHEN user searches audit trail, THE System SHALL support field-specific search (e.g., "domain:outbound_send")
3. WHEN user searches skills, THE System SHALL support tag-based filtering
4. WHEN user searches configuration, THE System SHALL support fuzzy matching
5. WHEN user applies filters, THE System SHALL show active filters with clear indicators
6. WHEN user clears filters, THE System SHALL restore full view with animation
7. WHEN user saves search, THE System SHALL offer save as preset option
8. WHEN user searches with no results, THE System SHALL show helpful "no results" message with suggestions
9. WHEN user searches, THE System SHALL show search results count
10. WHEN user exports search results, THE System SHALL export only filtered items

### Requirement 115: Batch Operations Support

**User Story:** As an end user, I want to perform batch operations, so that I can manage multiple items efficiently.

#### Acceptance Criteria

1. WHEN user selects multiple memories, THE System SHALL show batch action toolbar (delete, archive, export)
2. WHEN user selects multiple audit entries, THE System SHALL offer batch export
3. WHEN user selects multiple skills, THE System SHALL offer batch activate/deactivate
4. WHEN user performs batch operation, THE System SHALL show progress with count (e.g., "Deleting 5 of 10")
5. WHEN batch operation fails partially, THE System SHALL show which items failed and why
6. WHEN user confirms batch delete, THE System SHALL show confirmation with item count
7. WHEN user selects all items, THE System SHALL offer "Select All" checkbox in header
8. WHEN user deselects items, THE System SHALL update batch action toolbar
9. WHEN batch operation completes, THE System SHALL show summary notification
10. WHEN batch operation is cancelled, THE System SHALL rollback completed items

### Requirement 116: Real-Time Status Updates

**User Story:** As an end user, I want real-time status updates, so that I see current system state without refreshing.

#### Acceptance Criteria

1. WHEN daemon status changes, THE System SHALL update Gateway console status indicator immediately
2. WHEN training progress updates, THE System SHALL update progress bar in real-time
3. WHEN new audit entry is created, THE System SHALL append to audit view without refresh
4. WHEN memory is added, THE System SHALL update memory count and list immediately
5. WHEN configuration changes, THE System SHALL update UI to reflect new settings
6. WHEN job is queued, THE System SHALL update queue view in real-time
7. WHEN approval is requested, THE System SHALL show notification immediately
8. WHEN Kill-Switch triggers, THE System SHALL update status indicators immediately
9. WHEN WebSocket reconnects, THE System SHALL sync missed updates
10. WHEN multiple users access Gateway console, THE System SHALL sync state across sessions

### Requirement 117: Data Export and Import Completeness

**User Story:** As an end user, I want to export and import data, so that I can backup and migrate configurations.

#### Acceptance Criteria

1. WHEN user exports memories, THE System SHALL include all metadata (timestamps, confidence, source)
2. WHEN user exports audit trail, THE System SHALL include evidence bundles
3. WHEN user exports configuration, THE System SHALL include all settings with comments
4. WHEN user exports skills, THE System SHALL include skill metadata and dependencies
5. WHEN user imports memories, THE System SHALL validate format and show preview before import
6. WHEN user imports configuration, THE System SHALL validate schema and show diff before applying
7. WHEN user imports skills, THE System SHALL check conflicts and show resolution options
8. WHEN import fails, THE System SHALL show specific validation errors with line numbers
9. WHEN export completes, THE System SHALL show success notification with file location
10. WHEN user exports large dataset, THE System SHALL show progress and allow cancellation

### Requirement 118: Context-Aware Help System

**User Story:** As an end user, I want context-aware help, so that I can get assistance without leaving my current task.

#### Acceptance Criteria

1. WHEN user clicks help icon, THE System SHALL show help panel relevant to current view
2. WHEN user encounters error, THE System SHALL show inline help with troubleshooting steps
3. WHEN user hovers over unfamiliar term, THE System SHALL show tooltip with definition
4. WHEN user opens complex feature, THE System SHALL offer "Learn More" link to documentation
5. WHEN user makes configuration mistake, THE System SHALL show suggestion with example
6. WHEN user searches help, THE System SHALL show relevant articles and videos
7. WHEN user views help article, THE System SHALL show related articles at bottom
8. WHEN user follows help steps, THE System SHALL track progress and show completion
9. WHEN user provides feedback on help, THE System SHALL offer thumbs up/down rating
10. WHEN user can't find help, THE System SHALL offer "Contact Support" option with diagnostic data

### Requirement 119: Performance Perception Optimization

**User Story:** As an end user, I want the system to feel fast, so that I have a smooth experience.

#### Acceptance Criteria

1. WHEN user opens Gateway console, THE System SHALL show initial view within 1 second
2. WHEN user navigates between views, THE System SHALL show new view within 300ms
3. WHEN user types in search, THE System SHALL show results within 200ms
4. WHEN user clicks button, THE System SHALL show visual feedback within 100ms
5. WHEN user loads large list, THE System SHALL use virtual scrolling for smooth performance
6. WHEN user performs action, THE System SHALL show optimistic UI update before server confirmation
7. WHEN user waits for operation, THE System SHALL show progress indicator to reduce perceived wait time
8. WHEN user experiences slow operation, THE System SHALL show "This may take a while" message
9. WHEN user has slow network, THE System SHALL show offline indicator and queue actions
10. WHEN user returns to view, THE System SHALL restore scroll position and selections

### Requirement 120: Error Message Actionability

**User Story:** As an end user, I want error messages to tell me exactly what to do, so that I can fix problems myself.

#### Acceptance Criteria

1. WHEN daemon connection fails, THE System SHALL show "Daemon not running. Click here to start daemon."
2. WHEN VRAM is insufficient, THE System SHALL show "Not enough VRAM. Close other applications or use lighter preset."
3. WHEN allowlist is empty, THE System SHALL show "No recipients configured. Click here to add recipients."
4. WHEN policy file is corrupted, THE System SHALL show "Policy file invalid. Click here to restore from backup."
5. WHEN skill installation fails, THE System SHALL show "Dependency missing: [name]. Click here to install."
6. WHEN training fails, THE System SHALL show "Training failed at step [N]. Click here to retry with lighter preset."
7. WHEN memory conflict occurs, THE System SHALL show "Memory conflict detected. Click here to resolve."
8. WHEN configuration is invalid, THE System SHALL show "Invalid value for [field]. Expected [format]. Example: [example]."
9. WHEN permission is denied, THE System SHALL show "Permission denied. Click here to grant permission."
10. WHEN network error occurs, THE System SHALL show "Network error. Check connection and click here to retry."

### Requirement 121: State Consistency Across Components

**User Story:** As a system reliability engineer, I want to verify state is consistent across all components, so that users don't see conflicting information.

#### Acceptance Criteria

1. WHEN Gateway console shows training as "running", THE Daemon SHALL actually have training process active
2. WHEN Gateway console shows daemon as "connected", THE WebSocket connection SHALL actually be established
3. WHEN Gateway console shows memory count as N, THE Database SHALL actually contain N memories
4. WHEN Gateway console shows Kill-Switch as "triggered", THE Capability domain SHALL actually be disabled
5. WHEN Gateway console shows job as "queued", THE Job queue SHALL actually contain that job
6. WHEN Gateway console shows approval as "pending", THE Approval system SHALL actually be waiting for response
7. WHEN Gateway console shows configuration as "saved", THE Configuration file SHALL actually be updated
8. WHEN Gateway console shows skill as "active", THE Skill SHALL actually be loaded and functional
9. WHEN Gateway console shows evidence bundle as "complete", THE Evidence SHALL actually contain all required fields
10. WHEN state sync fails, THE System SHALL detect mismatch and trigger reconciliation

### Requirement 122: Concurrent User Action Handling

**User Story:** As an end user, I want the system to handle my rapid actions gracefully, so that I don't break things by clicking too fast.

#### Acceptance Criteria

1. WHEN user double-clicks submit button, THE System SHALL process request only once (not twice)
2. WHEN user clicks multiple actions rapidly, THE System SHALL queue actions (not execute simultaneously)
3. WHEN user changes configuration while saving, THE System SHALL either block changes or queue them
4. WHEN user starts training while another is running, THE System SHALL queue or reject with clear message
5. WHEN user approves action while it's executing, THE System SHALL handle gracefully (not duplicate)
6. WHEN user cancels operation while it's starting, THE System SHALL cancel cleanly (not leave partial state)
7. WHEN user refreshes page during operation, THE System SHALL restore operation state
8. WHEN user opens multiple Gateway console tabs, THE System SHALL sync state across tabs
9. WHEN user performs action offline then comes online, THE System SHALL sync queued actions
10. WHEN user's actions conflict with scheduled task, THE System SHALL resolve with priority rules

### Requirement 123: Resource Cleanup on Failure Paths

**User Story:** As a system reliability engineer, I want to verify resources are cleaned up even when operations fail, so that no leaks occur.

#### Acceptance Criteria

1. WHEN training fails mid-process, THE System SHALL release VRAM and delete temporary files
2. WHEN desktop control fails, THE System SHALL release Human-Mutex and restore window state
3. WHEN evidence bundle generation fails, THE System SHALL clean up partial evidence files
4. WHEN skill installation fails, THE System SHALL remove partially installed files
5. WHEN WebSocket connection fails during RPC, THE System SHALL clean up pending callbacks
6. WHEN memory write fails, THE System SHALL rollback transaction and release locks
7. WHEN configuration save fails, THE System SHALL restore previous configuration
8. WHEN model loading fails, THE System SHALL release allocated VRAM
9. WHEN audit log write fails, THE System SHALL buffer in memory and retry (not lose)
10. WHEN daemon crashes during job, THE System SHALL clean up orphaned processes and files

### Requirement 124: Data Validation at Boundaries

**User Story:** As a security engineer, I want to verify all data is validated at system boundaries, so that invalid data doesn't propagate.

#### Acceptance Criteria

1. WHEN data enters from WebSocket, THE System SHALL validate against schema before processing
2. WHEN data enters from file system, THE System SHALL validate format and encoding
3. WHEN data enters from user input, THE System SHALL sanitize and validate before storage
4. WHEN data enters from external skill, THE System SHALL validate against declared schema
5. WHEN data enters from database, THE System SHALL validate integrity (not assume valid)
6. WHEN data crosses process boundary (Plugin→Daemon), THE System SHALL validate serialization
7. WHEN data enters from configuration file, THE System SHALL validate against schema
8. WHEN data enters from environment variables, THE System SHALL validate type and range
9. WHEN data enters from command line, THE System SHALL validate and escape special characters
10. WHEN validation fails, THE System SHALL reject with specific error (not silently coerce)

### Requirement 125: Timeout Handling Completeness

**User Story:** As an end user, I want operations to timeout gracefully, so that I'm not stuck waiting forever.

#### Acceptance Criteria

1. WHEN WebSocket RPC exceeds 30 seconds, THE System SHALL timeout with clear error message
2. WHEN Human-Mutex exceeds 20 seconds, THE System SHALL timeout and pause operation
3. WHEN model loading exceeds 60 seconds, THE System SHALL timeout and show diagnostic info
4. WHEN desktop control operation exceeds 10 seconds, THE System SHALL timeout and offer retry
5. WHEN approval request exceeds configured timeout, THE System SHALL auto-deny and notify
6. WHEN database query exceeds 5 seconds, THE System SHALL timeout and log slow query
7. WHEN skill execution exceeds timeout, THE System SHALL terminate and log error
8. WHEN training checkpoint write exceeds 30 seconds, THE System SHALL timeout and retry
9. WHEN evidence bundle generation exceeds 10 seconds, THE System SHALL timeout and investigate
10. WHEN health check exceeds 2 seconds, THE System SHALL timeout and mark component as unhealthy

### Requirement 126: Partial Failure Handling

**User Story:** As an end user, I want the system to handle partial failures gracefully, so that one failure doesn't break everything.

#### Acceptance Criteria

1. WHEN batch memory delete fails for some items, THE System SHALL show which succeeded and which failed
2. WHEN plan bundle execution fails for one action, THE System SHALL show partial completion status
3. WHEN multi-agent task fails for one agent, THE System SHALL continue with other agents
4. WHEN evidence bundle has some missing fields, THE System SHALL show which fields are missing
5. WHEN skill import has some dependency failures, THE System SHALL install what's possible
6. WHEN configuration has some invalid fields, THE System SHALL apply valid fields and report invalid
7. WHEN audit log write fails for some entries, THE System SHALL buffer failed entries for retry
8. WHEN memory sync fails for some domains, THE System SHALL sync successful domains
9. WHEN training checkpoint write fails, THE System SHALL continue training and retry checkpoint
10. WHEN notification delivery fails for some channels, THE System SHALL deliver through available channels

### Requirement 127: User Mistake Prevention

**User Story:** As an end user, I want the system to prevent me from making costly mistakes, so that I don't accidentally break things.

#### Acceptance Criteria

1. WHEN user tries to delete all memories, THE System SHALL show confirmation with "type DELETE to confirm"
2. WHEN user tries to disable all capability domains, THE System SHALL warn about system becoming unusable
3. WHEN user tries to clear allowlist, THE System SHALL warn about blocking all outbound sends
4. WHEN user tries to set VRAM budget to 0, THE System SHALL reject with minimum value suggestion
5. WHEN user tries to set training preset to invalid value, THE System SHALL clamp to valid range
6. WHEN user tries to delete active skill, THE System SHALL warn about dependent features
7. WHEN user tries to modify policy during active operations, THE System SHALL warn about impact
8. WHEN user tries to restart daemon during training, THE System SHALL warn about losing progress
9. WHEN user tries to export sensitive data, THE System SHALL show privacy warning
10. WHEN user tries to import untrusted skill, THE System SHALL show security warning

### Requirement 128: Graceful Degradation Testing

**User Story:** As a system reliability engineer, I want to verify the system degrades gracefully under stress, so that it doesn't crash completely.

#### Acceptance Criteria

1. WHEN VRAM is exhausted, THE System SHALL fallback to CPU inference (not crash)
2. WHEN disk is full, THE System SHALL stop non-critical writes and alert (not crash)
3. WHEN memory is low, THE System SHALL unload cached models and reduce buffers
4. WHEN CPU is maxed, THE System SHALL throttle background tasks and prioritize user actions
5. WHEN network is slow, THE System SHALL increase timeouts and show slow connection warning
6. WHEN database is locked, THE System SHALL retry with exponential backoff (not fail immediately)
7. WHEN too many jobs are queued, THE System SHALL reject new jobs with queue full message
8. WHEN daemon is unresponsive, THE System SHALL show degraded mode and offer restart
9. WHEN external skill is slow, THE System SHALL timeout and continue without it
10. WHEN audit log is full, THE System SHALL rotate immediately and continue (not block operations)

### Requirement 129: Version Compatibility Testing

**User Story:** As a system maintainer, I want to verify version compatibility is handled correctly, so that upgrades don't break existing data.

#### Acceptance Criteria

1. WHEN evidence bundle version is old, THE System SHALL migrate to current version automatically
2. WHEN configuration schema version is old, THE System SHALL migrate with backward compatibility
3. WHEN memory database schema is old, THE System SHALL run migration scripts
4. WHEN policy file version is old, THE System SHALL migrate or reject with upgrade instructions
5. WHEN skill API version is incompatible, THE System SHALL detect and show compatibility error
6. WHEN Gateway protocol version mismatches Daemon, THE System SHALL negotiate compatible version
7. WHEN audit log format is old, THE System SHALL read old format and write new format
8. WHEN model checkpoint version is old, THE System SHALL attempt to load or show incompatibility error
9. WHEN OpenCode version is incompatible, THE System SHALL detect and show minimum version requirement
10. WHEN downgrade is attempted, THE System SHALL warn about data loss and offer backup

### Requirement 130: Idempotency Verification

**User Story:** As a system reliability engineer, I want to verify operations are idempotent, so that retries don't cause duplicate effects.

#### Acceptance Criteria

1. WHEN same outbound send is retried, THE System SHALL detect duplicate and skip (not send twice)
2. WHEN same memory write is retried, THE System SHALL detect duplicate and skip (not create duplicate)
3. WHEN same training job is retried, THE System SHALL detect duplicate and skip (not train twice)
4. WHEN same evidence bundle is generated twice, THE System SHALL return cached version
5. WHEN same configuration save is retried, THE System SHALL detect no change and skip write
6. WHEN same skill installation is retried, THE System SHALL detect already installed and skip
7. WHEN same approval is submitted twice, THE System SHALL detect duplicate and ignore second
8. WHEN same audit log entry is written twice, THE System SHALL detect duplicate and skip
9. WHEN same Kill-Switch trigger occurs twice, THE System SHALL detect already triggered and skip
10. WHEN same policy reload is triggered twice, THE System SHALL detect no change and skip

### Requirement 131: Cross-Domain Data Consistency

**User Story:** As a data integrity engineer, I want to verify data is consistent across domains, so that related data doesn't diverge.

#### Acceptance Criteria

1. WHEN memory is deleted, THE System SHALL also delete related evidence bundles
2. WHEN skill is uninstalled, THE System SHALL also remove related configuration
3. WHEN training completes, THE System SHALL update both model registry and audit log
4. WHEN approval is granted, THE System SHALL update both approval history and action status
5. WHEN Kill-Switch triggers, THE System SHALL update both capability domain state and audit log
6. WHEN configuration changes, THE System SHALL update both file and in-memory cache
7. WHEN evidence bundle is created, THE System SHALL update both storage and index
8. WHEN job completes, THE System SHALL update both job queue and result storage
9. WHEN policy changes, THE System SHALL update both policy file and policy-hash
10. WHEN daemon disconnects, THE System SHALL update both connection state and job queue

### Requirement 132: Audit Trail Completeness Verification

**User Story:** As a compliance auditor, I want to verify audit trail captures all important events, so that nothing is missed.

#### Acceptance Criteria

1. WHEN user approves action, THE System SHALL log approval with timestamp, user, and action details
2. WHEN user denies action, THE System SHALL log denial with timestamp, user, and reason
3. WHEN configuration changes, THE System SHALL log change with before/after values
4. WHEN Kill-Switch triggers, THE System SHALL log trigger with full context and stack trace
5. WHEN policy changes, THE System SHALL log change with version diff
6. WHEN skill is installed/uninstalled, THE System SHALL log with skill metadata
7. WHEN memory is created/updated/deleted, THE System SHALL log with memory content hash
8. WHEN training starts/completes/fails, THE System SHALL log with parameters and outcome
9. WHEN evidence bundle is generated, THE System SHALL log with bundle hash
10. WHEN daemon crashes, THE System SHALL log crash with stack trace and system state

### Requirement 133: UI State Persistence

**User Story:** As an end user, I want my UI state to persist across sessions, so that I don't lose my work.

#### Acceptance Criteria

1. WHEN user closes Gateway console, THE System SHALL save current view and filters
2. WHEN user reopens Gateway console, THE System SHALL restore previous view and filters
3. WHEN user collapses/expands sections, THE System SHALL remember state
4. WHEN user resizes panels, THE System SHALL remember sizes
5. WHEN user sorts table, THE System SHALL remember sort order
6. WHEN user sets preferences, THE System SHALL persist to local storage
7. WHEN user has unsaved changes and closes, THE System SHALL prompt to save
8. WHEN user's session expires, THE System SHALL restore state after re-authentication
9. WHEN user switches between tabs, THE System SHALL maintain state per tab
10. WHEN user refreshes page, THE System SHALL restore scroll position and selections

### Requirement 134: Background Task Visibility

**User Story:** As an end user, I want to see all background tasks, so that I know what the system is doing.

#### Acceptance Criteria

1. WHEN training is running in background, THE System SHALL show in background tasks panel
2. WHEN memory reflection is running, THE System SHALL show in background tasks panel
3. WHEN skill is being installed, THE System SHALL show in background tasks panel
4. WHEN audit log is being rotated, THE System SHALL show in background tasks panel
5. WHEN configuration is being synced, THE System SHALL show in background tasks panel
6. WHEN evidence bundles are being generated, THE System SHALL show in background tasks panel
7. WHEN scheduled task is executing, THE System SHALL show in background tasks panel
8. WHEN model is being loaded, THE System SHALL show in background tasks panel
9. WHEN database migration is running, THE System SHALL show in background tasks panel
10. WHEN background task completes, THE System SHALL show notification and remove from panel

### Requirement 135: Rate Limiting User Feedback

**User Story:** As an end user, I want to know when I'm being rate limited, so that I understand why my actions are delayed.

#### Acceptance Criteria

1. WHEN user is rate limited for outbound sends, THE System SHALL show "Rate limit reached. Next send available in [time]."
2. WHEN user is rate limited for approvals, THE System SHALL show "Too many approval requests. Please wait [time]."
3. WHEN user is rate limited for API calls, THE System SHALL show "API rate limit reached. Retry after [time]."
4. WHEN user is rate limited for training jobs, THE System SHALL show "Training queue full. Position: [N]."
5. WHEN user is rate limited for memory writes, THE System SHALL show "Memory write limit reached. Quota resets in [time]."
6. WHEN user is rate limited for skill installations, THE System SHALL show "Installation limit reached. Try again in [time]."
7. WHEN user is rate limited for configuration changes, THE System SHALL show "Too many changes. Please wait [time]."
8. WHEN user is rate limited for evidence queries, THE System SHALL show "Query limit reached. Retry after [time]."
9. WHEN user is rate limited for desktop control, THE System SHALL show "Cooldown active. Available in [time]."
10. WHEN rate limit is about to expire, THE System SHALL show countdown timer

### Requirement 136: Dependency Chain Validation

**User Story:** As a system architect, I want to verify dependency chains are validated, so that dependent features don't break.

#### Acceptance Criteria

1. WHEN user disables desktop_control, THE System SHALL warn that outbound_send depends on it
2. WHEN user uninstalls skill, THE System SHALL check if other skills depend on it
3. WHEN user deletes memory domain, THE System SHALL check if agents depend on it
4. WHEN user changes policy, THE System SHALL validate that capability domains are still functional
5. WHEN user removes model, THE System SHALL check if training jobs depend on it
6. WHEN user disables capability domain, THE System SHALL check if scheduled tasks depend on it
7. WHEN user changes configuration, THE System SHALL validate that dependent features still work
8. WHEN user removes allowlist entry, THE System SHALL check if scheduled sends depend on it
9. WHEN user deletes evidence bundle, THE System SHALL check if audit trail references it
10. WHEN user downgrades version, THE System SHALL check if features depend on newer version

### Requirement 137: Multi-Language Content Handling

**User Story:** As a Chinese-speaking user, I want the system to handle mixed language content correctly, so that nothing breaks.

#### Acceptance Criteria

1. WHEN user inputs Chinese characters in memory, THE System SHALL store and retrieve without corruption
2. WHEN user inputs emoji in messages, THE System SHALL handle correctly in desktop control
3. WHEN user inputs mixed Chinese-English in search, THE System SHALL search both correctly
4. WHEN user views Chinese content in Gateway console, THE System SHALL display with correct encoding
5. WHEN user exports data with Chinese content, THE System SHALL use UTF-8 encoding
6. WHEN user imports data with Chinese content, THE System SHALL detect encoding correctly
7. WHEN user inputs Chinese in configuration, THE System SHALL validate and save correctly
8. WHEN user views error messages, THE System SHALL display Chinese with proper formatting
9. WHEN user inputs Chinese in skill names, THE System SHALL handle without breaking
10. WHEN user inputs Chinese in evidence bundles, THE System SHALL store and display correctly

### Requirement 138: System Resource Monitoring

**User Story:** As a system administrator, I want to monitor system resource usage, so that I can prevent resource exhaustion.

#### Acceptance Criteria

1. WHEN VRAM usage exceeds 80%, THE System SHALL show warning and suggest cleanup
2. WHEN disk usage exceeds 90%, THE System SHALL show critical warning and trigger cleanup
3. WHEN memory usage exceeds 80%, THE System SHALL show warning and unload cached models
4. WHEN CPU usage exceeds 90%, THE System SHALL show warning and throttle background tasks
5. WHEN network bandwidth is saturated, THE System SHALL show warning and prioritize critical traffic
6. WHEN database size exceeds threshold, THE System SHALL show warning and suggest archiving
7. WHEN audit log size exceeds threshold, THE System SHALL trigger rotation automatically
8. WHEN temporary files exceed quota, THE System SHALL trigger LRU cleanup
9. WHEN job queue exceeds threshold, THE System SHALL reject new jobs with queue full message
10. WHEN resource monitoring fails, THE System SHALL log error and continue with degraded monitoring

### Requirement 139: Rollback Capability Testing

**User Story:** As a system operator, I want to rollback failed changes, so that I can recover from mistakes.

#### Acceptance Criteria

1. WHEN configuration change fails, THE System SHALL offer rollback to previous version
2. WHEN skill installation fails, THE System SHALL automatically rollback partial installation
3. WHEN policy change breaks system, THE System SHALL offer rollback to last working version
4. WHEN database migration fails, THE System SHALL rollback to previous schema
5. WHEN memory import fails, THE System SHALL rollback to state before import
6. WHEN training fails, THE System SHALL offer rollback to last checkpoint
7. WHEN evidence bundle generation fails, THE System SHALL rollback partial evidence
8. WHEN approval batch fails, THE System SHALL rollback completed approvals
9. WHEN daemon upgrade fails, THE System SHALL rollback to previous version
10. WHEN rollback itself fails, THE System SHALL log error and enter safe mode

### Requirement 140: Dead Code and Unused Feature Detection

**User Story:** As a code quality engineer, I want to identify dead code and unused features, so that they can be removed or fixed.

#### Acceptance Criteria

1. WHEN function is defined but never called, THE Audit SHALL flag as dead code
2. WHEN configuration option is defined but never read, THE Audit SHALL flag as unused config
3. WHEN event is emitted but no handlers exist, THE Audit SHALL flag as unused event
4. WHEN capability domain is defined but never activated, THE Audit SHALL flag as unused domain
5. WHEN skill is installed but never invoked, THE Audit SHALL flag as unused skill
6. WHEN memory domain is defined but never written to, THE Audit SHALL flag as unused domain
7. WHEN evidence field is defined but never populated, THE Audit SHALL flag as unused field
8. WHEN policy rule is defined but never matched, THE Audit SHALL flag as unused rule
9. WHEN UI component is defined but never rendered, THE Audit SHALL flag as unused component
10. WHEN API endpoint is defined but never called, THE Audit SHALL flag as unused endpoint

### Requirement 141: Gateway WebSocket Connection Stability

**User Story:** As an end user, I want the Gateway WebSocket connection to be stable and recover automatically, so that I don't lose control of the system.

#### Acceptance Criteria

1. WHEN WebSocket connection drops, THE System SHALL attempt reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)
2. WHEN reconnection succeeds, THE System SHALL restore subscription state and sync missed events
3. WHEN reconnection fails after 5 attempts, THE System SHALL show clear error message with manual reconnect button
4. WHEN network switches (WiFi to Ethernet), THE System SHALL detect and reconnect automatically
5. WHEN Gateway restarts, THE System SHALL detect version mismatch and prompt user to refresh UI
6. WHEN WebSocket message is malformed, THE System SHALL log error and continue (not crash)
7. WHEN WebSocket send buffer is full, THE System SHALL apply backpressure and show warning
8. WHEN heartbeat timeout occurs, THE System SHALL close connection and trigger reconnect
9. WHEN multiple tabs are open, THE System SHALL sync state across tabs using BroadcastChannel
10. WHEN connection is unstable (frequent reconnects), THE System SHALL show network quality indicator

### Requirement 142: Training Job Lifecycle Completeness

**User Story:** As an end user, I want complete control over training jobs, so that I can manage them effectively.

#### Acceptance Criteria

1. WHEN training job is submitted, THE System SHALL validate VRAM budget before queuing
2. WHEN training job is queued, THE System SHALL show estimated start time based on current queue
3. WHEN training job starts, THE System SHALL show notification with model type and parameters
4. WHEN training job is running, THE System SHALL show real-time progress (step, loss, ETA)
5. WHEN training job reaches checkpoint, THE System SHALL save checkpoint and show notification
6. WHEN training job is paused by user activity, THE System SHALL show pause reason and resume ETA
7. WHEN training job is cancelled, THE System SHALL clean up resources and show confirmation
8. WHEN training job completes, THE System SHALL show success notification with model location and metrics
9. WHEN training job fails, THE System SHALL show error details and offer retry with lighter preset
10. WHEN training job is resumed, THE System SHALL load from last checkpoint and continue

### Requirement 143: Desktop Control Coordinate Caching Validation

**User Story:** As a desktop automation tester, I want to verify coordinate caching works correctly, so that automation is fast and accurate.

#### Acceptance Criteria

1. WHEN coordinate is cached, THE System SHALL verify pixel fingerprint before using cached coordinate
2. WHEN pixel fingerprint mismatches, THE System SHALL invalidate cache and re-detect coordinate
3. WHEN window is resized, THE System SHALL invalidate all cached coordinates for that window
4. WHEN window is moved, THE System SHALL adjust cached coordinates based on new position
5. WHEN DPI changes, THE System SHALL invalidate all cached coordinates and re-detect
6. WHEN theme changes (light/dark), THE System SHALL invalidate cached coordinates if pixel-based
7. WHEN cached coordinate is used successfully, THE System SHALL update cache hit statistics
8. WHEN cached coordinate fails, THE System SHALL update cache miss statistics and trigger re-detection
9. WHEN cache size exceeds limit, THE System SHALL evict least recently used entries
10. WHEN cache is cleared manually, THE System SHALL show confirmation and clear all entries

### Requirement 144: QQ/WeChat Window Detection Robustness

**User Story:** As a desktop automation tester, I want to verify QQ/WeChat window detection is robust, so that sends don't fail due to detection issues.

#### Acceptance Criteria

1. WHEN QQ/WeChat is minimized, THE System SHALL restore window before attempting send
2. WHEN QQ/WeChat is on different virtual desktop, THE System SHALL switch desktop and focus window
3. WHEN QQ/WeChat is behind other windows, THE System SHALL bring to front and verify focus
4. WHEN QQ/WeChat has multiple windows open, THE System SHALL detect correct main window
5. WHEN QQ/WeChat window title changes, THE System SHALL update detection pattern
6. WHEN QQ/WeChat is not running, THE System SHALL show clear error and offer to launch
7. WHEN QQ/WeChat is running but not logged in, THE System SHALL detect and show login prompt
8. WHEN QQ/WeChat is in full-screen mode, THE System SHALL exit full-screen before attempting send
9. WHEN QQ/WeChat window is partially off-screen, THE System SHALL adjust window position
10. WHEN QQ/WeChat detection fails 3 times, THE System SHALL trigger Kill-Switch and show diagnostic info

### Requirement 145: Allowlist Management User Experience

**User Story:** As an end user, I want to easily manage the allowlist, so that I can control who Miya can send messages to.

#### Acceptance Criteria

1. WHEN user opens allowlist management, THE System SHALL display all entries with tier (owner/friend)
2. WHEN user adds entry, THE System SHALL validate format and show preview before saving
3. WHEN user edits entry, THE System SHALL show inline editor with save/cancel buttons
4. WHEN user deletes entry, THE System SHALL show confirmation dialog with impact warning
5. WHEN user changes tier, THE System SHALL show tier description and permission differences
6. WHEN user searches allowlist, THE System SHALL filter by name/ID and highlight matches
7. WHEN user exports allowlist, THE System SHALL offer format selection (JSON/CSV) and download
8. WHEN user imports allowlist, THE System SHALL validate format and show preview before applying
9. WHEN allowlist is empty, THE System SHALL show warning that all sends will be blocked
10. WHEN allowlist entry is used in send, THE System SHALL show last used timestamp

### Requirement 146: Memory Reflection Worker Reliability

**User Story:** As a memory system tester, I want to verify memory reflection worker is reliable, so that memories are extracted correctly.

#### Acceptance Criteria

1. WHEN reflection worker starts, THE System SHALL verify queue is accessible and writable
2. WHEN reflection worker processes message, THE System SHALL extract structured triplets (subject, predicate, object)
3. WHEN reflection extraction fails, THE System SHALL log error and skip message (not crash)
4. WHEN reflection queue is full, THE System SHALL apply backpressure and reject new messages
5. WHEN reflection worker is idle, THE System SHALL sleep and wake on new messages
6. WHEN reflection worker crashes, THE System SHALL restart automatically and resume from last position
7. WHEN reflection extracts duplicate memory, THE System SHALL detect and merge with existing
8. WHEN reflection extracts conflicting memory, THE System SHALL trigger conflict resolution
9. WHEN reflection extracts low-confidence memory, THE System SHALL mark as pending (not auto-activate)
10. WHEN reflection worker metrics are queried, THE System SHALL show processed count, error rate, and average latency

### Requirement 147: Policy File Corruption Detection and Recovery

**User Story:** As a system operator, I want the system to detect and recover from policy file corruption, so that security is maintained.

#### Acceptance Criteria

1. WHEN policy file is loaded, THE System SHALL validate JSON schema and structure
2. WHEN policy file is corrupted, THE System SHALL refuse execution and show clear error
3. WHEN policy file is corrupted, THE System SHALL offer restore from backup option
4. WHEN policy file is corrupted, THE System SHALL offer reset to defaults option
5. WHEN policy file is restored, THE System SHALL validate restored file before applying
6. WHEN policy file backup is created, THE System SHALL verify backup is readable
7. WHEN policy file is modified, THE System SHALL create backup before applying changes
8. WHEN policy file hash mismatches, THE System SHALL detect drift and alert user
9. WHEN policy file is missing, THE System SHALL create default policy and alert user
10. WHEN policy file recovery fails, THE System SHALL enter safe mode and block all operations

### Requirement 148: Evidence Bundle Storage and Retrieval

**User Story:** As an auditor, I want to verify evidence bundles are stored and retrieved correctly, so that audit trail is complete.

#### Acceptance Criteria

1. WHEN evidence bundle is generated, THE System SHALL store with unique auditId
2. WHEN evidence bundle is stored, THE System SHALL verify write succeeded and file is readable
3. WHEN evidence bundle is queried, THE System SHALL return complete bundle with all fields
4. WHEN evidence bundle is queried by time range, THE System SHALL filter correctly
5. WHEN evidence bundle is queried by domain, THE System SHALL filter correctly
6. WHEN evidence bundle is queried by risk level, THE System SHALL filter correctly
7. WHEN evidence bundle storage is full, THE System SHALL trigger rotation and cleanup
8. WHEN evidence bundle is corrupted, THE System SHALL detect and mark as invalid
9. WHEN evidence bundle is exported, THE System SHALL include all referenced artifacts (screenshots, logs)
10. WHEN evidence bundle is deleted, THE System SHALL also delete referenced artifacts

### Requirement 149: Scheduled Task Execution Reliability

**User Story:** As an end user, I want scheduled tasks to execute reliably, so that I can trust automation.

#### Acceptance Criteria

1. WHEN scheduled task time arrives, THE System SHALL execute task within 1 minute of scheduled time
2. WHEN scheduled task is executing, THE System SHALL show status in Gateway console
3. WHEN scheduled task completes, THE System SHALL show notification with result summary
4. WHEN scheduled task fails, THE System SHALL retry according to retry policy
5. WHEN scheduled task fails after retries, THE System SHALL show error notification and stop retrying
6. WHEN scheduled task requires approval, THE System SHALL check pre-approval template
7. WHEN scheduled task conflicts with user activity, THE System SHALL respect Human-Mutex and defer
8. WHEN scheduled task is disabled, THE System SHALL skip execution and show skipped status
9. WHEN scheduled task is edited, THE System SHALL validate new schedule before saving
10. WHEN scheduled task history is queried, THE System SHALL show all executions with timestamps and results

### Requirement 150: Model Loading and Unloading Verification

**User Story:** As a resource management tester, I want to verify models are loaded and unloaded correctly, so that VRAM is managed efficiently.

#### Acceptance Criteria

1. WHEN model is loaded, THE System SHALL verify VRAM budget is available before loading
2. WHEN model is loaded, THE System SHALL track actual VRAM usage and update budget
3. WHEN model is unloaded, THE System SHALL verify VRAM is released and update budget
4. WHEN model loading fails, THE System SHALL show clear error and offer fallback options
5. WHEN model is in use, THE System SHALL prevent unloading and show in-use status
6. WHEN model is idle for configured time, THE System SHALL unload automatically (LRU)
7. WHEN multiple models compete for VRAM, THE System SHALL use priority queue
8. WHEN model swap is needed, THE System SHALL unload lowest priority model first
9. WHEN model loading times out, THE System SHALL cancel loading and show timeout error
10. WHEN model version mismatches, THE System SHALL detect and show version mismatch error

### Requirement 151: Approval Template Matching Accuracy

**User Story:** As an approval system tester, I want to verify approval templates match correctly, so that pre-approved actions work as expected.

#### Acceptance Criteria

1. WHEN action matches template exactly, THE System SHALL auto-approve without prompting
2. WHEN action partially matches template, THE System SHALL prompt for confirmation
3. WHEN action doesn't match any template, THE System SHALL require full approval
4. WHEN template has wildcards, THE System SHALL match correctly with wildcard rules
5. WHEN template has conditions, THE System SHALL evaluate conditions before matching
6. WHEN template is expired, THE System SHALL not match and require new approval
7. WHEN template is disabled, THE System SHALL not match and require full approval
8. WHEN multiple templates match, THE System SHALL use most specific template
9. WHEN template matching fails, THE System SHALL log error and require full approval
10. WHEN template is updated, THE System SHALL invalidate cached matches

### Requirement 152: Cross-Session State Consistency

**User Story:** As a system reliability tester, I want to verify state is consistent across sessions, so that users don't see stale data.

#### Acceptance Criteria

1. WHEN user opens new session, THE System SHALL load latest state from storage
2. WHEN state changes in one session, THE System SHALL broadcast to all active sessions
3. WHEN session is closed, THE System SHALL persist state to storage
4. WHEN session crashes, THE System SHALL recover state from last checkpoint
5. WHEN multiple sessions modify same state, THE System SHALL use last-write-wins or conflict resolution
6. WHEN state sync fails, THE System SHALL show warning and offer manual refresh
7. WHEN state is corrupted, THE System SHALL detect and offer recovery options
8. WHEN state version mismatches, THE System SHALL migrate or reject with clear error
9. WHEN state is too large, THE System SHALL compress or paginate
10. WHEN state is queried, THE System SHALL return consistent snapshot (not partial updates)

### Requirement 153: Diagnostic Command Output Completeness

**User Story:** As a troubleshooter, I want diagnostic commands to provide complete information, so that I can diagnose issues effectively.

#### Acceptance Criteria

1. WHEN opencode debug config is run, THE System SHALL show all configuration keys and values
2. WHEN opencode debug skill is run, THE System SHALL show all loaded skills with versions
3. WHEN opencode debug paths is run, THE System SHALL show all plugin paths and load status
4. WHEN diagnostic command fails, THE System SHALL show clear error message with troubleshooting steps
5. WHEN diagnostic command is run, THE System SHALL include system information (OS, version, runtime)
6. WHEN diagnostic command is run, THE System SHALL include resource usage (CPU, memory, disk)
7. WHEN diagnostic command is run, THE System SHALL include network status (proxy, connectivity)
8. WHEN diagnostic command is run, THE System SHALL include recent errors from logs
9. WHEN diagnostic command output is too large, THE System SHALL paginate or offer export
10. WHEN diagnostic command is run, THE System SHALL include timestamp and session ID

### Requirement 154: Persona Consistency Across Modes

**User Story:** As a persona system tester, I want to verify persona is consistent across work/chat modes, so that user experience is coherent.

#### Acceptance Criteria

1. WHEN mode switches from work to chat, THE System SHALL apply persona to responses
2. WHEN mode switches from chat to work, THE System SHALL remove persona from execution agents
3. WHEN mode is mixed, THE System SHALL apply persona to chat responses but not work execution
4. WHEN persona is updated, THE System SHALL apply changes to all active sessions
5. WHEN persona is disabled, THE System SHALL use neutral tone for all responses
6. WHEN persona conflicts with safety, THE System SHALL prioritize safety over persona
7. WHEN persona is customized, THE System SHALL validate customization before applying
8. WHEN persona is reset, THE System SHALL restore default persona and show confirmation
9. WHEN persona consistency is measured, THE System SHALL track consistency score across conversations
10. WHEN persona consistency is low, THE System SHALL show warning and offer recalibration

### Requirement 155: Backup and Restore Functionality

**User Story:** As an end user, I want to backup and restore my data, so that I don't lose important information.

#### Acceptance Criteria

1. WHEN user initiates backup, THE System SHALL backup all data (memories, configuration, evidence, allowlist)
2. WHEN backup is created, THE System SHALL verify backup integrity with checksum
3. WHEN backup is created, THE System SHALL show success notification with backup location
4. WHEN user initiates restore, THE System SHALL validate backup file before restoring
5. WHEN restore is initiated, THE System SHALL show preview of what will be restored
6. WHEN restore is confirmed, THE System SHALL backup current state before restoring
7. WHEN restore completes, THE System SHALL verify restored data and show summary
8. WHEN restore fails, THE System SHALL rollback to previous state and show error
9. WHEN backup is scheduled, THE System SHALL create backups automatically at configured intervals
10. WHEN backup storage is full, THE System SHALL rotate old backups according to retention policy

### Requirement 156: Network Proxy Compatibility

**User Story:** As an end user behind corporate proxy, I want the system to work with proxy, so that I can use it at work.

#### Acceptance Criteria

1. WHEN system proxy is configured, THE System SHALL detect and use proxy for external requests
2. WHEN proxy requires authentication, THE System SHALL prompt for credentials
3. WHEN proxy is unavailable, THE System SHALL show clear error and offer direct connection fallback
4. WHEN proxy configuration changes, THE System SHALL detect and update automatically
5. WHEN localhost requests are made, THE System SHALL bypass proxy (use NO_PROXY)
6. WHEN proxy is slow, THE System SHALL show slow connection warning
7. WHEN proxy blocks requests, THE System SHALL show blocked error with proxy details
8. WHEN proxy settings are invalid, THE System SHALL show validation error
9. WHEN proxy is configured in environment variables, THE System SHALL respect environment settings
10. WHEN proxy is disabled, THE System SHALL use direct connection

### Requirement 157: Multi-User Environment Support

**User Story:** As a system administrator, I want the system to support multiple users, so that each user has isolated data.

#### Acceptance Criteria

1. WHEN user logs in, THE System SHALL load user-specific configuration and data
2. WHEN user switches, THE System SHALL save current user state and load new user state
3. WHEN user data is accessed, THE System SHALL verify user has permission
4. WHEN user creates data, THE System SHALL tag with user ID for isolation
5. WHEN user deletes data, THE System SHALL only delete user's own data
6. WHEN user exports data, THE System SHALL only export user's own data
7. WHEN user imports data, THE System SHALL validate ownership before importing
8. WHEN user quota is exceeded, THE System SHALL show quota warning and block new data
9. WHEN user is deleted, THE System SHALL clean up user data according to retention policy
10. WHEN user list is queried, THE System SHALL show all users with status and quota usage

### Requirement 158: Offline Mode Functionality

**User Story:** As an end user, I want basic functionality to work offline, so that I can use the system without internet.

#### Acceptance Criteria

1. WHEN network is unavailable, THE System SHALL detect offline mode and show indicator
2. WHEN in offline mode, THE System SHALL allow local operations (file edit, build, test)
3. WHEN in offline mode, THE System SHALL queue operations that require network
4. WHEN network is restored, THE System SHALL sync queued operations automatically
5. WHEN in offline mode, THE System SHALL show which features are unavailable
6. WHEN in offline mode, THE System SHALL use cached data for read operations
7. WHEN in offline mode, THE System SHALL prevent operations that require external services
8. WHEN in offline mode, THE System SHALL show last sync timestamp
9. WHEN network is intermittent, THE System SHALL retry failed operations with backoff
10. WHEN offline mode is manually enabled, THE System SHALL respect user preference

### Requirement 159: Security Audit Log Integrity

**User Story:** As a security auditor, I want to verify audit logs cannot be tampered with, so that audit trail is trustworthy.

#### Acceptance Criteria

1. WHEN audit log entry is created, THE System SHALL sign with cryptographic signature
2. WHEN audit log is queried, THE System SHALL verify signatures of all entries
3. WHEN audit log signature is invalid, THE System SHALL flag entry as tampered
4. WHEN audit log is exported, THE System SHALL include signatures for verification
5. WHEN audit log is imported, THE System SHALL verify signatures before accepting
6. WHEN audit log is rotated, THE System SHALL verify integrity before archiving
7. WHEN audit log is deleted, THE System SHALL require special permission and log deletion
8. WHEN audit log is modified, THE System SHALL detect and alert (logs should be append-only)
9. WHEN audit log storage is full, THE System SHALL alert and prevent new operations
10. WHEN audit log integrity check fails, THE System SHALL enter safe mode and alert

### Requirement 160: Performance Profiling and Optimization

**User Story:** As a performance engineer, I want to profile system performance, so that bottlenecks can be identified and optimized.

#### Acceptance Criteria

1. WHEN profiling is enabled, THE System SHALL collect performance metrics (CPU, memory, I/O, network)
2. WHEN profiling is enabled, THE System SHALL track operation latencies with percentiles (P50, P95, P99)
3. WHEN profiling is enabled, THE System SHALL identify slow operations and log details
4. WHEN profiling is enabled, THE System SHALL generate flamegraph for CPU profiling
5. WHEN profiling is enabled, THE System SHALL track memory allocations and leaks
6. WHEN profiling is enabled, THE System SHALL track database query performance
7. WHEN profiling is enabled, THE System SHALL track network request performance
8. WHEN profiling is enabled, THE System SHALL track model inference latency
9. WHEN profiling is disabled, THE System SHALL have minimal performance overhead
10. WHEN profiling data is exported, THE System SHALL provide analysis tools and recommendations
