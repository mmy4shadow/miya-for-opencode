# Miya Project Rules

## Scope
- Working directory: `G:\pythonG\py\yun\.opencode`
- Remote repository: `https://github.com/mmy4shadow/miya-for-opencode.git`

## Required Workflow
1. Every code/config modification must be persisted to GitHub automatically.
2. Auto-save is implemented by the project hook plugin at `plugin/auto-git-push.ts`.
3. The hook stages touched files plus tracked updates only (prevents accidental full-repo add).
4. If auto push fails, report the error clearly and provide a reproducible recovery command.
5. Project rule: all modifications must be limited to Miya plugin files (primarily `miya-src/**`) unless explicitly requested otherwise.

## Runtime Verification
- Check resolved config: `opencode debug config`
- Check loaded skills: `opencode debug skill`
- Check global paths: `opencode debug paths`
