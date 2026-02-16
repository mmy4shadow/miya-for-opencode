import type { SentinelSignals } from '../state-machine';
import { runWindowsPowerShellJson } from './windows-shell';

interface GamepadRaw {
  xinputActive?: boolean;
  gamepadActive?: boolean;
  error?: string;
}

export function sampleGamepadSignal(): {
  signals: Partial<SentinelSignals>;
  limitations: string[];
} {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MiyaXInputProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct XINPUT_GAMEPAD {
    public ushort wButtons;
    public byte bLeftTrigger;
    public byte bRightTrigger;
    public short sThumbLX;
    public short sThumbLY;
    public short sThumbRX;
    public short sThumbRY;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct XINPUT_STATE {
    public uint dwPacketNumber;
    public XINPUT_GAMEPAD Gamepad;
  }
  [DllImport("xinput1_4.dll", EntryPoint="XInputGetState")]
  public static extern uint XInputGetState14(uint dwUserIndex, out XINPUT_STATE pState);
  [DllImport("xinput9_1_0.dll", EntryPoint="XInputGetState")]
  public static extern uint XInputGetState910(uint dwUserIndex, out XINPUT_STATE pState);
}
"@
$active = $false
$probeErr = ''
for ($i = 0; $i -lt 4; $i++) {
  $state = New-Object MiyaXInputProbe+XINPUT_STATE
  $ret = 1167
  try { $ret = [MiyaXInputProbe]::XInputGetState14([uint32]$i, [ref]$state) } catch {}
  if ($ret -ne 0) {
    try { $ret = [MiyaXInputProbe]::XInputGetState910([uint32]$i, [ref]$state) } catch {}
  }
  if ($ret -eq 0) {
    if (
      $state.Gamepad.wButtons -ne 0 -or
      $state.Gamepad.bLeftTrigger -gt 10 -or
      $state.Gamepad.bRightTrigger -gt 10 -or
      [Math]::Abs($state.Gamepad.sThumbLX) -gt 4000 -or
      [Math]::Abs($state.Gamepad.sThumbLY) -gt 4000 -or
      [Math]::Abs($state.Gamepad.sThumbRX) -gt 4000 -or
      [Math]::Abs($state.Gamepad.sThumbRY) -gt 4000
    ) {
      $active = $true
      break
    }
  } elseif ($ret -ne 1167) {
    $probeErr = "xinput_code_" + $ret
  }
}
@{
  xinputActive = $active
  gamepadActive = $active
  error = $probeErr
} | ConvertTo-Json -Compress
`.trim();
  const shell = runWindowsPowerShellJson<GamepadRaw>(script, 900);
  if (!shell.ok || !shell.value) {
    return {
      signals: {},
      limitations: [`gamepad_probe_failed:${shell.error ?? 'unknown'}`],
    };
  }
  return {
    signals: {
      xinputActive: Boolean(shell.value.xinputActive),
      gamepadActive: Boolean(shell.value.gamepadActive),
    },
    limitations:
      typeof shell.value.error === 'string' && shell.value.error.trim().length > 0
        ? [shell.value.error.trim()]
        : [],
  };
}
