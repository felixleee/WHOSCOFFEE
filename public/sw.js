// KILL SWITCH — 서비스워커 폐기.
// 이전 버전이 캐시한 낡은/빈 페이지 때문에 생긴 blank 를 자동 복구한다:
// 캐시 전부 삭제 → 자기 자신 등록 해제 → 열린 창들을 네트워크에서 새로 로드.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) {}
  })());
});
// fetch 는 가로채지 않음 — 항상 네트워크(정상 동작).
