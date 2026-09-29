$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot 'apps\web'
$vite = Join-Path $webRoot 'node_modules\vite\bin\vite.js'
$url = 'http://127.0.0.1:5173/#/china'

function Test-FangyuServer {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
        if ($response.Content -match 'id="app"' -and $response.Content -match '/src/main.ts') { return $true }
        throw '5173 端口已被其他程序占用。'
    } catch [System.Net.WebException] {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $vite)) {
    throw '缺少前端依赖，请先运行项目根目录的「安装依赖.cmd」。'
}
if (-not (Test-FangyuServer)) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList @($vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $webRoot -WindowStyle Hidden
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-FangyuServer) { $ready = $true; break }
    }
    if (-not $ready) { throw '新版服务启动失败，请运行「启动前端.cmd」查看错误信息。' }
}

Write-Host "正在打开 $url"
Write-Host '首次打开会载入本机迁移记录；若已有空白存档，请点击首页「一键载入本机旧版记录」。'
Start-Process -FilePath $url
