# 卸载 dsh-session-anywhere 插件（回滚安装）
#
# 做的事：
#   1. 从 profile package.json 的 dsh.profile.bundles 移除 "dsh-session-anywhere"
#   2. 删除 <profile>/node_modules/dsh-session-anywhere
#   3. 提示重启
#
# 如果 package.json 被改坏导致 DSH 起不来，直接用它旁边的备份恢复：
#   Copy-Item "<profile>\package.json.bak-session-cloud" "<profile>\package.json" -Force

param(
    [string]$ProfileDir = "C:\Users\issuser\.dsh\profiles\web"
)

$ErrorActionPreference = "Stop"
$pkgName = "dsh-session-anywhere"
$profilePkg = Join-Path $ProfileDir "package.json"

if (Test-Path $profilePkg) {
    $json = Get-Content $profilePkg -Raw | ConvertFrom-Json
    $bundles = @($json.dsh.profile.bundles) | Where-Object { $_ -ne $pkgName }
    $json.dsh.profile.bundles = @($bundles)
    $json | ConvertTo-Json -Depth 100 | Set-Content $profilePkg -Encoding UTF8
    Write-Host "已从 bundles 移除：$pkgName" -ForegroundColor DarkGray
}

$target = Join-Path $ProfileDir "node_modules\$pkgName"
if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
    Write-Host "已删除 $target" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "✅ 卸载完成。重启 DSH 后按钮消失。会话数据不受影响（备份仍在私有仓库）。" -ForegroundColor Green
