$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot 'scripts\windows-common.ps1')
$script:checks = 0
function Check([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:checks++
}
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'scripts') -Filter '*.ps1' | ForEach-Object {
    # Windows PowerShell 5.1 需要 BOM，才能可靠识别包含中文的 UTF-8 脚本。
    $scriptText = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
    if ($scriptText -match '[^\x00-\x7F]') {
        $bytes = [IO.File]::ReadAllBytes($_.FullName)
        Check ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) `
            ("Chinese PowerShell comments require UTF-8 BOM: " + $_.Name)
    }
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors) | Out-Null
    Check ($errors.Count -eq 0) ("PowerShell parse failed: " + $_.Name)
}
$temporaryRoot = Join-Path $projectRoot ('.runtime\windows-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
$state = Join-Path $temporaryRoot 'state with spaces'
$codexHome = Join-Path $temporaryRoot 'codex home'
$desktop = Join-Path $temporaryRoot 'Desktop'
$startup = Join-Path $temporaryRoot 'Startup'
foreach ($path in @($state, $codexHome, $desktop, $startup)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
$fakeConfig = Join-Path $codexHome 'config.toml'
[IO.File]::WriteAllText($fakeConfig, "[plugins.`"codex-usage-lens@codex-usage-lens`"]`nenabled=true`n")
$node = Find-LensNode ''
Check ([bool]$node) 'Test requires an available Node.js 22 runtime.'
$setupScript = Join-Path $projectRoot 'scripts\setup-windows.ps1'
$default = & $setupScript -StateDir $state -CodexHome $codexHome -NodePath $node -Port 65433 `
    -DesktopDirectory $desktop -StartupDirectory $startup | ConvertFrom-Json
Check (-not $default.desktopInstalled -and -not $default.loginRecovery) 'Default setup must not opt into shortcuts or login startup.'
Check ((Get-ChildItem -LiteralPath $desktop).Count -eq 0 -and (Get-ChildItem -LiteralPath $startup).Count -eq 0) 'Default setup must not create shortcut files.'
Check (Test-Path -LiteralPath (Join-Path $state 'restart-windows.ps1')) 'Default setup must deploy the one-time restart entry.'
$installed = & $setupScript -StateDir $state -CodexHome $codexHome -NodePath $node -Port 65433 `
    -DesktopDirectory $desktop -StartupDirectory $startup -DesktopShortcut -LoginRecovery | ConvertFrom-Json
Check ($installed.loginRecovery -eq $true) 'Setup must register login recovery.'
Check ($installed.desktopInstalled -eq $true) 'Setup must create a dedicated shortcut.'
Check (Test-Path -LiteralPath (Join-Path $installed.runtimePath 'vendor\toml.mjs')) 'Stable runtime must include its parser.'
Check (-not (Test-Path -LiteralPath (Join-Path $installed.runtimePath '.git'))) 'Runtime deployment must exclude repository state.'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($installed.desktopShortcut)
Check ($shortcut.TargetPath -match 'powershell.exe$') 'Shortcut must use a stable launcher, not a version-specific Codex path.'
Check ($shortcut.Arguments.Contains((Join-Path $state 'launcher-windows.ps1'))) 'Shortcut must point to the stable launcher.'
$login = $shell.CreateShortcut($installed.startupShortcut)
Check ($login.Arguments.Contains((Join-Path $state 'resume-windows.ps1'))) 'Login shortcut must use recovery, not the Codex launcher.'
$second = & $setupScript -StateDir $state -CodexHome $codexHome -NodePath $node -Port 65433 `
    -DesktopDirectory $desktop -StartupDirectory $startup | ConvertFrom-Json
Check ($second.runtimePath -eq $installed.runtimePath) 'Repeated setup must retain the stable runtime pointer.'
Check ((Get-ChildItem -LiteralPath $startup -Filter '*.lnk').Count -eq 1) 'Repeated setup must not create duplicate login entries.'
Check ($second.loginRecovery -and $second.desktopInstalled) 'Setup must preserve previous explicitly configured entries.'
$self = Get-Process -Id $PID
$selfMatches = @(Get-LensCodexProcesses $self.Path | Where-Object { $_.pid -eq $PID })
Check ($selfMatches.Count -eq 1 -and [bool]$selfMatches[0].startedAt) 'Process identity must include the real executable path, PID, and start time.'
$expired = [pscustomobject]@{
    token = [guid]::NewGuid().ToString('N'); state = 'waiting-for-exit'
    expiresAt = [DateTime]::UtcNow.AddSeconds(-1).ToString('o')
    codexPath = $self.Path; processes = $selfMatches
}
Save-LensRestart $state $expired
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $state 'restart-windows.ps1') `
    -StateDir $state -Token $expired.token
Check ((Read-LensRestart $state).state -eq 'expired') 'The deployed restart entry must run independently and expire without launching a client.'

# 使用已禁用的测试配置检查真实登录入口，不读取用户配置。
[IO.File]::WriteAllText($fakeConfig, "[plugins.`"codex-usage-lens@codex-usage-lens`"]`nenabled=false`n")
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $state 'resume-windows.ps1') -StateDir $state
Check (-not (Test-Path -LiteralPath (Join-Path $state 'control.json'))) 'Disabled plugin must not start at login.'
$null = & $node (Join-Path $installed.runtimePath 'src\cli.mjs') status --state-dir $state --codex-home $codexHome
Check ($LASTEXITCODE -eq 0) 'Deployed runtime must function without node_modules or the plugin cache.'
[IO.File]::WriteAllText($fakeConfig, "[plugins.`"codex-usage-lens@codex-usage-lens`"]`nenabled=true`n")
& $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $state 'resume-windows.ps1') -StateDir $state
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-Path -LiteralPath (Join-Path $state 'control.json')) { break }
    Start-Sleep -Milliseconds 100
}
Check (Test-Path -LiteralPath (Join-Path $state 'control.json')) 'Enabled login entry must start the stable deployed helper.'
$null = & $node (Join-Path $installed.runtimePath 'src\cli.mjs') stop --state-dir $state --codex-home $codexHome
Check ($LASTEXITCODE -eq 0) 'Login helper must stop cleanly.'
$ordinary = $shell.CreateShortcut((Join-Path $desktop 'Original Codex.lnk'))
$ordinary.TargetPath = $env:ComSpec
$ordinary.Save()
$controlScript = Join-Path $projectRoot 'scripts\control.ps1'
$null = & $powerShell -NoProfile -ExecutionPolicy Bypass -File $controlScript -Action Uninstall `
    -StateDir $state -CodexHome $codexHome
Check (-not (Test-Path -LiteralPath $installed.startupShortcut)) 'Uninstall must remove its owned login entry.'
Check (-not (Test-Path -LiteralPath $installed.desktopShortcut)) 'Uninstall must remove its owned desktop entry.'
Check (Test-Path -LiteralPath (Join-Path $desktop 'Original Codex.lnk')) 'Uninstall must preserve the ordinary application shortcut.'
$null = & $setupScript -StateDir $state -CodexHome $codexHome -NodePath $node -Port 65433 `
    -DesktopDirectory $desktop -StartupDirectory $startup -DesktopShortcut -LoginRecovery
$foreign = $shell.CreateShortcut($installed.desktopShortcut)
$foreign.TargetPath = $env:ComSpec
$foreign.Arguments = '/c exit'
$foreign.Save()
$null = & $powerShell -NoProfile -ExecutionPolicy Bypass -File $controlScript -Action Uninstall `
    -StateDir $state -CodexHome $codexHome
Check (Test-Path -LiteralPath $installed.desktopShortcut) 'Uninstall must not remove a replaced, unrelated shortcut.'
Check ((Get-Content -LiteralPath $fakeConfig -Raw) -match 'enabled=true') 'Setup and uninstall must not rewrite the Codex plugin switch.'
$recovery = & $setupScript -StateDir $state -CodexHome $codexHome -NodePath $node -Port 65433 `
    -DesktopDirectory $desktop -StartupDirectory $startup -LoginRecovery | ConvertFrom-Json
$recoveryStatus = & $node (Join-Path $recovery.runtimePath 'src\cli.mjs') status --state-dir $state --codex-home $codexHome | ConvertFrom-Json
Check ($recoveryStatus.loginRecovery -eq $true) 'Status must report explicitly registered helper recovery.'
$null = & $powerShell -NoProfile -ExecutionPolicy Bypass -File $controlScript -Action DisableLoginRecovery `
    -StateDir $state -CodexHome $codexHome
Check (-not (Test-Path -LiteralPath $recovery.startupShortcut)) 'Disabling login recovery must remove its owned entry.'
Check (Test-Path -LiteralPath $installed.desktopShortcut) 'Disabling login recovery must preserve unrelated desktop files.'
Check (-not (Read-LensInstallation $state).loginRecovery) 'Disabling recovery must also invalidate queued login entries.'
$recoveryStatus = & $node (Join-Path $recovery.runtimePath 'src\cli.mjs') status --state-dir $state --codex-home $codexHome | ConvertFrom-Json
Check ($recoveryStatus.loginRecovery -eq $false) 'Status must report disabled login recovery.'
& $powerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $state 'resume-windows.ps1') -StateDir $state
Check (-not (Test-Path -LiteralPath (Join-Path $state 'control.json'))) 'A queued login entry must not resume after recovery is disabled.'
$null = & $setupScript -StateDir $state -CodexHome $codexHome -NodePath $node -Port 65433 `
    -DesktopDirectory $desktop -StartupDirectory $startup -LoginRecovery
$foreignLogin = $shell.CreateShortcut($recovery.startupShortcut)
$foreignLogin.TargetPath = $env:ComSpec
$foreignLogin.Arguments = '/c exit'
$foreignLogin.Save()
$null = & $powerShell -NoProfile -ExecutionPolicy Bypass -File $controlScript -Action DisableLoginRecovery `
    -StateDir $state -CodexHome $codexHome
Check (Test-Path -LiteralPath $recovery.startupShortcut) 'Disabling recovery must preserve a replaced, unrelated login shortcut.'
Check (-not (Read-LensInstallation $state).loginRecovery) 'Unrelated entries must not prevent recovery from being disabled.'

# 用模拟安装包验证客户端升级后的路径发现。
$older = Join-Path $temporaryRoot 'codex-old'
$newer = Join-Path $temporaryRoot 'codex-new'
foreach ($path in @($older, $newer)) {
    New-Item -ItemType Directory -Path (Join-Path $path 'app') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $path 'app\Codex.exe'), 'fixture')
}
$script:packageFixtures = @(
    [pscustomobject]@{ Version='26.818.1.0'; InstallLocation=$older },
    [pscustomobject]@{ Version='26.1000.1.0'; InstallLocation=$newer }
)
function Get-AppxPackage { param($Name, $ErrorAction) return $script:packageFixtures }
$application = Find-CodexApplication (Join-Path $older 'app\Codex.exe')
Check ($application.Path -eq (Join-Path $newer 'app\Codex.exe')) 'Launcher must discover the new client path after upgrade.'
[IO.File]::WriteAllText((Join-Path $newer 'app\ChatGPT.exe'), 'fixture')
$application = Find-CodexApplication (Join-Path $older 'app\Codex.exe')
Check ($application.Path -eq (Join-Path $newer 'app\ChatGPT.exe')) 'Integrated Codex builds using ChatGPT.exe must be discovered.'

# 启动测试替换进程接口，不打开或关闭真实应用。
$script:launches = @()
$script:helperStarts = 0
$script:enabled = $true
$script:missingNode = $false
$script:busyPort = $false
$script:rejectDebug = $false
$script:throwDebug = $false
$script:runningCodex = $false
$script:noInstallation = $false
function Read-LensInstallation { param($StateDir) if (-not $script:noInstallation) { return $installed } }
function Find-CodexApplication { param($PreferredPath) return [pscustomobject]@{ Path='C:\fixture\Codex.exe' } }
function Find-LensNode { param($PreferredPath) if (-not $script:missingNode) { return 'C:\fixture\node.exe' } }
function Read-LensPolicy { param($Installation, $NodePath) return [bool]($Installation -and $NodePath -and $script:enabled) }
function Get-NetTCPConnection { param($LocalPort, $State, $ErrorAction) if ($script:busyPort) { return [pscustomobject]@{ Port=$LocalPort } } }
function Get-Process { param($Name, $ErrorAction) if ($script:runningCodex) { return [pscustomobject]@{ Name=$Name } } }
function Start-LensHelper { param($Installation, $NodePath) $script:helperStarts++ }
function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, [switch]$PassThru)
    $script:launches += [pscustomobject]@{ Path=$FilePath; Arguments=[string]$ArgumentList; WindowStyle=$WindowStyle }
    if ($script:throwDebug -and [string]$ArgumentList -match 'remote-debugging') { throw 'Simulated debug launch failure' }
    if ($PassThru) {
        $process = [pscustomobject]@{}
        $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Timeout) return $script:rejectDebug }
        return $process
    }
}
function Reset-Launch {
    $script:launches=@(); $script:helperStarts=0; $script:enabled=$true; $script:missingNode=$false
    $script:busyPort=$false; $script:rejectDebug=$false; $script:throwDebug=$false
    $script:runningCodex=$false; $script:noInstallation=$false
}
Invoke-LensLogin $state
Check ($script:launches.Count -eq 0 -and $script:helperStarts -eq 1) 'Login recovery must resume only the helper and never open Codex.'
Reset-Launch
$installed.loginRecovery = $false
Invoke-LensLogin $state
Check ($script:launches.Count -eq 0 -and $script:helperStarts -eq 0) 'Opting out must make login recovery a no-op.'
$installed.loginRecovery = $true
Reset-Launch
$script:enabled = $false
Invoke-LensLogin $state
Check ($script:launches.Count -eq 0 -and $script:helperStarts -eq 0) 'Disabled plugins must not resume or open Codex at login.'
Reset-Launch
$script:missingNode = $true
Invoke-LensLogin $state
Check ($script:launches.Count -eq 0 -and $script:helperStarts -eq 0) 'Missing Node at login must never trigger a client launch fallback.'
Reset-Launch
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 1 -and $script:launches[0].Arguments -match 'remote-debugging-address=127.0.0.1') 'Enabled launch should use loopback debugging.'
Check ($script:helperStarts -eq 1) 'Enabled launch should resume its helper.'
Reset-Launch
$script:enabled=$false
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 1 -and -not $script:launches[0].Arguments) 'Disabled Lens must launch ordinary Codex.'
Check ($script:helperStarts -eq 0) 'Disabled Lens must not start its helper.'
Reset-Launch
$script:missingNode=$true
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 1 -and -not $script:launches[0].Arguments) 'Missing Node must not block Codex.'
Reset-Launch
$script:busyPort=$true
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 1 -and -not $script:launches[0].Arguments) 'A busy debug port must not block Codex.'
Reset-Launch
$script:noInstallation=$true
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 1 -and -not $script:launches[0].Arguments) 'Missing installation metadata must not block Codex.'
Reset-Launch
$script:rejectDebug=$true
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 2 -and -not $script:launches[1].Arguments) 'A build that immediately rejects debugging must get one ordinary launch fallback.'
Check ($script:helperStarts -eq 0) 'Rejected debugging must not start a helper.'
Reset-Launch
$script:throwDebug=$true
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 2 -and -not $script:launches[1].Arguments) 'A debug launch exception must get one ordinary fallback.'
Reset-Launch
$script:runningCodex=$true
Invoke-LensLaunch $state ''
Check ($script:launches.Count -eq 0) 'An already running Codex must never be restarted.'
Check ($script:helperStarts -eq 1) 'An already running client can still resume Lens.'

# 用固定进程数据验证等待重开，不关闭真实应用。
$script:restartProcesses = @([pscustomobject]@{ pid=101; startedAt='2026-01-01T00:00:00.0000000Z' })
$script:afterSleep = {}
function Get-LensCodexProcesses { param($CodexPath) return $script:restartProcesses }
function Start-Sleep { param($Milliseconds) & $script:afterSleep }
function New-RestartFixture {
    Reset-Launch
    $script:restartProcesses = @([pscustomobject]@{ pid=101; startedAt='2026-01-01T00:00:00.0000000Z' })
    $script:afterSleep = { $script:restartProcesses = @() }
    return Start-LensRestart $installed
}
$request = New-RestartFixture
Check ($script:launches.Count -eq 1 -and $script:launches[0].WindowStyle -eq 'Hidden') 'Activation must start a hidden wait process, not another Codex.'
Check ($script:launches[0].Arguments -match 'restart-windows.ps1' -and $script:launches[0].Arguments -match $request.token) 'Wait entry must receive the one-time request identity.'
$script:launches = @()
$script:afterSleep = {
    Check ($script:launches.Count -eq 0) 'Codex must not be launched while the original process is still running.'
    $script:restartProcesses = @()
}
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 1 -and $script:launches[0].Arguments -match 'remote-debugging') 'Normal exit must trigger one debug-enabled reopen.'
Check ((Read-LensRestart $state).state -eq 'completed') 'A restart request must be consumed.'
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 1) 'A consumed request must never reopen Codex again.'

$request = New-RestartFixture
$script:launches = @()
Stop-LensRestart $state
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 0 -and (Read-LensRestart $state).state -eq 'cancelled') 'Stop must cancel a pending reopen.'

$request = New-RestartFixture
$script:launches = @()
$request.expiresAt = [DateTime]::UtcNow.AddSeconds(-1).ToString('o')
Save-LensRestart $state $request
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 0 -and (Read-LensRestart $state).state -eq 'expired') 'Expired requests must not reopen Codex.'

$request = New-RestartFixture
$script:launches = @()
$script:enabled = $false
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 0 -and (Read-LensRestart $state).state -eq 'cancelled') 'Disabling the plugin must cancel a pending reopen.'

$request = New-RestartFixture
$script:launches = @()
$script:afterSleep = { $script:enabled = $false }
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 0) 'A disable during the wait must be observed before reopening.'

$request = New-RestartFixture
$script:launches = @()
$script:restartProcesses = @([pscustomobject]@{ pid=101; startedAt='2026-02-01T00:00:00.0000000Z' })
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 0 -and (Read-LensRestart $state).state -eq 'client-already-reopened') 'A reused PID or manually reopened client must not trigger another launch.'

$olderRequest = New-RestartFixture
$newerRequest = New-RestartFixture
$script:launches = @()
Invoke-LensRestart $state $olderRequest.token
Check ($script:launches.Count -eq 0 -and (Read-LensRestart $state).token -eq $newerRequest.token) 'Repeated activation must invalidate the older waiting process.'
Stop-LensRestart $state

$request = New-RestartFixture
$script:launches = @()
$script:afterSleep = { throw 'Simulated process inspection failure' }
Invoke-LensRestart $state $request.token
Check ($script:launches.Count -eq 0 -and (Read-LensRestart $state).state -eq 'failed') 'Process inspection failures must never launch or close a client.'

Reset-Launch
$script:restartProcesses = @()
$failed = $false
try { Start-LensRestart $installed | Out-Null } catch { $failed = $true }
Check ($failed -and $script:launches.Count -eq 0) 'No matching running client must fail without arming a reopen.'
Write-Output "Windows lifecycle checks passed: $script:checks"
