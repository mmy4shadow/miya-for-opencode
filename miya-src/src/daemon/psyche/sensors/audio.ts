import type { SentinelSignals } from '../state-machine';
import { runWindowsPowerShellJson } from './windows-shell';

interface AudioRaw {
  audioSessionCount?: number;
  audioSessionActive?: boolean;
}

export function sampleAudioSignal(): {
  signals: Partial<SentinelSignals>;
  limitations: string[];
} {
  const script = `
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
  $sessions = $manager.GetSessions()
  $activeCount = 0
  foreach ($session in $sessions) {
    try {
      $playback = $session.GetPlaybackInfo()
      if ($playback -and $playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
        $activeCount += 1
      }
    } catch {}
  }
  @{
    audioSessionCount = $activeCount
    audioSessionActive = ($activeCount -gt 0)
  } | ConvertTo-Json -Compress
} catch {
  @{
    audioSessionCount = 0
    audioSessionActive = $false
    error = "media_session_unavailable"
  } | ConvertTo-Json -Compress
}
`.trim();
  const shell = runWindowsPowerShellJson<AudioRaw & { error?: string }>(
    script,
    1_200,
  );
  if (!shell.ok || !shell.value) {
    return {
      signals: {},
      limitations: [`audio_probe_failed:${shell.error ?? 'unknown'}`],
    };
  }
  const sessionCountRaw = Number(shell.value.audioSessionCount ?? Number.NaN);
  const audioSessionCount = Number.isFinite(sessionCountRaw)
    ? Math.max(0, Math.floor(sessionCountRaw))
    : 0;
  return {
    signals: {
      audioSessionCount,
      audioSessionActive:
        Boolean(shell.value.audioSessionActive) || audioSessionCount > 0,
      audioActive:
        Boolean(shell.value.audioSessionActive) || audioSessionCount > 0,
    },
    limitations:
      typeof shell.value.error === 'string' &&
      shell.value.error.trim().length > 0
        ? [shell.value.error.trim()]
        : [],
  };
}
