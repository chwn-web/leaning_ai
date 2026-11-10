# 一键备份：把本机所有 DSH 会话推到私有仓库。
# 用途：关机前 / 换电脑前 / 重置系统前，跑一次；也由计划任务每 2 小时自动跑。
#
# 手动用法（普通 PowerShell 窗口，不要在 DSH 沙箱里）：
#   powershell -File scripts\session-backup.ps1
#
# 自动任务：DSH-Session-Backup（每 2 小时，见 notes/换机与备份操作.md）
# 日志：仓库根目录 .tmp-backup.log（已 gitignore）

param(
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $root "plugins\session-cloud\sync.py"
$log  = Join-Path $root ".tmp-backup.log"

if (-not (Test-Path $sync)) { throw "找不到同步引擎：$sync" }

$env:PYTHONIOENCODING = "utf-8"
# 让 python 的 stdout 以 UTF-8 交给 PowerShell，否则中文在日志里会变成乱码
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Log([string]$text) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    Add-Content -Path $log -Value $line -Encoding UTF8
    if (-not $Quiet) { Write-Host $text }
}

try {
    $out = & python $sync push --all --force 2>&1
    $code = $LASTEXITCODE
    $out | ForEach-Object { Write-Log $_ }
    if ($code -ne 0) { throw "推送失败（exit $code）" }

    $status = & python $sync status 2>&1
    Write-Log ("状态：" + (($status | Select-Object -First 2) -join " / "))
    Write-Log "✅ 备份完成"
    exit 0
}
catch {
    Write-Log ("❌ 备份失败：" + $_.Exception.Message)
    exit 1
}
