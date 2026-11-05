param(
    [ValidateSet('web', 'api')]
    [string]$Target = 'web'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$RuntimePath = Join-Path $ProjectRoot '.tools/runtime-path.txt'
if (Test-Path -LiteralPath $RuntimePath) {
    $NodeDirectory = (Get-Content -LiteralPath $RuntimePath -Raw -Encoding utf8).Trim()
    if (Test-Path -LiteralPath (Join-Path $NodeDirectory 'node.exe')) {
        $env:PATH = "$NodeDirectory;$env:PATH"
    }
}
$PackageManager = Join-Path $ProjectRoot 'node_modules/pnpm/bin/pnpm.cjs'
if (-not (Test-Path -LiteralPath $PackageManager)) {
    Write-Host 'Please run the dependency installer first.' -ForegroundColor Red
    exit 1
}

# Vite owns the local admin process, including config reloads and recovery.
# Starting another hidden backend here races with Vite's own lifecycle.
if ($Target -eq 'web') {
    $env:VITE_LOCAL_JSON = '1'
    Write-Host 'Starting frontend and local JSON admin API together. Backend logs appear in this window.'
}
& node $PackageManager --filter "@fangyu/$Target" dev
exit $LASTEXITCODE

