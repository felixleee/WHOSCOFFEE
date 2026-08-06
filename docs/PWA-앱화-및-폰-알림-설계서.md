# PWA 앱화 & 폰 알림(푸시) 설계서

> WHOSCOFFEE에 실제 구현된 내용을 근거로 정리한 설계·블루프린트.
> 다른 프로젝트(WATERBUDDY·RIDESPLIT 등)에도 그대로 재사용 가능하도록 일반화해서 기술한다.

- **대상 스택**: Cloudflare Workers + D1 + 정적 에셋([assets]), 순수 HTML/JS 단일 페이지
- **핵심 파일**: `public/manifest.webmanifest`, `public/sw.js`, `src/worker.js`, `src/webpush.js`, `public/index.html`

---

## 0. 한눈에 보기

| 목표 | 필요한 것 | 상태 |
|---|---|---|
| 홈 화면에 앱처럼 설치 | manifest + 서비스워커 + HTTPS + 아이콘 | ✅ 구현 |
| 앱처럼 전체화면 실행 | `display: standalone` | ✅ |
| 첫 구동 스플래시 | manifest `background_color` + 아이콘 + 인트로 애니 | ✅ |
| 상대가 품앗이하면 알림 | Web Push(이벤트성) | ✅ |
| 매일 정오 "오늘 차례" 알림 | Web Push(예약성, Cron) | ✅ |
| 알림 종류 취사선택 | 기기별 취향 저장 | ✅ |
| 상단바 아이콘(뱃지) | 단색 실루엣 PNG | ✅ |

---

# Part A. PWA 앱 만들기

## A-1. PWA의 3대 필수 요소
1. **HTTPS** — 서비스워커·푸시는 보안 컨텍스트에서만 동작 (localhost는 예외).
2. **Web App Manifest** — 앱 이름·아이콘·표시 모드 등 설치 메타데이터.
3. **서비스워커(Service Worker)** — 설치 가능성(installability)의 핵심 조건. `fetch` 핸들러가 **존재**해야 설치형(WebAPK)으로 인정된다.

## A-2. manifest.webmanifest
실제 값:

```json
{
  "name": "WHOSCOFFEE — 커피 품앗이 알리미",
  "short_name": "WHOSCOFFEE",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",          // 주소창 없는 앱 모드
  "orientation": "portrait",
  "background_color": "#f0e6d6",     // 스플래시 배경색
  "theme_color": "#f0e6d6",          // 상태바 색
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**포인트**
- `maskable` 아이콘: 안드로이드 원형/스퀴클 마스크에 대응. 아이콘의 주요 그래픽을 중앙 **안전영역(약 80%)** 안에 둬야 잘림 방지.
- `background_color`는 **스플래시·로딩 오버레이 배경색과 반드시 일치**시켜 네이티브 스플래시 → 앱 화면 전환이 매끄럽게.
- HTML `<head>`에 연결: `<link rel="manifest" href="/manifest.webmanifest">` + iOS용 `<meta name="apple-mobile-web-app-capable" content="yes">`, `apple-touch-icon`.

## A-3. 서비스워커 (`public/sw.js`)
WHOSCOFFEE는 **네트워크 전용(캐시 안 함)** 전략을 택했다.

```js
self.addEventListener('install', () => self.skipWaiting());   // 새 SW 즉시 대기 해제
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const ks = await caches.keys();                            // 옛 캐시 정리(heal)
    await Promise.all(ks.map((k) => caches.delete(k)));
    await self.clients.claim();                                // 열려있는 탭 즉시 장악
  })());
});
self.addEventListener('fetch', () => {});  // no-op: 가로채지 않음(브라우저 기본). 존재 자체가 설치 조건
```

**왜 네트워크 전용인가**
- 캐시-우선(cache-first) SW는 "예전 화면이 계속 뜨는" 낡은 캐시 문제를 자주 일으킨다.
- 사내망 로컬 앱이라 오프라인 필요가 낮고, **항상 최신**이 더 중요.
- 단, 설치 가능성 조건을 위해 `fetch` 핸들러는 **존재**해야 하므로 no-op으로 둔다.

**SW 업데이트 전파(중요)**
- SW 스크립트(`sw.js`)는 `Cache-Control: max-age=0, must-revalidate`로 서빙 → 매번 재검증.
- 코드 수정 → 배포하면, 다음 앱 실행(내비게이션) 때 브라우저가 새 `sw.js`를 가져와 `skipWaiting`+`claim`으로 **즉시 활성화**.
- ⚠️ 그래도 **이미 실행 중인 앱은 옛 SW를 계속 쓴다.** 확실히 반영하려면 **앱 완전 종료 후 재실행**. 최후엔 홈화면에서 삭제 후 재설치.

## A-4. 설치 흐름
- **안드로이드(Chrome)**: 조건 충족 시 자동 설치 배너 / 메뉴 "홈 화면에 추가" → **WebAPK**(진짜 앱처럼 등록, 별도 아이콘·스플래시).
- **iOS(Safari)**: 공유 → "홈 화면에 추가"만 지원(자동 배너 없음). **푸시 알림은 iOS 16.4+ & 홈화면 설치 상태에서만** 동작.

## A-5. 스플래시 & 로딩 인트로
- 네이티브 스플래시 = manifest `background_color` + 아이콘(OS가 그림, 커스터마이즈 불가).
- 그 위 앱 자체 로딩 오버레이(`#busyOverlay`)로 자연스럽게 연결.
- **구현한 인트로 애니**: 첫 구동 시 로딩 원두 스피너가 **스플래시 크기(scale 3.2)에서 시작 → 돌며 정상 크기(52px)로 축소** → 이후 정상 회전.
  - 회전을 `720deg`로 끝내 무한 회전(`busy-spin` 0°)과 각도 이음새 제거.
  - `cold-start`에서만 `splash` 클래스를 부여하고, 로드 완료(`hideBusy`) 시 제거 → 이후 액션 스피너엔 인트로 미적용.

---

# Part B. 폰에서 알림(알람) 울리기 — Web Push

## B-1. 전체 구조
```
[클라] 권한 허용 → pushManager.subscribe(VAPID 공개키)
      → PushSubscription(endpoint, p256dh, auth) 을 서버에 저장
[서버] 이벤트/스케줄 발생 → 저장된 구독으로 암호화 푸시 발송(VAPID 서명)
      → 각 OS의 Push Service(FCM/APNs/…) → 기기
[SW]  'push' 이벤트 수신 → showNotification() 으로 알림 표시
```

## B-2. VAPID 키
- 공개키(`VAPID_PUBLIC`)·subject(`VAPID_SUBJECT`)는 공개돼도 안전 → `wrangler.toml [vars]`.
- 비공개키(`VAPID_JWK`)는 **secret**으로 보관: `wrangler secret put VAPID_JWK`.
- 서버 발송(`src/webpush.js`)이 이 키로 서명. **키 미설정 시 발송 전부 스킵**되므로 배포 환경에 secret 필수.

## B-3. 구독 & 취향 저장
- 테이블 `push_subs(endpoint PK, user_key, room_id, p256dh, auth, pref_turn, pref_daily, created_at)` — **기기(구독)별** 저장.
- `POST /api/subscribe` : 구독 저장(ON CONFLICT로 갱신).
- `POST /api/notif-prefs {endpoint, turn, daily, announce}` : 기기별 알림 취향 저장. `announce=true`면 "이제부터 ~ 알려드릴게요" 확인 푸시 발송(파이프라인 검증 겸).
- `POST /api/unsubscribe {endpoint}` : 구독 삭제(둘 다 끄면 호출).

## B-4. 알림 2종
### ① 이벤트성 — "내 차례" (`notifyTurn`)
- 트리거: 상대가 `/api/buy`로 품앗이 → 다음 차례 사람의 구독(`pref_turn=1`)에 발송.
- 백그라운드 발송(`execCtx.waitUntil`)이라 buy 응답 지연 없음.

### ② 예약성 — "매일 정오 오늘 차례" (Cron)
- `wrangler.toml`:
  ```toml
  [triggers]
  crons = ["0 3 * * *"]   # UTC 03:00 = KST 12:00
  ```
- 워커 `scheduled()` → `sendDailyTurn(env)`: `pref_daily=1` 구독을 방별로 순회, `currentTurnKey`로 오늘 차례 계산 → "오늘 커피는 OO님 차례" 발송(대기중 방은 스킵).

## B-5. 서비스워커 push 핸들러 (방탄)
```js
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; }
    catch (e) { try { d = { body: event.data && event.data.text() }; } catch (_) { d = {}; } }
    const title = d.title || '☕ WHOSCOFFEE';
    const opts = { body: d.body || '새 소식이 있어요', icon: '/icon-192.png',
                   badge: '/badge.png?v=2', tag: d.tag || 'wc', renotify: true,
                   data: { url: d.url || '/' } };
    try { await self.registration.showNotification(title, opts); }
    catch (e) { try { await self.registration.showNotification(title, { body: opts.body, data: opts.data }); } catch (_) {} }
  })());
});
```
- **반드시** 모든 push에서 `showNotification`을 호출해야 한다(아래 함정 참고).
- 실패 시 최소 옵션 재시도 → 브라우저 대체 알림 방지.
- `notificationclick`에서 열린 창 포커스 또는 새 창 오픈.

## B-6. 아이콘 vs 뱃지 (안드로이드 핵심)
| 항목 | 용도 | 형식 |
|---|---|---|
| `icon` | 알림 펼쳤을 때 큰 아이콘 | 컬러 PNG(예: `icon-192.png`) |
| `badge` | **상단바 작은 아이콘** | **투명 배경 + 흰 단색 실루엣** PNG |

- 안드로이드는 badge의 **알파 채널만** 사용해 흰색으로 칠한다.
- ❌ 컬러 아이콘을 badge로 쓰면 → **흰 사각형**으로 렌더.
- ⚠️ 실루엣이 **너무 작거나(캔버스 대비 커버리지↓)**, 가운데가 크게 파여 **얇게 갈라지면** → 상단바 크기(~24px)에서 안 보임.
  - WHOSCOFFEE 교훈: 원두 커버리지 10%→**38%**, 크레이스(홈)를 얇게 → 24px 가시성 46% 확보.
- **iOS는 badge를 무시**하고 앱 아이콘을 쓴다(이 기능은 사실상 안드로이드용).

## B-7. 플랫폼별 제약
- **안드로이드**: WebAPK 설치 시 사실상 네이티브 수준. 백그라운드 푸시 자유.
- **iOS**: 16.4+ & **홈화면 설치 필수**. badge 커스텀 무시(앱 아이콘 사용). 옵션 호환성 낮아 `showNotification` 실패 → 대체 알림 위험 → 최소옵션 재시도 필수.

## B-8. 흔한 함정 & 해결 (실제 겪은 것)
1. **SW 업데이트 안 됨** → 앱 완전 종료·재실행(최후: 재설치). 이미 뜬 알림은 안 바뀌고 **새 알림부터** 반영.
2. **"사이트 URL만 뜨는" 대체 알림** = push는 왔는데 SW가 알림을 못 띄운 것(`userVisibleOnly` 페널티). → push 핸들러 방탄 처리(항상 showNotification, 실패 시 재시도).
3. **뱃지가 흰 사각형** → badge에 컬러 아이콘 쓴 것. 단색 실루엣 PNG로 교체.
4. **뱃지가 투명/안 보임** → 실루엣이 작거나 갈라짐. 커버리지↑·크레이스 얇게. 캐시 의심 시 `badge: '/badge.png?v=N'`로 버스트.
5. **정오 알림 즉시 확인 불가** → Cron은 다음 정오에 발동. 즉시 테스트는 Cloudflare 대시보드에서 Cron 수동 트리거.

---

## 부록. 엔드포인트 · 스키마 요약
- `POST /api/subscribe` `{subscription}` — 구독 저장
- `POST /api/unsubscribe` `{endpoint}` — 구독 삭제
- `POST /api/notif-prefs` `{endpoint, turn, daily, announce}` — 취향 저장(+확인 알림)
- `scheduled()` (cron `0 3 * * *`) — 매일 정오 발송
- `push_subs(endpoint PK, user_key, room_id, p256dh, auth, pref_turn, pref_daily, created_at)`

## 부록. 신규 프로젝트 적용 체크리스트
- [ ] HTTPS 서빙
- [ ] manifest 작성(icons·maskable·background_color=로딩배경)
- [ ] `<head>`에 manifest·apple 메타·apple-touch-icon 연결
- [ ] 서비스워커 등록(+ install/activate/fetch/push/notificationclick)
- [ ] VAPID 키 생성 → 공개는 vars, 비공개는 secret
- [ ] 구독/해지/취향 API + `push_subs` 테이블
- [ ] push 핸들러 방탄(항상 showNotification + 재시도)
- [ ] badge: 단색 흰 실루엣 PNG(커버리지 충분·얇은 디테일)
- [ ] 예약 알림 필요 시 `[triggers] crons` + `scheduled()`
- [ ] iOS: 설치 안내 문구(홈화면 추가 필요)
