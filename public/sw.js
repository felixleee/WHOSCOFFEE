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

// --- 푸시 알림 (구독/발송 연결은 다음 단계. 지금은 수신 시 알림 표시만) ---
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  const title = d.title || '☕ 내 차례가 돌아왔어요!';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '이제 당신이 품앗이를 수행할 차례예요',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'wc-turn',
    renotify: true,
    data: { url: d.url || '/' },
  }));
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
