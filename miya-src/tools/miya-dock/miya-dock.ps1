[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
  [switch]$TryStartGateway
)

$ErrorActionPreference = "Stop"

$GatewayCandidates = @(
  (Join-Path $ProjectRoot "miya\gateway.json"),
  (Join-Path $ProjectRoot ".opencode\miya\gateway.json"),
  (Join-Path $ProjectRoot "miya-src\miya\gateway.json"),
  (Join-Path $ProjectRoot "miya-src\.opencode\miya\gateway.json")
)
$ProjectRootLeaf = Split-Path -Path $ProjectRoot -Leaf
if ($ProjectRootLeaf -eq "miya-src") {
  $repoRoot = Split-Path -Path $ProjectRoot -Parent
  $GatewayCandidates += @(
    (Join-Path $repoRoot "miya\gateway.json"),
    (Join-Path $repoRoot ".opencode\miya\gateway.json")
  )
}
$DockScript = Join-Path $PSScriptRoot "miya-dock.ahk"
$PidFile = Join-Path $PSScriptRoot "miya-dock.pid"

function Resolve-GatewayFile {
  param([string[]]$Candidates)
  $candidates = @($Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
  if ($candidates.Count -eq 0) {
    return $Candidates[0]
  }
  if ($candidates.Count -eq 1) {
    return $candidates[0]
  }
  return ($candidates | Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending | Select-Object -First 1)
}

function Cleanup-StaleGatewayFiles {
  param([string[]]$Candidates)
  $unique = @($Candidates | Select-Object -Unique)
  foreach ($candidate in $unique) {
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) {
      continue
    }
    $state = Read-GatewayState -Path $candidate
    if (-not $state) {
      continue
    }
    $statePid = 0
    try {
      $statePid = [int]$state.pid
    } catch {
      $statePid = 0
    }
    if ($statePid -gt 0 -and -not (Test-PidAlive -ProcessId $statePid)) {
      Write-Host "[miya-dock] stale gateway state removed: $candidate (pid=$statePid)"
      Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
    }
  }
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

function Resolve-GatewayStartBootstrap {
  param([string]$WorkingDirectory)

  $node = Get-Command node -ErrorAction SilentlyContinue
  $nodeSupervisorCandidates = @(
    (Join-Path $WorkingDirectory "dist\cli\gateway-supervisor.node.js"),
    (Join-Path $WorkingDirectory "miya-src\dist\cli\gateway-supervisor.node.js")
  )
  $nodeSupervisor = $nodeSupervisorCandidates | Where-Object {
    Test-Path -LiteralPath $_
  } | Select-Object -First 1
  if ($node -and $nodeSupervisor) {
    return @{
      FilePath = $node.Source
      Args = @($nodeSupervisor, "--workspace", $WorkingDirectory)
      Label = "node gateway-supervisor.node.js"
    }
  }

  $miya = Get-Command miya -ErrorAction SilentlyContinue
  if ($miya) {
    return @{
      FilePath = $miya.Source
      Args = @("gateway", "start", "--force")
      Label = "miya gateway start --force"
    }
  }

  $opencode = Get-Command opencode -ErrorAction SilentlyContinue
  if ($opencode) {
    return @{
      FilePath = $opencode.Source
      Args = @("run", "--command", "miya-gateway-start")
      Label = "opencode run --command miya-gateway-start"
    }
  }

  return $null
}

function Try-StartGatewayViaCli {
  param([string]$WorkingDirectory)

  $bootstrap = Resolve-GatewayStartBootstrap -WorkingDirectory $WorkingDirectory
  if (-not $bootstrap) {
    return $false
  }

  $prevAutoUi = $Env:MIYA_AUTO_UI_OPEN
  $prevDockAuto = $Env:MIYA_DOCK_AUTO_LAUNCH
  try {
    $Env:MIYA_AUTO_UI_OPEN = "0"
    $Env:MIYA_DOCK_AUTO_LAUNCH = "0"
    $proc = Start-Process `
      -FilePath $bootstrap.FilePath `
      -ArgumentList $bootstrap.Args `
      -WorkingDirectory $WorkingDirectory `
      -PassThru `
      -WindowStyle Hidden
    $completed = Wait-Process -Id $proc.Id -Timeout 20 -ErrorAction SilentlyContinue
    if (-not $completed) {
      # Do not kill long-running bootstrap aggressively; caller will re-check gateway health/state.
      return $true
    }
    return ($proc.ExitCode -eq 0)
  } finally {
    if ($null -eq $prevAutoUi) {
      Remove-Item Env:MIYA_AUTO_UI_OPEN -ErrorAction SilentlyContinue
    } else {
      $Env:MIYA_AUTO_UI_OPEN = $prevAutoUi
    }
    if ($null -eq $prevDockAuto) {
      Remove-Item Env:MIYA_DOCK_AUTO_LAUNCH -ErrorAction SilentlyContinue
    } else {
      $Env:MIYA_DOCK_AUTO_LAUNCH = $prevDockAuto
    }
  }
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

Cleanup-StaleGatewayFiles -Candidates $GatewayCandidates
$GatewayFile = Resolve-GatewayFile -Candidates $GatewayCandidates

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
  $pidAlive = Test-PidAlive -ProcessId $gatewayPid
  if (-not $pidAlive) {
    Write-Host "[miya-dock] stale gateway.json detected (pid=$($gateway.pid) not alive), removing stale state."
    Remove-Item -LiteralPath $GatewayFile -Force -ErrorAction SilentlyContinue
    $gateway = $null
    $GatewayFile = Resolve-GatewayFile -Candidates $GatewayCandidates
  } else {
    $ready = Test-GatewayUrl -Url $gateway.url
  }
}

if (-not $ready -and $TryStartGateway) {
  $bootstrap = Resolve-GatewayStartBootstrap -WorkingDirectory $ProjectRoot
  $label = if ($bootstrap) { $bootstrap.Label } else { "no_bootstrap_available" }
  Write-Host "[miya-dock] Gateway not ready, trying: $label"
  $null = Try-StartGatewayViaCli -WorkingDirectory $ProjectRoot
  Start-Sleep -Milliseconds 800
  Cleanup-StaleGatewayFiles -Candidates $GatewayCandidates
  $GatewayFile = Resolve-GatewayFile -Candidates $GatewayCandidates
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
1) Run: node .\miya-src\dist\cli\gateway-supervisor.node.js --workspace "$ProjectRoot"
2) If node path is unavailable: miya gateway start --force
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
