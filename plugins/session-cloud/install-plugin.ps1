# 安装 dsh-session-cloud 插件到 DSH web profile（需要完整文件权限）
#
# 做的事（每一步都可回滚）：
#   1. 备份 profile 的 package.json → package.json.bak-session-cloud
#   2. 把 dsh-plugin/ 拷到 <profile>/node_modules/dsh-session-cloud
#   3. 把 "dsh-session-cloud" 追加到 package.json 的 dsh.profile.bundles
#   4. 打印"重启才生效"的提示
#
# 不做的事：不改 cordis.patch.yml（插件自带 dsh.bundle.patch，宿主启动时会自动合并）

param(
    [string]$ProfileDir = "C:\Users\issuser\.dsh\profiles\web",
    [string]$SourceDir  = (Join-Path $PSScriptRoot "dsh-plugin")
)

$ErrorActionPreference = "Stop"
$pkgName = "dsh-session-cloud"

if (-not (Test-Path (Join-Path $SourceDir "package.json"))) {
    throw "找不到插件源：$SourceDir\package.json"
}
if (-not (Test-Path (Join-Path $ProfileDir "package.json"))) {
    throw "找不到 profile：$ProfileDir"
}

$profilePkg = Join-Path $ProfileDir "package.json"
$backup = "$profilePkg.bak-session-cloud"

# 1. 备份（只备份一次，保留最早的干净版本）
if (-not (Test-Path $backup)) {
    Copy-Item $profilePkg $backup
    Write-Host "已备份 profile package.json → $backup" -ForegroundColor DarkGray
} else {
    Write-Host "备份已存在，沿用：$backup" -ForegroundColor DarkGray
}

# 2. 拷文件
$target = Join-Path $ProfileDir "node_modules\$pkgName"
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Recurse -Force (Join-Path $SourceDir "*") $target
Write-Host "已安装到 $target" -ForegroundColor DarkGray

# 2b. 告诉宿主引擎在哪（装进 node_modules 后相对路径就断了，靠这个文件指回仓库里的 sync.py）
#     注意：必须写 UTF-8 **无 BOM**，宿主用 JSON.parse 读它，BOM 会让它整份失效。
$engineDir = (Resolve-Path $PSScriptRoot).Path
$engineCfg = @{ engineDir = $engineDir } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
    (Join-Path $target "session-cloud.json"),
    $engineCfg,
    (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "引擎指向：$engineDir\sync.py" -ForegroundColor DarkGray

# 3. 加入 bundles 列表（幂等）
$json = Get-Content $profilePkg -Raw | ConvertFrom-Json
$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains $pkgName) {
    $bundles += $pkgName
    $json.dsh.profile.bundles = $bundles
    $json | ConvertTo-Json -Depth 100 | Set-Content $profilePkg -Encoding UTF8
    Write-Host "已追加 bundle：$pkgName" -ForegroundColor DarkGray
} else {
    Write-Host "bundle 已在列表中：$pkgName" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "✅ 安装完成。接下来：完全退出 DSH 再启动（重启后浏览器模块清单才会包含它）。" -ForegroundColor Green
Write-Host "   回滚命令：powershell -File `"$PSScriptRoot\uninstall-plugin.ps1`"" -ForegroundColor DarkGray
