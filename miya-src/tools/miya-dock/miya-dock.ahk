#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
SetTitleMatchMode 2
DetectHiddenWindows False

; -----------------------------
; Miya Dock user-config section
; -----------------------------
global Config := Map(
  "collapsedW", 10,
  "expandedW", 420,
  "minExpandedVisibleW", 280,
  "edgeStripW", 6,
  "hoverExpandEnabled", false,
  "hoverExpandDelay", 260,
  "autoCollapseEnabled", false,
  "collapseDelay", 900,
  "collapseWhenInOpenCode", false,
  "dockGap", 0,
  "preferredSide", "left",
  "allowOverlay", false,
  "allowCollapsedOverlay", true,
  "collapseStripOnOuterEdge", true,
  "followIntervalMs", 120,
  "transitionDebounceMs", 160,
  "transitionSteps", 1,
  "transitionStepMs", 10,
  "keepTopmostWhenOpenCodeActive", true,
  "stripWindowFrame", false,
  "openCodeWaitMs", 15000,
  "openCodeRetryMs", 150,
  "openCodeLostHideDelayMs", 1800,
  "autoStartGatewayOnExpand", false,
  "terminalTitleLooseMatch", true,
  "openCodeTitle", "OpenCode",
  "openCodeExe", "",
  "openCodeClass", "",
  "edgePath", "",
  "edgeProfileDir", A_ScriptDir "\.edge-profile"
)

global DockState := {
  state: "collapsed", ; collapsed | expanding | expanded | collapsing
  expanded: false,
  dockSide: "",
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
  lastLayoutWarnAt: 0,
  windowsVisible: true,
  isTopmost: false,
  monitorRect: {left: 0, top: 0, right: 0, bottom: 0},
  dockRect: {x: 0, y: 0, w: 0, h: 0},
  hotRect: {x: 0, y: 0, w: 0, h: 0},
  openCodeRect: {x: 0, y: 0, w: 0, h: 0},
  lastDockRect: {x: -1, y: -1, w: -1, h: -1},
  lastHotRect: {x: -1, y: -1, w: -1, h: -1},
  openCodeMissSince: 0
}

defaultGatewayPrimary := A_ScriptDir "\..\..\.opencode\miya\gateway.json"
defaultGatewayAlternate := A_ScriptDir "\..\..\miya-src\.opencode\miya\gateway.json"
argGatewayFile := A_Args.Length >= 1 ? A_Args[1] : ""
if (argGatewayFile != "" && FileExist(argGatewayFile)) {
  DockState.gatewayFile := argGatewayFile
} else {
  DockState.gatewayFile := ResolveGatewayFile(defaultGatewayPrimary, defaultGatewayAlternate)
}
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
knownEdgeWindows := Map()
for existingHwnd in WinGetList("ahk_exe msedge.exe") {
  knownEdgeWindows[existingHwnd] := true
}

runCmd := Format('"{1}" --app="{2}" --force-dark-mode --disable-features=Translate,msEdgeTranslate,msEdgeAutoTranslate --user-data-dir="{3}" --new-window --no-first-run --disable-session-crashed-bubble', edgePath, DockState.gatewayUrl, Config["edgeProfileDir"])
Run runCmd, A_ScriptDir, , &edgePid
DockState.edgePid := edgePid

DockState.dockHwnd := WaitForDockWindow(edgePid, knownEdgeWindows, 12000)
if !DockState.dockHwnd {
  MsgBox "Miya Dock: failed to capture Edge app window handle.", "Miya Dock", 48
  ExitApp 1
}

PrepareDockWindow(DockState.dockHwnd)
CreateHotZone()
UpdateLayoutFromOpenCode()
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
    if (DockState.openCodeMissSince = 0) {
      DockState.openCodeMissSince := A_TickCount
      return
    }
    if ((A_TickCount - DockState.openCodeMissSince) >= Config["openCodeLostHideDelayMs"]) {
      SetDockVisibility(false)
      SetDockTopmost(false)
    }
    return
  }
  DockState.openCodeMissSince := 0
  SetDockVisibility(true)

  MouseGetPos &mx, &my
  inDock := RectContains(DockState.dockRect, mx, my)
  inHot := RectContains(DockState.hotRect, mx, my)
  inOpenCode := RectContains(DockState.openCodeRect, mx, my)
  inSidebarArea := inDock || inHot
  now := A_TickCount
  SyncDockTopmost(inSidebarArea)

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

    if (inSidebarArea || (!Config["collapseWhenInOpenCode"] && inOpenCode)) {
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

  minMax := 0
  try minMax := WinGetMinMax("ahk_id " openCodeHwnd)
  if (minMax = -1) {
    return false
  }

  ox := 0, oy := 0, ow := 0, oh := 0
  try {
    WinGetPos &ox, &oy, &ow, &oh, "ahk_id " openCodeHwnd
  } catch {
    return false
  }
  if (ow <= 0 || oh <= 0) {
    return false
  }

  nextRect := {x: ox, y: oy, w: ow, h: oh}
  if !RectEquals(DockState.openCodeRect, nextRect) {
    DockState.openCodeRect := nextRect
    ApplyStateLayout()
  }
  return true
}

ApplyStateLayout(overrideDockW := 0) {
  if !WindowExists(DockState.dockHwnd) || !WindowExists(DockState.hotZoneHwnd) {
    return
  }

  layout := BuildDockLayout(overrideDockW)
  if !layout.ok {
    return
  }

  DockState.dockSide := layout.side
  DockState.monitorRect := layout.monitorRect
  DockState.dockRect := {x: layout.dockX, y: layout.dockY, w: layout.dockW, h: layout.dockH}
  DockState.hotRect := {x: layout.hotX, y: layout.dockY, w: layout.hotW, h: layout.dockH}

  MoveDockIfNeeded(DockState.dockRect)
  MoveHotZoneIfNeeded(DockState.hotRect)

  if DockState.expanded {
    SafeWinSetTransparent(36, DockState.hotZoneHwnd)
  } else {
    SafeWinSetTransparent(70, DockState.hotZoneHwnd)
  }
}

BeginExpand(reason := "") {
  if !CanTransition() {
    return
  }
  if !CanExpandWithoutOverlay() {
    return
  }

  DockState.state := "expanding"
  DockState.expanded := true
  DockState.hoverStartTime := 0
  DockState.leaveStartTime := 0
  AnimateDockWidth(Config["collapsedW"], Config["expandedW"])
  ApplyStateLayout()
  DockState.state := "expanded"

  if !IsGatewayReachable(DockState.gatewayUrl) {
    ShowGatewayHint()
    if Config["autoStartGatewayOnExpand"] {
      TryStartGatewayCommand()
    }
  }
}

BeginCollapse(reason := "") {
  if !CanTransition() {
    return
  }
  DockState.state := "collapsing"
  DockState.expanded := true
  DockState.hoverStartTime := 0
  DockState.leaveStartTime := 0
  AnimateDockWidth(Config["expandedW"], Config["collapsedW"])
  DockState.expanded := false
  ApplyStateLayout()
  DockState.state := "collapsed"

  ; Keep typing focus in OpenCode when collapsing from strip/hotkey.
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

AnimateDockWidth(fromW, toW) {
  steps := Max(1, Config["transitionSteps"])
  if (fromW = toW) {
    return
  }
  if (steps <= 1) {
    ApplyStateLayout(toW)
    return
  }
  loop steps {
    t := A_Index / steps
    w := Round(fromW + ((toW - fromW) * t))
    ApplyStateLayout(w)
    Sleep Config["transitionStepMs"]
  }
}

PrepareDockWindow(hwnd) {
  ; Keep app window stable: style stripping is optional to avoid Chromium repaint glitches.
  if Config["stripWindowFrame"] {
    WinSetStyle "-0xC00000", "ahk_id " hwnd ; WS_CAPTION
    WinSetStyle "-0x00040000", "ahk_id " hwnd ; WS_SIZEBOX
  }
  WinSetExStyle "+0x00000080", "ahk_id " hwnd ; WS_EX_TOOLWINDOW
  WinSetAlwaysOnTop false, "ahk_id " hwnd
}

SetWindowPosNoActivate(hwnd, x, y, w, h) {
  if !WindowExists(hwnd) {
    return
  }
  static HWND_TOP := 0
  static SWP_NOACTIVATE := 0x0010
  static SWP_SHOWWINDOW := 0x0040
  DllCall(
    "SetWindowPos",
    "ptr", hwnd,
    "ptr", HWND_TOP,
    "int", x,
    "int", y,
    "int", w,
    "int", h,
    "uint", SWP_NOACTIVATE | SWP_SHOWWINDOW
  )
}

MoveDockIfNeeded(rect) {
  if RectEquals(DockState.lastDockRect, rect) {
    return
  }
  SetWindowPosNoActivate(DockState.dockHwnd, rect.x, rect.y, rect.w, rect.h)
  DockState.lastDockRect := {x: rect.x, y: rect.y, w: rect.w, h: rect.h}
}

MoveHotZoneIfNeeded(rect) {
  if RectEquals(DockState.lastHotRect, rect) {
    return
  }
  DockState.hotZoneGui.Show(Format("NA x{1} y{2} w{3} h{4}", rect.x, rect.y, rect.w, rect.h))
  SetWindowPosNoActivate(DockState.hotZoneHwnd, rect.x, rect.y, rect.w, rect.h)
  DockState.lastHotRect := {x: rect.x, y: rect.y, w: rect.w, h: rect.h}
}

SetDockVisibility(show) {
  if (DockState.windowsVisible = show) {
    return
  }
  DockState.windowsVisible := show
  if show {
    try WinShow "ahk_id " DockState.dockHwnd
    try WinShow "ahk_id " DockState.hotZoneHwnd
    ApplyStateLayout()
    return
  }
  try WinHide "ahk_id " DockState.dockHwnd
  try WinHide "ahk_id " DockState.hotZoneHwnd
}

SyncDockTopmost(inSidebarArea) {
  if !Config["keepTopmostWhenOpenCodeActive"] {
    SetDockTopmost(false)
    return
  }
  openCodeActive := DockState.openCodeHwnd && WinActive("ahk_id " DockState.openCodeHwnd)
  dockActive := DockState.dockHwnd && WinActive("ahk_id " DockState.dockHwnd)
  shouldTopmost := openCodeActive || dockActive || inSidebarArea
  SetDockTopmost(shouldTopmost)
}

SetDockTopmost(shouldTopmost) {
  if (DockState.isTopmost = shouldTopmost) {
    return
  }
  DockState.isTopmost := shouldTopmost
  try WinSetAlwaysOnTop shouldTopmost, "ahk_id " DockState.dockHwnd
  try WinSetAlwaysOnTop shouldTopmost, "ahk_id " DockState.hotZoneHwnd
}

CanExpandWithoutOverlay() {
  if Config["allowOverlay"] {
    return true
  }
  sideInfo := ResolveDockSide(Config["expandedW"])
  if !sideInfo.ok {
    return false
  }
  if (sideInfo.maxSpace >= Config["minExpandedVisibleW"]) {
    return true
  }
  ShowLayoutHint(sideInfo.maxSpace)
  return false
}

ShowLayoutHint(maxSpace) {
  now := A_TickCount
  if ((now - DockState.lastLayoutWarnAt) < 3500) {
    return
  }
  DockState.lastLayoutWarnAt := now
  msg := "Miya Dock: not enough side space (" maxSpace "px).`nLeave margin next to OpenCode or set Config.allowOverlay := true."
  ToolTip msg
  SetTimer () => ToolTip(), -2200
}

BuildDockLayout(overrideDockW := 0) {
  ox := DockState.openCodeRect.x
  oy := DockState.openCodeRect.y
  ow := DockState.openCodeRect.w
  oh := DockState.openCodeRect.h
  if (ow <= 0 || oh <= 0) {
    return {ok: false}
  }

  desiredW := overrideDockW > 0 ? overrideDockW : (DockState.expanded ? Config["expandedW"] : Config["collapsedW"])
  sideInfo := ResolveDockSide(desiredW)
  if !sideInfo.ok {
    return {ok: false}
  }
  side := sideInfo.side
  available := sideInfo.space
  monitorRect := sideInfo.monitorRect
  collapsedOverlayAllowed := (!DockState.expanded) && Config["allowCollapsedOverlay"]
  overlayAllowed := Config["allowOverlay"] || collapsedOverlayAllowed

  if overlayAllowed {
    dockW := desiredW
  } else {
    dockW := Min(desiredW, available)
  }
  dockW := Max(1, dockW)
  dockY := oy
  dockH := oh

  if (side = "left") {
    dockX := ox - Config["dockGap"] - dockW
    if overlayAllowed {
      dockX := Max(monitorRect.left, dockX)
    } else if (available = 0 && !DockState.expanded) {
      dockX := monitorRect.left
    }
  } else {
    dockX := ox + ow + Config["dockGap"]
    if overlayAllowed {
      dockX := Min(dockX, monitorRect.right - dockW)
    } else if (available = 0 && !DockState.expanded) {
      dockX := monitorRect.right - dockW
    }
  }

  if DockState.expanded {
    hotW := Max(1, Min(Config["edgeStripW"], dockW))
    if Config["collapseStripOnOuterEdge"] {
      hotX := (side = "left") ? dockX : (dockX + dockW - hotW)
    } else {
      hotX := (side = "left") ? (dockX + dockW - hotW) : dockX
    }
  } else {
    hotW := dockW
    hotX := dockX
  }

  return {
    ok: true,
    side: side,
    monitorRect: monitorRect,
    dockX: dockX,
    dockY: dockY,
    dockW: dockW,
    dockH: dockH,
    hotX: hotX,
    hotW: hotW,
    maxSpace: sideInfo.maxSpace
  }
}

ResolveDockSide(desiredW) {
  if !DockState.openCodeHwnd {
    return {ok: false}
  }
  monitorRect := GetMonitorWorkAreaForWindow(DockState.openCodeHwnd)
  if !IsObject(monitorRect) {
    return {ok: false}
  }

  ox := DockState.openCodeRect.x
  ow := DockState.openCodeRect.w
  leftSpace := Max(0, ox - monitorRect.left - Config["dockGap"])
  rightSpace := Max(0, monitorRect.right - (ox + ow) - Config["dockGap"])
  maxSpace := Max(leftSpace, rightSpace)

  preferred := StrLower(Config["preferredSide"])
  if (preferred != "right") {
    preferred := "left"
  }
  alt := (preferred = "left") ? "right" : "left"
  primarySpace := (preferred = "left") ? leftSpace : rightSpace
  altSpace := (alt = "left") ? leftSpace : rightSpace

  side := preferred
  space := primarySpace
  if (altSpace > space && (space < desiredW || space = 0)) {
    side := alt
    space := altSpace
  }

  return {
    ok: true,
    side: side,
    space: space,
    maxSpace: maxSpace,
    monitorRect: monitorRect
  }
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

RectEquals(a, b) {
  if !IsObject(a) || !IsObject(b) {
    return false
  }
  return a.x = b.x && a.y = b.y && a.w = b.w && a.h = b.h
}

FindOpenCodeWindow() {
  if IsOpenCodeWindowCandidate(DockState.openCodeHwnd) {
    return DockState.openCodeHwnd
  }

  activeHwnd := WinExist("A")
  if IsOpenCodeWindowCandidate(activeHwnd) {
    return activeHwnd
  }

  hwnd := 0
  if (Config["openCodeTitle"] != "") {
    for byTitle in WinGetList(Config["openCodeTitle"]) {
      if IsOpenCodeWindowCandidate(byTitle) {
        return byTitle
      }
    }
  }
  if (Config["openCodeExe"] != "") {
    for byExeHwnd in WinGetList("ahk_exe " Config["openCodeExe"]) {
      if IsOpenCodeWindowCandidate(byExeHwnd) {
        return byExeHwnd
      }
    }
  }
  if (Config["openCodeClass"] != "") {
    for byClassHwnd in WinGetList("ahk_class " Config["openCodeClass"]) {
      if IsOpenCodeWindowCandidate(byClassHwnd) {
        return byClassHwnd
      }
    }
  }

  ; Fallbacks for common OpenCode host windows (Windows Terminal and native build).
  for byTitleHwnd in WinGetList("OpenCode") {
    if IsOpenCodeWindowCandidate(byTitleHwnd) {
      return byTitleHwnd
    }
  }

  candidateExes := ["opencode.exe", "OpenCode.exe", "WindowsTerminal.exe", "wt.exe"]
  for exeName in candidateExes {
    for byKnownExeHwnd in WinGetList("ahk_exe " exeName) {
      if !IsOpenCodeWindowCandidate(byKnownExeHwnd) {
        continue
      }
      return byKnownExeHwnd
    }
  }

  hwnd := PickLargestOpenCodeWindow()
  if hwnd {
    return hwnd
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

WaitForDockWindow(edgePid, knownEdgeWindows, timeoutMs) {
  deadline := A_TickCount + Max(800, timeoutMs)
  loop {
    hwnd := FindDockWindow(edgePid, knownEdgeWindows)
    if hwnd {
      return hwnd
    }
    if (A_TickCount >= deadline) {
      return 0
    }
    Sleep 80
  }
}

FindDockWindow(edgePid, knownEdgeWindows) {
  hwnd := PickLargestDockWindow("ahk_pid " edgePid)
  if hwnd {
    return hwnd
  }

  for byExeHwnd in WinGetList("ahk_exe msedge.exe") {
    if knownEdgeWindows.Has(byExeHwnd) {
      continue
    }
    if IsDockWindowCandidate(byExeHwnd) {
      return byExeHwnd
    }
  }

  for byTitleHwnd in WinGetList("ahk_exe msedge.exe") {
    if !IsDockWindowCandidate(byTitleHwnd) {
      continue
    }
    title := ""
    try title := WinGetTitle("ahk_id " byTitleHwnd)
    if InStr(title, "Miya Gateway") || InStr(title, "Miya Dock") {
      return byTitleHwnd
    }
  }
  return 0
}

PickLargestOpenCodeWindow() {
  bestHwnd := 0
  bestArea := 0
  for hwnd in WinGetList() {
    if !IsOpenCodeWindowCandidate(hwnd) {
      continue
    }
    w := 0, h := 0
    try WinGetPos ,, &w, &h, "ahk_id " hwnd
    area := w * h
    if (area > bestArea) {
      bestArea := area
      bestHwnd := hwnd
    }
  }
  return bestHwnd
}

PickLargestDockWindow(winTitle) {
  bestHwnd := 0
  bestArea := 0
  for hwnd in WinGetList(winTitle) {
    if !IsDockWindowCandidate(hwnd) {
      continue
    }
    w := 0, h := 0
    try WinGetPos ,, &w, &h, "ahk_id " hwnd
    area := w * h
    if (area > bestArea) {
      bestArea := area
      bestHwnd := hwnd
    }
  }
  return bestHwnd
}

IsDockWindowCandidate(hwnd) {
  if !IsWindowCandidate(hwnd) {
    return false
  }
  className := ""
  try className := WinGetClass("ahk_id " hwnd)
  if (className != "" && !InStr(className, "Chrome_WidgetWin")) {
    return false
  }
  return true
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
  minMax := 0
  try minMax := WinGetMinMax("ahk_id " hwnd)
  if (minMax = -1) {
    return false
  }
  return (w >= 200 && h >= 120)
}

IsOpenCodeWindowCandidate(hwnd) {
  if !IsWindowCandidate(hwnd) {
    return false
  }

  title := ""
  try title := WinGetTitle("ahk_id " hwnd)
  hasOpenCodeTitle := InStr(title, "OpenCode")

  exe := ""
  try exe := StrLower(WinGetProcessName("ahk_id " hwnd))
  exe := NormalizeExeName(exe)

  if (exe = "msedge.exe") {
    return false
  }
  if (exe = "windowsterminal.exe" || exe = "wt.exe" || exe = "openconsole.exe") {
    if (Config["terminalTitleLooseMatch"] && DockState.openCodeHwnd = hwnd) {
      return true
    }
    if (Config["openCodeExe"] != "" && exe = NormalizeExeName(Config["openCodeExe"])) {
      return true
    }
    return hasOpenCodeTitle
  }
  if (exe = "opencode.exe") {
    return true
  }
  if (Config["openCodeExe"] != "" && exe = NormalizeExeName(Config["openCodeExe"])) {
    return true
  }
  return hasOpenCodeTitle
}

NormalizeExeName(rawExe) {
  if (rawExe = "") {
    return ""
  }
  if !InStr(rawExe, "\") && !InStr(rawExe, "/") {
    return StrLower(rawExe)
  }
  fileName := ""
  SplitPath rawExe, &fileName
  return StrLower(fileName)
}

TryActivateOpenCode() {
  if !DockState.openCodeHwnd {
    return
  }
  try WinActivate "ahk_id " DockState.openCodeHwnd
}

GetMonitorWorkAreaForWindow(hwnd) {
  static MONITOR_DEFAULTTONEAREST := 2
  hMonitor := DllCall("MonitorFromWindow", "ptr", hwnd, "uint", MONITOR_DEFAULTTONEAREST, "ptr")
  if !hMonitor {
    return GetPrimaryWorkArea()
  }

  mi := Buffer(40, 0)
  NumPut("uint", 40, mi, 0)
  ok := DllCall("GetMonitorInfoW", "ptr", hMonitor, "ptr", mi.Ptr, "int")
  if !ok {
    return GetPrimaryWorkArea()
  }

  left := NumGet(mi, 20, "int")
  top := NumGet(mi, 24, "int")
  right := NumGet(mi, 28, "int")
  bottom := NumGet(mi, 32, "int")
  return {left: left, top: top, right: right, bottom: bottom}
}

GetPrimaryWorkArea() {
  left := 0, top := 0, right := 0, bottom := 0
  try MonitorGetWorkArea(1, &left, &top, &right, &bottom)
  return {left: left, top: top, right: right, bottom: bottom}
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
  if RegExMatch(text, '"controlUrl"\s*:\s*"([^"]+)"', &mControl) {
    return NormalizeGatewayUiUrl(mControl[1])
  }
  if RegExMatch(text, '"url"\s*:\s*"([^"]+)"', &m) {
    return NormalizeGatewayUiUrl(m[1])
  }
  return ""
}

ResolveGatewayFile(primaryPath, alternatePath) {
  primaryExists := FileExist(primaryPath)
  alternateExists := FileExist(alternatePath)
  if (!primaryExists && !alternateExists) {
    return primaryPath
  }
  if (primaryExists && !alternateExists) {
    return primaryPath
  }
  if (!primaryExists && alternateExists) {
    return alternatePath
  }
  primaryMtime := FileGetTime(primaryPath, "M")
  alternateMtime := FileGetTime(alternatePath, "M")
  return (alternateMtime >= primaryMtime) ? alternatePath : primaryPath
}

NormalizeGatewayUiUrl(url) {
  clean := Trim(url)
  if (clean = "") {
    return ""
  }
  if RegExMatch(clean, "^https?://[^/]+/?$") {
    return RTrim(clean, "/") "/control"
  }
  return clean
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
  ToolTip "Gateway not running. Try node miya-src/dist/cli/index.js gateway start --force"
  SetTimer () => ToolTip(), -1800
}

TryStartGatewayCommand() {
  now := A_TickCount
  if ((now - DockState.lastGatewayStartAttempt) < 15000) {
    return
  }
  DockState.lastGatewayStartAttempt := now
  try {
    projectRoot := A_ScriptDir "\..\.."
    workspace := projectRoot "\miya-src"
    distCli := workspace "\dist\cli\index.js"
    srcCli := workspace "\src\cli\index.ts"
    if FileExist(distCli) {
      commandLine := ' /c set "MIYA_AUTO_UI_OPEN=0" && set "MIYA_DOCK_AUTO_LAUNCH=0" && node "' . distCli . '" gateway start --force'
      Run A_ComSpec commandLine, workspace, "Hide"
      return
    }
    if FileExist(srcCli) {
      commandLine := ' /c set "MIYA_AUTO_UI_OPEN=0" && set "MIYA_DOCK_AUTO_LAUNCH=0" && node --import tsx "' . srcCli . '" gateway start --force'
      Run A_ComSpec commandLine, workspace, "Hide"
      return
    }
  } catch {
    ; Fallback is tooltip instruction.
  }
}

CleanupDock(*) {
  if (DockState.hotZoneGui) {
    try DockState.hotZoneGui.Destroy()
  }
  SetDockTopmost(false)
  if (DockState.edgePid != 0 && ProcessExist(DockState.edgePid)) {
    try ProcessClose DockState.edgePid
  }
}
