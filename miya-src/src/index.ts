import type { Plugin } from '@opencode-ai/plugin';
import { getAgentConfigs } from './agents';
import { MiyaAutomationService } from './automation';
import { BackgroundTaskManager, TmuxSessionManager } from './background';
import { loadPluginConfig, type TmuxConfig } from './config';
import {
  extractAgentModelSelectionsFromEvent,
  persistAgentRuntimeSelection,
} from './config/agent-model-persistence';
import { parseList } from './config/agent-mcps';
import {
  createGatewayTools,
  isGatewayOwner,
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
  getMiyaDaemonService,
} from './daemon';
import {
  createLoopGuardHook,
  createPhaseReminderHook,
  createPostReadNudgeHook,
  createSlashCommandBridgeHook,
} from './hooks';
import { createSafetyTools, handlePermissionAsk } from './safety';
import { createConfigTools } from './settings';
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
  const daemonService = getMiyaDaemonService(ctx.directory);
  startGatewayWithLog(ctx.directory);
  const gatewayOwner = isGatewayOwner(ctx.directory);
  if (gatewayOwner) {
    const daemonLaunch = ensureMiyaLauncher(ctx.directory);
    log('[miya-launcher] daemon bootstrap', daemonLaunch);
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
    daemonService.start();
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
      (opencodeConfig as { default_agent?: string }).default_agent =
        '1-task-manager';

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

    'permission.ask': async (input, output) => {
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
    },
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
