import type { SentinelForegroundCategory, SentinelSignals } from '../state-machine';
import { runWindowsPowerShellJson } from './windows-shell';

interface ForegroundRaw {
  process?: string;
  title?: string;
  fullscreen?: boolean;
}

let lastWindowKey = '';
const switchEventsMs: number[] = [];

function normalizeForegroundCategory(processName: string, title: string): SentinelForegroundCategory {
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
    ['cmd', 'powershell', 'pwsh', 'windowsterminal', 'bash', 'wt'].some((item) =>
      processText.includes(item),
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
    ['steam', 'epicgameslauncher', 'riotclientservices', 'battle.net', 'game'].some((item) =>
      text.includes(item),
    )
  ) {
    return 'game';
  }
  if (
    ['vlc', 'potplayer', 'mpv', 'movies', 'media player', 'netflix', 'youtube'].some((item) =>
      text.includes(item),
    )
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

export function sampleForegroundSignal(nowMs = Date.now()): {
  signals: Partial<SentinelSignals>;
  limitations: string[];
} {
  const script = `
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
  const shell = runWindowsPowerShellJson<ForegroundRaw>(script, 900);
  if (!shell.ok || !shell.value) {
    return {
      signals: {
        foreground: 'unknown',
      },
      limitations: [`foreground_probe_failed:${shell.error ?? 'unknown'}`],
    };
  }
  const processName = String(shell.value.process ?? '').trim();
  const title = String(shell.value.title ?? '').trim();
  const category = normalizeForegroundCategory(processName, title);
  const windowKey = `${processName.toLowerCase()}|${title.toLowerCase()}`;
  const windowSwitchPerMin = calculateSwitchRate(windowKey, nowMs);
  return {
    signals: {
      foreground: category,
      foregroundTitle: title,
      fullscreen: Boolean(shell.value.fullscreen),
      windowSwitchPerMin,
    },
    limitations: [],
  };
}
