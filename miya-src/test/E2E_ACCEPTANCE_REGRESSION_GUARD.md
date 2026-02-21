# E2E Acceptance Regression Guard

## Runbook

1. `npm --prefix miya-src run -s typecheck`
2. `npm --prefix miya-src run -s build`
3. `npm --prefix miya-src run -s test:integration:report`
4. `bun test miya-src/src/gateway/security-interaction.test.ts`
5. `opencode debug config`
6. `opencode debug skill`
7. `opencode debug paths`

## Recurrence Points

### R1. Integration runner/test framework mismatch

- Symptom: `ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'bun:'` in integration report.
- Root cause: `tsx --test` (Node runner) executed files importing `bun:test`.
- Fixed in:
  - `miya-src/package.json`
  - `miya-src/tools/run-integration-suite.ts`
- Guard:
  - Integration entry must use `bun test`.
  - Keep `src/integration/**/*.test.ts` using one test runtime only.

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
