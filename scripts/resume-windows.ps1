param([string]$StateDir)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'windows-common.ps1')
    if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
    $installation = Read-LensInstallation $StateDir
    if (-not $installation) { exit }
    $nodeRuntime = Find-LensNode $installation.nodePath
    if (Read-LensPolicy $installation $nodeRuntime) { Start-LensHelper $installation $nodeRuntime }
} catch {
    # Login recovery is optional and must not interrupt normal desktop startup.
    exit
}
