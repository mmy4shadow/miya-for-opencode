# Miya OpenClaw Parity Plan

## Source Repositories

- `mock/refs/openclaw` (full control-plane baseline)
- `mock/refs/nanobot` (lightweight core capabilities)
- `mock/refs/openclaw-girl` (persona + voice + onboarding extensions)
- `mock/refs/clawra` (selfie/persona media extension)

## Parity Scope (Core First)

1. Session-centric control plane (list, route, inspect, archive, delete)
2. Agent routing and model override from a unified panel
3. Scheduling/approvals/history for local automation runtime
4. Tool invocation and loop control
5. Connectors (webhook/slack/telegram), voice, and browser control

## Current Round (Implemented)

- Added Miya session control APIs:
  - `GET /miya/sessions`
  - `POST /miya/sessions`
  - `PATCH /miya/sessions/:id`
  - `DELETE /miya/sessions/:id`
  - `GET /miya/sessions/:id/messages`
- Extended gateway turn routing:
  - `POST /miya/gateway/turn` now supports explicit `session_id`, `agent`, `model`
  - returns `404` for unknown session IDs
- Upgraded Miya web panel:
  - New `Sessions` tab in left control panel
  - Session list/search/create/rename/archive/delete
  - Recent message preview for selected session
  - Gateway tab now supports `session id / agent / model` inputs
- Fixed Miya TUI gateway panel data source:
  - replaced placeholder file reads with real SDK session/status data
  - agent list now comes from live local agent config
- Added session collaboration APIs (OpenClaw sessions_* aligned):
  - `POST /miya/sessions/:id/send`
  - `POST /miya/sessions/route`
  - `POST /miya/sessions/spawn`
  - `GET /miya/sessions/spawn/:id`
- Added Clawra profile/media/voice APIs:
  - `GET /miya/clawra/profile`
  - `PUT /miya/clawra/profile`
  - `POST /miya/clawra/selfie` (Grok Imagine via fal)
  - `POST /miya/clawra/voice/speak` (ElevenLabs TTS)
- Persona injection now applies on all major request paths:
  - `/miya/sessions/:id/send`
  - `/miya/sessions/route`
  - `/miya/gateway/turn`
  - `/miya/voice/ws`
- Browser control upgraded from event-only to real automation:
  - Playwright runtime per browser session
  - real `navigate` and UI actions (`click/type/scroll/hover/check/uncheck/select/screenshot/...`)
  - runtime console/pageerror/navigation events streamed via existing SSE
- Miya web panel now includes:
  - Session collaboration controls (send/route/spawn)
  - Clawra tab (profile/persona, selfie generation, ElevenLabs voice playback)
  - Browser session live/offline indicator + expanded action command list

## Next Steps (Recommended)

1. Add OpenClaw-style reply policy knobs (`timeout`, `REPLY_SKIP`, `ANNOUNCE_SKIP`) to `sessions/route` and `sessions/spawn` flows
2. Add browser snapshot/ref abstraction (OpenClaw-style `snapshot -> ref -> act` chain)
3. Add connector/channel templates (Discord/Telegram/Slack route presets)
4. Add onboarding wizard for Clawra profile setup (photo/voice/persona guided flow)
