# Miya Dock (Windows)

Windows external dock sidebar for Miya Gateway console.

## What it does

- Opens Miya Gateway console (`.opencode/miya/gateway.json -> url`) in Edge App mode.
- Uses two layers:
  - Edge App window for real Gateway content.
  - AHK HotZone window (always-on-top + no-activate) for hover/click capture.
- Default collapsed width: `20px` (a thin interactive strip).
- Expanded width: `420px` (configurable in `miya-dock.ahk`).
- In expanded mode, HotZone only covers the right edge strip (`12px` by default) for quick collapse.
- Follows OpenCode move/resize every `70ms`.

## Requirements

1. Windows
2. Microsoft Edge installed
3. AutoHotkey v2 installed: https://www.autohotkey.com/
4. OpenCode running in this project with Miya plugin loaded

## Quick start

1. Start OpenCode in this project.
2. Double-click `tools/miya-dock/miya-launch.bat`.
3. Use `Ctrl+Alt+M` to collapse/expand.
4. In collapsed mode:
   - Click thin strip to expand.
   - Hover on strip for `hoverExpandDelay` (default `200ms`) to auto-expand.
5. In expanded mode:
   - Click right edge strip to collapse.
   - Moving mouse out of sidebar starts delayed auto-collapse (`collapseDelay`, default `900ms`).

## Controls

- `Ctrl + Alt + M`: collapse/expand
- Collapsed strip click: expand
- Collapsed strip hover (debounced): expand
- Expanded right edge strip click: collapse
- Auto collapse on leave (delayed, cancel if mouse returns)

## Config

Edit `tools/miya-dock/miya-dock.ahk` header:

- `collapsedW`, `expandedW`, `edgeStripW`
- `hoverExpandEnabled`, `hoverExpandDelay`
- `autoCollapseEnabled`, `collapseDelay`
- `dockGap`, `followIntervalMs`
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
