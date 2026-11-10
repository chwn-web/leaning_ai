# dsh-session-cloud — uninstall / rollback.
#
# Default: drop "dsh-session-cloud" from dsh.profile.bundles and delete
# <profile>\node_modules\dsh-session-cloud. The engine directory (sync.py,
# config.json, state.json) is never touched — your sync history survives.
#
# -RestoreManifest also copies package.json.bak-session-cloud back over
# package.json (the pre-install manifest, verbatim).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RestoreManifest

[CmdletBinding()]
param(
  [string] $ProfileDir = 'C:\Users\issuser\.dsh\profiles\web',
  [switch] $RestoreManifest,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$PackageName = 'dsh-session-cloud'
$Utf8NoBom   = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string] $Message) { Write-Host "[session-cloud] $Message" }
function Write-JsonFile([string] $Path, [string] $Text) { [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom) }

$manifestPath = Join-Path $ProfileDir 'package.json'
$backupPath   = Join-Path $ProfileDir 'package.json.bak-session-cloud'
$target       = Join-Path (Join-Path $ProfileDir 'node_modules') $PackageName

if (-not (Test-Path -LiteralPath $manifestPath)) {
  Write-Step "no profile manifest at $manifestPath — nothing to unregister"
}

if ($DryRun) {
  Write-Step 'DRY RUN — nothing is written.'
  Write-Step "would remove $PackageName from dsh.profile.bundles"
  Write-Step "would delete $target"
  if ($RestoreManifest) { Write-Step "would restore $backupPath -> $manifestPath" }
  exit 0
}

if (Test-Path -LiteralPath $manifestPath) {
  $manifest = (Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8) | ConvertFrom-Json
  if ($manifest.dsh -ne $null -and $manifest.dsh.profile -ne $null -and $manifest.dsh.profile.bundles -ne $null) {
    $bundles = @($manifest.dsh.profile.bundles)
    if ($bundles -contains $PackageName) {
      $kept = @($bundles | Where-Object { $_ -ne $PackageName })
      $manifest.dsh.profile | Add-Member -MemberType NoteProperty -Name bundles -Value $kept -Force
      $json = $manifest | ConvertTo-Json -Depth 32
      Write-JsonFile $manifestPath ($json + "`n")
      Write-Step "removed $PackageName from dsh.profile.bundles ($($bundles.Count) -> $($kept.Count))"
    } else {
      Write-Step "dsh.profile.bundles does not list $PackageName"
    }
  }
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Step "deleted $target"
} else {
  Write-Step "no installation at $target"
}

if ($RestoreManifest) {
  if (Test-Path -LiteralPath $backupPath) {
    Copy-Item -LiteralPath $backupPath -Destination $manifestPath -Force
    Write-Step "restored $backupPath -> $manifestPath"
  } else {
    Write-Step "no backup at $backupPath — manifest left as is"
  }
}

Write-Host ''
Write-Step 'uninstalled. Restart DSH so the host routes and the client bundle table drop the plugin.'
