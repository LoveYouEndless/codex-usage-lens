param([string]$StateDir, [string]$Token)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'windows-common.ps1')
    if (-not $StateDir -or $Token -notmatch '^[a-f0-9]{32}$') { exit }
    Invoke-LensRestart $StateDir $Token
} catch {
    # 一次重开失败时，仍保留用户从普通入口启动 Codex 的能力。
    exit
}
