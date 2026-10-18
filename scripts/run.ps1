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

function Test-AdminService {
    try {
        $response = Invoke-WebRequest `
            -Uri 'http://127.0.0.1:3001/api/v1/admin/china/regions?ids=CN110000' `
            -UseBasicParsing `
            -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

$adminProcess = $null
if ($Target -eq 'web' -and -not (Test-AdminService)) {
    try {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $ApiRoot = Join-Path $ProjectRoot 'apps/api'
        $adminProcess = Start-Process `
            -FilePath $node `
            -ArgumentList @('--import', 'tsx', '--watch', 'src/admin-main.ts') `
            -WorkingDirectory $ApiRoot `
            -WindowStyle Hidden `
            -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-AdminService) {
                $ready = $true
                break
            }
            if ($adminProcess.HasExited) { break }
        }
        if (-not $ready) {
            if (-not $adminProcess.HasExited) { Stop-Process -Id $adminProcess.Id -Force }
            throw 'Local point admin service failed to start. Check apps/api dependencies and data files.'
        }
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

try {
    if ($Target -eq 'web') { $env:VITE_LOCAL_JSON = '1' }
    & node $PackageManager --filter "@fangyu/$Target" dev
    $exitCode = $LASTEXITCODE
} finally {
    if ($null -ne $adminProcess -and -not $adminProcess.HasExited) {
        & taskkill.exe /PID $adminProcess.Id /T /F *> $null
    }
}
exit $exitCode

