# WHOSCOFFEE — 기술 스택 & 아키텍처

> 커피 품앗이 당번 알리미 — **"다음 커피는 누가 살 차례인지"** 알려주는 2인용 순번 웹앱.
> 날짜·공휴일 계산 없이, 커피를 산 사람이 **"쏜다" 도장**을 찍으면 상대에게 차례가 넘어간다.

---

## 한눈에 보기

| 레이어 | 기술 |
|---|---|
| 프론트엔드 | 순수 HTML/CSS/JavaScript (프레임워크·빌드·의존성 **제로**, SPA) |
| 백엔드 | Cloudflare Workers (서버리스, JS `fetch` handler) |
| 데이터베이스 | Cloudflare D1 (서버리스 SQLite) |
| 정적 서빙 | Cloudflare Workers Assets |
| 데스크톱 앱 창 | C# WinForms + WebView2 → **단일 exe** |
| 배포 CLI | wrangler |

현재 접속 주소: **https://whoscoffee.youn7084084.workers.dev**

---

## 아키텍처 (현재)

```
[브라우저]  또는  [WHOSCOFFEE.exe (WebView2 앱 창)]
        │
        ▼  HTTPS
https://whoscoffee.<계정>.workers.dev
        │
        ▼
Cloudflare Worker  (src/worker.js)
   ├─ /api/*   →  D1 쿼리 (방·순번·도장·세션)
   └─ 그 외    →  Assets (index.html · favicon.ico)
        │
        ▼
Cloudflare D1  (SQLite: rooms · members · events · sessions · undo_requests)
```

- 서버가 클라우드에 상시 존재 → **호스트 PC를 켜둘 필요가 없다.**
- 사용자·팀원 모두 같은 URL에 접속(브라우저 또는 앱 창) → 데이터 공유.

---

## 레이어별 상세

### 1. 프론트엔드 — `public/index.html`
- **단일 파일 SPA.** 프레임워크·번들러 없음, 순수 JS.
- `fetch`로 `/api/state`를 4초 폴링하여 화면 갱신.
- 화면 흐름: 방 만들기/참여 → 대기 → 내 관점 메인(차례 표시) → "쏜다" 도장(애니메이션).
- 부가 기능
  - **테마 토글**: 시스템 테마 무시, 수동 라이트/다크 (`data-theme` + `localStorage`).
  - **오프라인 읽기 캐시**: 서버가 꺼지면 마지막 `active` 상태를 `localStorage`에서 읽어 읽기 전용 표시, 복구 시 폴링으로 자동 반영.
  - **favicon**: `.ico` 링크(멀티 해상도).

### 2. 백엔드 — `src/worker.js` (Cloudflare Workers)
- `export default { fetch }` 구조. `/api/*`만 처리, 나머지는 `env.ASSETS`로 위임.
- REST API: `state` · `create` · `join` · `buy` · `undo`(요청) · `undo-approve` · `undo-cancel` · `reset` · `logout` · `rename` · `avatar`.
- 세션: `crypto.randomUUID()` 토큰 → `sessions` 테이블, 요청 헤더 `X-Token`으로 식별.
- **멀티룸**: 방마다 PIN. 사람은 불변 `user_key`로 식별(이름·아바타는 `members`에서 변경).
- 순번 규칙: **마지막에 산 사람의 반대편** (기록 없으면 방장부터).
- **마지막 기록 취소 = 상대 승인제**: `/api/undo`는 `undo_requests`에 요청만 생성 → 상대의 `/api/undo-approve`로만 실제 삭제(요청자≠승인자 강제), `/api/undo-cancel`로 철회/거절, 새 도장 시 자동 클리어.
- 날짜는 **KST 보정**(Workers 런타임은 UTC).

### 3. 데이터베이스 — Cloudflare D1
- 서버리스 SQLite. `env.DB.prepare(...).bind(...).run()/first()/all()` (async).
- 테이블
  | 테이블 | 컬럼 | 용도 |
  |---|---|---|
  | `rooms` | id, pin, created_at | 방 |
  | `members` | room_id, role(`creator`\|`joiner`), user_key, name, avatar | 방장·참가자(각 1행) |
  | `events` | id, room_id, date, user_key, note, created_at | 커피 산 기록(도장) |
  | `sessions` | token, user_key, room_id, created_at | 기기별 로그인 |
  | `undo_requests` | room_id, event_id, by_key, created_at | 취소 요청(방마다 최대 1건) |
- 스키마: `schema.sql`. 초기엔 방 정보를 `config`/`rooms.data` JSON blob에 넣었으나 **`members` 테이블로 정규화**(`migrate-members.sql`)하고 blob 컬럼은 제거했다.

### 4. 데스크톱 앱 창 — `viewer.cs` (WebView2)
- C# WinForms `Form` + `WebView2` 컨트롤로 Cloudflare URL을 로드하는 **주소창 없는 네이티브 창**.
- **단일 exe (~0.9MB)**: WebView2 DLL 3개를 csc `/resource`로 exe에 임베드하고 런타임 로드.
  - 관리 DLL(Core/WinForms): `AppDomain.AssemblyResolve`로 메모리 로드.
  - 네이티브 `WebView2Loader.dll`: `%TEMP%`에 추출 후 `SetDllDirectory`.
- 원두 아이콘(창·작업표시줄), 타이틀바는 시스템 테마 연동(`DwmSetWindowAttribute`).
- WebView2 런타임이 없으면 기본 브라우저로 폴백.

---

## 빌드·배포 도구

| 도구 | 용도 |
|---|---|
| **wrangler** | Cloudflare Workers/D1 배포·쿼리 (`deploy`, `d1 execute` 등) |
| **csc** (.NET Framework, Windows 내장) | `viewer.cs` → `WHOSCOFFEE.exe` 컴파일 |
| **Microsoft Edge** (headless) | `icon.svg` → 크기별 PNG 렌더 |
| **make-ico.js** | 여러 PNG → 멀티 해상도 `.ico` |
| **rcedit** | exe 아이콘/메타데이터 패치 (SEA exe 시절) |
| **esbuild · postject** | Node.js SEA 번들·주입 (초기 방식, 현재 미사용) |

---

## 배포 방식의 진화

1. **로컬 실행** (`node server.js`) — 개발용.
2. **Node.js SEA 단일 exe** — Node 설치 없이 더블클릭. `node:http` + `node:sqlite` 내장이라 네이티브 애드온 번들 불필요(SEA 채택 핵심 이유).
3. **사내망 호스트-클라이언트** — 내 PC가 서버, 팀원은 Edge 앱 모드(`--app`)로 접속.
4. **WebView2 네이티브 창** — Edge `--app`은 작업표시줄이 Edge 아이콘이라, 우리 프로세스 창으로 교체(원두 아이콘 표시).
5. **Fly.io 검토 → 폐기** — 가입/결제 과정 문제로 접음.
6. **Cloudflare Workers + D1 (현재)** — 24/7 클라우드 서버, 호스트 PC 무관. 무료 티어, 카드 불필요.

> 참고: `server.js` / `db.js`(Node 버전)와 `Dockerfile` / `fly.toml`은 저장소에 남아있으나 현재 배포에는 쓰지 않는다. 현행 서버는 `src/worker.js`(Cloudflare).

---

## 주요 설계 결정

- **의존성 제로** — 초기 Node 버전은 `node:http`+`node:sqlite`만 사용해 `npm install` 없이 사내망/오프라인 배포가 쉬웠다.
- **순번 = 도장 기반** — 날짜/공휴일 로직 없이 "마지막 산 사람 반대편". 안 마신 날은 아무도 안 찍으니 차례 유지.
- **모노크롬 + 커피 원두 로고** — 텐퍼센트 커피의 미니멀·기호형 스타일을 참고(복제 아님).
- **단일 exe** — WebView2 DLL을 exe에 임베드해 파일 하나로 배포(전달·설치 부담 최소화).
- **웹 우선** — exe 없이도 URL만으로 접속 가능(브라우저). exe는 "앱 창"이 필요할 때만.

---

## 파일 구조 (요약)

```
WHOSCOFFEE/
  src/worker.js       Cloudflare Worker (API + 라우팅, 현행 서버)
  schema.sql          D1 스키마 (rooms · members · events · sessions · undo_requests)
  wrangler.toml       Cloudflare 설정 (D1 바인딩 · Assets)
  public/
    index.html        화면(SPA)
    favicon.ico       파비콘
  viewer.cs           WebView2 앱 창 소스 (단일 exe)
  build-viewer.ps1    viewer.cs → dist\WHOSCOFFEE.exe (DLL 임베드)
  icon.svg / icon.html  아이콘 소스 (커피 원두 2알)
  make-ico.js         PNG → 멀티 해상도 .ico
  build-icon.ps1      icon.svg → icon.ico
  tools/webview2/     WebView2 DLL 3개 (임베드 재료)
  tools/rcedit-x64.exe  exe 아이콘 패치(레거시)
  dist/WHOSCOFFEE.exe   배포용 앱 창 (단일 파일)
  ── 레거시(미사용) ──
  server.js, db.js    Node.js 서버 버전
  Dockerfile, fly.toml, deploy-fly.ps1   Fly.io 배포(폐기)
```

---

## 접속·운영 정보

- **URL**: https://whoscoffee.youn7084084.workers.dev
- **Cloudflare**: D1 `whoscoffee` (region APAC) — account id·database id는 대시보드/`wrangler.toml`에서 확인
- **재배포**: `npx wrangler deploy` (로그인된 상태)
- **데이터 조회/관리**: Cloudflare 대시보드 D1 콘솔 또는 `npx wrangler d1 execute whoscoffee --remote --command "..."`
