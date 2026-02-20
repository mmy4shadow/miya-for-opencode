# gateway/

## Responsibility
- `index.ts` remains the gateway façade and orchestration entry, exposing runtime startup/shutdown, RPC method registry, HTTP/WS serving, and tool wiring.
- Extracted support modules now hold low-level responsibilities:
  - `render/console.ts`, `render/webchat.ts`: built-in HTML renderers.
  - `http-router.ts`: Node HTTP request/response bridge and port reservation.
  - `ws-runtime.ts`: WebSocket raw payload normalization.
  - `state-files.ts`: gateway state/config file path + atomic JSON helpers.
  - `ownership-lock.ts`: process liveness utility for owner-lock logic.
  - `bootstrap.ts`: gateway status text formatting helpers.
  - `methods/registry.ts`: session-method registration façade.

## Compatibility
- Public API surface remains owned by `gateway/index.ts`.
- RPC method names and tool names are unchanged.
- Existing callers can continue importing from `gateway/index.ts` without path migration.
