import type { Plugin } from '@opencode-ai/plugin';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAgentConfigs } from './agents';
import { MiyaAutomationService } from './automation';
import { BackgroundTaskManager, TmuxSessionManager } from './background';
import { loadPluginConfig, type TmuxConfig } from './config';
import {
  extractAgentModelSelectionsFromEvent,
  persistAgentRuntimeSelection,
  readPersistedAgentRuntime,
} from './config/agent-model-persistence';
import { parseList } from './config/agent-mcps';
import {
  createGatewayTools,
  ensureGatewayRunning,
  isGatewayOwner,
  probeGatewayAlive,
  registerGatewayDependencies,
  startGatewayWithLog,
} from './gateway';
import { createIntakeTools } from './intake';
import {
  shouldInterceptWriteAfterWebsearch,
  trackWebsearchToolOutput,
} from './intake/websearch-guard';
import {
  ensureMiyaLauncher,
  getLauncherDaemonSnapshot,
  subscribeLauncherEvents,
} from './daemon';
import { appendProviderOverrideAudit } from './config/provider-override-audit';
import {
  createLoopGuardHook,
  createPhaseReminderHook,
  createPostReadNudgeHook,
  createSlashCommandBridgeHook,
} from './hooks';
import { createSafetyTools, handlePermissionAsk } from './safety';
import { createConfigTools, readConfig } from './settings';
import { createBuiltinMcps } from './mcp';
import {
  ast_grep_replace,
  ast_grep_search,
  createAutomationTools,
  createAutopilotTools,
  createBackgroundTools,
  createMultimodalTools,
  createMcpTools,
  createNodeTools,
  createRalphTools,
  createRouterTools,
  createSoulTools,
  createUltraworkTools,
  grep,
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_rename,
  createWorkflowTools,
} from './tools';
import { mergePluginAgentConfigs } from './config/runtime-merge';
import { startTmuxCheck } from './utils';
import { log } from './utils/logger';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMergeObject(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMergeObject(baseValue, overrideValue);
      continue;
    }
    result[key] = overrideValue;
  }
  return result;
}

const autoUiOpenAtByDir = new Map<string, number>();

function openUrlSilently(url: string): void {
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function launchDockSilently(projectDir: string): void {
  if (process.platform !== 'win32') return;
  const bat = path.join(projectDir, 'miya-src', 'tools', 'miya-dock', 'miya-launch.bat');
  if (!fs.existsSync(bat)) return;
  const child = spawn('cmd', ['/c', bat], {
    cwd: projectDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function shouldAutoOpenUi(projectDir: string): boolean {
  const config = readConfig(projectDir);
  const ui = (config.ui as Record<string, unknown> | undefined)?.dashboard as
    | Record<string, unknown>
    | undefined;
  const enabled = ui?.openOnStart !== false;
  if (!enabled) return false;
  const last = autoUiOpenAtByDir.get(projectDir) ?? 0;
  const now = Date.now();
  if (now - last < 10_000) return false;
  autoUiOpenAtByDir.set(projectDir, now);
  return true;
}

const MiyaPlugin: Plugin = async (ctx) => {
  const config = loadPluginConfig(ctx.directory);
  const agents = getAgentConfigs(config, ctx.directory);

  // Parse tmux config with defaults
  const tmuxConfig: TmuxConfig = {
    enabled: config.tmux?.enabled ?? false,
    layout: config.tmux?.layout ?? 'main-vertical',
    main_pane_size: config.tmux?.main_pane_size ?? 60,
  };

  log('[plugin] initialized with tmux config', {
    tmuxConfig,
    rawTmuxConfig: config.tmux,
    directory: ctx.directory,
  });

  // Start background tmux check if enabled
  if (tmuxConfig.enabled) {
    startTmuxCheck();
  }

  const backgroundManager = new BackgroundTaskManager(ctx, tmuxConfig, config);
  startGatewayWithLog(ctx.directory);
  const gatewayOwner = isGatewayOwner(ctx.directory);
  if (gatewayOwner) {
    const daemonLaunch = ensureMiyaLauncher(ctx.directory);
    log('[miya-launcher] daemon bootstrap', daemonLaunch);
    if (shouldAutoOpenUi(ctx.directory)) {
      setTimeout(async () => {
        try {
          const state = ensureGatewayRunning(ctx.directory);
          const healthy = await probeGatewayAlive(state.url, 1_500);
          if (!healthy) {
            log('[miya] auto ui open skipped: gateway unhealthy', { url: state.url });
            return;
          }
          // Windows: try dock bootstrap (side panel) and always open fallback web UI.
          launchDockSilently(ctx.directory);
          openUrlSilently(state.url);
          log('[miya] auto ui open triggered', { url: state.url });
        } catch (error) {
          log('[miya] auto ui open failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, 1_200);
    }
    setTimeout(async () => {
      try {
        const daemon = getLauncherDaemonSnapshot(ctx.directory);
        await ctx.client.tui.showToast({
          query: { directory: ctx.directory },
          body: {
            title: 'Miya',
            message: daemon.connected
              ? 'Miya Daemon Connected'
              : daemon.statusText || 'Miya Daemon Connecting',
            variant: daemon.connected ? 'success' : 'info',
            duration: 3000,
          },
        });
      } catch {}
    }, 4000);
    subscribeLauncherEvents(ctx.directory, (event) => {
      if (event.type !== 'job.progress') return;
      const status = String(event.payload?.status ?? '').trim().toLowerCase();
      if (
        status !== 'completed' &&
        status !== 'failed' &&
        status !== 'degraded' &&
        status !== 'canceled'
      ) {
        return;
      }
      const jobID = String(event.payload?.jobID ?? event.snapshot.activeJobID ?? '').trim();
      const phase = String(event.payload?.phase ?? '').trim();
      const progress = Number(event.payload?.progress ?? 0);
      const messageParts = [`job=${jobID || 'unknown'}`, `status=${status}`];
      if (phase) messageParts.push(`phase=${phase}`);
      if (Number.isFinite(progress)) messageParts.push(`progress=${Math.floor(progress)}%`);
      void ctx.client.tui
        .showToast({
          query: { directory: ctx.directory },
          body: {
            title: 'Miya Job',
            message: messageParts.join(' | '),
            variant: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'info',
            duration: 3500,
          },
        })
        .catch(() => {});
    });
  } else {
    log('[miya] follower instance detected; skip daemon bootstrap/toast', {
      directory: ctx.directory,
    });
  }
  const automationService = new MiyaAutomationService(ctx.directory);
  if (gatewayOwner) {
    automationService.start();
  }
  registerGatewayDependencies(ctx.directory, {
    client: ctx.client,
    backgroundManager,
    automationService,
    extraSkillDirs: [],
  });

  const backgroundTools = createBackgroundTools(
    ctx,
    backgroundManager,
    tmuxConfig,
    config,
  );
  const automationTools = createAutomationTools(automationService);
  const workflowTools = createWorkflowTools(ctx.directory);
  const autopilotTools = createAutopilotTools(ctx.directory);
  const ralphTools = createRalphTools();
  const nodeTools = createNodeTools(ctx.directory);
  const multimodalTools = createMultimodalTools(ctx.directory);
  const soulTools = createSoulTools(ctx.directory);
  const ultraworkTools = createUltraworkTools(ctx, backgroundManager);
  const routerTools = createRouterTools(ctx.directory);
  const mcpTools = createMcpTools();
  const safetyTools = createSafetyTools(ctx);
  const configTools = createConfigTools(ctx);
  const intakeTools = createIntakeTools(ctx);
  const gatewayTools = createGatewayTools(ctx);
  // Stability-first default: keep plugin-hosted remote MCPs disabled unless explicitly enabled
  // by setting disabled_mcps in config (remove entries you want to use).
  const defaultDisabledMcps: string[] = [];
  const disabledMcps = config.disabled_mcps ?? defaultDisabledMcps;
  const mcps = createBuiltinMcps(disabledMcps);

  // Initialize TmuxSessionManager to handle OpenCode's built-in Task tool sessions
  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig);

  // Initialize loop guard hook for hard iteration limits and strict mode.
  const loopGuardHook = createLoopGuardHook(ctx.directory);

  // Initialize phase reminder hook for workflow compliance
  const phaseReminderHook = createPhaseReminderHook();

  // Bridge typed slash commands (eg. /miya-gateway-start) in case they are sent as plain prompts.
  const slashCommandBridgeHook = createSlashCommandBridgeHook();

  // Initialize post-read nudge hook
  const postReadNudgeHook = createPostReadNudgeHook();

  const onPermissionAsked = async (
    input: {
      sessionID?: string;
      type?: string;
      pattern?: string[] | string;
      metadata?: unknown;
      messageID?: string;
      callID?: string;
    },
    output: { status?: 'allow' | 'ask' | 'deny' },
  ) => {
    const intakeGate = shouldInterceptWriteAfterWebsearch(ctx.directory, {
      sessionID: String(input.sessionID ?? 'main'),
      permission: String(input.type ?? ''),
    });
    if (intakeGate.intercept) {
      output.status = 'ask';
      return;
    }

    const patterns = Array.isArray(input.pattern)
      ? input.pattern.map(String)
      : typeof input.pattern === 'string'
        ? [String(input.pattern)]
        : [];
    const status = await handlePermissionAsk(ctx.directory, {
      sessionID: String(input.sessionID ?? 'main'),
      permission: String(input.type ?? ''),
      patterns,
      metadata:
        input.metadata && typeof input.metadata === 'object'
          ? (input.metadata as Record<string, unknown>)
          : {},
      messageID: input.messageID ? String(input.messageID) : undefined,
      toolCallID: input.callID ? String(input.callID) : undefined,
    });
    output.status = status.status;
  };

  return {
    name: 'miya',

    agent: agents,

    tool: {
      ...backgroundTools,
      ...automationTools,
      ...workflowTools,
      ...autopilotTools,
      ...ralphTools,
      ...nodeTools,
      ...multimodalTools,
      ...soulTools,
      ...ultraworkTools,
      ...routerTools,
      ...mcpTools,
      ...safetyTools,
      ...configTools,
      ...intakeTools,
      ...gatewayTools,
      lsp_goto_definition,
      lsp_find_references,
      lsp_diagnostics,
      lsp_rename,
      grep,
      ast_grep_search,
      ast_grep_replace,
    },

    mcp: mcps,

    config: async (opencodeConfig: Record<string, unknown>) => {
      const persistedRuntime = readPersistedAgentRuntime(ctx.directory);
      (opencodeConfig as { default_agent?: string }).default_agent =
        persistedRuntime.activeAgentId ?? '1-task-manager';

      // Register Miya control-plane commands in the command palette.
      const commandConfig = (opencodeConfig.command ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      opencodeConfig.command = commandConfig;

      if (!commandConfig.miya) {
        commandConfig.miya = {
          description: 'Open Miya control plane panel',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_status_panel` exactly once. Return only the tool output verbatim. If tool invocation fails, return the exact error text only.',
        };
      }

      if (!commandConfig['miya-schedule']) {
        commandConfig['miya-schedule'] = {
          description: 'Create daily schedule from natural language',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_schedule_from_text` with request="$ARGUMENTS". Return only tool output.',
        };
      }

      if (!commandConfig['miya-jobs']) {
        commandConfig['miya-jobs'] = {
          description: 'List Miya jobs',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_list_jobs` once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-approvals']) {
        commandConfig['miya-approvals'] = {
          description: 'List pending Miya approvals',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_list_approvals` once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-history']) {
        commandConfig['miya-history'] = {
          description: 'Show recent Miya automation history',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_job_history` with limit=20. Return only tool output.',
        };
      }

      if (!commandConfig['miya-safety']) {
        commandConfig['miya-safety'] = {
          description: 'Show Miya safety status (kill-switch and approvals)',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_kill_status` once. Then summarize latest `miya_status_panel` in 5 lines max.',
        };
      }

      commandConfig['miya-gateway-start'] = {
        description: 'Start Miya Gateway and print runtime URL',
        agent: '1-task-manager',
        template:
          'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text only.',
      };

      if (!commandConfig['miya-gateway-shutdown']) {
        commandConfig['miya-gateway-shutdown'] = {
          description: 'Stop Miya Gateway runtime',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_shutdown` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-ui-open']) {
        commandConfig['miya-ui-open'] = {
          description: 'Open Miya web control console in default browser',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_ui_open` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-config-get']) {
        commandConfig['miya-config-get'] = {
          description: 'Read Miya config key',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_config_get` with key="$ARGUMENTS". Return only tool output.',
        };
      }

      if (!commandConfig['miya-config-validate']) {
        commandConfig['miya-config-validate'] = {
          description: 'Validate Miya config patch JSON',
          agent: '1-task-manager',
          template:
            'MANDATORY: Parse $ARGUMENTS as JSON patch payload, then call tool `miya_config_validate`. Return only tool output.',
        };
      }

      if (!commandConfig['miya-intake']) {
        commandConfig['miya-intake'] = {
          description: 'List intake gate pending/allow/deny records',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_intake_list` with target="all". Return only tool output.',
        };
      }

      if (!commandConfig['miya-intake-pending']) {
        commandConfig['miya-intake-pending'] = {
          description: 'List pending intake proposals',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_intake_list` with target="pending". Return only tool output.',
        };
      }

      // Aliases for users/IMEs that prefer underscore or dot command styles.
      if (!commandConfig.miya_gateway_start) {
        commandConfig.miya_gateway_start = { ...commandConfig['miya-gateway-start'] };
      }
      if (!commandConfig.miya_gateway_shutdown) {
        commandConfig.miya_gateway_shutdown = {
          ...commandConfig['miya-gateway-shutdown'],
        };
      }
      if (!commandConfig['miya.gateway.start']) {
        commandConfig['miya.gateway.start'] = {
          description: 'Alias of miya-gateway-start',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text only.',
        };
      }
      if (!commandConfig['miya.gateway.shutdown']) {
        commandConfig['miya.gateway.shutdown'] = {
          description: 'Alias of miya-gateway-shutdown',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_shutdown` exactly once. Return only tool output.',
        };
      }

      // Merge Agent configs
      opencodeConfig.agent = mergePluginAgentConfigs(
        opencodeConfig.agent as Record<string, unknown> | undefined,
        agents as Record<string, Record<string, unknown>>,
      );
      const configAgent = opencodeConfig.agent as Record<string, unknown>;

      // Merge provider configs with runtime overrides (active-agent provider has highest priority).
      const existingProvider = isPlainObject(opencodeConfig.provider)
        ? (opencodeConfig.provider as Record<string, unknown>)
        : {};
      const pluginProvider = isPlainObject(config.provider)
        ? (config.provider as Record<string, unknown>)
        : {};
      opencodeConfig.provider = deepMergeObject(existingProvider, pluginProvider);

      // Merge MCP configs
      const configMcp = opencodeConfig.mcp as
        | Record<string, unknown>
        | undefined;
      if (!configMcp) {
        opencodeConfig.mcp = { ...mcps };
      } else {
        Object.assign(configMcp, mcps);
      }

      // Get all MCP names from our config
      const allMcpNames = Object.keys(mcps);

      // For each agent, create permission rules based on their mcps list
      for (const [agentName, agentConfig] of Object.entries(agents)) {
        const agentMcps = (agentConfig as { mcps?: string[] })?.mcps;
        if (!agentMcps) continue;

        // Get or create agent permission config
        if (!configAgent[agentName]) {
          configAgent[agentName] = { ...agentConfig };
        }
        const agentConfigEntry = configAgent[agentName] as Record<
          string,
          unknown
        >;
        const agentPermission = (agentConfigEntry.permission ?? {}) as Record<
          string,
          unknown
        >;

        // Parse mcps list with wildcard and exclusion support
        const allowedMcps = parseList(agentMcps, allMcpNames);

        // Create permission rules for each MCP
        // MCP tools are named as <server>_<tool>, so we use <server>_*
        for (const mcpName of allMcpNames) {
          const sanitizedMcpName = mcpName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const permissionKey = `${sanitizedMcpName}_*`;
          const action = allowedMcps.includes(mcpName) ? 'allow' : 'deny';

          // Only set if not already defined by user
          if (!(permissionKey in agentPermission)) {
            agentPermission[permissionKey] = action;
          }
        }

        // Update agent config with permissions
        agentConfigEntry.permission = agentPermission;
      }
    },

    event: async (input) => {
      // Handle model/runtime persistence from message, agent switch, and settings-save events.
      const selections = extractAgentModelSelectionsFromEvent(input.event);
      for (const modelSelection of selections) {
        const changed = persistAgentRuntimeSelection(ctx.directory, {
          agentName: modelSelection.agentName,
          model: modelSelection.model,
          variant: modelSelection.variant,
          providerID: modelSelection.providerID,
          options: modelSelection.options,
          apiKey: modelSelection.apiKey,
          baseURL: modelSelection.baseURL,
          activeAgentId: modelSelection.activeAgentId,
        });
        if (changed) {
          log(`[model-persistence] updated from ${modelSelection.source}`, {
            agent: modelSelection.agentName,
            model: modelSelection.model,
          });
          const optionKeys =
            modelSelection.options &&
            typeof modelSelection.options === 'object' &&
            !Array.isArray(modelSelection.options)
              ? Object.keys(modelSelection.options as Record<string, unknown>)
              : [];
          if (
            optionKeys.length > 0 ||
            (typeof modelSelection.providerID === 'string' &&
              modelSelection.providerID.trim().length > 0) ||
            (typeof modelSelection.apiKey === 'string' &&
              modelSelection.apiKey.trim().length > 0) ||
            (typeof modelSelection.baseURL === 'string' &&
              modelSelection.baseURL.trim().length > 0)
          ) {
            appendProviderOverrideAudit(ctx.directory, {
              source: modelSelection.source,
              agentName: modelSelection.agentName,
              model: modelSelection.model,
              providerID: modelSelection.providerID,
              activeAgentId: modelSelection.activeAgentId,
              hasApiKey:
                typeof modelSelection.apiKey === 'string' &&
                modelSelection.apiKey.trim().length > 0,
              hasBaseURL:
                typeof modelSelection.baseURL === 'string' &&
                modelSelection.baseURL.trim().length > 0,
              optionKeys,
            });
          }
        }
      }

      // Handle tmux pane spawning for OpenCode's Task tool sessions
      await tmuxSessionManager.onSessionCreated(
        input.event as {
          type: string;
          properties?: {
            info?: { id?: string; parentID?: string; title?: string };
          };
        },
      );

      // Handle session.status events for:
      // 1. BackgroundTaskManager: completion detection
      // 2. TmuxSessionManager: pane cleanup
      await backgroundManager.handleSessionStatus(
        input.event as {
          type: string;
          properties?: { sessionID?: string; status?: { type: string } };
        },
      );
      await tmuxSessionManager.onSessionStatus(
        input.event as {
          type: string;
          properties?: { sessionID?: string; status?: { type: string } };
        },
      );

      // Drive scheduler ticks from plugin lifecycle events as backup to timer.
      // Use fire-and-forget to avoid delaying session event processing.
      void automationService.tick();
    },

    // Inject loop guard + phase reminder before sending to API.
    'experimental.chat.messages.transform': async (input, output) => {
      await slashCommandBridgeHook['experimental.chat.messages.transform'](
        input,
        output,
      );
      await loopGuardHook['experimental.chat.messages.transform'](input, output);
      await phaseReminderHook['experimental.chat.messages.transform'](input, output);
    },

    // Nudge after file reads to encourage delegation + track websearch usage for intake gate
    'tool.execute.after': async (input, output) => {
      await postReadNudgeHook['tool.execute.after'](input, output);
      trackWebsearchToolOutput(
        typeof input.sessionID === 'string' ? input.sessionID : 'main',
        String(input.tool ?? ''),
        String(output.output ?? ''),
      );
    },

    // Current OpenCode event key.
    'permission.asked': onPermissionAsked,

    // Backward compatibility for older runtimes.
    'permission.ask': onPermissionAsked,
  };
};

export default MiyaPlugin;

export type {
  AgentName,
  AgentOverrideConfig,
  McpName,
  PluginConfig,
  TmuxConfig,
  TmuxLayout,
} from './config';
export type { RemoteMcpConfig } from './mcp';
