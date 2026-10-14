param(
    [string]$CodexPath,
    [ValidateRange(1024, 65535)]
    [int]$Port = 9229,
    [switch]$CreateShortcut,
    [string]$ShortcutPath,
    [string]$StateDir
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
$setupArguments = @{ StateDir = $StateDir; CodexPath = $CodexPath; Port = $Port }
if ($ShortcutPath) { $setupArguments.DesktopDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($ShortcutPath)) }
# Kept for users of the 0.1.x command. New users use control.ps1 Start.
& (Join-Path $PSScriptRoot 'setup-windows.ps1') @setupArguments | Out-Null
if ($CreateShortcut) {
    Write-Output 'Dedicated launcher and login recovery configured.'
} else {
    Invoke-LensLaunch $StateDir $CodexPath
}
