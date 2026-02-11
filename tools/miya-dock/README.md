# Miya Dock (Windows)

Windows external dock sidebar for Miya Gateway console.

## What it does

- Opens Miya Gateway console (`.opencode/miya/gateway.json -> url`) in Edge App mode.
- Creates a borderless always-on-top sidebar that sticks to the left edge of OpenCode.
- Default collapsed width: `20px`.
- Expanded width: `420px` (configurable in `miya-dock.ahk`).
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
4. You can also click on the dock window itself to toggle.

## Controls

- Toggle: `Ctrl + Alt + M`
- Toggle by click: click dock window

## Config

Edit `tools/miya-dock/miya-dock.ahk` header:

- `CollapsedWidth`
- `ExpandedWidth`
- `FollowIntervalMs`
- `OpenCodeTitle` (primary matcher, default `OpenCode`)
- `OpenCodeExe` / `OpenCodeClass` (fallback matcher)
- `EdgePath` (manual edge binary path)

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

3. Edge path not found
- Install Edge, or set `EdgePath` in `miya-dock.ahk` to full `msedge.exe` path.

4. AutoHotkey not found
- Install AutoHotkey v2 and retry.
