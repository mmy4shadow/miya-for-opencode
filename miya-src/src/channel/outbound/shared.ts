import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { getMiyaVisionTempDir } from '../../model/paths';

export interface DesktopOutboundResult {
  sent: boolean;
  message: string;
  automationPath?: 'uia' | 'sendkeys' | 'mixed';
  uiaPath?: 'valuepattern' | 'clipboard_sendkeys' | 'none';
  targetHwnd?: string;
  foregroundBefore?: string;
  foregroundAfter?: string;
  fallbackReason?: string;
  simulationStatus?: 'captured' | 'not_available';
  simulationRiskHints?: string[];
  visualPrecheck?: string;
  visualPostcheck?: string;
  receiptStatus?: 'confirmed' | 'uncertain';
  failureStep?: string;
  payloadHash?: string;
  windowFingerprint?: string;
  recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
  preSendScreenshotPath?: string;
  postSendScreenshotPath?: string;
}

function safeValueFromSignal(signal: string, key: string): string | undefined {
  const matched = new RegExp(`${key}=([^|]*)`).exec(signal)?.[1];
  if (matched == null) return undefined;
  const text = matched.trim();
  return text.length > 0 ? text : undefined;
}

export function deriveDesktopFailureDetail(input: {
  signal: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  exitCode: number;
}): string {
  return (
    safeValueFromSignal(input.signal, 'error') ??
    (input.stderr.trim() || undefined) ??
    (input.stdout.trim() || undefined) ??
    (input.timedOut ? 'timeout' : `exit_${input.exitCode}`)
  );
}

function buildEvidenceDir(projectDir: string, channel: 'qq' | 'wechat'): string {
  const root = getMiyaVisionTempDir(projectDir, channel);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export async function sendDesktopOutbound(input: {
  projectDir: string;
  appName: 'QQ' | 'WeChat';
  channel: 'qq' | 'wechat';
  destination: string;
  text?: string;
  mediaPath?: string;
}): Promise<DesktopOutboundResult> {
  const destination = input.destination.trim();
  const text = (input.text ?? '').trim();
  const mediaPath = (input.mediaPath ?? '').trim();
  const payloadHash = createHash('sha256').update(`${text}||${mediaPath}`).digest('hex');
  const traceID = `desktop_${randomUUID()}`;
  const evidenceDir = buildEvidenceDir(input.projectDir, input.channel);

  if (process.platform !== 'win32') {
    return Promise.resolve({
      sent: false,
      message: 'desktop_ui_windows_only',
      automationPath: 'sendkeys',
      simulationStatus: 'not_available',
      simulationRiskHints: ['platform_not_supported'],
      receiptStatus: 'uncertain',
      failureStep: 'preflight.platform',
      payloadHash,
      recipientTextCheck: 'uncertain',
    });
  }
  if (process.env.MIYA_UI_AUTOMATION_ENABLED !== '1') {
    return Promise.resolve({
      sent: false,
      message: 'desktop_ui_disabled:set MIYA_UI_AUTOMATION_ENABLED=1',
      automationPath: 'sendkeys',
      simulationStatus: 'not_available',
      simulationRiskHints: ['desktop_ui_disabled'],
      receiptStatus: 'uncertain',
      failureStep: 'preflight.runtime_switch',
      payloadHash,
      recipientTextCheck: 'uncertain',
    });
  }

  if (!destination || (!text && !mediaPath)) {
    return Promise.resolve({
      sent: false,
      message: 'invalid_desktop_send_args',
      automationPath: 'sendkeys',
      simulationStatus: 'not_available',
      simulationRiskHints: ['invalid_arguments'],
      receiptStatus: 'uncertain',
      failureStep: 'preflight.args',
      payloadHash,
      recipientTextCheck: 'uncertain',
    });
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try { Add-Type -AssemblyName UIAutomationClient | Out-Null } catch {}
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiyaInputProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
public static class MiyaWinApi {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@

$destination = $env:MIYA_DESTINATION
$payload = $env:MIYA_MESSAGE
$mediaPath = $env:MIYA_MEDIA_PATH
$appName = $env:MIYA_APP_NAME
$payloadHash = $env:MIYA_PAYLOAD_HASH
$traceId = $env:MIYA_TRACE_ID
$evidenceDir = $env:MIYA_EVIDENCE_DIR
$shell = New-Object -ComObject WScript.Shell

$step = "bootstrap"
$precheck = "unavailable"
$postcheck = "unavailable"
$receipt = "uncertain"
$recipientCheck = "uncertain"
$preShot = ""
$postShot = ""
$windowFingerprint = ""
$automationPath = "sendkeys"
$uiaPath = "none"
$simulation = "not_available"
$targetHwndText = ""
$foregroundBeforeText = ""
$foregroundAfterText = ""
$fallbackReasons = New-Object System.Collections.Generic.List[string]
$riskHints = New-Object System.Collections.Generic.List[string]

function Safe-Token {
  param([string]$Value)
  if (-not $Value) { return "" }
  return $Value.Replace('|', '/').Replace([char]13, ' ').Replace([char]10, ' ').Trim()
}

function Get-Sha256Hex {
  param([string]$Value)
  if (-not $Value) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = $sha.ComputeHash($bytes)
    return ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Format-Hwnd {
  param([IntPtr]$Hwnd)
  if ($Hwnd -eq [IntPtr]::Zero) { return "0x0" }
  return ('0x{0:X}' -f [UInt64]$Hwnd.ToInt64())
}

function Save-Screenshot {
  param([string]$TargetPath)
  try {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
  } catch {}
}

function Get-CursorPoint {
  $point = New-Object MiyaInputProbe+POINT
  [void][MiyaInputProbe]::GetCursorPos([ref]$point)
  return @{ X = [int]$point.X; Y = [int]$point.Y }
}

function Test-KeyboardActivity {
  $keys = @(0x08,0x09,0x0D,0x10,0x11,0x12,0x1B,0x20,0x25,0x26,0x27,0x28,0x2E,0x5B,0x5C)
  foreach ($vk in $keys) {
    if (([MiyaInputProbe]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { return $true }
  }
  for ($vk = 0x30; $vk -le 0x5A; $vk++) {
    if (([MiyaInputProbe]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { return $true }
  }
  return $false
}

function Wait-UserInputIdle {
  param([int]$TimeoutMs = 1200, [int]$StableMs = 350, [int]$SampleMs = 60)
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  $idleSince = Get-Date
  $last = Get-CursorPoint
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds $SampleMs
    $curr = Get-CursorPoint
    $moved = ([Math]::Abs($curr.X - $last.X) + [Math]::Abs($curr.Y - $last.Y)) -gt 2
    $typing = Test-KeyboardActivity
    if ($moved -or $typing) {
      $idleSince = Get-Date
      $last = $curr
      continue
    }
    if (((Get-Date) - $idleSince).TotalMilliseconds -ge $StableMs) {
      return $curr
    }
    $last = $curr
  }
  throw "input_mutex_timeout:user_active"
}

function Assert-NoUserInterference {
  param($LockPoint)
  $curr = Get-CursorPoint
  $moved = ([Math]::Abs($curr.X - $LockPoint.X) + [Math]::Abs($curr.Y - $LockPoint.Y)) -gt 6
  if ($moved -or (Test-KeyboardActivity)) {
    throw "input_mutex_timeout:user_interference"
  }
}

function Get-WindowTitle {
  param([IntPtr]$Hwnd)
  if ($Hwnd -eq [IntPtr]::Zero) { return "" }
  $sb = New-Object System.Text.StringBuilder 1024
  [void][MiyaWinApi]::GetWindowText($Hwnd, $sb, $sb.Capacity)
  return Safe-Token($sb.ToString())
}

function Get-WindowClass {
  param([IntPtr]$Hwnd)
  if ($Hwnd -eq [IntPtr]::Zero) { return "" }
  $sb = New-Object System.Text.StringBuilder 512
  [void][MiyaWinApi]::GetClassName($Hwnd, $sb, $sb.Capacity)
  return Safe-Token($sb.ToString())
}

function Get-WindowProcessId {
  param([IntPtr]$Hwnd)
  $pid = [uint32]0
  [void][MiyaWinApi]::GetWindowThreadProcessId($Hwnd, [ref]$pid)
  return [int]$pid
}

function Build-WindowFingerprint {
  param([IntPtr]$Hwnd)
  if ($Hwnd -eq [IntPtr]::Zero) { return "" }
  $pid = Get-WindowProcessId -Hwnd $Hwnd
  $titleHash = (Get-Sha256Hex (Get-WindowTitle -Hwnd $Hwnd))
  if ($titleHash.Length -gt 12) { $titleHash = $titleHash.Substring(0, 12) }
  $classHash = (Get-Sha256Hex (Get-WindowClass -Hwnd $Hwnd))
  if ($classHash.Length -gt 12) { $classHash = $classHash.Substring(0, 12) }
  return ("pid=" + $pid + ";hwnd=" + (Format-Hwnd -Hwnd $Hwnd) + ";class=" + $classHash + ";title=" + $titleHash)
}

function Resolve-TargetWindow {
  param([string]$AppName, [string]$Destination)
  $windows = @(Get-Process -Name $AppName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 })
  if ($windows.Count -eq 0) {
    Start-Process -FilePath $AppName | Out-Null
    Start-Sleep -Milliseconds 1200
    $windows = @(Get-Process -Name $AppName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 })
  }
  if ($windows.Count -eq 0) { return $null }
  $selected = $null
  if ($Destination) {
    $selected = $windows | Where-Object { $_.MainWindowTitle -like ("*" + $Destination + "*") } | Select-Object -First 1
  }
  if (-not $selected) {
    $selected = $windows | Select-Object -First 1
  }
  if (-not $selected) { return $null }
  $hwnd = [IntPtr]$selected.MainWindowHandle
  return @{
    processId = [int]$selected.Id
    hwnd = $hwnd
    title = Safe-Token([string]$selected.MainWindowTitle)
    fingerprint = Build-WindowFingerprint -Hwnd $hwnd
  }
}

function Focus-WindowWinApi {
  param([IntPtr]$TargetHwnd, [string]$Destination, [string]$AppName)
  $before = [MiyaWinApi]::GetForegroundWindow()
  $targetPid = [uint32]0
  $targetThread = [MiyaWinApi]::GetWindowThreadProcessId($TargetHwnd, [ref]$targetPid)
  $selfThread = [MiyaWinApi]::GetCurrentThreadId()
  $fgPid = [uint32]0
  $fgThread = if ($before -ne [IntPtr]::Zero) { [MiyaWinApi]::GetWindowThreadProcessId($before, [ref]$fgPid) } else { [uint32]0 }
  $attachedSelf = $false
  $attachedForeground = $false
  [void][MiyaWinApi]::ShowWindow($TargetHwnd, 9)
  try {
    if ($targetThread -ne 0 -and $targetThread -ne $selfThread) {
      $attachedSelf = [MiyaWinApi]::AttachThreadInput($selfThread, $targetThread, $true)
    }
    if ($targetThread -ne 0 -and $fgThread -ne 0 -and $fgThread -ne $targetThread) {
      $attachedForeground = [MiyaWinApi]::AttachThreadInput($fgThread, $targetThread, $true)
    }
    [void][MiyaWinApi]::SetForegroundWindow($TargetHwnd)
    [void][MiyaWinApi]::BringWindowToTop($TargetHwnd)
    Start-Sleep -Milliseconds 120
  } finally {
    if ($attachedForeground) {
      [void][MiyaWinApi]::AttachThreadInput($fgThread, $targetThread, $false)
    }
    if ($attachedSelf) {
      [void][MiyaWinApi]::AttachThreadInput($selfThread, $targetThread, $false)
    }
  }
  $fallbackReason = ""
  $after = [MiyaWinApi]::GetForegroundWindow()
  if ($after -ne $TargetHwnd) {
    $fallbackReason = "winapi_foreground_mismatch"
    $activated = $false
    if ($Destination) {
      $activated = $shell.AppActivate($Destination)
    }
    if (-not $activated) {
      $activated = $shell.AppActivate($AppName)
      if (-not $activated) {
        $fallbackReason = "winapi_and_appactivate_failed"
      } else {
        $fallbackReason = "winapi_fallback_appactivate_app"
      }
    } else {
      $fallbackReason = "winapi_fallback_appactivate_destination"
    }
    Start-Sleep -Milliseconds 120
    $after = [MiyaWinApi]::GetForegroundWindow()
  }
  return @{
    ok = ($after -eq $TargetHwnd)
    before = $before
    after = $after
    fallbackReason = $fallbackReason
  }
}

function Assert-TargetStable {
  param(
    [string]$AppName,
    [string]$Destination,
    [IntPtr]$ExpectedHwnd,
    [string]$ExpectedFingerprint,
    [string]$Phase
  )
  $resolved = Resolve-TargetWindow -AppName $AppName -Destination $Destination
  if (-not $resolved) {
    throw ("window_not_found:" + $Phase)
  }
  if ($resolved.hwnd -ne $ExpectedHwnd) {
    throw ("hwnd_changed:" + $Phase)
  }
  if ($ExpectedFingerprint -and $resolved.fingerprint -ne $ExpectedFingerprint) {
    throw ("hwnd_fingerprint_mismatch:" + $Phase)
  }
  return $resolved
}

function Try-SendTextViaUia {
  param(
    [string]$Value,
    [int]$ExpectedProcessId,
    [IntPtr]$ExpectedHwnd
  )
  try {
    if ($ExpectedHwnd -ne [IntPtr]::Zero -and [MiyaWinApi]::GetForegroundWindow() -ne $ExpectedHwnd) {
      return $false
    }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $focused) { return $false }
    if ($ExpectedProcessId -gt 0 -and $focused.Current.ProcessId -ne $ExpectedProcessId) {
      return $false
    }
    $valuePattern = $focused.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if (-not $valuePattern) { return $false }
    if ($focused.Current.IsEnabled -ne $true) { return $false }
    $valuePattern.SetValue($Value)
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    return $true
  } catch {
    return $false
  }
}

try {
  if (-not (Test-Path -LiteralPath $evidenceDir)) {
    New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
  }
  $step = "bootstrap.process"
  $lockPoint = Wait-UserInputIdle

  $target = Resolve-TargetWindow -AppName $appName -Destination $destination
  if (-not $target) {
    throw ("window_not_found:" + $destination)
  }
  $targetHwnd = $target.hwnd
  $targetHwndText = Format-Hwnd -Hwnd $targetHwnd
  $windowFingerprint = $target.fingerprint

  $step = "precheck.focus_winapi"
  $focus = Focus-WindowWinApi -TargetHwnd $targetHwnd -Destination $destination -AppName $appName
  $foregroundBeforeText = Format-Hwnd -Hwnd $focus.before
  $foregroundAfterText = Format-Hwnd -Hwnd $focus.after
  if ($focus.fallbackReason) { $fallbackReasons.Add($focus.fallbackReason) }
  if (-not $focus.ok) {
    throw "window_focus_verify_failed"
  }
  $precheck = "window_activated"
  Assert-NoUserInterference -LockPoint $lockPoint
  $target = Assert-TargetStable -AppName $appName -Destination $destination -ExpectedHwnd $targetHwnd -ExpectedFingerprint $windowFingerprint -Phase "before_send"
  if ($target.title -like ("*" + $destination + "*")) {
    $recipientCheck = "matched"
  }

  $step = "precheck.capture"
  $preShot = Join-Path $evidenceDir ($traceId + "_pre.png")
  Save-Screenshot -TargetPath $preShot

  if ($env:MIYA_DESKTOP_UIA_FIRST -eq '0') {
    $riskHints.Add("uia_disabled_by_config")
  } else {
    try {
      $null = [System.Windows.Automation.AutomationElement]::FocusedElement
      $simulation = "captured"
    } catch {
      $simulation = "not_available"
      $riskHints.Add("uia_runtime_unavailable")
    }
  }

  if ($mediaPath) {
    Assert-NoUserInterference -LockPoint $lockPoint
    [void](Assert-TargetStable -AppName $appName -Destination $destination -ExpectedHwnd $targetHwnd -ExpectedFingerprint $windowFingerprint -Phase "media_prepare")
    $step = "send.media_prepare"
    if (-not (Test-Path -LiteralPath $mediaPath)) {
      throw ("media_not_found:" + $mediaPath)
    }
    $list = New-Object System.Collections.Specialized.StringCollection
    $list.Add($mediaPath) | Out-Null
    $data = New-Object System.Windows.Forms.DataObject
    $data.SetFileDropList($list)
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
    Start-Sleep -Milliseconds 220
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    $step = "send.media_commit"
    Start-Sleep -Milliseconds 220
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 220
    if ($automationPath -eq "uia") { $automationPath = "mixed" } else { $automationPath = "sendkeys" }
    if ($env:MIYA_DESKTOP_UIA_FIRST -ne '0') { $riskHints.Add("media_sendkeys_path") }
  }

  if ($payload) {
    Assert-NoUserInterference -LockPoint $lockPoint
    [void](Assert-TargetStable -AppName $appName -Destination $destination -ExpectedHwnd $targetHwnd -ExpectedFingerprint $windowFingerprint -Phase "text_prepare")
    $sentViaUia = $false
    if ($env:MIYA_DESKTOP_UIA_FIRST -ne '0') {
      $step = "send.text_prepare.uia"
      $sentViaUia = Try-SendTextViaUia -Value $payload -ExpectedProcessId $target.processId -ExpectedHwnd $targetHwnd
      if ($sentViaUia) {
        if ($automationPath -eq "sendkeys") { $automationPath = "uia" } else { $automationPath = "mixed" }
        $uiaPath = "valuepattern"
        $step = "send.text_commit.uia"
      } else {
        $fallbackReasons.Add("uia_valuepattern_unavailable")
      }
    }
    if (-not $sentViaUia) {
      $step = "send.text_prepare.clipboard"
      Set-Clipboard -Value $payload
      Start-Sleep -Milliseconds 180
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      $step = "send.text_commit.clipboard"
      Start-Sleep -Milliseconds 120
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      if ($automationPath -eq "uia") { $automationPath = "mixed" } else { $automationPath = "sendkeys" }
      $uiaPath = "clipboard_sendkeys"
    }
  }

  $step = "postcheck.verify_window"
  $foregroundNow = [MiyaWinApi]::GetForegroundWindow()
  if ($foregroundNow -ne $targetHwnd) {
    throw "foreground_drift_after_send"
  }
  $targetAfter = Assert-TargetStable -AppName $appName -Destination $destination -ExpectedHwnd $targetHwnd -ExpectedFingerprint $windowFingerprint -Phase "after_send"
  $windowFingerprint = $targetAfter.fingerprint
  $postcheck = "window_active_after_send"
  $receipt = "confirmed"
  $step = "postcheck.capture"
  $postShot = Join-Path $evidenceDir ($traceId + "_post.png")
  Save-Screenshot -TargetPath $postShot

  $fallbackReason = if ($fallbackReasons.Count -gt 0) { ($fallbackReasons -join ',') } else { "none" }
  Write-Output ("desktop_send_ok|step=" + $step + "|pre=" + $precheck + "|post=" + $postcheck + "|receipt=" + $receipt + "|recipient=" + $recipientCheck + "|window_fp=" + Safe-Token($windowFingerprint) + "|target_hwnd=" + $targetHwndText + "|foreground_before=" + $foregroundBeforeText + "|foreground_after=" + $foregroundAfterText + "|uia_path=" + $uiaPath + "|fallback_reason=" + Safe-Token($fallbackReason) + "|pre_shot=" + Safe-Token($preShot) + "|post_shot=" + Safe-Token($postShot) + "|payload=" + $payloadHash + "|automation=" + $automationPath + "|simulation=" + $simulation + "|risk=" + Safe-Token(($riskHints -join ',')))
  exit 0
} catch {
  $err = Safe-Token($_.Exception.Message)
  $fallbackReason = if ($fallbackReasons.Count -gt 0) { ($fallbackReasons -join ',') } else { "none" }
  Write-Output ("desktop_send_fail|step=" + $step + "|error=" + $err + "|pre=" + $precheck + "|post=" + $postcheck + "|receipt=" + $receipt + "|recipient=" + $recipientCheck + "|window_fp=" + Safe-Token($windowFingerprint) + "|target_hwnd=" + Safe-Token($targetHwndText) + "|foreground_before=" + Safe-Token($foregroundBeforeText) + "|foreground_after=" + Safe-Token($foregroundAfterText) + "|uia_path=" + Safe-Token($uiaPath) + "|fallback_reason=" + Safe-Token($fallbackReason) + "|pre_shot=" + Safe-Token($preShot) + "|post_shot=" + Safe-Token($postShot) + "|payload=" + $payloadHash + "|automation=" + $automationPath + "|simulation=" + $simulation + "|risk=" + Safe-Token(($riskHints -join ',')))
  exit 2
}
`.trim();

  const proc = Bun.spawn(
    ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: {
        ...process.env,
        MIYA_DESTINATION: destination,
        MIYA_MESSAGE: text,
        MIYA_MEDIA_PATH: mediaPath,
        MIYA_APP_NAME: input.appName,
        MIYA_PAYLOAD_HASH: payloadHash,
        MIYA_TRACE_ID: traceID,
        MIYA_EVIDENCE_DIR: evidenceDir,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill('SIGTERM');
    } catch {}
  }, 15_000);
  const exitCode = await proc.exited;
  clearTimeout(timeout);
  const stdout = (await new Response(proc.stdout).text()).trim();
  const stderr = (await new Response(proc.stderr).text()).trim();
  const signal = stdout || stderr;
  const precheck = safeValueFromSignal(signal, 'pre') ?? 'failed';
  const postcheck = safeValueFromSignal(signal, 'post') ?? 'failed';
  const receipt = safeValueFromSignal(signal, 'receipt') === 'confirmed' ? 'confirmed' : 'uncertain';
  const failureStep = safeValueFromSignal(signal, 'step') ?? 'send.unknown';
  const windowFingerprint = safeValueFromSignal(signal, 'window_fp');
  const targetHwnd = safeValueFromSignal(signal, 'target_hwnd');
  const foregroundBefore = safeValueFromSignal(signal, 'foreground_before');
  const foregroundAfter = safeValueFromSignal(signal, 'foreground_after');
  const uiaPathRaw = safeValueFromSignal(signal, 'uia_path');
  const uiaPath =
    uiaPathRaw === 'valuepattern' || uiaPathRaw === 'clipboard_sendkeys' || uiaPathRaw === 'none'
      ? uiaPathRaw
      : undefined;
  const fallbackReason = safeValueFromSignal(signal, 'fallback_reason');
  const recipientTextCheckRaw = safeValueFromSignal(signal, 'recipient');
  const recipientTextCheck =
    recipientTextCheckRaw === 'matched' || recipientTextCheckRaw === 'mismatch'
      ? recipientTextCheckRaw
      : 'uncertain';
  const preSendScreenshotPath = safeValueFromSignal(signal, 'pre_shot');
  const postSendScreenshotPath = safeValueFromSignal(signal, 'post_shot');
  const payloadFromSignal = safeValueFromSignal(signal, 'payload') ?? payloadHash;
  const automationRaw = safeValueFromSignal(signal, 'automation');
  const automationPath =
    automationRaw === 'uia' || automationRaw === 'mixed' || automationRaw === 'sendkeys'
      ? automationRaw
      : 'sendkeys';
  const simulationRaw = safeValueFromSignal(signal, 'simulation');
  const simulationStatus = simulationRaw === 'captured' ? 'captured' : 'not_available';
  const simulationRiskHints = (safeValueFromSignal(signal, 'risk') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (fallbackReason && fallbackReason !== 'none') {
    simulationRiskHints.push(`focus_fallback:${fallbackReason}`);
  }
  if (exitCode === 0 && stdout.includes('desktop_send_ok') && !timedOut) {
    return {
      sent: true,
      message: `${input.channel}_desktop_sent`,
      automationPath,
      uiaPath,
      targetHwnd,
      foregroundBefore,
      foregroundAfter,
      fallbackReason,
      simulationStatus,
      simulationRiskHints,
      visualPrecheck: precheck,
      visualPostcheck: postcheck,
      receiptStatus: receipt,
      payloadHash: payloadFromSignal,
      windowFingerprint,
      recipientTextCheck,
      preSendScreenshotPath,
      postSendScreenshotPath,
      failureStep,
    };
  }

  const detail = deriveDesktopFailureDetail({
    signal,
    stdout,
    stderr,
    timedOut,
    exitCode,
  });
  return {
    sent: false,
    message: `${input.channel}_desktop_send_failed:${detail}`,
    automationPath,
    uiaPath,
    targetHwnd,
    foregroundBefore,
    foregroundAfter,
    fallbackReason,
    simulationStatus,
    simulationRiskHints,
    visualPrecheck: precheck,
    visualPostcheck: postcheck,
    receiptStatus: receipt,
    failureStep,
    payloadHash: payloadFromSignal,
    windowFingerprint,
    recipientTextCheck,
    preSendScreenshotPath,
    postSendScreenshotPath,
  };
}
