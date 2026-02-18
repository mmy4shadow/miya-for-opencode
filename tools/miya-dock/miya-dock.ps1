[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$TryStartGateway
)

$ErrorActionPreference = "Stop"

$delegate = Join-Path $ProjectRoot "miya-src\tools\miya-dock\miya-dock.ps1"
if (-not (Test-Path -LiteralPath $delegate)) {
  throw "Delegate script not found: $delegate"
}

& $delegate -ProjectRoot $ProjectRoot -TryStartGateway:$TryStartGateway
exit $LASTEXITCODE
