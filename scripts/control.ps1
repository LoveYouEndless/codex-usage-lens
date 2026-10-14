param(
    [ValidateSet('Start', 'Stop', 'Status', 'Setup', 'Uninstall')]
    [string]$Action = 'Start',
    [int]$Port = 0,
    [string]$StateDir,
    [string]$CodexHome,
    [string]$CodexPath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$pluginRoot = Split-Path -Parent $PSScriptRoot
if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
if (-not $CodexHome) {
    $CodexHome = $env:CODEX_HOME
    if (-not $CodexHome) { $CodexHome = Join-Path $env:USERPROFILE '.codex' }
}
$installation = Read-LensInstallation $StateDir
$nodeRuntime = Find-LensNode $installation.nodePath
if (-not $nodeRuntime) { throw 'Node.js 22 or newer is required. Codex itself is unaffected.' }
if ($Action -in @('Start', 'Setup')) {
    $setup = & (Join-Path $PSScriptRoot 'setup-windows.ps1') -StateDir $StateDir `
        -CodexHome $CodexHome -CodexPath $CodexPath -NodePath $nodeRuntime -Port $Port
    $installation = $setup | ConvertFrom-Json
    if ($Action -eq 'Setup') { $setup; exit }
}
$runtimeRoot = $pluginRoot
if ($installation) { $runtimeRoot = $installation.runtimePath }
$runtimeArguments = @((Join-Path $runtimeRoot 'src\cli.mjs'), $Action.ToLowerInvariant(),
    '--state-dir', $StateDir, '--codex-home', $CodexHome)
if ($installation) {
    $runtimeArguments += @('--plugin-id', $installation.pluginId)
    if ($Port -eq 0) { $Port = $installation.port }
}
if ($Port -gt 0) { $runtimeArguments += @('--port', "$Port") }
if ($Action -eq 'Uninstall') { $runtimeArguments[1] = 'stop' }
& $nodeRuntime @runtimeArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Action -eq 'Uninstall' -and $installation) {
    foreach ($entry in @(
        @{ Path = $installation.desktopShortcut; Script = 'launcher-windows.ps1' },
        @{ Path = $installation.startupShortcut; Script = 'resume-windows.ps1' }
    )) {
        if ($entry.Path -and (Test-Path -LiteralPath $entry.Path)) {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($entry.Path)
            $expected = Join-Path $StateDir $entry.Script
            if ($shortcut.Arguments.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                Remove-Item -LiteralPath $entry.Path -Force
            }
        }
    }
    $installation.loginRecovery = $false
    $installation.desktopInstalled = $false
    [IO.File]::WriteAllText((Join-Path $StateDir 'install.json'), ($installation | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Output 'Lens login recovery and dedicated shortcut removed. The original Codex shortcut is unchanged.'
} elseif ($Action -eq 'Start') {
    $connection = & $nodeRuntime (Join-Path $runtimeRoot 'src\cli.mjs') connection --port $Port
    if ($LASTEXITCODE -eq 0 -and -not ($connection | ConvertFrom-Json).connected) {
        Write-Output 'First activation: finish active work, close Codex normally, then open the Codex Usage Lens desktop shortcut.'
    }
}
exit 0
