# Miya Source Reorg Report

Date: 2026-02-20

## Scope

- Included:
  - `miya-src/src/**`
  - `miya-src/gateway-ui/src/**`
- Excluded:
  - `miya-src/dist/**`
  - `miya-src/test/**`
  - `miya-src/tools/**`
  - all non-`miya-src` repositories/directories

## Phase Progress

### Phase 0 (Baseline)

- Completed.
- Baseline captured in `miya-src/src/reorg/BASELINE.md`.

### Phase 1 (Gateway split)

Implemented file extraction from `miya-src/src/gateway/index.ts`:

- `miya-src/src/gateway/render/console.ts`
- `miya-src/src/gateway/render/webchat.ts`
- `miya-src/src/gateway/http-router.ts`
- `miya-src/src/gateway/ws-runtime.ts`
- `miya-src/src/gateway/state-files.ts`
- `miya-src/src/gateway/ownership-lock.ts`
- `miya-src/src/gateway/bootstrap.ts`
- `miya-src/src/gateway/methods/registry.ts`

Wiring status:

- `gateway/index.ts` now imports render/http/ws/state/ownership helpers from new modules.
- Duplicated in-file implementations were removed.
- Session method registration is now routed via `methods/registry.ts` (`registerCoreSessionMethods`).

Compatibility:

- Public exports from `gateway/index.ts` retained.
- RPC method names retained.
- `gateway/index.ts` remains primary façade/entrypoint.

### Phase 2 (Gateway UI split)

Added app-level composition modules:

- `miya-src/gateway-ui/src/app/AppProviders.tsx`
- `miya-src/gateway-ui/src/app/AppRoutes.tsx`
- `miya-src/gateway-ui/src/app/AppShell.tsx`
- `miya-src/gateway-ui/src/app/navigation.ts`

Wiring status:

- `App.tsx` now imports and uses `AppProviders` + `AppShell` + `AppRoutes`.
- Navigation types/constants/helpers moved to `app/navigation.ts`.
- `App.tsx` remains the default export façade.

### Phase 3 (Domain consolidation)

- Not fully completed in this pass.
- Existing `channel/channels` and `node/nodes` compatibility façades were preserved.
- No destructive move/delete performed.

## Path Mapping (old -> new)

- `gateway/index.ts::renderConsoleHtml` -> `gateway/render/console.ts::renderConsoleHtml`
- `gateway/index.ts::renderWebChatHtml` -> `gateway/render/webchat.ts::renderWebChatHtml`
- `gateway/index.ts::normalizeNodeHeaders|toNodeRequest|sendNodeResponse|reserveGatewayPort` -> `gateway/http-router.ts`
- `gateway/index.ts::normalizeWsInput` -> `gateway/ws-runtime.ts`
- `gateway/index.ts::gatewayFile|trustModeFile|psycheModeFile|learningGateFile|writeJsonAtomic|safeReadJsonObject` -> `gateway/state-files.ts`
- `gateway/index.ts::isProcessAlive` -> `gateway/ownership-lock.ts`
- `gateway/index.ts::formatGatewayStateWithRuntime` -> `gateway/bootstrap.ts`

## Archive / Duplicate Handling

- `_archive/` not introduced in this pass (no safe duplicate moves were finalized yet).
- Duplicate consolidation postponed to next phase to avoid coupling regressions.

## Next Recommended Split Points

- `miya-src/src/gateway/index.ts`
  - move owner-lock lifecycle to dedicated module
  - move HTTP route dispatcher (`routeGatewayHttpRequest`) to `http-router.ts`
  - move WS connection/session lifecycle to `ws-runtime.ts`
- `miya-src/gateway-ui/src/App.tsx`
  - extract page-route elements into per-route composition modules
  - extract state/reducer/action logic into `app/state/*`

## Verification Snapshot

- `npm run --cwd miya-src typecheck`: pass
- `npx vitest run --cwd miya-src/src gateway`: pass
- `npm run --cwd miya-src/gateway-ui test:run`: fail (same baseline failing suites)
  - `src/pages/TasksPage.test.tsx`
  - `src/pages/MemoryPage.test.tsx`
  - `src/App.behavior.test.tsx`
- Runtime diagnostics:
  - `opencode debug config`: pass
  - `opencode debug skill`: pass
  - `opencode debug paths`: pass
