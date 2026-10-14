param(
    [string]$StateDir,
    [string]$CodexHome,
    [string]$CodexPath,
    [string]$NodePath,
    [int]$Port = 0,
    [string]$DesktopDirectory,
    [string]$StartupDirectory
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
if (-not $StateDir) { $StateDir = Get-LensStateDirectory }
if (-not $CodexHome) {
    $CodexHome = $env:CODEX_HOME
    if (-not $CodexHome) { $CodexHome = Join-Path $env:USERPROFILE '.codex' }
}
$StateDir = [IO.Path]::GetFullPath($StateDir)
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$pluginRoot = Split-Path -Parent $PSScriptRoot
$node = Find-LensNode $NodePath
if (-not $node) { throw 'Node.js 22 or newer was not found. Setup made no startup changes.' }
$cli = Join-Path $pluginRoot 'src\cli.mjs'
$policyOutput = & $node $cli status --codex-home $CodexHome --state-dir $StateDir
if ($LASTEXITCODE -ne 0) { throw 'Could not read the plugin enable switch.' }
if (($policyOutput | ConvertFrom-Json).policy -ne 'enabled') {
    throw 'Install and enable Codex Usage Lens in Codex before first activation.'
}
$policyResult = & $node (Join-Path $pluginRoot 'src\policy-check.mjs') $CodexHome
if ($LASTEXITCODE -ne 0) { throw 'Could not identify the installed plugin.' }
$pluginId = ($policyResult | ConvertFrom-Json).pluginId
if ($Port -lt 0 -or $Port -gt 65535) { throw 'Invalid port.' }
if ($Port -eq 0) {
    $connection = & $node $cli connection
    if ($LASTEXITCODE -eq 0) {
        $connection = $connection | ConvertFrom-Json
        if ($connection.connected) { $Port = $connection.port }
    }
    if ($Port -eq 0) { $Port = 9229 }
}
$previous = Read-LensInstallation $StateDir
if (-not $CodexPath -and $previous) { $CodexPath = $previous.codexPath }
$application = Find-CodexApplication $CodexPath
$version = (Get-Content -LiteralPath (Join-Path $pluginRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid plugin version.' }
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
$runtime = Join-Path $StateDir "runtimes\$version"
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
# Copy only shipped code; never copy .git, state, logs, or conversation data.
foreach ($folder in @('src', 'vendor')) {
    $destination = Join-Path $runtime $folder
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $pluginRoot $folder) -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) -Force
    }
}
Copy-Item -LiteralPath (Join-Path $pluginRoot 'package.json') -Destination (Join-Path $runtime 'package.json') -Force
foreach ($entry in @('windows-common.ps1', 'launcher-windows.ps1', 'resume-windows.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry) -Destination (Join-Path $StateDir $entry) -Force
}
if (-not $DesktopDirectory) { $DesktopDirectory = [Environment]::GetFolderPath('Desktop') }
if (-not $StartupDirectory) { $StartupDirectory = [Environment]::GetFolderPath('Startup') }
$shell = New-Object -ComObject WScript.Shell
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Save-LensShortcut([string]$Directory, [string]$Name, [string]$Entry, [string]$Description) {
    $path = Join-Path $Directory $Name
    $script = Join-Path $StateDir $Entry
    if (Test-Path -LiteralPath $path) {
        $existing = $shell.CreateShortcut($path)
        if ($existing.Arguments.IndexOf($script, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            Write-Warning "Existing unrelated shortcut kept: $path"
            return $false
        }
    }
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $powerShell
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '" -StateDir "' + $StateDir + '"'
    $shortcut.WorkingDirectory = $StateDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = $Description
    if ($application) { $shortcut.IconLocation = $application.Path + ',0' }
    $shortcut.Save()
    return $true
}
$installation = [ordered]@{
    product = 'codex-usage-lens'; version = $version
    stateDir = $StateDir; runtimePath = $runtime; codexHome = $CodexHome
    pluginId = $pluginId; nodePath = $node; port = $Port
    codexPath = $(if ($application) { $application.Path } else { $null })
    desktopShortcut = (Join-Path $DesktopDirectory 'Codex Usage Lens.lnk')
    startupShortcut = (Join-Path $StartupDirectory 'Codex Usage Lens startup.lnk')
    desktopInstalled = $false; loginRecovery = $false
}
# Persist the pointer before shortcuts become usable.
$installPath = Join-Path $StateDir 'install.json'
[IO.File]::WriteAllText($installPath, ($installation | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
try {
    $installation.desktopInstalled = Save-LensShortcut $DesktopDirectory 'Codex Usage Lens.lnk' 'launcher-windows.ps1' 'Open Codex with optional Usage Lens statistics'
} catch { Write-Warning 'Could not create the dedicated desktop shortcut. The original Codex shortcut is unchanged.' }
try {
    $installation.loginRecovery = Save-LensShortcut $StartupDirectory 'Codex Usage Lens startup.lnk' 'resume-windows.ps1' 'Restore Usage Lens at login without opening Codex'
} catch { Write-Warning 'Login recovery could not be registered; manual activation remains available.' }
[IO.File]::WriteAllText($installPath, ($installation | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$installation | ConvertTo-Json
