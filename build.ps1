# WHOSCOFFEE 단일 exe 빌드 (Node.js SEA)
# 사용법:  pwsh -File build.ps1   또는   powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
$EXE  = 'dist\WHOSCOFFEE.exe'

Write-Host ''
Write-Host '  WHOSCOFFEE 빌드 시작' -ForegroundColor Cyan
New-Item -ItemType Directory -Force dist | Out-Null

# 1) server.js + db.js 를 단일 CommonJS 번들로 (node: 내장 모듈은 제외)
Write-Host '  [1/5] 번들링 (esbuild)...' -ForegroundColor Yellow
npx --yes esbuild server.js --bundle --platform=node --target=node22 `
  --outfile=dist/bundle.cjs --external:node:*
if ($LASTEXITCODE -ne 0) { throw 'esbuild 실패' }

# 2) SEA blob 생성 (index.html asset 포함)
Write-Host '  [2/5] SEA blob 생성...' -ForegroundColor Yellow
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw 'SEA blob 생성 실패' }

# 3) 현재 node.exe 를 복사해 뼈대로 사용
Write-Host '  [3/5] node.exe 복사...' -ForegroundColor Yellow
$nodeExe = (Get-Command node).Source
Copy-Item $nodeExe $EXE -Force

# 4) 아이콘 + 메타데이터 패치 (rcedit) — 반드시 blob 주입 전에!
#    blob 주입 후 rcedit 로 리소스를 재작성하면 SEA blob 과 충돌한다.
$rcedit = 'tools\rcedit-x64.exe'
if (Test-Path $rcedit) {
  Write-Host '  [4/5] 아이콘/메타데이터 패치 (rcedit)...' -ForegroundColor Yellow
  $rcArgs = @($EXE,
    '--set-file-version', '1.0.0', '--set-product-version', '1.0.0',
    '--set-version-string', 'ProductName', 'WHOSCOFFEE',
    '--set-version-string', 'FileDescription', '커피 품앗이 알리미')
  if (Test-Path 'icon.ico') { $rcArgs += @('--set-icon', 'icon.ico') }
  & $rcedit @rcArgs
  if ($LASTEXITCODE -ne 0) { throw 'rcedit 패치 실패' }
} else {
  Write-Host '  [4/5] rcedit 없음 — 아이콘/메타데이터 건너뜀' -ForegroundColor DarkGray
}

# 5) blob 을 exe 에 주입 (마지막)
Write-Host '  [5/5] blob 주입 (postject)...' -ForegroundColor Yellow
npx --yes postject $EXE NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse $FUSE
if ($LASTEXITCODE -ne 0) { throw 'postject 주입 실패' }

$size = [math]::Round((Get-Item $EXE).Length / 1MB, 1)
Write-Host ''
Write-Host "  완료:  $EXE  ($size MB)" -ForegroundColor Green
Write-Host '  이 exe 하나만 배포하면 됩니다. (실행하면 옆에 whoscoffee.db / config.json 생성)'
Write-Host ''
