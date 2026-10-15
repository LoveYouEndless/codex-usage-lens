param([string]$StateDir)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'windows-common.ps1')
    if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
    Invoke-LensLogin $StateDir
} catch {
    # 登录恢复是可选功能，失败时不影响正常进入桌面。
    exit
}
