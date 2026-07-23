# icon.html → 여러 크기 PNG(Edge headless) → 멀티 해상도 icon.ico(node)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
if (-not (Test-Path $edge)) { throw 'Edge를 찾을 수 없습니다.' }

$html = 'file:///' + ($PSScriptRoot -replace '\\', '/') + '/icon.html'
$sizes = 16, 32, 48, 64, 128, 256
$pngs = @()

Write-Host '  아이콘 렌더 (Edge headless, 멀티 해상도)...' -ForegroundColor Yellow
foreach ($sz in $sizes) {
  $out = Join-Path $PSScriptRoot "icon-$sz.png"
  Remove-Item $out -ErrorAction SilentlyContinue
  & $edge --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    --default-background-color=00000000 --screenshot="$out" --window-size="$sz,$sz" $html 2>$null | Out-Null
  if (-not (Test-Path $out)) { throw "PNG 렌더 실패: ${sz}px" }
  $pngs += $out
}

# 미리보기/참조용 256 사본
Copy-Item (Join-Path $PSScriptRoot 'icon-256.png') (Join-Path $PSScriptRoot 'icon.png') -Force

node (Join-Path $PSScriptRoot 'make-ico.js') (Join-Path $PSScriptRoot 'icon.ico') @pngs
Write-Host '  완료: icon.ico (멀티 해상도)' -ForegroundColor Green
