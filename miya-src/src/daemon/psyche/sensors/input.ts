import type { SentinelSignals } from '../state-machine';
import { runWindowsPowerShellJson } from './windows-shell';

interface InputRaw {
  idleSec?: number;
  rawInputActive?: boolean;
}

const inputEventsMs: number[] = [];
let previousIdleSec: number | undefined;

function updateApm(input: { idleSec?: number; rawInputActive?: boolean }, nowMs: number): number {
  const idle = Number.isFinite(input.idleSec) ? Number(input.idleSec) : undefined;
  if (input.rawInputActive) {
    inputEventsMs.push(nowMs);
  }
  if (idle !== undefined && previousIdleSec !== undefined && idle + 0.2 < previousIdleSec) {
    inputEventsMs.push(nowMs);
  }
  previousIdleSec = idle;
  while (inputEventsMs.length > 0 && nowMs - inputEventsMs[0] > 60_000) {
    inputEventsMs.shift();
  }
  return inputEventsMs.length;
}

export function sampleInputSignal(nowMs = Date.now()): {
  signals: Partial<SentinelSignals>;
  limitations: string[];
} {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MiyaInputSignal {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$idleSec = 0.0
try {
  $lii = New-Object MiyaInputSignal+LASTINPUTINFO
  $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type]'MiyaInputSignal+LASTINPUTINFO')
  if ([MiyaInputSignal]::GetLastInputInfo([ref]$lii)) {
    $tick = [double][MiyaInputSignal]::GetTickCount64()
    $delta = [Math]::Max(0, $tick - [double]$lii.dwTime)
    $idleSec = [Math]::Round($delta / 1000.0, 3)
  }
} catch {}
$active = $false
$keys = @(0x01,0x02,0x08,0x09,0x0D,0x10,0x11,0x12,0x1B,0x20,0x25,0x26,0x27,0x28)
foreach ($vk in $keys) {
  if (([MiyaInputSignal]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) {
    $active = $true
    break
  }
}
@{
  idleSec = $idleSec
  rawInputActive = $active
} | ConvertTo-Json -Compress
`.trim();
  const shell = runWindowsPowerShellJson<InputRaw>(script, 900);
  if (!shell.ok || !shell.value) {
    return {
      signals: {},
      limitations: [`input_probe_failed:${shell.error ?? 'unknown'}`],
    };
  }
  const idleSec = Number(shell.value.idleSec ?? Number.NaN);
  const rawInputActive = Boolean(shell.value.rawInputActive);
  const apm = updateApm(
    {
      idleSec: Number.isFinite(idleSec) ? idleSec : undefined,
      rawInputActive,
    },
    nowMs,
  );
  return {
    signals: {
      idleSec: Number.isFinite(idleSec) ? Number(idleSec.toFixed(2)) : undefined,
      rawInputActive,
      apm,
    },
    limitations: [],
  };
}
