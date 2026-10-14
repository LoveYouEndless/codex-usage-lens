param(
    [string]$CodexPath,
    [ValidateRange(1024, 65535)]
    [int]$Port = 9229,
    [switch]$CreateShortcut,
    [string]$ShortcutPath
)
$ErrorActionPreference = 'Stop'
if (-not $CodexPath) {
    $installed = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
    if ($installed) {
        foreach ($relative in @('app\Codex.exe', 'Codex.exe')) {
            $candidate = Join-Path $installed.InstallLocation $relative
            if (Test-Path -LiteralPath $candidate) { $CodexPath = $candidate; break }
        }
    }
}
if (-not $CodexPath) { throw 'Codex executable not found. Supply -CodexPath with its absolute path.' }
$executable = (Resolve-Path -LiteralPath $CodexPath).Path
if ([IO.Path]::GetExtension($executable) -ne '.exe') { throw 'Supply a Codex .exe path.' }
$debugArguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port"
if ($CreateShortcut) {
    if (-not $ShortcutPath) {
        $ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Usage Lens.lnk'
    }
    $fullShortcut = [IO.Path]::GetFullPath($ShortcutPath)
    if (Test-Path -LiteralPath $fullShortcut) { throw "Shortcut already exists: $fullShortcut" }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($fullShortcut)
    $shortcut.TargetPath = $executable
    $shortcut.Arguments = $debugArguments
    $shortcut.WorkingDirectory = Split-Path -Parent $executable
    $shortcut.Description = 'Launch Codex with a local Usage Lens connection'
    $shortcut.Save()
    Write-Output "Created: $fullShortcut"
    exit
}
$running = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($executable)) -ErrorAction SilentlyContinue
if ($running) { throw 'Codex is already running. Finish active work and close it normally before using this launcher.' }
$portInUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($portInUse) { throw "Port $Port is already in use. Supply another -Port value." }
Start-Process -FilePath $executable -ArgumentList $debugArguments -WindowStyle Normal
Write-Output "Codex launched with a local debug port ($Port). Start Usage Lens from the plugin."
