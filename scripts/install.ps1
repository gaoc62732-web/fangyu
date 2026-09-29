$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $SavedRuntime = Join-Path $ProjectRoot '.tools/runtime-path.txt'
    if (Test-Path -LiteralPath $SavedRuntime) {
        $SavedNodeDirectory = (Get-Content -LiteralPath $SavedRuntime -Raw -Encoding utf8).Trim()
        if (Test-Path -LiteralPath (Join-Path $SavedNodeDirectory 'node.exe')) {
            $env:PATH = "$SavedNodeDirectory;$env:PATH"
        }
    }
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $NeedNode = $true
    if ($NodeCommand) {
        $VersionText = & $NodeCommand.Source -p 'process.versions.node'
        $NeedNode = ([version]$VersionText -lt [version]'22.12.0')
    }

    if ($NeedNode) {
        Write-Host 'Downloading Node.js 24 LTS to this project (no administrator rights needed)...'
        $Releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $Release = $Releases | Where-Object { $_.version -match '^v24\.' -and $_.lts } | Select-Object -First 1
        if (-not $Release) { throw 'Cannot locate a Node.js 24 LTS release.' }
        $Architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
        $ArchiveName = "node-$($Release.version)-win-$Architecture.zip"
        $DownloadBase = "https://nodejs.org/dist/$($Release.version)"
        $RuntimeDirectory = Join-Path $ProjectRoot '.tools'
        New-Item -ItemType Directory -Force -Path $RuntimeDirectory | Out-Null
        $ArchivePath = Join-Path $RuntimeDirectory $ArchiveName
        Invoke-WebRequest -UseBasicParsing "$DownloadBase/$ArchiveName" -OutFile $ArchivePath
        $Checksums = (Invoke-WebRequest -UseBasicParsing "$DownloadBase/SHASUMS256.txt").Content
        $Expected = ($Checksums -split "\r?\n" | Where-Object { $_ -match ("\s+" + [regex]::Escape($ArchiveName) + '$') }) -split '\s+'
        $Actual = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
        if (-not $Expected -or $Actual -ne $Expected[0]) { throw 'Node.js download checksum does not match.' }
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $RuntimeDirectory -Force
        $NodeDirectory = Join-Path $RuntimeDirectory ("node-$($Release.version)-win-$Architecture")
        $env:PATH = "$NodeDirectory;$env:PATH"
        Set-Content -LiteralPath $SavedRuntime -Value $NodeDirectory -Encoding utf8
    }

    & node (Join-Path $PSScriptRoot 'install.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    Write-Host 'Done. Dependencies are installed.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

