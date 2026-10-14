param(
    [ValidateSet('Start', 'Stop', 'Status')]
    [string]$Action = 'Start',
    [int]$Port = 0
)
$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$nodeCandidates = @(
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
)
$nodeRuntime = $null
foreach ($candidate in $nodeCandidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        $runtimeVersion = & $candidate --version
        if ($runtimeVersion -match '^v(\d+)' -and [int]$Matches[1] -ge 22) {
            $nodeRuntime = $candidate
            break
        }
    }
}
if (-not $nodeRuntime) { throw 'Node.js 22 or newer is required. Install it from https://nodejs.org/.' }
$runtimeArguments = @((Join-Path $pluginRoot 'src\cli.mjs'), $Action.ToLowerInvariant())
if ($Port -gt 0) { $runtimeArguments += @('--port', "$Port") }
& $nodeRuntime @runtimeArguments
exit $LASTEXITCODE
