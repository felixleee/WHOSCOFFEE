# WHOSCOFFEE 앱 창 (WebView2) — 단일 exe (DLL 3개 임베드)
#   결과: dist\WHOSCOFFEE.exe 하나. 호스트/팀원 구분 없이 모두 이거 하나 (서버는 클라우드).
# 사용법:  pwsh -File build-viewer.ps1 [접속URL]   (기본: Cloudflare 배포 주소)
param([string]$AppUrl = "https://whoscoffee.youn7084084.workers.dev")
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'csc.exe(.NET Framework) 를 찾을 수 없습니다.' }
$wv = 'tools\webview2'
if (-not (Test-Path "$wv\Microsoft.Web.WebView2.Core.dll")) { throw 'WebView2 DLL 이 없습니다 (tools\webview2).' }

# 컴파일 참조
$refs = @(
  '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
  "/r:$wv\Microsoft.Web.WebView2.Core.dll", "/r:$wv\Microsoft.Web.WebView2.WinForms.dll"
)
# exe 에 임베드(리소스명 = 파일명) — 런타임에 여기서 로드
$resx = @(
  "/resource:$wv\Microsoft.Web.WebView2.Core.dll,Microsoft.Web.WebView2.Core.dll",
  "/resource:$wv\Microsoft.Web.WebView2.WinForms.dll,Microsoft.Web.WebView2.WinForms.dll",
  "/resource:$wv\WebView2Loader.dll,WebView2Loader.dll",
  "/resource:icon.ico,AppIcon.ico"   # 창/작업표시줄 아이콘 (다중해상도)
)
New-Item -ItemType Directory -Force dist | Out-Null

Write-Host ''
Write-Host "  WHOSCOFFEE 앱 창 빌드 — 단일 exe (접속: $AppUrl)" -ForegroundColor Cyan
$src = (Get-Content 'viewer.cs' -Raw) -replace '__APPURL__', $AppUrl
$tmp = Join-Path $env:TEMP ('viewer_' + [guid]::NewGuid().ToString('N') + '.cs')
Set-Content -Path $tmp -Value $src -Encoding UTF8
& $csc /nologo /target:winexe /platform:x64 /win32icon:icon.ico @refs @resx '/out:dist\WHOSCOFFEE.exe' $tmp
$code = $LASTEXITCODE
Remove-Item $tmp -Force
if ($code -ne 0) { throw 'csc 컴파일 실패' }

$size = [math]::Round((Get-Item 'dist\WHOSCOFFEE.exe').Length / 1MB, 2)

# 업데이트 알림(B안)용: 배포 exe를 Cloudflare 정적 경로(public\download)로 복사
# → 웹의 EXE_DOWNLOAD(/download/WHOSCOFFEE.exe)로 팀원이 최신 exe를 받는다. (wrangler deploy 필요)
New-Item -ItemType Directory -Force 'public\download' | Out-Null
Copy-Item 'dist\WHOSCOFFEE.exe' 'public\download\WHOSCOFFEE.exe' -Force
Write-Host ''
Write-Host "  완료:  dist\WHOSCOFFEE.exe  ($size MB, 단일 파일)" -ForegroundColor Green
Write-Host '  이 exe 하나만 전달/실행하면 됩니다. (WebView2 DLL 은 exe 안에 포함됨)'
Write-Host '  public\download 에도 복사됨 — wrangler deploy 하면 업데이트 알림 다운로드로 반영.'
Write-Host ''
