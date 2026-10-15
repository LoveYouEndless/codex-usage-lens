param([string]$StateDir, [string]$CodexHome, [int]$Port = 0)
$ErrorActionPreference = 'Stop'
$mutex = $null
$locked = $false
try {
    # hook 输入可能包含用户消息，直接丢弃，不解析、保留、记录或用于拼接命令。
    if ([Console]::IsInputRedirected) {
        $stream = [Console]::OpenStandardInput()
        $buffer = New-Object byte[] 8192
        while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) { }
    }
    . (Join-Path $PSScriptRoot 'windows-common.ps1')
    if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
    if (-not $CodexHome) {
        $CodexHome = $env:CODEX_HOME
        if (-not $CodexHome) { $CodexHome = Join-Path $env:USERPROFILE '.codex' }
    }
    $StateDir = [IO.Path]::GetFullPath($StateDir)
    $CodexHome = [IO.Path]::GetFullPath($CodexHome)
    if (Test-Path -LiteralPath (Join-Path $StateDir 'paused')) { exit 0 }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($StateDir.ToUpperInvariant()))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = [Threading.Mutex]::new($false, ('Local\CodexUsageLensHook-' + $key))
    try { $locked = $mutex.WaitOne(10000) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked -or (Test-Path -LiteralPath (Join-Path $StateDir 'paused'))) { exit 0 }
    $pluginRoot = Split-Path -Parent $PSScriptRoot
    $installation = Read-LensInstallation $StateDir
    $node = Find-LensNode $installation.nodePath
    if (-not $node) { throw 'Runtime unavailable.' }
    $version = (Get-Content -LiteralPath (Join-Path $pluginRoot 'package.json') -Raw | ConvertFrom-Json).version
    if (-not $installation -or $installation.version -ne $version -or
        $installation.pluginRoot -ne $pluginRoot -or $installation.codexHome -ne $CodexHome -or
        -not (Test-Path -LiteralPath (Join-Path $installation.runtimePath 'src\cli.mjs'))) {
        $setup = & (Join-Path $PSScriptRoot 'setup-windows.ps1') -StateDir $StateDir `
            -CodexHome $CodexHome -NodePath $node -Port $Port
        $installation = $setup | ConvertFrom-Json
    }
    $arguments = @((Join-Path $installation.runtimePath 'src\cli.mjs'), 'resume',
        '--state-dir', $StateDir, '--codex-home', $CodexHome, '--plugin-id', $installation.pluginId)
    if ($Port -gt 0) { $arguments += @('--port', "$Port") }
    & $node @arguments *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Helper unavailable.' }
} catch {
    # 恢复失败时静默退出，避免阻塞会话或在输出中泄露配置和用户消息。
    if ($StateDir -and (Test-Path -LiteralPath $StateDir -PathType Container)) {
        try {
            $status = @{ state = 'unavailable'; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
            [IO.File]::WriteAllText((Join-Path $StateDir 'hook-status.json'), $status, [Text.UTF8Encoding]::new($false))
        } catch { }
    }
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit 0
