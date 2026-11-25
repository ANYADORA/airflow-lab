<#
.SYNOPSIS
    AirFlow Lab Phase 1 簡易論文 LaTeX -> PDF ビルドスクリプト（D:\home\geminiファイル\airflowlab_env\tectonic 使用）
#>
param(
    [switch]$KeepLogs
)

$ErrorActionPreference = 'Stop'

$TectonicExe = 'D:\home\geminiファイル\airflowlab_env\tectonic\tectonic.exe'
$TectonicCache = 'D:\home\geminiファイル\airflowlab_env\tectonic\cache'
$PaperDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TexFile = 'AirFlow_Lab_Phase1_Validation_Paper.tex'

if (-not (Test-Path $TectonicExe)) {
    throw "Tectonic が見つかりません: $TectonicExe"
}
New-Item -ItemType Directory -Force -Path $TectonicCache | Out-Null

# バンドルやフォントキャッシュを必ず D ドライブ配下へ固定
$env:TECTONIC_CACHE_DIR = $TectonicCache

Push-Location $PaperDir
try {
    Write-Host "=== Tectonic PDF コンパイル開始 ($TexFile) ===" -ForegroundColor Cyan
    Write-Host "TECTONIC_CACHE_DIR = $env:TECTONIC_CACHE_DIR"
    $argsList = @('-X', 'compile', $TexFile)
    if ($KeepLogs) {
        $argsList += '--keep-logs'
    }
    & $TectonicExe @argsList
    if ($LASTEXITCODE -ne 0) {
        throw "Tectonic コンパイルが終了コード $LASTEXITCODE で失敗しました。"
    }
    $pdfPath = Join-Path $PaperDir 'AirFlow_Lab_Phase1_Validation_Paper.pdf'
    Write-Host "PDF 生成完了: $pdfPath" -ForegroundColor Green
} finally {
    Pop-Location
}
