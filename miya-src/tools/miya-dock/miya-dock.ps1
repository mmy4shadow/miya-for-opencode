[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$TryStartGateway
)

$ErrorActionPreference = "Stop"

$GatewayFile = Join-Path $ProjectRoot ".opencode\miya\gateway.json"
$DockScript = Join-Path $PSScriptRoot "miya-dock.ahk"
$PidFile = Join-Path $PSScriptRoot "miya-dock.pid"

function Read-GatewayState {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Test-GatewayUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) {
    return $false
  }
  try {
    $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $true
  } catch {
    return $false
  }
}

function Try-StartGatewayViaOpenCode {
  param([string]$WorkingDirectory)
  $opencode = Get-Command opencode -ErrorAction SilentlyContinue
  if (-not $opencode) {
    return $false
  }

  $proc = Start-Process `
    -FilePath $opencode.Source `
    -ArgumentList @("run", "--command", "miya-gateway-start") `
    -WorkingDirectory $WorkingDirectory `
    -PassThru `
    -WindowStyle Hidden
  $completed = Wait-Process -Id $proc.Id -Timeout 20 -ErrorAction SilentlyContinue
  if (-not $completed) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    return $false
  }
  return ($proc.ExitCode -eq 0)
}

function Resolve-AhkExecutable {
  $cmd = Get-Command AutoHotkey64.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command AutoHotkey.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    (Join-Path $PSScriptRoot "v2\AutoHotkey64.exe"),
    (Join-Path $PSScriptRoot "v2\AutoHotkey.exe"),
    (Join-Path $ProjectRoot "v2\AutoHotkey64.exe"),
    (Join-Path $ProjectRoot "v2\AutoHotkey.exe"),
    (Join-Path $ProjectRoot "AutoHotkey64.exe"),
    (Join-Path $ProjectRoot "AutoHotkey.exe"),
    "$Env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe",
    "$Env:ProgramFiles\AutoHotkey\AutoHotkey64.exe",
    "$Env:ProgramFiles\AutoHotkey\v2\AutoHotkey.exe",
    "$Env:ProgramFiles(x86)\AutoHotkey\v2\AutoHotkey32.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $null
}

if (-not (Test-Path -LiteralPath $DockScript)) {
  throw "Dock script not found: $DockScript"
}

$gateway = Read-GatewayState -Path $GatewayFile
$ready = $false
if ($gateway -and $gateway.url) {
  $ready = Test-GatewayUrl -Url $gateway.url
}

if (-not $ready -and $TryStartGateway) {
  Write-Host "[miya-dock] Gateway not ready, trying: opencode run --command miya-gateway-start"
  $null = Try-StartGatewayViaOpenCode -WorkingDirectory $ProjectRoot
  Start-Sleep -Milliseconds 800
  $gateway = Read-GatewayState -Path $GatewayFile
  if ($gateway -and $gateway.url) {
    $ready = Test-GatewayUrl -Url $gateway.url
  }
}

if (-not $ready) {
  throw @"
Gateway is not ready.
Expected file: $GatewayFile
Recovery:
1) Start OpenCode in this project (with Miya plugin loaded)
2) Run command: /miya-gateway-start
3) Re-run tools/miya-dock/miya-launch.bat
"@
}

$ahkExe = Resolve-AhkExecutable
if (-not $ahkExe) {
  throw "AutoHotkey v2 not found. Install from https://www.autohotkey.com/ first."
}

if (Test-Path -LiteralPath $PidFile) {
  try {
    $existingPid = [int](Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($existingPid -gt 0 -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
      Write-Host "[miya-dock] Existing dock process found (pid=$existingPid), stopping it first."
      Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 200
    }
  } catch {}
}

$argLine = "`"$DockScript`" `"$GatewayFile`""
$proc = Start-Process `
  -FilePath $ahkExe `
  -ArgumentList $argLine `
  -WorkingDirectory $PSScriptRoot `
  -PassThru

Set-Content -LiteralPath $PidFile -Value $proc.Id -Encoding utf8
Write-Host "[miya-dock] launched pid=$($proc.Id)"
Write-Host "[miya-dock] gateway=$($gateway.url)"
