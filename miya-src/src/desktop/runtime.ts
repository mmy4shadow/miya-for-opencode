import { parseDesktopActionPlanV2, type DesktopActionPlanV2 } from './action-engine';

export interface DesktopActionExecutionStep {
  id: string;
  kind: string;
  status: 'planned' | 'ok' | 'failed' | 'skipped';
  message?: string;
  durationMs?: number;
}

export interface DesktopActionExecutionResult {
  ok: boolean;
  dryRun: boolean;
  traceID: string;
  platform: 'windows' | 'other';
  startedAt: string;
  finishedAt: string;
  executedCount: number;
  failureStepID?: string;
  failureReason?: string;
  inputMutexTriggered: boolean;
  steps: DesktopActionExecutionStep[];
  stdout?: string;
  stderr?: string;
}

interface DesktopActionExecutionInput {
  projectDir: string;
  plan: DesktopActionPlanV2;
  dryRun?: boolean;
  timeoutMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function actionScript(): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiyaDesktopNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_WHEEL = 0x0800

function New-Result([string]$traceID) {
  return [ordered]@{
    ok = $true
    dryRun = $false
    traceID = $traceID
    platform = 'windows'
    startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    executedCount = 0
    failureStepID = $null
    failureReason = $null
    inputMutexTriggered = $false
    steps = @()
  }
}

function Escape-SendKeys([string]$text) {
  if ($null -eq $text) { return '' }
  $escaped = $text.Replace('{','{{}').Replace('}','{}}')
  $escaped = $escaped.Replace('+','{+}').Replace('^','{^}').Replace('%','{%}')
  $escaped = $escaped.Replace('~','{~}').Replace('(','{(}').Replace(')','{)}')
  return $escaped
}

function Get-CursorPoint {
  $cursor = New-Object MiyaDesktopNative+POINT
  [void][MiyaDesktopNative]::GetCursorPos([ref]$cursor)
  return @{
    x = [int]$cursor.X
    y = [int]$cursor.Y
  }
}

function Test-UserInterference($baseline, [int]$tolerancePx = 3) {
  $cursor = Get-CursorPoint
  if ([Math]::Abs($cursor.x - $baseline.x) -gt $tolerancePx -or [Math]::Abs($cursor.y - $baseline.y) -gt $tolerancePx) {
    return $true
  }
  $keys = @(0x01, 0x02, 0x09, 0x0D, 0x10, 0x11, 0x12, 0x1B, 0x20)
  foreach ($code in $keys) {
    if (([MiyaDesktopNative]::GetAsyncKeyState($code) -band 0x8000) -ne 0) {
      return $true
    }
  }
  return $false
}

function Get-ForegroundWindowTitle() {
  $hwnd = [MiyaDesktopNative]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return '' }
  $builder = New-Object System.Text.StringBuilder 512
  [void][MiyaDesktopNative]::GetWindowText($hwnd, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Invoke-Hotkey([System.__ComObject]$shell, $keys) {
  if ($null -eq $keys -or $keys.Count -eq 0) { throw "hotkey_keys_missing" }
  $mods = ''
  $main = ''
  foreach ($raw in $keys) {
    $key = [string]$raw
    switch ($key.ToLowerInvariant()) {
      'ctrl' { $mods += '^'; continue }
      'control' { $mods += '^'; continue }
      'shift' { $mods += '+'; continue }
      'alt' { $mods += '%'; continue }
      default { $main = $key; continue }
    }
  }
  if (-not $main) { $main = [string]$keys[$keys.Count - 1] }
  $special = @{
    'enter' = '{ENTER}'
    'tab' = '{TAB}'
    'esc' = '{ESC}'
    'escape' = '{ESC}'
    'space' = ' '
    'up' = '{UP}'
    'down' = '{DOWN}'
    'left' = '{LEFT}'
    'right' = '{RIGHT}'
    'delete' = '{DELETE}'
    'backspace' = '{BACKSPACE}'
  }
  $mainKey = if ($special.ContainsKey($main.ToLowerInvariant())) { $special[$main.ToLowerInvariant()] } else { Escape-SendKeys $main }
  $shell.SendKeys("$mods$mainKey")
}

function Invoke-ClickCoordinates([int]$x, [int]$y) {
  [void][MiyaDesktopNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 30
  [MiyaDesktopNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [MiyaDesktopNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-Drag([int]$fromX, [int]$fromY, [int]$toX, [int]$toY) {
  [void][MiyaDesktopNative]::SetCursorPos($fromX, $fromY)
  Start-Sleep -Milliseconds 20
  [MiyaDesktopNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  $steps = 10
  for ($i = 1; $i -le $steps; $i++) {
    $x = [int][Math]::Round($fromX + (($toX - $fromX) * ($i / [double]$steps)))
    $y = [int][Math]::Round($fromY + (($toY - $fromY) * ($i / [double]$steps)))
    [void][MiyaDesktopNative]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 10
  }
  [MiyaDesktopNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

$planPayload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:MIYA_DESKTOP_ACTION_PLAN_B64))
$traceID = [string]$env:MIYA_DESKTOP_TRACE_ID
$plan = $planPayload | ConvertFrom-Json
$result = New-Result -traceID $traceID
$shell = New-Object -ComObject WScript.Shell
$mutexEnabled = [string]$env:MIYA_INPUT_MUTEX_ENABLED -eq '1'
$cursorBaseline = Get-CursorPoint

try {
  foreach ($action in $plan.actions) {
    $stepStartedAt = Get-Date
    $step = [ordered]@{
      id = [string]$action.id
      kind = [string]$action.kind
      status = 'ok'
      message = ''
      durationMs = 0
    }
    if ($mutexEnabled -and (Test-UserInterference -baseline $cursorBaseline)) {
      throw "input_mutex_timeout:user_interference"
    }
    switch ([string]$action.kind) {
      'focus' {
        if (-not $action.target -or [string]$action.target.mode -eq 'coordinates') { throw "focus_target_invalid" }
        $ok = $shell.AppActivate([string]$action.target.value)
        Start-Sleep -Milliseconds 120
        if (-not $ok) { throw "focus_window_not_found" }
      }
      'click' {
        if (-not $action.target -or [string]$action.target.mode -ne 'coordinates' -or -not $action.target.point) {
          throw "click_target_not_supported"
        }
        Invoke-ClickCoordinates -x ([int]$action.target.point.x) -y ([int]$action.target.point.y)
      }
      'type' {
        if (-not [string]$action.text) { throw "type_text_missing" }
        $shell.SendKeys((Escape-SendKeys ([string]$action.text)))
      }
      'hotkey' {
        Invoke-Hotkey -shell $shell -keys $action.keys
      }
      'scroll' {
        if ($null -eq $action.scrollDeltaY) { throw "scroll_delta_missing" }
        [MiyaDesktopNative]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, [uint32]([int]$action.scrollDeltaY), [UIntPtr]::Zero)
      }
      'drag' {
        if (-not $action.target -or [string]$action.target.mode -ne 'coordinates' -or -not $action.target.point -or -not $action.dragTo) {
          throw "drag_target_not_supported"
        }
        Invoke-Drag -fromX ([int]$action.target.point.x) -fromY ([int]$action.target.point.y) -toX ([int]$action.dragTo.x) -toY ([int]$action.dragTo.y)
      }
      'assert' {
        if (-not $action.assert -or [string]$action.assert.type -ne 'window') {
          throw "assert_not_supported"
        }
        $title = Get-ForegroundWindowTitle
        $expected = [string]$action.assert.expected
        $contains = $true
        if ($null -ne $action.assert.contains) { $contains = [bool]$action.assert.contains }
        if ($contains) {
          if (-not $title.ToLowerInvariant().Contains($expected.ToLowerInvariant())) {
            throw "assert_window_mismatch"
          }
        } else {
          if ($title -ne $expected) {
            throw "assert_window_mismatch"
          }
        }
      }
      default {
        throw "unsupported_action_kind"
      }
    }
    $step.durationMs = [Math]::Max(1, [int]((Get-Date) - $stepStartedAt).TotalMilliseconds)
    $result.steps += $step
    $result.executedCount += 1
  }
} catch {
  $err = [string]$_.Exception.Message
  if ($err.StartsWith('input_mutex_timeout')) {
    $result.inputMutexTriggered = $true
  }
  $result.ok = $false
  $result.failureReason = $err
  if ($result.steps.Count -gt 0) {
    $result.failureStepID = [string]$result.steps[$result.steps.Count - 1].id
  }
}

$result.finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
$json = $result | ConvertTo-Json -Compress -Depth 8
Write-Output $json
`.trim();
}

function parseJsonFromOutput(raw: string): Record<string, unknown> | null {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

function dryRunResult(plan: DesktopActionPlanV2): DesktopActionExecutionResult {
  const startedAt = nowIso();
  const steps: DesktopActionExecutionStep[] = plan.actions.map((action) => ({
    id: action.id,
    kind: action.kind,
    status: 'planned',
    message: action.notes,
  }));
  return {
    ok: true,
    dryRun: true,
    traceID: `${plan.planID}_dry_run`,
    platform: process.platform === 'win32' ? 'windows' : 'other',
    startedAt,
    finishedAt: nowIso(),
    executedCount: 0,
    inputMutexTriggered: false,
    steps,
  };
}

export async function executeDesktopActionPlan(
  input: DesktopActionExecutionInput,
): Promise<DesktopActionExecutionResult> {
  const plan = parseDesktopActionPlanV2(input.plan);
  if (input.dryRun === true) {
    return dryRunResult(plan);
  }
  if (process.platform !== 'win32') {
    return {
      ok: false,
      dryRun: false,
      traceID: `${plan.planID}_platform`,
      platform: 'other',
      startedAt: nowIso(),
      finishedAt: nowIso(),
      executedCount: 0,
      failureReason: 'platform_not_supported',
      inputMutexTriggered: false,
      steps: [],
    };
  }

  const traceID = `desktop_exec_${Date.now().toString(36)}`;
  const planPayload = Buffer.from(JSON.stringify(plan), 'utf-8').toString('base64');
  const timeoutMsRaw = Number(input.timeoutMs ?? 25_000);
  const timeoutMs = Number.isFinite(timeoutMsRaw)
    ? Math.max(1_000, Math.min(120_000, Math.floor(timeoutMsRaw)))
    : 25_000;
  const startedAt = nowIso();

  const proc = Bun.spawn(
    ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', actionScript()],
    {
      env: {
        ...process.env,
        MIYA_DESKTOP_TRACE_ID: traceID,
        MIYA_DESKTOP_ACTION_PLAN_B64: planPayload,
        MIYA_INPUT_MUTEX_ENABLED: plan.safety.inputMutex ? '1' : '0',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill('SIGTERM');
    } catch {}
  }, timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);
  const stdout = (await new Response(proc.stdout).text()).trim();
  const stderr = (await new Response(proc.stderr).text()).trim();
  const parsed = parseJsonFromOutput(stdout);

  if (!parsed) {
    return {
      ok: false,
      dryRun: false,
      traceID,
      platform: 'windows',
      startedAt,
      finishedAt: nowIso(),
      executedCount: 0,
      failureReason: timedOut ? 'execution_timeout' : `execution_parse_failed:${exitCode}`,
      inputMutexTriggered: false,
      steps: [],
      stdout,
      stderr,
    };
  }

  const stepRows = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: DesktopActionExecutionStep[] = stepRows
    .map((row): DesktopActionExecutionStep | null => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const statusRaw = String(item.status ?? '').trim();
      const status =
        statusRaw === 'planned' || statusRaw === 'ok' || statusRaw === 'failed' || statusRaw === 'skipped'
          ? statusRaw
          : 'failed';
      return {
        id: String(item.id ?? ''),
        kind: String(item.kind ?? ''),
        status,
        message:
          typeof item.message === 'string' && item.message.trim().length > 0
            ? item.message.trim()
            : undefined,
        durationMs:
          typeof item.durationMs === 'number' && Number.isFinite(item.durationMs)
            ? Math.max(0, Math.floor(item.durationMs))
            : undefined,
      };
    })
    .filter((item): item is DesktopActionExecutionStep => item !== null && item.id.length > 0);

  return {
    ok: parsed.ok === true && !timedOut,
    dryRun: false,
    traceID,
    platform: 'windows',
    startedAt:
      typeof parsed.startedAt === 'string' && parsed.startedAt.trim().length > 0
        ? parsed.startedAt
        : startedAt,
    finishedAt:
      typeof parsed.finishedAt === 'string' && parsed.finishedAt.trim().length > 0
        ? parsed.finishedAt
        : nowIso(),
    executedCount:
      typeof parsed.executedCount === 'number' && Number.isFinite(parsed.executedCount)
        ? Math.max(0, Math.floor(parsed.executedCount))
        : 0,
    failureStepID:
      typeof parsed.failureStepID === 'string' && parsed.failureStepID.trim().length > 0
        ? parsed.failureStepID.trim()
        : undefined,
    failureReason:
      timedOut
        ? 'execution_timeout'
        : typeof parsed.failureReason === 'string' && parsed.failureReason.trim().length > 0
          ? parsed.failureReason.trim()
          : undefined,
    inputMutexTriggered: parsed.inputMutexTriggered === true,
    steps,
    stdout,
    stderr,
  };
}

