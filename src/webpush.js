// Cloudflare Workers 웹푸시 발송 — VAPID(ES256) + 페이로드 암호화(RFC 8291 aes128gcm)
// 의존성 없이 Web Crypto(subtle)만 사용.
const enc = new TextEncoder();

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function bytesToB64url(bytes) {
  const b = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

// VAPID JWT(ES256) 서명 — audience = 푸시 엔드포인트의 scheme://host
async function vapidJwt(env, audience) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = bytesToB64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`; // ECDSA sign = raw r||s (JWT 요구 형식)
}

// sub: { endpoint, p256dh, auth }  /  payloadObj: SW push 핸들러가 읽을 JSON
// 반환: 푸시 서비스 HTTP 상태코드 (404/410 이면 만료 → 호출측에서 구독 삭제)
export async function sendPush(env, sub, payloadObj) {
  const p256dh = b64urlToBytes(sub.p256dh);
  const auth = b64urlToBytes(sub.auth);
  const plaintext = enc.encode(JSON.stringify(payloadObj));

  // 임시 ECDH 키페어(application server)
  const asPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey)); // 65B
  const uaPublicKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asPair.privateKey, 256));

  // RFC 8291: ikm = HKDF(auth, ecdhSecret, "WebPush: info\0"||ua||as, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), p256dh, asPublicRaw);
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32);

  // RFC 8188 aes128gcm: salt → CEK(16) / NONCE(12)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 암호화(단일 레코드, 마지막 delimiter 0x02)
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  // 본문: salt(16) | rs(4=4096) | idlen(1) | as_public(65) | ciphertext
  const rs = new Uint8Array([0, 0, 0x10, 0]);
  const body = concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw, ct);

  const url = new URL(sub.endpoint);
  const jwt = await vapidJwt(env, `${url.protocol}//${url.host}`);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body,
  });
  return res.status;
}
