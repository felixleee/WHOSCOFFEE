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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { try { await w.navigate(url); } catch (e) {} return w.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
