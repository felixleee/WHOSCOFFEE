# ☕ WHOSCOFFEE

커피 품앗이 알리미 — **다음 커피는 누가 살 차례인지** 알려주는 2인용 순번 웹앱.

날짜·공휴일 계산이 없다. 커피를 마시게 되면 차례인 사람이 **"품앗이 수행" 도장**을 찍고, 그러면 상대에게 차례가 넘어간다. 안 마신 날은 아무도 안 찍으니 차례가 그대로 유지된다.

> 접속: **https://whoscoffee.youn7084084.workers.dev** — 브라우저로 바로 쓰거나, 주소창 없는 **네이티브 앱 창(WebView2 exe)** 으로 띄운다.

---

## 어떻게 동작하나

- **순번 = 도장 기반.** 규칙은 단 하나 — *마지막에 산 사람의 반대편*이 다음 차례. (기록이 없으면 방장부터.)
- **방(room)** 을 만들면 4자리 **PIN**이 나온다. 상대가 그 PIN으로 참여하면 둘이 매칭된다.
- 커피를 사면 **도장** → 기록에 남고 차례가 넘어간다.
- 사람은 기기가 바뀌어도 유지되는 **user_key**로 식별한다(이름·아바타는 언제든 변경 가능).

## 주요 기능

- **멀티룸** — 여러 쌍이 각자 방(PIN)으로 독립적으로 사용.
- **미니 플로팅** — 앱 창을 콘텐츠에 딱 맞는 작은 위젯으로 축소, **항상 위(핀)** 토글.
- **마지막 기록 취소 = 상대 승인제** — 취소는 *요청*만 생성되고, **상대가 승인해야** 실제로 취소된다(거절·철회 가능, 새 도장 찍히면 요청 자동 무효).
- **아바타 / 이름 변경**, 라이트·다크 **테마 토글**.
- **오프라인 읽기 캐시** — 서버 불가 시 마지막 상태를 읽기 전용으로 표시, 복구되면 자동 갱신.
- **업데이트 알림** — 앱이 자기 버전과 최신 네이티브 버전을 비교해 새 버전이면 다운로드 배지를 띄운다(자기교체는 안 함 — 받아서 수동 교체).

## 구성

```
[브라우저]  또는  [WHOSCOFFEE.exe — WebView2 앱 창(얇은 껍데기)]
        │  HTTPS
        ▼
Cloudflare Worker (src/worker.js)
   ├─ /api/*  →  D1 쿼리 (방·멤버·순번·도장·세션·취소요청)
   └─ 그 외   →  Assets (public/index.html · favicon)
        │
        ▼
Cloudflare D1 (SQLite)
```

- 서버가 클라우드에 상시 존재 → **호스트 PC를 켜둘 필요가 없다.** 모두 같은 URL을 공유.
- **exe는 얇은 껍데기**(~0.9MB): Cloudflare URL을 로드하는 주소창 없는 창일 뿐. 웹이 바뀌면 앱을 켤 때 자동 반영되고, exe 자체는 거의 안 바뀐다(해시 안정 → 백신 오탐에도 유리).

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 프론트엔드 | 순수 HTML/CSS/JS 단일 파일 SPA (프레임워크·번들러 **없음**) |
| 백엔드 | Cloudflare Workers (서버리스 `fetch` 핸들러) |
| 데이터베이스 | Cloudflare D1 (서버리스 SQLite) |
| 정적 서빙 | Cloudflare Workers Assets |
| 데스크톱 앱 창 | C# WinForms + WebView2 → **단일 exe** (DLL 임베드) |
| 배포 CLI | wrangler |

자세한 구조·설계 결정은 [TECH-STACK.md](TECH-STACK.md) 참고.

## 데이터 모델 (D1)

| 테이블 | 컬럼 | 용도 |
|---|---|---|
| `rooms` | id, pin, created_at | 방 |
| `members` | room_id, role(`creator`\|`joiner`), user_key, name, avatar | 방장·참가자(각 1행) |
| `events` | id, room_id, date, user_key, note, created_at | 커피 산 기록(도장) |
| `sessions` | token, user_key, room_id, created_at | 기기별 로그인 |
| `undo_requests` | room_id, event_id, by_key, created_at | 취소 요청(방마다 최대 1건, 상대 승인 시 삭제) |

스키마 원본: [schema.sql](schema.sql)

## API

`GET /api/state` · `POST /api/create` · `join` · `buy` · `undo`(요청) · `undo-approve` · `undo-cancel` · `reset` · `logout` · `rename` · `avatar`
(세션은 `X-Token` 헤더로 식별.)

## 개발 · 배포

```bash
# 웹/워커 배포 (Cloudflare 로그인 상태)
npx wrangler deploy

# D1 스키마/쿼리 (원격)
npx wrangler d1 execute whoscoffee --remote --file schema.sql
npx wrangler d1 execute whoscoffee --remote --command "SELECT * FROM rooms"
```

**네이티브 앱 창(exe) 빌드** — Windows + .NET Framework(csc) 필요:

```powershell
# viewer.cs → dist\WHOSCOFFEE.exe  (WebView2 DLL 3개를 exe에 임베드)
powershell -ExecutionPolicy Bypass -File build-viewer.ps1
```

빌드에 필요한 WebView2 DLL과 rcedit는 `tools/`에 포함돼 있다. 대부분의 변경(웹/워커)은 재빌드가 필요 없고, `viewer.cs`(네이티브)를 고칠 때만 재빌드한다.

## 파일 구조 (요약)

```
src/worker.js         Cloudflare Worker (API + 라우팅)
public/index.html     화면(단일 파일 SPA)
schema.sql            D1 스키마
migrate-*.sql         마이그레이션(멀티룸·members 정규화)
wrangler.toml         Cloudflare 설정 (D1 바인딩 · Assets)
viewer.cs             WebView2 앱 창 소스 → 단일 exe
build-viewer.ps1      viewer.cs → dist\WHOSCOFFEE.exe
icon.svg / make-ico.js / build-icon.ps1   아이콘(커피 원두) 소스·빌드
tools/                빌드 재료 (WebView2 DLL · rcedit)
── 레거시(미사용) ──
server.js, db.js      옛 Node.js 로컬 서버
Dockerfile, fly.toml, deploy-fly.ps1, sea-config.json   옛 배포 시도
```

> 레거시 파일들은 초기 버전(로컬 node 서버 → Node SEA exe → Fly.io 검토)의 흔적이다. 현행 백엔드는 `src/worker.js`(Cloudflare)다.
