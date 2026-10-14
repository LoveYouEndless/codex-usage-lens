# Shared by the stable launcher and login entry. Never terminate Codex.
function Get-LensStateDirectory {
    if ($env:LOCALAPPDATA) { return Join-Path $env:LOCALAPPDATA 'CodexUsageLens' }
    return Join-Path $env:USERPROFILE 'AppData\Local\CodexUsageLens'
}

function Find-LensNode([string]$PreferredPath) {
    $candidates = @(
        $PreferredPath,
        (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            try {
                $version = & $candidate --version 2>$null
                if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)' -and [int]$Matches[1] -ge 22) {
                    return (Resolve-Path -LiteralPath $candidate).Path
                }
            } catch { }
        }
    }
    return $null
}

function Find-CodexApplication([string]$PreferredPath) {
    $discovered = $null
    try {
        try {
            $packages = @(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop)
        } catch {
            # The Appx module is not available natively in PowerShell 7.
            $nativePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $packageJSON = & $nativePowerShell -NoProfile -NonInteractive -Command `
                'Get-AppxPackage -Name OpenAI.Codex | Select-Object Version,InstallLocation,PackageFullName,PackageFamilyName | ConvertTo-Json -Depth 3' 2>$null
            $packages = @()
            if ($LASTEXITCODE -eq 0 -and $packageJSON) { $packages = @($packageJSON | ConvertFrom-Json) }
        }
        $packages = @($packages | Sort-Object -Property @{ Expression = { [version]$_.Version } } -Descending)
        foreach ($package in $packages) {
            foreach ($relative in @('app\ChatGPT.exe', 'app\Codex.exe', 'ChatGPT.exe', 'Codex.exe')) {
                $candidate = Join-Path $package.InstallLocation $relative
                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    $discovered = [pscustomobject]@{ Path = $candidate; AppId = $null }
                    break
                }
            }
            if (-not $discovered) {
                try {
                    $manifest = Get-AppxPackageManifest $package.PackageFullName -ErrorAction Stop
                    foreach ($app in @($manifest.Package.Applications.Application)) {
                        if (-not $app.Executable) { continue }
                        $candidate = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation ([string]$app.Executable)))
                        $packageRoot = [IO.Path]::GetFullPath($package.InstallLocation) + [IO.Path]::DirectorySeparatorChar
                        if ($candidate.StartsWith($packageRoot, [StringComparison]::OrdinalIgnoreCase) -and
                            [IO.Path]::GetExtension($candidate) -eq '.exe' -and (Test-Path -LiteralPath $candidate)) {
                            $discovered = [pscustomobject]@{ Path = $candidate; AppId = $null }
                            break
                        }
                    }
                } catch { }
            }
            if ($discovered) { break }
        }
    } catch { }
    if ($discovered) { return $discovered }
    if ($PreferredPath -and [IO.Path]::GetExtension($PreferredPath) -eq '.exe' -and
        (Test-Path -LiteralPath $PreferredPath -PathType Leaf)) {
        return [pscustomobject]@{ Path = (Resolve-Path -LiteralPath $PreferredPath).Path; AppId = $null }
    }
    return $null
}

function Read-LensInstallation([string]$StateDir) {
    $path = Join-Path $StateDir 'install.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($value.product -ne 'codex-usage-lens') { return $null }
        $root = [IO.Path]::GetFullPath((Join-Path $StateDir 'runtimes')) + [IO.Path]::DirectorySeparatorChar
        $runtime = [IO.Path]::GetFullPath([string]$value.runtimePath)
        if (-not $runtime.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        return $value
    } catch { return $null }
}

function Read-LensPolicy($Installation, [string]$NodePath) {
    if (-not $Installation -or -not $NodePath) { return $false }
    try {
        $cli = Join-Path $Installation.runtimePath 'src\cli.mjs'
        $result = & $NodePath $cli status --state-dir $Installation.stateDir `
            --codex-home $Installation.codexHome --plugin-id $Installation.pluginId 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        return (($result | ConvertFrom-Json).policy -eq 'enabled')
    } catch { return $false }
}

function Start-LensHelper($Installation, [string]$NodePath) {
    if (-not $Installation -or -not $NodePath) { return }
    try {
        $cli = Join-Path $Installation.runtimePath 'src\cli.mjs'
        $arguments = @(
            ('"' + $cli + '"'), 'resume',
            '--state-dir', ('"' + $Installation.stateDir + '"'),
            '--codex-home', ('"' + $Installation.codexHome + '"'),
            '--plugin-id', ('"' + $Installation.pluginId + '"'),
            '--port', [string]$Installation.port
        )
        Start-Process -FilePath $NodePath -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    } catch { Write-LensLaunchStatus $Installation.stateDir 'helper-unavailable' }
}

function Write-LensLaunchStatus([string]$StateDir, [string]$State) {
    try {
        if (-not (Test-Path -LiteralPath $StateDir)) { return }
        $value = @{ state = $State; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $StateDir 'launcher-status.json'), $value, [Text.UTF8Encoding]::new($false))
    } catch { }
}

function Invoke-LensLaunch([string]$StateDir, [string]$CodexPath) {
    # Application launch is independent of the helper and even damaged settings.
    $installation = Read-LensInstallation $StateDir
    $hint = $CodexPath
    if (-not $hint -and $installation) { $hint = $installation.codexPath }
    $application = Find-CodexApplication $hint
    if (-not $application) {
        Write-LensLaunchStatus $StateDir 'codex-not-found'
        Write-Warning 'Codex could not be located. Open it from your normal shortcut.'
        return
    }
    $running = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($application.Path)) -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        $node = Find-LensNode $installation.nodePath
        if (Read-LensPolicy $installation $node) { Start-LensHelper $installation $node }
        Write-LensLaunchStatus $StateDir 'codex-already-running'
        return
    }
    # Start the ordinary client first on every setup/policy/port failure.
    $debug = $false
    $node = $null
    try {
        if ($installation) {
            $node = Find-LensNode $installation.nodePath
            if (Read-LensPolicy $installation $node) {
                $listeners = @(Get-NetTCPConnection -LocalPort $installation.port -State Listen -ErrorAction SilentlyContinue)
                if ($listeners.Count -eq 0) { $debug = $true }
            }
        }
    } catch { $debug = $false }
    $launched = $false
    try {
        if ($debug) {
            $debugArguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$($installation.port)"
            $process = Start-Process -FilePath $application.Path -ArgumentList $debugArguments -WindowStyle Normal -PassThru
            # If a new build rejects debugging and exits immediately, fall back
            # once. Never close an existing client or retry in a launch loop.
            if ($process.WaitForExit(700) -and
                @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($application.Path)) -ErrorAction SilentlyContinue).Count -eq 0) {
                Start-Process -FilePath $application.Path -WindowStyle Normal | Out-Null
                $debug = $false
            }
        } else { Start-Process -FilePath $application.Path -WindowStyle Normal | Out-Null }
        $launched = $true
    } catch {
        if ($debug) {
            try {
                Start-Process -FilePath $application.Path -WindowStyle Normal | Out-Null
                $launched = $true
                $debug = $false
            } catch { }
        }
    }
    if (-not $launched) {
        Write-LensLaunchStatus $StateDir 'launch-failed'
        Write-Warning 'The dedicated launcher could not open Codex. Use the original Codex shortcut.'
        return
    }
    Write-LensLaunchStatus $StateDir $(if ($debug) { 'launched-with-lens' } else { 'launched-normally' })
    if ($debug) { Start-LensHelper $installation $node }
}
