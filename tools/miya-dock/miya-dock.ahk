#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
SetTitleMatchMode 2
DetectHiddenWindows False

; -----------------------------
; Miya Dock user-config section
; -----------------------------
global Config := Map(
  "collapsedW", 12,
  "expandedW", 420,
  "edgeStripW", 12,
  "hoverExpandEnabled", true,
  "hoverExpandDelay", 200,
  "autoCollapseEnabled", true,
  "collapseDelay", 900,
  "dockGap", 0,
  "followIntervalMs", 70,
  "transitionDebounceMs", 120,
  "openCodeWaitMs", 15000,
  "openCodeRetryMs", 150,
  "openCodeTitle", "OpenCode",
  "openCodeExe", "",
  "openCodeClass", "",
  "edgePath", "",
  "edgeProfileDir", A_ScriptDir "\.edge-profile"
)

global DockState := {
  state: "collapsed", ; collapsed | expanding | expanded | collapsing
  expanded: false,
  dockHwnd: 0,
  hotZoneGui: 0,
  hotZoneHwnd: 0,
  openCodeHwnd: 0,
  edgePid: 0,
  gatewayFile: "",
  gatewayUrl: "",
  hoverStartTime: 0,
  leaveStartTime: 0,
  lastTransitionTime: 0,
  lastGatewayWarnAt: 0,
  lastGatewayStartAttempt: 0,
  dockRect: {x: 0, y: 0, w: 0, h: 0},
  hotRect: {x: 0, y: 0, w: 0, h: 0},
  openCodeRect: {x: 0, y: 0, w: 0, h: 0}
}

DockState.gatewayFile := A_Args.Length >= 1 ? A_Args[1] : A_ScriptDir "\..\..\.opencode\miya\gateway.json"
DockState.gatewayUrl := ReadGatewayUrl(DockState.gatewayFile)
if (DockState.gatewayUrl = "") {
  MsgBox "Miya Dock: failed to read gateway URL from`n" DockState.gatewayFile "`n`nPlease start OpenCode + Miya first.", "Miya Dock", 48
  ExitApp 1
}

DockState.openCodeHwnd := WaitForOpenCodeWindow(Config["openCodeWaitMs"])
if !DockState.openCodeHwnd {
  MsgBox "Miya Dock: OpenCode window not found within " Config["openCodeWaitMs"] " ms.`nAdjust openCodeTitle/openCodeExe/openCodeClass in script header.", "Miya Dock", 48
  ExitApp 1
}

edgePath := ResolveEdgePath(Config["edgePath"])
if (edgePath = "") {
  MsgBox "Miya Dock: Microsoft Edge executable not found.`nInstall Edge or set Config.edgePath manually.", "Miya Dock", 48
  ExitApp 1
}

DirCreate Config["edgeProfileDir"]
runCmd := Format('"{1}" --app="{2}" --user-data-dir="{3}" --new-window --no-first-run --disable-session-crashed-bubble', edgePath, DockState.gatewayUrl, Config["edgeProfileDir"])
Run runCmd, A_ScriptDir, , &edgePid
DockState.edgePid := edgePid

if !WinWait("ahk_pid " edgePid, , 12) {
  MsgBox "Miya Dock: timed out waiting for Edge app window.", "Miya Dock", 48
  ExitApp 1
}

DockState.dockHwnd := WinExist("ahk_pid " edgePid)
if !DockState.dockHwnd {
  MsgBox "Miya Dock: failed to capture Edge app window handle.", "Miya Dock", 48
  ExitApp 1
}

PrepareDockWindow(DockState.dockHwnd)
CreateHotZone()
ApplyStateLayout()
SetTimer PollDockState, Config["followIntervalMs"]
OnExit CleanupDock

; Return focus to OpenCode after launching dock.
TryActivateOpenCode()
return

^!m::HandleToggleHotkey()

HandleToggleHotkey() {
  if (DockState.state = "expanded" || DockState.state = "expanding") {
    BeginCollapse("hotkey")
  } else {
    BeginExpand("hotkey")
  }
}

CreateHotZone() {
  global DockState
  hotGui := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x08000000", "MiyaHotZone") ; WS_EX_NOACTIVATE
  hotGui.MarginX := 0
  hotGui.MarginY := 0
  hotGui.BackColor := "202020"
  DockState.hotZoneGui := hotGui
  hotGui.Show("NA x0 y0 w1 h1")
  DockState.hotZoneHwnd := hotGui.Hwnd
  OnMessage(0x0201, HotZoneLButtonDown) ; WM_LBUTTONDOWN
  SafeWinSetTransparent(60, DockState.hotZoneHwnd)
}

HotZoneClicked(*) {
  if (DockState.state = "collapsed" || DockState.state = "collapsing") {
    BeginExpand("click")
  } else if (DockState.state = "expanded" || DockState.state = "expanding") {
    BeginCollapse("click")
  }
}

HotZoneLButtonDown(wParam, lParam, msg, hwnd) {
  if (hwnd != DockState.hotZoneHwnd) {
    return
  }
  HotZoneClicked()
}

PollDockState() {
  if !UpdateLayoutFromOpenCode() {
    return
  }

  MouseGetPos &mx, &my
  inDock := RectContains(DockState.dockRect, mx, my)
  inHot := RectContains(DockState.hotRect, mx, my)
  inOpenCode := RectContains(DockState.openCodeRect, mx, my)
  inSidebarArea := inDock || inHot
  now := A_TickCount

  if (DockState.state = "collapsed") {
    DockState.leaveStartTime := 0
    if (Config["hoverExpandEnabled"] && inHot) {
      if (DockState.hoverStartTime = 0) {
        DockState.hoverStartTime := now
      } else if ((now - DockState.hoverStartTime) >= Config["hoverExpandDelay"]) {
        BeginExpand("hover")
      }
    } else {
      DockState.hoverStartTime := 0
    }
    return
  }

  if (DockState.state = "expanded") {
    DockState.hoverStartTime := 0
    if !Config["autoCollapseEnabled"] {
      DockState.leaveStartTime := 0
      return
    }

    ; Delay collapse when moving out of sidebar, including to OpenCode area.
    if inSidebarArea {
      DockState.leaveStartTime := 0
      return
    }

    if (DockState.leaveStartTime = 0) {
      DockState.leaveStartTime := now
      return
    }

    if ((now - DockState.leaveStartTime) >= Config["collapseDelay"]) {
      BeginCollapse(inOpenCode ? "auto-openCode" : "auto")
    }
  }
}

UpdateLayoutFromOpenCode() {
  openCodeHwnd := FindOpenCodeWindow()
  if !openCodeHwnd {
    return false
  }
  DockState.openCodeHwnd := openCodeHwnd

  ox := 0, oy := 0, ow := 0, oh := 0
  try {
    WinGetPos &ox, &oy, &ow, &oh, "ahk_id " openCodeHwnd
  } catch {
    return false
  }
  if (ow <= 0 || oh <= 0) {
    return false
  }

  DockState.openCodeRect := {x: ox, y: oy, w: ow, h: oh}
  ApplyStateLayout()
  return true
}

ApplyStateLayout() {
  if !WindowExists(DockState.dockHwnd) || !WindowExists(DockState.hotZoneHwnd) {
    return
  }

  ox := DockState.openCodeRect.x
  oy := DockState.openCodeRect.y
  oh := DockState.openCodeRect.h
  if (oh <= 0) {
    return
  }

  dockW := DockState.expanded ? Config["expandedW"] : Config["collapsedW"]
  dockRight := ox - Config["dockGap"]
  dockX := dockRight - dockW
  dockY := oy
  DockState.dockRect := {x: dockX, y: dockY, w: dockW, h: oh}
  SetWindowPosNoActivate(DockState.dockHwnd, dockX, dockY, dockW, oh)

  if DockState.expanded {
    hotW := Max(1, Min(Config["edgeStripW"], dockW))
    hotX := dockRight - hotW
    SafeWinSetTransparent(40, DockState.hotZoneHwnd)
  } else {
    hotW := dockW
    hotX := dockX
    SafeWinSetTransparent(75, DockState.hotZoneHwnd)
  }
  DockState.hotRect := {x: hotX, y: dockY, w: hotW, h: oh}
  DockState.hotZoneGui.Show(Format("NA x{1} y{2} w{3} h{4}", hotX, dockY, hotW, oh))
  SetWindowPosNoActivate(DockState.hotZoneHwnd, hotX, dockY, hotW, oh)
}

BeginExpand(reason := "") {
  if !CanTransition() {
    return
  }
  DockState.state := "expanding"
  DockState.expanded := true
  DockState.hoverStartTime := 0
  DockState.leaveStartTime := 0
  ApplyStateLayout()
  DockState.state := "expanded"

  if !IsGatewayReachable(DockState.gatewayUrl) {
    ShowGatewayHint()
    TryStartGatewayCommand()
  }

  ; Keep typing focus in OpenCode after non-content interactions.
  TryActivateOpenCode()
}

BeginCollapse(reason := "") {
  if !CanTransition() {
    return
  }
  DockState.state := "collapsing"
  DockState.expanded := false
  DockState.hoverStartTime := 0
  DockState.leaveStartTime := 0
  ApplyStateLayout()
  DockState.state := "collapsed"

  ; Keep typing focus in OpenCode after strip/hotkey collapse.
  TryActivateOpenCode()
}

CanTransition() {
  now := A_TickCount
  if ((now - DockState.lastTransitionTime) < Config["transitionDebounceMs"]) {
    return false
  }
  DockState.lastTransitionTime := now
  return true
}

PrepareDockWindow(hwnd) {
  ; Remove frame/caption and keep window floating.
  WinSetStyle "-0xC00000", "ahk_id " hwnd ; WS_CAPTION
  WinSetStyle "-0x00040000", "ahk_id " hwnd ; WS_SIZEBOX
  WinSetExStyle "+0x00000080", "ahk_id " hwnd ; WS_EX_TOOLWINDOW
  WinSetAlwaysOnTop true, "ahk_id " hwnd
}

SetWindowPosNoActivate(hwnd, x, y, w, h) {
  if !WindowExists(hwnd) {
    return
  }
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

SafeWinSetTransparent(alpha, hwnd) {
  if !WindowExists(hwnd) {
    return
  }
  try WinSetTransparent alpha, "ahk_id " hwnd
}

WindowExists(hwnd) {
  return hwnd != 0 && DllCall("IsWindow", "ptr", hwnd, "int")
}

RectContains(rect, x, y) {
  if !IsObject(rect) {
    return false
  }
  return x >= rect.x && x < (rect.x + rect.w) && y >= rect.y && y < (rect.y + rect.h)
}

FindOpenCodeWindow() {
  hwnd := 0
  if (Config["openCodeTitle"] != "") {
    hwnd := WinExist(Config["openCodeTitle"])
    if (hwnd && IsWindowCandidate(hwnd)) {
      return hwnd
    }
  }
  if (Config["openCodeExe"] != "") {
    for byExeHwnd in WinGetList("ahk_exe " Config["openCodeExe"]) {
      if IsWindowCandidate(byExeHwnd) {
        return byExeHwnd
      }
    }
  }
  if (Config["openCodeClass"] != "") {
    for byClassHwnd in WinGetList("ahk_class " Config["openCodeClass"]) {
      if IsWindowCandidate(byClassHwnd) {
        return byClassHwnd
      }
    }
  }

  ; Fallbacks for common OpenCode host windows (Windows Terminal and native build).
  for byTitleHwnd in WinGetList("OpenCode") {
    if IsWindowCandidate(byTitleHwnd) {
      return byTitleHwnd
    }
  }

  candidateExes := ["opencode.exe", "OpenCode.exe", "WindowsTerminal.exe", "wt.exe"]
  for exeName in candidateExes {
    for byKnownExeHwnd in WinGetList("ahk_exe " exeName) {
      if !IsWindowCandidate(byKnownExeHwnd) {
        continue
      }
      title := ""
      try title := WinGetTitle("ahk_id " byKnownExeHwnd)
      ; For terminal hosts, only accept tabs/window that actually show OpenCode title.
      if ((exeName = "WindowsTerminal.exe" || exeName = "wt.exe")) {
        if InStr(title, "OpenCode") {
          return byKnownExeHwnd
        }
        continue
      }
      return byKnownExeHwnd
    }
  }

  for className in ["CASCADIA_HOSTING_WINDOW_CLASS"] {
    for byKnownClassHwnd in WinGetList("ahk_class " className) {
      if !IsWindowCandidate(byKnownClassHwnd) {
        continue
      }
      title := ""
      try title := WinGetTitle("ahk_id " byKnownClassHwnd)
      if InStr(title, "OpenCode") {
        return byKnownClassHwnd
      }
    }
  }

  return 0
}

WaitForOpenCodeWindow(timeoutMs) {
  deadline := A_TickCount + Max(200, timeoutMs)
  loop {
    hwnd := FindOpenCodeWindow()
    if hwnd {
      return hwnd
    }
    if (A_TickCount >= deadline) {
      return 0
    }
    Sleep Config["openCodeRetryMs"]
  }
}

IsWindowCandidate(hwnd) {
  if (hwnd = 0) {
    return false
  }
  if !DllCall("IsWindowVisible", "ptr", hwnd, "int") {
    return false
  }
  w := 0, h := 0
  try WinGetPos ,, &w, &h, "ahk_id " hwnd
  catch {
    return false
  }
  return (w >= 200 && h >= 120)
}

TryActivateOpenCode() {
  if !DockState.openCodeHwnd {
    return
  }
  try WinActivate "ahk_id " DockState.openCodeHwnd
}

ResolveEdgePath(configuredPath) {
  if (configuredPath != "" && FileExist(configuredPath)) {
    return configuredPath
  }

  candidates := []
  pf := EnvGet("ProgramFiles")
  pfx86 := EnvGet("ProgramFiles(x86)")
  localAppData := EnvGet("LocalAppData")
  if (pf != "") {
    candidates.Push(pf "\Microsoft\Edge\Application\msedge.exe")
  }
  if (pfx86 != "") {
    candidates.Push(pfx86 "\Microsoft\Edge\Application\msedge.exe")
  }
  if (localAppData != "") {
    candidates.Push(localAppData "\Microsoft\Edge\Application\msedge.exe")
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

IsGatewayReachable(url) {
  try {
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.SetTimeouts(500, 500, 800, 800)
    req.Open("GET", url, false)
    req.Send()
    status := req.Status
    ; Any HTTP response means server is up; treat >=500 as not healthy.
    return status >= 100 && status < 500
  } catch {
    return false
  }
}

ShowGatewayHint() {
  now := A_TickCount
  if ((now - DockState.lastGatewayWarnAt) < 3000) {
    return
  }
  DockState.lastGatewayWarnAt := now
  ToolTip "Gateway not running. Try /miya-gateway-start"
  SetTimer () => ToolTip(), -1800
}

TryStartGatewayCommand() {
  now := A_TickCount
  if ((now - DockState.lastGatewayStartAttempt) < 15000) {
    return
  }
  DockState.lastGatewayStartAttempt := now
  try {
    Run A_ComSpec ' /c opencode run --command "miya-gateway-start"', A_ScriptDir, "Hide"
  } catch {
    ; Fallback is tooltip instruction.
  }
}

CleanupDock(*) {
  if (DockState.hotZoneGui) {
    try DockState.hotZoneGui.Destroy()
  }
  if (DockState.edgePid != 0 && ProcessExist(DockState.edgePid)) {
    try ProcessClose DockState.edgePid
  }
}
