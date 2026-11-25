<#
.SYNOPSIS
    AirFlow Lab Phase 1 ローカル起動スクリプト（D:\home\geminiファイル\airflowlab_env 環境使用）
.DESCRIPTION
    FastAPI バックエンド (http://127.0.0.1:8000) と Vite フロントエンド (http://127.0.0.1:5173) を起動します。
    Ctrl+C または終了時にバックエンドプロセスを自動停止します。
#>
param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$BackendOnly
)

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvBase = 'D:\home\geminiファイル\airflowlab_env'
$PythonExe = Join-Path $EnvBase 'venv\Scripts\python.exe'
$NodeDir = Join-Path $EnvBase 'node'
$NodeExe = Join-Path $NodeDir 'node.exe'

if (-not (Test-Path $PythonExe)) {
    throw "Python 仮想環境が見つかりません: $PythonExe"
}
if (-not (Test-Path $NodeExe)) {
    throw "Node.js が見つかりません: $NodeExe"
}

$BackendDir = Join-Path $RootDir 'backend'
$FrontendDir = Join-Path $RootDir 'frontend'

Write-Host '=== AirFlow Lab Phase 1 起動準備 ===' -ForegroundColor Cyan
Write-Host "Python : $PythonExe"
Write-Host "Node   : $NodeExe"
Write-Host "Backend: http://127.0.0.1:$BackendPort"
if (-not $BackendOnly) {
    Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
}

$env:PYTHONPATH = $BackendDir
$backendProc = Start-Process -FilePath $PythonExe `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort") `
    -WorkingDirectory $RootDir `
    -PassThru `
    -NoNewWindow

try {
    if ($BackendOnly) {
        Write-Host 'バックエンドのみ起動中 (Ctrl+C で停止)...' -ForegroundColor Green
        Wait-Process -Id $backendProc.Id
    } else {
        # バックエンドのヘルスチェック待機
        $healthUrl = "http://127.0.0.1:$BackendPort/api/health"
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 300
            try {
                $res = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
                if ($res.status -eq 'ok') { break }
            } catch {
                # 起動待機中
            }
        }
        $env:PATH = "$NodeDir;$env:PATH"
        Push-Location $FrontendDir
        try {
            Write-Host 'フロントエンドを起動しています (Ctrl+C で停止)...' -ForegroundColor Green
            & $NodeExe '.\node_modules\vite\bin\vite.js' --host '127.0.0.1' --port "$FrontendPort"
        } finally {
            Pop-Location
        }
    }
} finally {
    if ($backendProc -and -not $backendProc.HasExited) {
        Write-Host 'バックエンドを停止しています...' -ForegroundColor Yellow
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
}
