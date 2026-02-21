# E2E Acceptance Regression Guard

## Runbook

1. `npm --prefix miya-src run -s typecheck`
2. `npm --prefix miya-src run -s build`
3. `npm --prefix miya-src run -s test:integration:report`
4. `npm --prefix miya-src run -s test:ui`
5. `opencode debug config`
6. `opencode debug skill`
7. `opencode debug paths`

## Recurrence Points

### R1. Integration dependency ESM specifier mismatch

- Symptom: `Cannot find module .../@opencode-ai/plugin/dist/tool imported from .../@opencode-ai/plugin/dist/index.js` during integration run.
- Root cause: upstream dependency `@opencode-ai/plugin` uses extensionless export `export * from "./tool";`, and this environment fails to resolve it reliably under current Node/Vitest chain.
- Fixed in:
  - `miya-src/tools/run-integration-suite.ts`
- Guard:
  - Integration runner must patch `node_modules/@opencode-ai/plugin/dist/index.js` to `./tool.js` before launching vitest.
  - Keep integration execution on Node + Vitest only; no Bun runtime mixing.

### R2. Gateway stop path hard-fails without sqlite runtime

- Symptom: `stopGateway()` throws `sqlite_runtime_unavailable`.
- Root cause: stop path executed `maybeReflectOnSessionEnd` without runtime fallback.
- Fixed in:
  - `miya-src/src/gateway/index.ts`
- Guard:
  - Shutdown path must be best-effort; no hard dependency on sqlite.

### R3. Companion profile read path hard-fails without sqlite runtime

- Symptom: `gateway.status.get` fails due to memory fact derivation crash.
- Root cause: `deriveActiveMemoryFacts()` called vector/sqlite path without fallback.
- Fixed in:
  - `miya-src/src/companion/store.ts`
- Guard:
  - Profile read path must always return degraded empty memory facts instead of throwing.

### R4. Learning gate flow breaks when sqlite is unavailable

- Symptom: `companion.memory.add` fails in security interaction acceptance.
- Root cause: gateway memory method required sqlite-backed insert on the hot path.
- Fixed in:
  - `miya-src/src/gateway/methods/memory.ts`
- Guard:
  - On sqlite outage, return degraded candidate payload and keep control-plane flow alive.

### R5. UI suite recurring React `act(...)` warnings

- Symptom: `test:ui` and `test` pass, but stderr repeatedly reports `An update to BrowserRouter inside a test was not wrapped in act(...)`.
- Root cause: route-driven state updates in some UI tests are not fully wrapped/synchronized with React testing utilities.
- Fixed in:
  - Not fully fixed yet (tracked recurrence).
- Guard:
  - Keep this as non-blocking warning in acceptance, but do not treat as green quality baseline.
  - Future test refactor must eliminate these warnings and then promote to blocking quality gate.

# Strict Gate Regression Guard

- Gate command is frozen as `npm --prefix miya-src run -s test:strict`.
- Expected artifact: `miya-src/.opencode/miya/reports/strict-gate-latest.json`.
- Regression rule: if strict report `ok=false`, release readiness is automatically downgraded.
