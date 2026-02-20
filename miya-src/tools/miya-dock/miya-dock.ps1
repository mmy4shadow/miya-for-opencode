[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$TryStartGateway
)

$ErrorActionPreference = "Stop"

$GatewayPrimary = Join-Path $ProjectRoot ".opencode\miya\gateway.json"
$GatewayAlternate = Join-Path $ProjectRoot "miya-src\.opencode\miya\gateway.json"
$DockScript = Join-Path $PSScriptRoot "miya-dock.ahk"
$PidFile = Join-Path $PSScriptRoot "miya-dock.pid"

function Resolve-GatewayFile {
  param([string]$Primary, [string]$Alternate)
  $candidates = @($Primary, $Alternate) | Where-Object { Test-Path -LiteralPath $_ }
  if ($candidates.Count -eq 0) {
    return $Primary
  }
  if ($candidates.Count -eq 1) {
    return $candidates[0]
  }
  return ($candidates | Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending | Select-Object -First 1)
}

function Read-GatewayState {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
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

function Test-PidAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return $false
  }
  try {
    $null = Get-Process -Id $ProcessId -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Try-StartGatewayViaNode {
  param([string]$WorkingDirectory)
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    return $false
  }

  $workspaceDir = Join-Path $WorkingDirectory "miya-src"
  $distCli = Join-Path $workspaceDir "dist\cli\index.js"
  $srcCli = Join-Path $workspaceDir "src\cli\index.ts"

  $escapedNode = '"' + $node.Source.Replace('"', '""') + '"'
  $cliCommand = $null
  $commandWorkingDirectory = $workspaceDir
  if (Test-Path -LiteralPath $distCli) {
    $escapedDistCli = '"' + $distCli.Replace('"', '""') + '"'
    $cliCommand = "$escapedDistCli gateway start --force"
  } elseif (Test-Path -LiteralPath $srcCli) {
    $escapedSrcCli = '"' + $srcCli.Replace('"', '""') + '"'
    $cliCommand = "--import tsx $escapedSrcCli gateway start --force"
  }

  if (-not $cliCommand) {
    return $false
  }

  $commandLine = 'set "MIYA_AUTO_UI_OPEN=0" && set "MIYA_DOCK_AUTO_LAUNCH=0" && ' + $escapedNode + ' ' + $cliCommand
  $proc = Start-Process `
    -FilePath $Env:ComSpec `
    -ArgumentList @("/d", "/c", $commandLine) `
    -WorkingDirectory $commandWorkingDirectory `
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

$GatewayFile = Resolve-GatewayFile -Primary $GatewayPrimary -Alternate $GatewayAlternate

if (-not (Test-Path -LiteralPath $DockScript)) {
  throw "Dock script not found: $DockScript"
}

$gateway = Read-GatewayState -Path $GatewayFile
$ready = $false
if ($gateway -and $gateway.url) {
  $gatewayPid = 0
  try {
    $gatewayPid = [int]$gateway.pid
  } catch {
    $gatewayPid = 0
  }
  $pidAlive = Test-PidAlive -Pid $gatewayPid
  if (-not $pidAlive) {
    Write-Host "[miya-dock] stale gateway.json detected (pid=$($gateway.pid) not alive), removing stale state."
    Remove-Item -LiteralPath $GatewayFile -Force -ErrorAction SilentlyContinue
    $gateway = $null
    $GatewayFile = Resolve-GatewayFile -Primary $GatewayPrimary -Alternate $GatewayAlternate
  } else {
    $ready = Test-GatewayUrl -Url $gateway.url
  }
}

if (-not $ready -and $TryStartGateway) {
  Write-Host "[miya-dock] Gateway not ready, trying: node miya-src/dist/cli/index.js gateway start --force"
  $null = Try-StartGatewayViaNode -WorkingDirectory $ProjectRoot
  Start-Sleep -Milliseconds 800
  $GatewayFile = Resolve-GatewayFile -Primary $GatewayPrimary -Alternate $GatewayAlternate
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
2) Run command: node miya-src/dist/cli/index.js gateway start --force
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
