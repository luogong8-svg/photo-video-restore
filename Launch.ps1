$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot
$baseUrl = 'http://127.0.0.1:31873'
$appId = 'infinite-canvas-local-3a6b64b'

function Test-CanvasReady {
    try {
        $health = Invoke-RestMethod -Uri ($baseUrl + '/__infinite_canvas_health') -TimeoutSec 2
        return $health.application -eq $appId
    } catch { return $false }
}

try {
    if (-not (Test-CanvasReady)) {
        $logDir = Join-Path $appDir 'logs'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $runtime = Join-Path $appDir 'runtime\bun.exe'
        if (-not (Test-Path -LiteralPath $runtime)) {
            $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
            if (-not $bunCommand) { throw 'Bun was not found. Install Bun or place bun.exe in the runtime folder.' }
            $runtime = $bunCommand.Source
        }
        $serverFile = Join-Path $appDir 'server.mjs'
        Start-Process -FilePath $runtime -ArgumentList @('run', ('"' + $serverFile + '"')) -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') | Out-Null
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if (Test-CanvasReady) { break }
            Start-Sleep -Milliseconds 250
        }
        if (-not (Test-CanvasReady)) { throw 'The local service could not start. Check logs/server-error.log in the installation folder.' }
    }
    $edgeCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    $edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($edgePath) {
        Start-Process -FilePath $edgePath -ArgumentList ('--app=' + $baseUrl + '/restore')
    } else {
        Start-Process ($baseUrl + '/restore')
    }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Infinite Canvas', 'OK', 'Error') | Out-Null
    exit 1
}
