# Miya Refactor Baseline

Date: 2026-02-20
Scope: `miya-src/src/**`, `miya-src/gateway-ui/src/**`

## Working Tree Baseline

`git status --short` before refactor already had local changes in:

- `miya-src/src/gateway/index.ts`
- `miya-src/gateway-ui/src/App.tsx`
- multiple companion/daemon/session files
- existing untracked `miya-src/src/gateway/methods/*` additions

This refactor proceeds on top of that dirty baseline (no reset/revert).

## Command Baseline

### `npm run --cwd miya-src typecheck`

- Exit: `0`
- Duration: `~2.1s`

### Core tests (equivalent to `test:core`)

- `npx vitest run --cwd miya-src/src --max-concurrency=1`
  - Exit: `0`
  - Duration: `~77.4s`
  - Result: `566 pass, 2 skip, 0 fail`
- `npx vitest run --cwd miya-src/test --max-concurrency=1`
  - Exit: `0`
  - Duration: `~4.9s`
  - Result: `17 pass, 0 fail`

### UI tests (equivalent target of `test:ui`)

- `npm run --cwd miya-src/gateway-ui test:run`
  - Exit: `1`
  - Duration: `~21.6s`
  - Baseline failures (pre-refactor gate):
    - `src/pages/TasksPage.test.tsx` (10 failed)
    - `src/pages/MemoryPage.test.tsx` (14 failed)
    - `src/App.behavior.test.tsx` (1 failed)
  - Key baseline error:
    - `TypeError: ... GatewayRpcClient ... is not a constructor` from `src/App.tsx`

## Known Flaky / Special Notes

- `src/daemon/service.test.ts` includes long-running cases (seconds-level variance).
- `src/channels/service*.test.ts` and some multimodal tests have higher runtime variance.
- Integration tests were skipped in baseline (`multimodal.runtime.integration.test.ts`).
