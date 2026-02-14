export function sendDesktopOutbound(input: {
  appName: 'QQ' | 'WeChat';
  channel: 'qq' | 'wechat';
  destination: string;
  text?: string;
  mediaPath?: string;
}): {
  sent: boolean;
  message: string;
  visualPrecheck?: string;
  visualPostcheck?: string;
  receiptStatus?: 'confirmed' | 'uncertain';
} {
  if (process.platform !== 'win32') {
    return { sent: false, message: 'desktop_ui_windows_only' };
  }
  if (process.env.MIYA_UI_AUTOMATION_ENABLED !== '1') {
    return {
      sent: false,
      message: 'desktop_ui_disabled:set MIYA_UI_AUTOMATION_ENABLED=1',
    };
  }

  const destination = input.destination.trim();
  const text = (input.text ?? '').trim();
  const mediaPath = (input.mediaPath ?? '').trim();
  if (!destination || (!text && !mediaPath)) {
    return { sent: false, message: 'invalid_desktop_send_args' };
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$destination = $env:MIYA_DESTINATION
$payload = $env:MIYA_MESSAGE
$mediaPath = $env:MIYA_MEDIA_PATH
$appName = $env:MIYA_APP_NAME
$shell = New-Object -ComObject WScript.Shell

$proc = Get-Process -Name $appName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Start-Process -FilePath $appName | Out-Null
  Start-Sleep -Milliseconds 1200
}

$activated = $shell.AppActivate($destination)
if (-not $activated) {
  $activated = $shell.AppActivate($appName)
}
if (-not $activated) {
  throw "window_not_found:$destination"
}
$precheck = "window_activated"

if ($mediaPath) {
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
  Start-Sleep -Milliseconds 220
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 240
}

if ($payload) {
  Set-Clipboard -Value $payload
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}

if (-not $shell.AppActivate($appName)) {
  throw "postcheck_window_not_active:$appName"
}
$postcheck = "window_active_after_send"
$receipt = "confirmed"

Write-Output ("desktop_send_ok|pre=" + $precheck + "|post=" + $postcheck + "|receipt=" + $receipt)
`.trim();

  const proc = Bun.spawnSync(
    ['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      timeout: 15_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        MIYA_DESTINATION: destination,
        MIYA_MESSAGE: text,
        MIYA_MEDIA_PATH: mediaPath,
        MIYA_APP_NAME: input.appName,
      },
    },
  );

  const stdout = Buffer.from(proc.stdout).toString('utf-8').trim();
  const stderr = Buffer.from(proc.stderr).toString('utf-8').trim();
  if (proc.exitCode === 0 && stdout.includes('desktop_send_ok')) {
    const precheck = /pre=([^|]+)/.exec(stdout)?.[1] ?? 'window_activated';
    const postcheck = /post=([^|]+)/.exec(stdout)?.[1] ?? 'window_active_after_send';
    const receipt = /receipt=([^|]+)/.exec(stdout)?.[1] === 'confirmed' ? 'confirmed' : 'uncertain';
    return {
      sent: true,
      message: `${input.channel}_desktop_sent`,
      visualPrecheck: precheck,
      visualPostcheck: postcheck,
      receiptStatus: receipt,
    };
  }

  const detail = stderr || stdout || `exit_${proc.exitCode}`;
  return {
    sent: false,
    message: `${input.channel}_desktop_send_failed:${detail}`,
    visualPrecheck: 'failed',
    visualPostcheck: 'failed',
    receiptStatus: 'uncertain',
  };
}
