# WHOSCOFFEE Cloudflare 배포 (npx wrangler login 후 실행)
# D1 생성 → wrangler.toml 에 database_id 주입 → 스키마 적용 → 배포
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 0) 로그인 확인
$who = (npx --yes wrangler whoami 2>&1 | Out-String)
if ($who -notmatch '@') {
  Write-Host '  먼저 로그인하세요:  npx wrangler login' -ForegroundColor Red
  exit 1
}
Write-Host '  로그인 확인됨' -ForegroundColor Green

# 1) D1 생성 (이미 있으면 목록에서 id 조회)
Write-Host '  [1/3] D1 데이터베이스 준비...' -ForegroundColor Yellow
$create = (npx --yes wrangler d1 create whoscoffee 2>&1 | Out-String)
$dbid = ([regex]'database_id\s*=\s*"([0-9a-fA-F-]+)"').Match($create).Groups[1].Value
if (-not $dbid) {
  $list = (npx --yes wrangler d1 list --json 2>&1 | Out-String)
  try {
    $arr = $list | ConvertFrom-Json
    $dbid = ($arr | Where-Object { $_.name -eq 'whoscoffee' } | Select-Object -First 1).uuid
  } catch { }
}
if (-not $dbid) { throw 'database_id 를 찾지 못했습니다. `npx wrangler d1 list` 로 확인 후 wrangler.toml 에 직접 넣으세요.' }
Write-Host "        database_id = $dbid"

# 2) wrangler.toml 에 id 주입
$toml = Get-Content 'wrangler.toml' -Raw
$toml = $toml -replace 'database_id = "[^"]*"', ('database_id = "' + $dbid + '"')
Set-Content 'wrangler.toml' -Value $toml -Encoding UTF8

# 3) 스키마 적용 (원격 D1)
Write-Host '  [2/3] 스키마 적용 (원격)...' -ForegroundColor Yellow
npx --yes wrangler d1 execute whoscoffee --remote --file=schema.sql --yes

# 4) 배포
Write-Host '  [3/3] 배포...' -ForegroundColor Yellow
npx --yes wrangler deploy

Write-Host ''
Write-Host '  완료! 위 출력의 https://whoscoffee.<계정>.workers.dev 주소로 접속하세요.' -ForegroundColor Green
