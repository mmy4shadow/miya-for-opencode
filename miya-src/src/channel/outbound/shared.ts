export function sendDesktopOutbound(input: {
  appName: 'QQ' | 'WeChat';
  channel: 'qq' | 'wechat';
  destination: string;
  text: string;
}): { sent: boolean; message: string } {
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
  const text = input.text.trim();
  if (!destination || !text) {
    return { sent: false, message: 'invalid_desktop_send_args' };
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$destination = $env:MIYA_DESTINATION
$payload = $env:MIYA_MESSAGE
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

Set-Clipboard -Value $payload
Start-Sleep -Milliseconds 180
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 120
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')

Write-Output 'desktop_send_ok'
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
        MIYA_APP_NAME: input.appName,
      },
    },
  );

  const stdout = Buffer.from(proc.stdout).toString('utf-8').trim();
  const stderr = Buffer.from(proc.stderr).toString('utf-8').trim();
  if (proc.exitCode === 0 && stdout.includes('desktop_send_ok')) {
    return { sent: true, message: `${input.channel}_desktop_sent` };
  }

  const detail = stderr || stdout || `exit_${proc.exitCode}`;
  return {
    sent: false,
    message: `${input.channel}_desktop_send_failed:${detail}`,
  };
}
