param([string]$StateDir, [string]$CodexPath)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'windows-common.ps1')
    if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
    Invoke-LensLaunch $StateDir $CodexPath
} catch {
    # Even a broken Lens script should leave the original client accessible.
    if ($CodexPath -and (Test-Path -LiteralPath $CodexPath -PathType Leaf)) {
        try { Start-Process -FilePath $CodexPath -WindowStyle Normal | Out-Null; exit } catch { }
    }
    try {
        $package = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
        if ($package) {
            $manifest = Get-AppxPackageManifest $package.PackageFullName
            $appId = [string]@($manifest.Package.Applications.Application)[0].Id
            if ($appId) { Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($package.PackageFamilyName)!$appId" -WindowStyle Normal }
        }
    } catch { }
}
