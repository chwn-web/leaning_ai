# 一键备份：把本机所有 DSH 会话推到私有仓库。
# 用途：关机前 / 换电脑前 / 重置系统前，跑一次就行。
#
# 用法：
#   powershell -File scripts\session-backup.ps1
#
# 注意：
# - 必须在**普通 PowerShell 窗口**里跑（不要在 DSH 沙箱里跑）：
#   沙箱限制下 git clone/push 会报 sh.exe: couldn't create signal pipe, Win32 error 5。
# - 首次运行前先配好远端（见 notes/换机与备份操作.md）。

$ErrorActionPreference = "Stop"

$sync = Join-Path $PSScriptRoot "..\plugins\session-cloud\sync.py"
$sync = (Resolve-Path $sync).Path

if (-not (Test-Path $sync)) { throw "找不到同步引擎：$sync" }

$env:PYTHONIOENCODING = "utf-8"

Write-Host "== 1/2 推送会话到私有仓库 ==" -ForegroundColor Cyan
python $sync push --all --force
if ($LASTEXITCODE -ne 0) { throw "推送失败，请看上面的输出（常见原因：没配远端、没登录 GitHub）" }

Write-Host "`n== 2/2 当前同步状态 ==" -ForegroundColor Cyan
python $sync status

Write-Host "`n✅ 备份完成。换机后在新机器上按 notes/换机与备份操作.md 的第 3 步拉回。" -ForegroundColor Green
