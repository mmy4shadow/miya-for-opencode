import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';

export interface DesktopOutboundResult {
  sent: boolean;
  message: string;
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

function buildEvidenceDir(projectDir: string, channel: 'qq' | 'wechat'): string {
  const root = path.join(getMiyaRuntimeDir(projectDir), 'model', 'shi jue', 'lin shi', channel);
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
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MiyaInputProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
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

function Save-Screenshot {
  param([string]$TargetPath)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
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

try {
  if (-not (Test-Path -LiteralPath $evidenceDir)) {
    New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
  }

  $step = "bootstrap.process"
  $lockPoint = Wait-UserInputIdle
$proc = Get-Process -Name $appName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Start-Process -FilePath $appName | Out-Null
  Start-Sleep -Milliseconds 1200
}

$step = "precheck.activate_window"
$activated = $shell.AppActivate($destination)
if (-not $activated) {
  $activated = $shell.AppActivate($appName)
}
if (-not $activated) {
  throw "window_not_found:$destination"
}
$precheck = "window_activated"
Assert-NoUserInterference -LockPoint $lockPoint

$step = "precheck.capture"
$preShot = Join-Path $evidenceDir ($traceId + "_pre.png")
Save-Screenshot -TargetPath $preShot

$activeByDestination = $shell.AppActivate($destination)
if (-not $activeByDestination) {
  $activeByDestination = $false
}
$windowProc = Get-Process -Name $appName -ErrorAction SilentlyContinue | Select-Object -First 1
$windowTitle = ""
if ($windowProc -and $windowProc.MainWindowTitle) {
  $windowTitle = $windowProc.MainWindowTitle
}
$windowFingerprint = ($appName + ":" + [string]($windowProc.Id) + ":" + $windowTitle.Replace('|', '/'))
if ($windowTitle -like ("*" + $destination + "*")) {
  $recipientCheck = "matched"
} elseif ($activeByDestination) {
  $recipientCheck = "matched"
} else {
  $recipientCheck = "uncertain"
}

if ($mediaPath) {
  Assert-NoUserInterference -LockPoint $lockPoint
  $step = "send.media_prepare"
  if (-not (Test-Path -LiteralPath $mediaPath)) {
    throw "media_not_found:$mediaPath"
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
  Start-Sleep -Milliseconds 240
}

if ($payload) {
  Assert-NoUserInterference -LockPoint $lockPoint
  $step = "send.text_prepare"
  Set-Clipboard -Value $payload
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  $step = "send.text_commit"
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}

$step = "postcheck.activate"
if (-not $shell.AppActivate($appName)) {
  throw "postcheck_window_not_active:$appName"
}
$postcheck = "window_active_after_send"
$receipt = "confirmed"
$step = "postcheck.capture"
$postShot = Join-Path $evidenceDir ($traceId + "_post.png")
Save-Screenshot -TargetPath $postShot

Write-Output ("desktop_send_ok|step=" + $step + "|pre=" + $precheck + "|post=" + $postcheck + "|receipt=" + $receipt + "|recipient=" + $recipientCheck + "|window_fp=" + $windowFingerprint.Replace('|', '/') + "|pre_shot=" + $preShot.Replace('|', '/') + "|post_shot=" + $postShot.Replace('|', '/') + "|payload=" + $payloadHash)
exit 0
} catch {
  $err = $_.Exception.Message.Replace('|', '/')
  Write-Output ("desktop_send_fail|step=" + $step + "|error=" + $err + "|pre=" + $precheck + "|post=" + $postcheck + "|receipt=" + $receipt + "|recipient=" + $recipientCheck + "|window_fp=" + $windowFingerprint.Replace('|', '/') + "|pre_shot=" + $preShot.Replace('|', '/') + "|post_shot=" + $postShot.Replace('|', '/') + "|payload=" + $payloadHash)
  exit 2
}
`.trim();

  const proc = Bun.spawn(
    ['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      stdout: 'pipe',
      stderr: 'pipe',
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
    },
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
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
  const recipientTextCheckRaw = safeValueFromSignal(signal, 'recipient');
  const recipientTextCheck =
    recipientTextCheckRaw === 'matched' || recipientTextCheckRaw === 'mismatch'
      ? recipientTextCheckRaw
      : 'uncertain';
  const preSendScreenshotPath = safeValueFromSignal(signal, 'pre_shot');
  const postSendScreenshotPath = safeValueFromSignal(signal, 'post_shot');
  const payloadFromSignal = safeValueFromSignal(signal, 'payload') ?? payloadHash;
  if (exitCode === 0 && stdout.includes('desktop_send_ok') && !timedOut) {
    return {
      sent: true,
      message: `${input.channel}_desktop_sent`,
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

  const detail =
    safeValueFromSignal(signal, 'error') ??
    (stderr.trim() || undefined) ??
    (stdout.trim() || undefined) ??
    timedOut ? 'timeout' : `exit_${exitCode}`;
  return {
    sent: false,
    message: `${input.channel}_desktop_send_failed:${detail}`,
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
