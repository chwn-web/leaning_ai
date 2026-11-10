# dsh-session-cloud — install into a DSH profile.
#
# What it does (in order, all idempotent):
#   1. backs the profile manifest up to package.json.bak-session-cloud (only the
#      first time — an existing backup is never overwritten by a modified file);
#   2. copies this bundle to <profile>\node_modules\dsh-session-cloud;
#   3. writes <installed>\session-cloud.json so the host half knows where sync.py
#      lives (no guessing, no hard-coded repo path at runtime);
#   4. appends "dsh-session-cloud" to dsh.profile.bundles in the profile manifest.
#
# No npm/pnpm/tsdown is involved: every artifact is hand-written JS.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProfileDir C:\Users\me\.dsh\profiles\web -EngineDir D:\somewhere\session-cloud

[CmdletBinding()]
param(
  [string] $ProfileDir = 'C:\Users\issuser\.dsh\profiles\web',
  [string] $EngineDir  = 'D:\TCL\leaning_AI_agent\plugins\session-cloud',
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$PackageName = 'dsh-session-cloud'
$BundleDir   = $PSScriptRoot
$Utf8NoBom   = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string] $Message) { Write-Host "[session-cloud] $Message" }
function Stop-WithError([string] $Message) { Write-Host "[session-cloud] ERROR: $Message" -ForegroundColor Red; exit 1 }
function Write-JsonFile([string] $Path, [string] $Text) { [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom) }

Write-Step "bundle source: $BundleDir"
Write-Step "profile:       $ProfileDir"
Write-Step "engine:        $EngineDir"

# ---------------------------------------------------------------- preconditions
$manifestPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  Stop-WithError "profile manifest not found: $manifestPath (is -ProfileDir right?)"
}
foreach ($required in @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $BundleDir $required))) {
    Stop-WithError "bundle is incomplete: missing $required under $BundleDir"
  }
}
$engineScript = Join-Path $EngineDir 'sync.py'
if (-not (Test-Path -LiteralPath $engineScript)) {
  Stop-WithError "sync.py not found at $engineScript (pass -EngineDir <session-cloud dir>)"
}

$nodeModules = Join-Path $ProfileDir 'node_modules'
$target      = Join-Path $nodeModules $PackageName
$backupPath  = Join-Path $ProfileDir 'package.json.bak-session-cloud'

if ($DryRun) {
  Write-Step 'DRY RUN — nothing is written.'
  Write-Step "would back up $manifestPath -> $backupPath"
  Write-Step "would copy   $BundleDir -> $target"
  Write-Step "would write  $(Join-Path $target 'session-cloud.json')"
  Write-Step "would append `"$PackageName`" to dsh.profile.bundles"
  exit 0
}

# --------------------------------------------------------------------- 1) backup
if (Test-Path -LiteralPath $backupPath) {
  Write-Step "backup already exists, keeping it: $backupPath"
} else {
  Copy-Item -LiteralPath $manifestPath -Destination $backupPath -Force
  Write-Step "backed up manifest -> $backupPath"
}

# ----------------------------------------------------------------- 2) copy bundle
if (-not (Test-Path -LiteralPath $nodeModules)) {
  New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null
}
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Step 'removed the previous installation'
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $BundleDir '*') -Destination $target -Recurse -Force
Write-Step "copied bundle -> $target"

# -------------------------------------------------- 3) point the host half at sync.py
$engineConfig = @{ engineDir = (Resolve-Path -LiteralPath $EngineDir).Path } | ConvertTo-Json
Write-JsonFile (Join-Path $target 'session-cloud.json') ($engineConfig + "`n")
Write-Step "wrote engine pointer: $(Join-Path $target 'session-cloud.json')"

# --------------------------------------------------- 4) register the profile bundle
$raw = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$manifest = $raw | ConvertFrom-Json
if ($manifest.dsh -eq $null) { $manifest | Add-Member -MemberType NoteProperty -Name dsh -Value (New-Object psobject) }
if ($manifest.dsh.profile -eq $null) { $manifest.dsh | Add-Member -MemberType NoteProperty -Name profile -Value (New-Object psobject) }

$bundles = @()
if ($manifest.dsh.profile.bundles -ne $null) {
  $bundles = @($manifest.dsh.profile.bundles)
}
if ($bundles -contains $PackageName) {
  Write-Step "dsh.profile.bundles already lists $PackageName"
} else {
  $bundles = @($bundles + $PackageName)
  $manifest.dsh.profile | Add-Member -MemberType NoteProperty -Name bundles -Value $bundles -Force
  $json = $manifest | ConvertTo-Json -Depth 32
  Write-JsonFile $manifestPath ($json + "`n")
  Write-Step "appended $PackageName to dsh.profile.bundles (now $($bundles.Count) bundles)"
}

# ----------------------------------------------------------------------- verify
$check = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ((@($check.dsh.profile.bundles) -contains $PackageName) -eq $false) {
  Stop-WithError "manifest write did not stick; restore $backupPath manually"
}
foreach ($file in @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\client.js', 'session-cloud.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $target $file))) {
    Stop-WithError "expected file missing after install: $(Join-Path $target $file)"
  }
}

Write-Host ''
Write-Step 'installed.'
Write-Host @"
Next steps
  1. restart DSH (host routes and the client bundle table are assembled at boot;
     a browser refresh alone is not enough):
       - stop the running `dsh web` process (Ctrl+C in its terminal, or quit the
         desktop app that owns it), then start it again;
       - reload http://127.0.0.1:3080 afterwards.
  2. smoke-check the host half once it is back:
       Invoke-RestMethod http://127.0.0.1:3080/session-cloud/health
  3. the chip appears at the left end of the composer tool row; it reads
     `☁ 云同步` / `🖥 仅本机` for the current conversation.
Rollback
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
  (or restore $backupPath over package.json and delete $target, then restart)
"@
