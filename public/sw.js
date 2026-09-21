// WHOSCOFFEE 서비스워커 — 네트워크 전용(캐시 안 함) + WebAPK 설치성 + 푸시 수신
// fetch 핸들러가 '존재'하면 설치형(WebAPK) 조건 충족. respondWith 를 안 하므로 브라우저 기본 네트워크로 처리
// → 캐시를 전혀 안 해서 예전 blank(낡은 캐시) 문제 재발 없음.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 예전 캐싱 SW 가 남긴 CacheStorage 전부 정리(heal)
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (e) {}
    await self.clients.claim();
  })());
});

// no-op: 가로채지 않고 브라우저 기본 네트워크 처리(캐시 안 함). 존재 자체가 WebAPK 설치 조건.
self.addEventListener('fetch', () => {});

// --- 푸시 수신 → 알림 표시 (어떤 페이로드/실패에도 항상 정상 알림, 브라우저 대체 알림 방지) ---
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; }
    catch (e) { try { d = { body: event.data && event.data.text() }; } catch (_) { d = {}; } }
    const title = d.title || '☕ WHOSCOFFEE';
    const opts = {
      body: d.body || '새 소식이 있어요',
      icon: '/icon-192.png',
      badge: '/badge.png?v=2',
      tag: d.tag || 'wc',
      renotify: true,
      data: { url: d.url || '/' },
    };
    try {
      await self.registration.showNotification(title, opts);
    } catch (e) {
      // 옵션 비호환(iOS 등)으로 실패해도 최소 옵션으로 재시도 → URL만 뜨는 대체 알림 차단
      try { await self.registration.showNotification(title, { body: opts.body, data: opts.data }); } catch (_) { }
    }
  })());
});

// --- 브라우저가 푸시 구독을 회전/무효화할 때 자동 재구독 → 서버 이관(토큰 없이 기존 endpoint 로 본인 확인) ---
// 공개 VAPID 키(공개돼도 안전). index.html·wrangler.toml 과 동일해야 함.
const VAPID_PUBLIC_B64 = 'BGxDtl10Cs5Gp3nt8kj6_-rny5fswUUldIMxOzDt7T5bCSeFERKxtXa_Bks2GDoF-XZKHGV61rf1FEP3HWW_Kac';
function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s), arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_B64) });
      await fetch('/api/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldEndpoint, subscription: sub.toJSON() }),
      });
    } catch (e) { /* 실패해도 다음 앱 실행 시 reconcileNotif 가 복구 */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { try { await w.navigate(url); } catch (e) {} return w.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
