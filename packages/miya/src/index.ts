import type { Plugin } from '@opencode-ai/plugin';
import { getAgentConfigs } from './agents';
import { MiyaAutomationService } from './automation';
import { BackgroundTaskManager, TmuxSessionManager } from './background';
import { loadPluginConfig, type TmuxConfig } from './config';
import { parseList } from './config/agent-mcps';
import { autoSaveToGithub } from './git/autosave';
import {
  createLoopGuardHook,
  createPhaseReminderHook,
  createPostReadNudgeHook,
} from './hooks';
import { getSessionState, setSessionState } from './workflow';
import { createBuiltinMcps } from './mcp';
import {
  ast_grep_replace,
  ast_grep_search,
  createAutomationTools,
  createBackgroundTools,
  createComputerTools,
  createVoiceRuntimeTools,
  grep,
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_rename,
  createWorkflowTools,
} from './tools';
import { startTmuxCheck } from './utils';
import { log } from './utils/logger';
import { LocalVoiceRuntimeManager } from './voice/runtime-manager';

const MiyaPlugin: Plugin = async (ctx) => {
  const config = loadPluginConfig(ctx.directory);
  const agents = getAgentConfigs(config);

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
  const automationService = new MiyaAutomationService(ctx.directory);
  automationService.start();
  const voiceRuntimeManager = new LocalVoiceRuntimeManager();

  const backgroundTools = createBackgroundTools(
    ctx,
    backgroundManager,
    tmuxConfig,
    config,
  );
  const automationTools = createAutomationTools(automationService);
  const voiceTools = createVoiceRuntimeTools();
  const computerTools = createComputerTools(ctx);
  const workflowTools = createWorkflowTools(ctx.directory);
  // Stability-first default: keep plugin-hosted remote MCPs disabled unless explicitly enabled
  // by setting disabled_mcps in config (remove entries you want to use).
  const defaultDisabledMcps = ['websearch', 'context7', 'grep_app'];
  const disabledMcps = config.disabled_mcps ?? defaultDisabledMcps;
  const mcps = createBuiltinMcps(disabledMcps);

  if (config.voice?.auto_start) {
    const providers = (config.voice.providers ?? ['coqui', 'rvc']).filter(
      (item): item is 'coqui' | 'rvc' => item === 'coqui' || item === 'rvc',
    );
    void voiceRuntimeManager.up(providers).catch((error) => {
      log('[voice-runtime] auto_start failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // Initialize TmuxSessionManager to handle OpenCode's built-in Task tool sessions
  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig);

  // Initialize loop guard hook for hard iteration limits and strict mode.
  const loopGuardHook = createLoopGuardHook(ctx.directory);

  // Initialize phase reminder hook for workflow compliance
  const phaseReminderHook = createPhaseReminderHook();

  // Initialize post-read nudge hook
  const postReadNudgeHook = createPostReadNudgeHook();

  const autoloop = async (event: unknown) => {
    if (!event || typeof event !== 'object') return;
    if (!('type' in event) || (event as { type?: unknown }).type !== 'session.status') return;
    const props = (event as { properties?: unknown }).properties;
    if (!props || typeof props !== 'object') return;
    const sessionID = (props as { sessionID?: unknown }).sessionID;
    const status = (props as { status?: unknown }).status;
    if (typeof sessionID !== 'string' || !status || typeof status !== 'object') return;
    if ((status as { type?: unknown }).type !== 'idle') return;

    const s = getSessionState(ctx.directory, sessionID);
    if (!s.loopEnabled) return;
    if (!s.autoContinue) return;
    if (!Array.isArray(s.lastMissing) || s.lastMissing.length === 0) return;
    const window = Math.max(0, s.iterationCompleted - s.windowStartIteration);
    if (window >= s.maxIterationsPerWindow) return;
    if (s.awaitingConfirmation) return;

    const same = s.autoContinueIteration === s.iterationCompleted;
    const last = Date.parse(s.autoContinueAt);
    if (same && Number.isFinite(last) && Date.now() - last < 60_000) return;

    s.autoContinueIteration = s.iterationCompleted;
    s.autoContinueAt = new Date().toISOString();
    setSessionState(ctx.directory, sessionID, s);

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: '1-task-manager',
        parts: [
          {
            type: 'text' as const,
            text: `[MIYA AUTOCONTINUE]\nContinue next cycle. Focus only on missing/unresolved from the latest checkpoint.\ncycle=${window + 1}/${s.maxIterationsPerWindow}\nmissing_count=${s.lastMissing.length}\nunresolved_count=${s.lastUnresolved.length}`,
          },
        ],
      },
    });
  };

  return {
    name: 'miya',

    agent: agents,

    tool: {
      ...backgroundTools,
      ...automationTools,
      ...voiceTools,
      ...computerTools,
      ...workflowTools,
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
          description: 'Show Miya self-approval mode status',
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

      if (!commandConfig['miya-voice-install']) {
        commandConfig['miya-voice-install'] = {
          description: 'Install embedded local voice runtime (coqui/rvc)',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_voice_install` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-voice-up']) {
        commandConfig['miya-voice-up'] = {
          description: 'Start local voice runtime servers',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_voice_up` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-voice-down']) {
        commandConfig['miya-voice-down'] = {
          description: 'Stop local voice runtime servers',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_voice_down` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-voice-status']) {
        commandConfig['miya-voice-status'] = {
          description: 'Show local voice runtime status',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_voice_status` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-voice-doctor']) {
        commandConfig['miya-voice-doctor'] = {
          description: 'Diagnose local voice runtime',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_voice_doctor` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-computer-open']) {
        commandConfig['miya-computer-open'] = {
          description: 'Open URL/file/app using system handler',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_computer_open` with target="$ARGUMENTS". Return only tool output.',
        };
      }

      if (!commandConfig['miya-computer-shell']) {
        commandConfig['miya-computer-shell'] = {
          description: 'Run guarded shell command in workspace',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_computer_shell` with command="$ARGUMENTS". Return only tool output.',
        };
      }

      if (!commandConfig['miya-self-heal']) {
        commandConfig['miya-self-heal'] = {
          description: 'Run Miya self-heal diagnostics',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_self_heal_doctor` with scope="all". Return only tool output.',
        };
      }

      // Merge Agent configs
      if (!opencodeConfig.agent) {
        opencodeConfig.agent = { ...agents };
      } else {
        Object.assign(opencodeConfig.agent, agents);
      }
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

      await autoloop(input.event);
      const event = input.event as {
        type?: string;
        properties?: { status?: { type?: string } };
      };
      if (
        event.type === 'session.status' &&
        event.properties?.status?.type === 'idle'
      ) {
        await autoSaveToGithub(ctx.directory, {
          remoteUrl: 'https://github.com/mmy4shadow/miya-for-opencode.git',
        });
      }

      // Avoid blocking session event processing with scheduler work.
      // Scheduler runs on its own timer in MiyaAutomationService.
    },

    // Inject loop guard + phase reminder before sending to API.
    'experimental.chat.messages.transform': async (input, output) => {
      await loopGuardHook['experimental.chat.messages.transform'](input, output);
      await phaseReminderHook['experimental.chat.messages.transform'](input, output);
    },

    // Nudge after file reads to encourage delegation
    'tool.execute.after': postReadNudgeHook['tool.execute.after'],
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
