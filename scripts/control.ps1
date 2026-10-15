param(
    [ValidateSet('Start', 'Stop', 'Status', 'Setup', 'Uninstall', 'DisableLoginRecovery')]
    [string]$Action = 'Start',
    [int]$Port = 0,
    [string]$StateDir,
    [string]$CodexHome,
    [string]$CodexPath,
    [switch]$DesktopShortcut,
    [switch]$LoginRecovery
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
if ($Action -eq 'DisableLoginRecovery') {
    Disable-LensLoginRecovery $StateDir
    Write-Output 'Lens login recovery disabled. The current helper and normal Codex startup are unchanged.'
    exit 0
}
if ($Action -in @('Stop', 'Uninstall')) { Stop-LensRestart $StateDir }
$nodeRuntime = Find-LensNode $installation.nodePath
if (-not $nodeRuntime) { throw 'Node.js 22 or newer is required. Codex itself is unaffected.' }
if ($Action -in @('Start', 'Setup')) {
    $setup = & (Join-Path $PSScriptRoot 'setup-windows.ps1') -StateDir $StateDir `
        -CodexHome $CodexHome -CodexPath $CodexPath -NodePath $nodeRuntime -Port $Port `
        -DesktopShortcut:$DesktopShortcut -LoginRecovery:$LoginRecovery
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
    Disable-LensLoginRecovery $StateDir
    Remove-LensOwnedShortcut $StateDir $installation.desktopShortcut 'launcher-windows.ps1' | Out-Null
    $installation = Read-LensInstallation $StateDir
    $installation.desktopInstalled = $false
    [IO.File]::WriteAllText((Join-Path $StateDir 'install.json'), ($installation | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Output 'Lens login recovery and dedicated shortcut removed. The original Codex shortcut is unchanged.'
} elseif ($Action -eq 'Start') {
    $connection = & $nodeRuntime (Join-Path $runtimeRoot 'src\cli.mjs') connection --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Could not check the local client connection. No restart was scheduled.' }
    if (($connection | ConvertFrom-Json).connected) {
        Stop-LensRestart $StateDir
    } else {
        $request = Start-LensRestart $installation
        Write-Output ('One-time restart prepared until ' + $request.expiresAt +
            '. Finish active work, then fully quit Codex normally within 15 minutes; it will reopen once with Usage Lens. No shortcut is needed. Stop cancels this request.')
    }
}
exit 0
