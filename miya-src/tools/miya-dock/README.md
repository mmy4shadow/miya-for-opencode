# Miya Dock (Windows)

Windows external dock sidebar for Miya Gateway console.

## What it does

- Opens Miya Gateway console (`.opencode/miya/gateway.json -> url`) in Edge App mode.
- Uses two layers:
  - Edge App window for real Gateway content.
  - AHK HotZone window (always-on-top + no-activate) for hover/click capture.
- Default collapsed width: `10px` (thin strip).
- Expanded width: `420px` (configurable in `miya-dock.ahk`).
- In expanded mode, HotZone only covers a small collapse strip (`6px` by default).
- Dock follows OpenCode move/resize with a low-frequency poll and only repositions on geometry change.
- Default safety mode avoids covering OpenCode content (`allowOverlay = false`).

## Requirements

1. Windows
2. Microsoft Edge installed
3. AutoHotkey v2 (one of the two):
   - Installed in system: https://www.autohotkey.com/
   - Portable binary in repo, e.g. `./v2/AutoHotkey64.exe`
4. OpenCode running in this project with Miya plugin loaded

## Quick start

1. Start OpenCode in this project.
2. Double-click `tools/miya-dock/miya-launch.bat`.
3. Use `Ctrl+Alt+M` to collapse/expand.
4. In collapsed mode:
   - Click thin strip to expand.
   - Optional: enable hover expand in config (`hoverExpandEnabled = true`).
5. In expanded mode:
   - Click edge strip to collapse.
   - Optional: enable delayed auto-collapse in config (`autoCollapseEnabled = true`).

## Controls

- `Ctrl + Alt + M`: collapse/expand
- Collapsed strip click: expand
- Collapsed strip hover (optional, disabled by default)
- Expanded edge strip click: collapse
- Auto collapse on leave (optional, disabled by default)

## Config

Edit `tools/miya-dock/miya-dock.ahk` header:

- `collapsedW`, `expandedW`, `edgeStripW`
- `minExpandedVisibleW` (minimum free side space required in non-overlay mode)
- `hoverExpandEnabled`, `hoverExpandDelay`
- `autoCollapseEnabled`, `collapseDelay`, `collapseWhenInOpenCode`
- `dockGap`, `followIntervalMs`
- `preferredSide` (`left`/`right`)
- `allowOverlay` (`false` by default, avoids covering OpenCode)
- `allowCollapsedOverlay` (`true` by default, keeps collapsed strip visible even when OpenCode is maximized)
- `collapseStripOnOuterEdge` (default `true`, keeps collapse strip away from OpenCode edge)
- `keepTopmostWhenOpenCodeActive` (topmost only when OpenCode context is active)
- `stripWindowFrame` (off by default to avoid Chromium repaint glitches)
- `openCodeLostHideDelayMs` (delay before hiding dock when OpenCode detection is temporarily lost)
- `terminalTitleLooseMatch` (keep current bound terminal window even if tab title changes)
- `openCodeTitle` (primary matcher, default `OpenCode`)
- `openCodeExe` / `openCodeClass` (fallback matcher)
- `edgePath` (manual edge binary path)
- `edgeProfileDir` (default `tools/miya-dock/.edge-profile`)

## Files generated at runtime

- `tools/miya-dock/.edge-profile/` (Edge app profile/cache)
- `tools/miya-dock/miya-dock.pid`

These are excluded from git by repository `.gitignore`.

## Troubleshooting

1. OpenCode window not found
- Keep OpenCode title containing `OpenCode`, or set `OpenCodeExe` / `OpenCodeClass` in `miya-dock.ahk`.

2. `gateway.json` missing or URL unreachable
- In OpenCode run command: `/miya-gateway-start`
- Then re-run `miya-launch.bat`.
- Dock also shows tooltip `Gateway not running` when expanding and will try `opencode run --command "miya-gateway-start"` in background.

3. Edge path not found
- Install Edge, or set `EdgePath` in `miya-dock.ahk` to full `msedge.exe` path.

4. AutoHotkey not found
- Install AutoHotkey v2 and retry.

5. Dock cannot fully expand
- In default non-overlay mode, Dock refuses large expansion if no free side space.
- Recovery options:
  - Leave horizontal margin next to OpenCode (unmaximize or resize OpenCode).
  - Or set `allowOverlay := true` in `miya-dock.ahk` if you accept overlap behavior.
