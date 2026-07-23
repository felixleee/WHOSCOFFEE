# WHOSCOFFEE Fly.io 배포 (로그인 후 원클릭)
# 사용법:  pwsh -File deploy-fly.ps1 [앱이름]
#   앱이름은 전역 고유해야 함. 생략 시 fly.toml 의 app 값 사용.
param([string]$AppName = "")
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$fly = "$HOME\.fly\bin\flyctl.exe"
if (-not (Test-Path $fly)) { throw 'flyctl 이 없습니다. https://fly.io/install.ps1 로 설치하세요.' }

# 1) 로그인 확인
$who = & $fly auth whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host '  먼저 로그인하세요:  fly auth login' -ForegroundColor Red
  exit 1
}
Write-Host "  로그인: $who" -ForegroundColor Green

# 2) 앱 생성 + fly.toml 확정 (배포는 아직 안 함)
$nameArg = @()
if ($AppName) { $nameArg = @('--name', $AppName) }
Write-Host '  [1/3] 앱 생성/설정 (fly launch)...' -ForegroundColor Yellow
& $fly launch --no-deploy --copy-config --region nrt --yes @nameArg

# 3) 영속 볼륨 (이미 있으면 무시)
Write-Host '  [2/3] 영속 볼륨 wc_data 생성...' -ForegroundColor Yellow
& $fly volumes create wc_data -r nrt -n 1 --yes 2>$null

# 4) 배포
Write-Host '  [3/3] 배포 (fly deploy)...' -ForegroundColor Yellow
& $fly deploy

Write-Host ''
Write-Host '  완료! 접속 주소:' -ForegroundColor Green
& $fly open
