#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
SetTitleMatchMode 2
DetectHiddenWindows False

; -----------------------------
; Miya Dock user-config section
; -----------------------------
global Config := Map(
  "CollapsedWidth", 20, ; default collapsed strip width (~0.5cm)
  "ExpandedWidth", 420, ; expanded dock width
  "FollowIntervalMs", 70, ; 50-100ms recommended
  "OpenCodeTitle", "OpenCode", ; primary title match
  "OpenCodeExe", "", ; fallback: e.g. opencode.exe
  "OpenCodeClass", "", ; fallback: window class
  "EdgePath", "", ; leave empty to auto-detect msedge
  "EdgeProfileDir", A_ScriptDir "\.edge-profile"
)

global DockState := {
  Expanded: false,
  DockHwnd: 0,
  OpenCodeHwnd: 0,
  EdgePid: 0,
  GatewayFile: "",
  GatewayUrl: ""
}

DockState.GatewayFile := A_Args.Length >= 1 ? A_Args[1] : A_ScriptDir "\..\..\.opencode\miya\gateway.json"
DockState.GatewayUrl := ReadGatewayUrl(DockState.GatewayFile)
if (DockState.GatewayUrl = "") {
  MsgBox "Miya Dock: failed to read gateway URL from`n" DockState.GatewayFile "`n`nPlease start OpenCode + Miya first.", "Miya Dock", 48
  ExitApp 1
}

DockState.OpenCodeHwnd := FindOpenCodeWindow()
if !DockState.OpenCodeHwnd {
  MsgBox "Miya Dock: OpenCode window not found.`nAdjust OpenCodeTitle/OpenCodeExe/OpenCodeClass in script header.", "Miya Dock", 48
  ExitApp 1
}

edgePath := ResolveEdgePath(Config["EdgePath"])
if (edgePath = "") {
  MsgBox "Miya Dock: Microsoft Edge executable not found.`nInstall Edge or set Config.EdgePath manually.", "Miya Dock", 48
  ExitApp 1
}

DirCreate Config["EdgeProfileDir"]
runCmd := Format('"{1}" --app="{2}" --user-data-dir="{3}" --new-window --no-first-run --disable-session-crashed-bubble', edgePath, DockState.GatewayUrl, Config["EdgeProfileDir"])
Run runCmd, A_ScriptDir, , &edgePid
DockState.EdgePid := edgePid

if !WinWait("ahk_pid " edgePid, , 12) {
  MsgBox "Miya Dock: timed out waiting for Edge app window.", "Miya Dock", 48
  ExitApp 1
}

DockState.DockHwnd := WinExist("ahk_pid " edgePid)
if !DockState.DockHwnd {
  MsgBox "Miya Dock: failed to capture Edge app window handle.", "Miya Dock", 48
  ExitApp 1
}

PrepareDockWindow(DockState.DockHwnd)
SyncDockPosition()
SetTimer SyncDockPosition, Config["FollowIntervalMs"]
OnExit CleanupDock

; Return focus to OpenCode after launching dock.
TryActivateOpenCode()
return

^!m::ToggleDock()
~LButton::HandleDockClick()

ToggleDock() {
  global DockState
  DockState.Expanded := !DockState.Expanded
  SyncDockPosition()
}

HandleDockClick() {
  global DockState
  if !DockState.DockHwnd {
    return
  }
  MouseGetPos , , &hoverHwnd
  if !hoverHwnd {
    return
  }
  hoverPid := 0
  try {
    hoverPid := WinGetPID("ahk_id " hoverHwnd)
  } catch {
    return
  }
  if (hoverPid != DockState.EdgePid) {
    return
  }
  ToggleDock()
}

SyncDockPosition() {
  global Config, DockState
  openCodeHwnd := FindOpenCodeWindow()
  if !openCodeHwnd {
    return
  }
  DockState.OpenCodeHwnd := openCodeHwnd

  ox := 0, oy := 0, ow := 0, oh := 0
  try {
    WinGetPos &ox, &oy, &ow, &oh, "ahk_id " openCodeHwnd
  } catch {
    return
  }
  if (ow <= 0 || oh <= 0) {
    return
  }

  dockW := DockState.Expanded ? Config["ExpandedWidth"] : Config["CollapsedWidth"]
  dockX := ox - dockW
  dockY := oy
  SetDockPosNoActivate(DockState.DockHwnd, dockX, dockY, dockW, oh)
}

PrepareDockWindow(hwnd) {
  ; Remove frame/caption and keep window floating.
  WinSetStyle "-0xC00000", "ahk_id " hwnd ; WS_CAPTION
  WinSetStyle "-0x00040000", "ahk_id " hwnd ; WS_SIZEBOX
  WinSetExStyle "+0x00000080", "ahk_id " hwnd ; WS_EX_TOOLWINDOW
  WinSetAlwaysOnTop true, "ahk_id " hwnd
}

SetDockPosNoActivate(hwnd, x, y, w, h) {
  static HWND_TOPMOST := -1
  static SWP_NOACTIVATE := 0x0010
  static SWP_SHOWWINDOW := 0x0040
  DllCall(
    "SetWindowPos",
    "ptr", hwnd,
    "ptr", HWND_TOPMOST,
    "int", x,
    "int", y,
    "int", w,
    "int", h,
    "uint", SWP_NOACTIVATE | SWP_SHOWWINDOW
  )
}

FindOpenCodeWindow() {
  global Config
  hwnd := WinExist(Config["OpenCodeTitle"])
  if hwnd {
    return hwnd
  }
  if (Config["OpenCodeExe"] != "") {
    hwnd := WinExist("ahk_exe " Config["OpenCodeExe"])
    if hwnd {
      return hwnd
    }
  }
  if (Config["OpenCodeClass"] != "") {
    hwnd := WinExist("ahk_class " Config["OpenCodeClass"])
    if hwnd {
      return hwnd
    }
  }
  return 0
}

TryActivateOpenCode() {
  global DockState
  if !DockState.OpenCodeHwnd {
    return
  }
  try WinActivate "ahk_id " DockState.OpenCodeHwnd
}

ResolveEdgePath(configuredPath) {
  if (configuredPath != "" && FileExist(configuredPath)) {
    return configuredPath
  }

  candidates := []
  pf := EnvGet("ProgramFiles")
  pfx86 := EnvGet("ProgramFiles(x86)")
  local := EnvGet("LocalAppData")
  if (pf != "") {
    candidates.Push(pf "\Microsoft\Edge\Application\msedge.exe")
  }
  if (pfx86 != "") {
    candidates.Push(pfx86 "\Microsoft\Edge\Application\msedge.exe")
  }
  if (local != "") {
    candidates.Push(local "\Microsoft\Edge\Application\msedge.exe")
  }
  for path in candidates {
    if FileExist(path) {
      return path
    }
  }
  return "msedge.exe"
}

ReadGatewayUrl(filePath) {
  if !FileExist(filePath) {
    return ""
  }
  text := FileRead(filePath, "UTF-8")
  if RegExMatch(text, '"url"\s*:\s*"([^"]+)"', &m) {
    return m[1]
  }
  return ""
}

CleanupDock(*) {
  global DockState
  if (DockState.EdgePid != 0 && ProcessExist(DockState.EdgePid)) {
    try ProcessClose DockState.EdgePid
  }
}
