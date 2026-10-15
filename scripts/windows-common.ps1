# 供稳定启动器和登录恢复入口共用，不终止 Codex 进程。
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
            # PowerShell 7 无法原生使用 Appx 模块，回退到系统 PowerShell 查询。
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

function Invoke-LensLogin([string]$StateDir) {
    $installation = Read-LensInstallation $StateDir
    if (-not $installation -or -not $installation.loginRecovery) { return }
    $node = Find-LensNode $installation.nodePath
    if (-not (Read-LensPolicy $installation $node)) { return }
    # 登录后只恢复助手并等待连接，不启动或重开 Codex。
    Start-LensHelper $installation $node
}

function Remove-LensOwnedShortcut([string]$StateDir, [string]$Path, [string]$Entry) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $true }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $script = Join-Path $StateDir $Entry
    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $expected = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '" -StateDir "' + $StateDir + '"'
    if ($shortcut.TargetPath -eq $powerShell -and $shortcut.Arguments -eq $expected) {
        Remove-Item -LiteralPath $Path -Force
        return $true
    }
    Write-Warning "Existing unrelated shortcut kept: $Path"
    return $false
}

function Disable-LensLoginRecovery([string]$StateDir) {
    $installation = Read-LensInstallation $StateDir
    if (-not $installation) { return }
    # 先关闭恢复标记，让已经排队的登录入口也不再执行恢复。
    $installation.loginRecovery = $false
    [IO.File]::WriteAllText((Join-Path $StateDir 'install.json'), ($installation | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Remove-LensOwnedShortcut $StateDir $installation.startupShortcut 'resume-windows.ps1' | Out-Null
}

function Write-LensLaunchStatus([string]$StateDir, [string]$State) {
    try {
        if (-not (Test-Path -LiteralPath $StateDir)) { return }
        $value = @{ state = $State; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $StateDir 'launcher-status.json'), $value, [Text.UTF8Encoding]::new($false))
    } catch { }
}

function Get-LensCodexProcesses([string]$CodexPath) {
    $expected = [IO.Path]::GetFullPath($CodexPath)
    $name = [IO.Path]::GetFileNameWithoutExtension($expected)
    foreach ($process in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
        try {
            $path = $process.Path
            if (-not $path) { throw 'Process path unavailable.' }
            if ([string]::Equals([IO.Path]::GetFullPath($path), $expected, [StringComparison]::OrdinalIgnoreCase)) {
                [pscustomobject]@{ pid = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString('o') }
            }
        } catch {
            # 进程可能在检查时退出；身份不明且仍存活的进程不能被当作已退出。
            if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
                throw 'Cannot safely identify the running client. No restart was scheduled.'
            }
        }
    }
}

function Read-LensRestart([string]$StateDir) {
    try { return Get-Content -LiteralPath (Join-Path $StateDir 'restart-request.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return $null }
}

function Save-LensRestart([string]$StateDir, $Request) {
    $path = Join-Path $StateDir 'restart-request.json'
    $temporary = $path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($Request | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Set-LensRestartState([string]$StateDir, [string]$Token, [string]$State) {
    $request = Read-LensRestart $StateDir
    if ($request -and $request.token -eq $Token -and $request.state -eq 'waiting-for-exit') {
        $request.state = $State
        Save-LensRestart $StateDir $request
    }
}

function Stop-LensRestart([string]$StateDir) {
    $request = Read-LensRestart $StateDir
    if ($request) { Set-LensRestartState $StateDir $request.token 'cancelled' }
}

function Start-LensRestart($Installation) {
    $application = Find-CodexApplication $Installation.codexPath
    if (-not $application) { throw 'Codex could not be located. No restart was scheduled.' }
    $processes = @(Get-LensCodexProcesses $application.Path)
    if ($processes.Count -eq 0) { throw 'No matching running Codex was found. No restart was scheduled.' }
    $request = [pscustomobject]@{
        token = [guid]::NewGuid().ToString('N')
        state = 'waiting-for-exit'
        expiresAt = [DateTime]::UtcNow.AddMinutes(15).ToString('o')
        codexPath = $application.Path
        processes = $processes
    }
    Save-LensRestart $Installation.stateDir $request
    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $script = Join-Path $Installation.stateDir 'restart-windows.ps1'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script +
        '" -StateDir "' + $Installation.stateDir + '" -Token "' + $request.token + '"'
    try { Start-Process -FilePath $powerShell -ArgumentList $arguments -WindowStyle Hidden | Out-Null }
    catch {
        Set-LensRestartState $Installation.stateDir $request.token 'failed'
        throw 'The one-time restart could not be prepared. Codex is unaffected.'
    }
    return $request
}

function Invoke-LensRestart([string]$StateDir, [string]$Token) {
    # 重开请求串行执行，避免重复启用时同时拉起两个客户端。
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($StateDir).ToUpperInvariant()))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = [Threading.Mutex]::new($false, ('Local\CodexUsageLensRestart-' + $key))
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(10000) }
        catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { return }
        while ($true) {
            $request = Read-LensRestart $StateDir
            if (-not $request -or $request.token -ne $Token -or $request.state -ne 'waiting-for-exit') { return }
            if ([DateTime]::Parse($request.expiresAt).ToUniversalTime() -le [DateTime]::UtcNow) {
                Set-LensRestartState $StateDir $Token 'expired'
                return
            }
            $installation = Read-LensInstallation $StateDir
            $node = Find-LensNode $installation.nodePath
            if (-not (Read-LensPolicy $installation $node)) {
                Set-LensRestartState $StateDir $Token 'cancelled'
                return
            }
            if (-not $request.processes -or -not $request.codexPath) { throw 'Invalid restart request.' }
            $running = @(Get-LensCodexProcesses $request.codexPath)
            $original = @($running | Where-Object {
                $current = $_
                @($request.processes | Where-Object { $_.pid -eq $current.pid -and $_.startedAt -eq $current.startedAt }).Count -gt 0
            })
            if ($original.Count -gt 0) { Start-Sleep -Milliseconds 1000; continue }
            if ($running.Count -gt 0) {
                Set-LensRestartState $StateDir $Token 'client-already-reopened'
                return
            }
            # 启动前先消耗请求；重复启用或停止会使旧请求失效，不循环重试启动。
            $latest = Read-LensRestart $StateDir
            if (-not $latest -or $latest.token -ne $Token -or $latest.state -ne 'waiting-for-exit') { return }
            Set-LensRestartState $StateDir $Token 'completed'
            Invoke-LensLaunch $StateDir ''
            return
        }
    } catch {
        Set-LensRestartState $StateDir $Token 'failed'
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Invoke-LensLaunch([string]$StateDir, [string]$CodexPath) {
    # 客户端启动独立于助手，配置损坏时也应保留正常启动能力。
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
    # 安装信息、插件开关或端口检查失败时，回退到普通启动。
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
            # 新版客户端拒绝调试参数并立即退出时，仅回退一次，不关闭已有客户端。
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
