import { spawn, type ChildProcess } from 'node:child_process';
import type {
  SentinelForegroundCategory,
  SentinelSignals,
} from '../state-machine';
import { runWindowsPowerShellJson } from './windows-shell';

interface ForegroundRaw {
  process?: string;
  title?: string;
  fullscreen?: boolean;
  sampledAt?: string;
}

let lastWindowKey = '';
const switchEventsMs: number[] = [];
const HOOK_STALE_AFTER_MS = 20_000;
const HOOK_RETRY_BACKOFF_MS = 8_000;
let hookProcess: ChildProcess | null = null;
let hookStdoutBuffer = '';
let hookSample: ForegroundRaw | null = null;
let hookSampledAtMs = 0;
let hookLastError = '';
let hookNextRetryMs = 0;
let hookExitCleanupBound = false;

function normalizeForegroundCategory(
  processName: string,
  title: string,
): SentinelForegroundCategory {
  const processText = processName.toLowerCase();
  const titleText = title.toLowerCase();
  const text = `${processText} ${titleText}`;
  if (
    ['code', 'cursor', 'webstorm', 'pycharm', 'idea64', 'devenv'].some((item) =>
      processText.includes(item),
    )
  ) {
    return 'ide';
  }
  if (
    ['cmd', 'powershell', 'pwsh', 'windowsterminal', 'bash', 'wt'].some(
      (item) => processText.includes(item),
    )
  ) {
    return 'terminal';
  }
  if (
    ['qq', 'wechat', 'telegram', 'discord', 'slack', 'teams'].some((item) =>
      processText.includes(item),
    )
  ) {
    return 'chat';
  }
  if (
    [
      'steam',
      'epicgameslauncher',
      'riotclientservices',
      'battle.net',
      'game',
    ].some((item) => text.includes(item))
  ) {
    return 'game';
  }
  if (
    [
      'vlc',
      'potplayer',
      'mpv',
      'movies',
      'media player',
      'netflix',
      'youtube',
    ].some((item) => text.includes(item))
  ) {
    return 'player';
  }
  if (
    ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'safari'].some((item) =>
      processText.includes(item),
    )
  ) {
    return 'browser';
  }
  if (!processText && !titleText) return 'unknown';
  return 'other';
}

function calculateSwitchRate(windowKey: string, nowMs: number): number {
  if (windowKey && windowKey !== lastWindowKey) {
    switchEventsMs.push(nowMs);
    lastWindowKey = windowKey;
  }
  while (switchEventsMs.length > 0 && nowMs - switchEventsMs[0] > 60_000) {
    switchEventsMs.shift();
  }
  return switchEventsMs.length;
}

function bindHookExitCleanup(): void {
  if (hookExitCleanupBound) return;
  hookExitCleanupBound = true;
  process.on('exit', () => {
    if (!hookProcess) return;
    try {
      hookProcess.kill();
    } catch {}
  });
}

function foregroundPollingScript(): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiyaForegroundProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [MiyaForegroundProbe]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  @{ process=''; title=''; fullscreen=$false } | ConvertTo-Json -Compress
  exit 0
}
$pid = 0
[void][MiyaForegroundProbe]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$titleBuilder = New-Object System.Text.StringBuilder 4096
[void][MiyaForegroundProbe]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$title = $titleBuilder.ToString()
$processName = ''
try {
  $processName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName
} catch {}
$isFullscreen = $false
try {
  $rect = New-Object MiyaForegroundProbe+RECT
  if ([MiyaForegroundProbe]::GetWindowRect($hwnd, [ref]$rect)) {
    $w = [Math]::Abs($rect.Right - $rect.Left)
    $h = [Math]::Abs($rect.Bottom - $rect.Top)
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($w -ge ($bounds.Width - 6) -and $h -ge ($bounds.Height - 6)) {
      $isFullscreen = $true
    }
  }
} catch {}
@{ process=$processName; title=$title; fullscreen=$isFullscreen } | ConvertTo-Json -Compress
`.trim();
}

function foregroundEventHookScript(): string {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiyaForegroundHook {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate void WinEventDelegate(
    IntPtr hWinEventHook,
    uint eventType,
    IntPtr hwnd,
    int idObject,
    int idChild,
    uint dwEventThread,
    uint dwmsEventTime
  );
  [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(
    uint eventMin,
    uint eventMax,
    IntPtr hmodWinEventProc,
    WinEventDelegate lpfnWinEventProc,
    uint idProcess,
    uint idThread,
    uint dwFlags
  );
  [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hWinEventHook);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
function Emit-Snapshot {
  param([IntPtr]$Hwnd)
  if ($Hwnd -eq [IntPtr]::Zero) {
    $Hwnd = [MiyaForegroundHook]::GetForegroundWindow()
  }
  if ($Hwnd -eq [IntPtr]::Zero) {
    @{ type='snapshot'; process=''; title=''; fullscreen=$false; sampledAt=(Get-Date).ToString('o') } | ConvertTo-Json -Compress
    return
  }
  $pid = 0
  [void][MiyaForegroundHook]::GetWindowThreadProcessId($Hwnd, [ref]$pid)
  $titleBuilder = New-Object System.Text.StringBuilder 4096
  [void][MiyaForegroundHook]::GetWindowText($Hwnd, $titleBuilder, $titleBuilder.Capacity)
  $title = $titleBuilder.ToString()
  $processName = ''
  try {
    $processName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName
  } catch {}
  $isFullscreen = $false
  try {
    $rect = New-Object MiyaForegroundHook+RECT
    if ([MiyaForegroundHook]::GetWindowRect($Hwnd, [ref]$rect)) {
      $w = [Math]::Abs($rect.Right - $rect.Left)
      $h = [Math]::Abs($rect.Bottom - $rect.Top)
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      if ($w -ge ($bounds.Width - 6) -and $h -ge ($bounds.Height - 6)) {
        $isFullscreen = $true
      }
    }
  } catch {}
  @{ type='snapshot'; process=$processName; title=$title; fullscreen=$isFullscreen; sampledAt=(Get-Date).ToString('o') } | ConvertTo-Json -Compress
}
$callback = [MiyaForegroundHook+WinEventDelegate]{
  param($hWinEventHook, $eventType, $hwnd, $idObject, $idChild, $dwEventThread, $dwmsEventTime)
  if ($idObject -ne 0 -or $idChild -ne 0) { return }
  try { Emit-Snapshot $hwnd } catch {}
}
$script:miyaForegroundCallback = $callback
$hook = [MiyaForegroundHook]::SetWinEventHook(3, 3, [IntPtr]::Zero, $callback, 0, 0, 2)
if ($hook -eq [IntPtr]::Zero) {
  @{ type='error'; message='set_win_event_hook_failed' } | ConvertTo-Json -Compress
  exit 1
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.Add_Tick({ try { Emit-Snapshot ([IntPtr]::Zero) } catch {} })
$timer.Start()
try {
  Emit-Snapshot ([IntPtr]::Zero)
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop()
  [MiyaForegroundHook]::UnhookWinEvent($hook) | Out-Null
}
`.trim();
}

function maybeStartForegroundHook(nowMs: number): void {
  if (process.platform !== 'win32') return;
  if (hookProcess && !hookProcess.killed) return;
  if (nowMs < hookNextRetryMs) return;
  bindHookExitCleanup();
  try {
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        foregroundEventHookScript(),
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    hookStdoutBuffer = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      hookStdoutBuffer += chunk;
      const lines = hookStdoutBuffer.split(/\r?\n/);
      hookStdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        try {
          const frame = JSON.parse(text) as {
            type?: string;
            process?: string;
            title?: string;
            fullscreen?: boolean;
            sampledAt?: string;
            message?: string;
          };
          if (frame.type === 'snapshot') {
            hookSample = {
              process: frame.process,
              title: frame.title,
              fullscreen: frame.fullscreen,
              sampledAt: frame.sampledAt,
            };
            hookSampledAtMs = Date.now();
            hookLastError = '';
          } else if (frame.type === 'error') {
            hookLastError = String(frame.message ?? 'foreground_hook_error');
          }
        } catch {}
      }
    });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (!text) return;
      hookLastError = `foreground_hook_stderr:${text}`;
    });
    child.on('exit', (code) => {
      hookProcess = null;
      hookNextRetryMs = Date.now() + HOOK_RETRY_BACKOFF_MS;
      if (code !== null && code !== 0 && !hookLastError) {
        hookLastError = `foreground_hook_exit_${code}`;
      }
    });
    hookProcess = child;
  } catch (error) {
    hookLastError =
      error instanceof Error ? error.message : String(error ?? 'hook_start_failed');
    hookNextRetryMs = nowMs + HOOK_RETRY_BACKOFF_MS;
  }
}

function readForegroundByPolling(): { shell: ReturnType<typeof runWindowsPowerShellJson<ForegroundRaw>>; } {
  return {
    shell: runWindowsPowerShellJson<ForegroundRaw>(foregroundPollingScript(), 900),
  };
}

export function sampleForegroundSignal(nowMs = Date.now()): {
  signals: Partial<SentinelSignals>;
  limitations: string[];
} {
  const limitations: string[] = [];
  let raw: ForegroundRaw | undefined;

  if (process.platform === 'win32') {
    maybeStartForegroundHook(nowMs);
    if (hookSample && nowMs - hookSampledAtMs <= HOOK_STALE_AFTER_MS) {
      raw = hookSample;
    } else {
      const { shell } = readForegroundByPolling();
      if (shell.ok && shell.value) {
        raw = shell.value;
        limitations.push('foreground_source=polling_fallback');
      } else {
        return {
          signals: {
            foreground: 'unknown',
          },
          limitations: [
            `foreground_probe_failed:${shell.error ?? hookLastError ?? 'unknown'}`,
          ],
        };
      }
    }
  } else {
    const { shell } = readForegroundByPolling();
    if (shell.ok && shell.value) {
      raw = shell.value;
    } else {
      return {
        signals: {
          foreground: 'unknown',
        },
        limitations: [`foreground_probe_failed:${shell.error ?? 'unknown'}`],
      };
    }
  }

  if (!raw) {
    return {
      signals: {
        foreground: 'unknown',
      },
      limitations: ['foreground_probe_failed:empty_sample'],
    };
  }

  if (hookLastError) {
    limitations.push(`foreground_hook_status:${hookLastError}`);
  } else if (process.platform === 'win32' && hookProcess) {
    limitations.push('foreground_source=SetWinEventHook');
  }

  const processName = String(raw.process ?? '').trim();
  const title = String(raw.title ?? '').trim();
  const category = normalizeForegroundCategory(processName, title);
  const windowKey = `${processName.toLowerCase()}|${title.toLowerCase()}`;
  const windowSwitchPerMin = calculateSwitchRate(windowKey, nowMs);
  return {
    signals: {
      foreground: category,
      foregroundTitle: title,
      fullscreen: Boolean(raw.fullscreen),
      windowSwitchPerMin,
    },
    limitations,
  };
}
