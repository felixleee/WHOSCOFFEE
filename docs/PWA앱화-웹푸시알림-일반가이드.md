# PWA 앱화 & 웹푸시 알림 — 일반 가이드 (플랫폼 무관)

> "웹앱을 폰에 앱처럼 설치되게 + 폰으로 알림 울리게" 하는 **핵심 방법만 추린** 버전.
> 전부 **웹 표준**이라 어떤 백엔드·호스트에서도 동일하게 동작한다. 호스트에 따라 달라지는 부분은 [플랫폼 교체 지점](#플랫폼-교체-지점)에 따로 표기.

---

## Part A. 웹앱을 PWA(설치형 앱)로 만들기

### 필수 3요소
1. **HTTPS** — 서비스워커·푸시는 보안 컨텍스트 전용(localhost 예외)
2. **Web App Manifest** — 앱 이름·아이콘·표시 모드
3. **Service Worker** — 설치 가능성의 조건. `fetch` 핸들러가 **존재**해야 설치형으로 인정됨

### 1) manifest (`manifest.webmanifest`)
```json
{
  "name": "앱 전체 이름",
  "short_name": "앱아이콘밑이름",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",         // 주소창 없는 앱 모드
  "background_color": "#f0e6d6",    // 스플래시 배경 = 로딩화면 배경과 일치시킬 것
  "theme_color": "#f0e6d6",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
- `maskable`: 안드 원형/스퀴클 마스크 대응. 주요 그래픽을 **중앙 80% 안전영역**에.
- `<head>` 연결: `<link rel="manifest" href="/manifest.webmanifest">`
- iOS 추가: `<meta name="apple-mobile-web-app-capable" content="yes">`, `<link rel="apple-touch-icon" href="/icon-192.png">`

### 2) 서비스워커 (최소 골격)
```js
self.addEventListener('install',  () => self.skipWaiting());          // 새 SW 즉시 대기해제
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim())); // 열린 탭 즉시 장악
self.addEventListener('fetch',    () => {});                           // no-op: 가로채지 않음(설치 조건만 충족)
```
- 등록: `navigator.serviceWorker.register('/sw.js')`
- **캐시 전략은 선택**: 위처럼 no-op(항상 최신) / 또는 cache-first(오프라인 지원, 대신 "낡은 화면" 관리 필요).

### 3) SW 업데이트 전파 (중요·함정)
- `sw.js`를 `Cache-Control: max-age=0, must-revalidate`로 서빙 → 재실행 때 새 SW 감지 → `skipWaiting`+`claim`으로 즉시 활성화.
- ⚠️ **이미 실행 중인 앱은 옛 SW 유지** → 확실히 반영하려면 앱 완전종료·재실행. 앱 내 "강제 새로고침" 버튼(아래)을 두면 편함.
- 앱 내 강제 새로고침:
  ```js
  async function hardReload(){
    if (window.caches){ for (const k of await caches.keys()) await caches.delete(k); }
    const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update();
    location.reload();
  }
  ```

### 4) 설치 흐름
- **안드로이드(Chrome)**: 조건 충족 시 설치 배너/"홈 화면에 추가" → **WebAPK**(진짜 앱처럼)
- **iOS(Safari)**: 공유 → "홈 화면에 추가"만(자동 배너 없음)

### 5) 스플래시
- 네이티브 스플래시 = manifest `background_color` + 아이콘(OS가 그림, 커스텀 불가)
- 그 뒤 앱 자체 로딩 화면 배경색을 `background_color`와 **일치**시켜 매끄럽게 연결

---

## Part B. 폰으로 알림 울리기 (Web Push)

### 핵심: 배달은 브라우저 푸시 서비스가 한다
```
[클라] 권한 허용 → subscribe(VAPID공개키) → PushSubscription 을 서버에 저장
[서버] 이벤트/예약 시각 → 저장된 구독으로 암호화 푸시 발송(VAPID 서명)
        → 브라우저 푸시 서비스(Chrome=FCM · Safari=APNs · Firefox=Mozilla) → 기기
[SW]  'push' 이벤트 → showNotification() 으로 표시
```
→ **네 서버는 "발송 트리거"만** 담당. 실제 전달은 OS/브라우저 푸시 서비스가 한다(호스트 무관).

### 1) VAPID 키 (RFC 8292)
- 공개키·subject: 공개돼도 안전(클라에 심음)
- 비공개키: **서버 시크릿**으로만 보관
- 생성: `web-push generate-vapid-keys` (또는 동등 도구)

### 2) 클라: 권한 + 구독
```js
const perm = await Notification.requestPermission();
if (perm === 'granted') {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
  });
  await fetch('/api/subscribe', { method:'POST', body: JSON.stringify(sub) });
}
```
- 저장 대상: `endpoint`, `keys.p256dh`, `keys.auth` (기기별로 유일)

### 3) 서버: 발송
```js
// Node 예시 — web-push 라이브러리(표준 암호화·VAPID 서명 대행)
import webpush from 'web-push';
webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
await webpush.sendNotification(sub, JSON.stringify({ title:'☕', body:'내 차례!', url:'/' }));
// 410/404 오면 그 구독 삭제
```
> Cloudflare Workers·Deno 등 web-push 라이브러리를 못 쓰는 런타임이면 Web Crypto(`crypto.subtle`)로 aes128gcm 암호화+VAPID JWT를 직접 구현(원리는 동일).

### 4) SW: 수신 표시 (방탄)
```js
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let d = {}; try { d = event.data ? event.data.json() : {}; } catch(_){}
    const title = d.title || '알림';
    const opts = { body:d.body||'', icon:'/icon-192.png', badge:'/badge.png',
                   tag:d.tag||'app', renotify:true, data:{ url:d.url||'/' } };
    try { await self.registration.showNotification(title, opts); }
    catch(_) { await self.registration.showNotification(title, { body:opts.body }); } // 실패 시 최소옵션 재시도
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
```
- ⚠️ **모든 push에서 반드시 showNotification 호출**. 안 하면 브라우저가 "사이트 URL만 뜨는" 대체 알림을 띄움(userVisibleOnly 페널티).

### 5) 예약 알림 = 스케줄러가 발송 트리거
- "매일 정오" 같은 예약 알림은 **서버 스케줄러**가 시각에 맞춰 발송 함수를 호출:
  1. 알림 켠 구독 조회 → 2. 대상자·문구 계산 → 3. 각 구독에 발송
- 스케줄러는 플랫폼마다 다름 → [플랫폼 교체 지점](#플랫폼-교체-지점)
- KST 정오 = UTC 03:00 (cron `0 3 * * *`)

### 6) 아이콘 vs 뱃지
| 필드 | 위치 | 형식 |
|---|---|---|
| `icon` | 알림 펼침 큰 아이콘 | 컬러 PNG |
| `badge` | **상단바 작은 아이콘(안드)** | **투명 배경 + 흰 단색 실루엣** PNG |
- 안드는 badge의 **알파만** 사용해 흰색으로 칠함. 컬러 아이콘 쓰면 흰 사각형. 실루엣이 작거나 얇게 갈라지면 안 보임(캔버스 대비 커버리지 충분히·디테일 굵게).
- **iOS는 badge 무시**하고 앱 아이콘 사용.

### 7) 플랫폼 제약
- **안드로이드**: WebAPK 설치 시 자유로운 백그라운드 푸시
- **iOS**: **16.4+ & 홈화면 설치 필수**. badge 커스텀 무시. 옵션 호환성 낮음 → 방탄 핸들러 필수

---

## 플랫폼 교체 지점
푸시 "원리"는 어디서나 동일. 아래 **서버 플럼빙만** 스택에 맞게 교체.

| 역할 | 표준/개념 | Cloudflare | Node/기타 |
|---|---|---|---|
| 서버 런타임 | HTTP 핸들러 | Workers `fetch` | Express/Fastify, Deno, Vercel Fn |
| **예약 발송** | 스케줄러 | Workers Cron `[triggers] crons` + `scheduled()` | node-cron, 리눅스 cron, GitHub Actions, Vercel Cron |
| 구독 저장 | DB 한 테이블 | D1 | Postgres/MySQL/SQLite/Redis |
| 발송 암호화 | Web Push(aes128gcm)+VAPID | Web Crypto 직접 | `web-push` npm |
| 정적 서빙 | 파일 서버/CDN | `[assets]` | Nginx, S3+CDN |
| 비공개키 보관 | 시크릿 | `wrangler secret` | env var / 시크릿 매니저 |

**클라(manifest·sw.js·구독 코드)와 푸시 프로토콜은 호스트를 옮겨도 그대로.**

---

## 흔한 함정
1. **SW 업데이트 안 붙음** → 앱 완전종료·재실행 / 앱 내 `hardReload()` / 최후 재설치. 이미 뜬 알림은 안 바뀌고 새 알림부터 반영.
2. **"URL만 뜨는" 대체 알림** → push 왔는데 showNotification 미호출. 방탄 핸들러로 항상 표시.
3. **뱃지 흰 사각형** → badge에 컬러 아이콘. 단색 흰 실루엣으로.
4. **뱃지 안 보임/투명** → 실루엣이 작거나 얇게 갈라짐. 커버리지↑·디테일 굵게. 캐시 의심 시 `/badge.png?v=N`.
5. **정오 알림 즉시 테스트 불가** → 스케줄러는 그 시각에만 발동. 수동 트리거로 테스트(대시보드/CLI).

## 신규 프로젝트 체크리스트
- [ ] HTTPS
- [ ] manifest(icons·maskable·background_color=로딩배경) + `<head>` 연결(+apple 메타)
- [ ] 서비스워커 등록(install/activate/fetch/push/notificationclick)
- [ ] VAPID 키(공개=클라, 비공개=서버 시크릿)
- [ ] 구독 저장/삭제 API + 구독 테이블
- [ ] push 핸들러 방탄(항상 showNotification)
- [ ] badge = 흰 단색 실루엣(커버리지·디테일 충분)
- [ ] 예약 알림 필요 시 스케줄러 연결
- [ ] iOS: 설치 안내 문구
- [ ] 앱 내 강제 새로고침(hardReload) 제공
