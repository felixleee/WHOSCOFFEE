'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exec } = require('node:child_process');
const db = require('./db');

// SEA(단일 exe)로 빌드됐는지 감지
let sea = null;
try { sea = require('node:sea'); } catch { /* dev 환경 */ }
const isSea = !!(sea && sea.isSea());

const PORT = process.env.PORT || db.readConfig().port || 9210;

function getIndexHtml() {
  if (isSea) return sea.getAsset('index.html', 'utf8');
  return fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
}
let INDEX_CACHE = isSea ? getIndexHtml() : null;

// 작업표시줄/탭 아이콘용 .ico (Edge --app 창은 SVG favicon을 작업표시줄에 못 써서 .ico 필요)
function getFavicon() {
  try {
    if (isSea) return Buffer.from(sea.getAsset('favicon.ico'));
    return fs.readFileSync(path.join(__dirname, 'icon.ico'));
  } catch { return null; }
}
const FAVICON_CACHE = getFavicon();
function indexHtml() { return INDEX_CACHE || getIndexHtml(); }

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('요청이 너무 큽니다.'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('잘못된 JSON입니다.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const token = req.headers['x-token'];

  try {
    if (pathname.startsWith('/api/')) {
      // 현재 상태 (phase + 내 정보)
      if (pathname === '/api/state' && req.method === 'GET') {
        return sendJson(res, 200, db.getState(token));
      }
      // 방 만들기
      if (pathname === '/api/create' && req.method === 'POST') {
        const { name } = await readBody(req);
        return sendJson(res, 200, db.createRoom(name));
      }
      // 방 참여 (신규 합류 / 재로그인)
      if (pathname === '/api/join' && req.method === 'POST') {
        const { name, pin } = await readBody(req);
        return sendJson(res, 200, db.joinRoom(name, pin));
      }
      // 방 초기화 (내 방만 닫기, 멤버만)
      if (pathname === '/api/reset' && req.method === 'POST') {
        const ctx = db.meAndRoom(token);
        if (!ctx) return sendJson(res, 401, { error: '권한이 없어요.' });
        db.closeRoom(ctx.room.id);
        return sendJson(res, 200, { ok: true });
      }
      // 도장: 토큰에서 (방·사람) 도출 + 내 차례 검증
      if (pathname === '/api/buy' && req.method === 'POST') {
        const ctx = db.meAndRoom(token);
        if (!ctx) return sendJson(res, 401, { error: '로그인이 필요해요.' });
        const { room, key } = ctx;
        const next = db.currentTurnKey(room, db.lastEvent(room.id));
        if (key !== next) throw new Error(`지금은 ${db.keyName(room, next)}님 차례예요.`);
        const { note } = await readBody(req);
        db.recordBuy(room.id, key, note);
        return sendJson(res, 200, { ok: true });
      }
      // 마지막 기록 취소 (멤버면 가능)
      if (pathname === '/api/undo' && req.method === 'POST') {
        const ctx = db.meAndRoom(token);
        if (!ctx) return sendJson(res, 401, { error: '로그인이 필요해요.' });
        db.undoLast(ctx.room.id);
        return sendJson(res, 200, { ok: true });
      }
      // 이름 변경 (내 것만)
      if (pathname === '/api/rename' && req.method === 'POST') {
        const { name } = await readBody(req);
        return sendJson(res, 200, db.rename(token, name));
      }
      // 아바타 변경 (내 것만)
      if (pathname === '/api/avatar' && req.method === 'POST') {
        const { avatar } = await readBody(req);
        return sendJson(res, 200, db.setAvatar(token, avatar));
      }
      // 신원 해제 (이 기기 로그아웃)
      if (pathname === '/api/logout' && req.method === 'POST') {
        db.deleteSession(token);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: '없는 API입니다.' });
    }

    if (pathname === '/favicon.ico') {
      if (FAVICON_CACHE) { res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=86400' }); return res.end(FAVICON_CACHE); }
      res.writeHead(404); return res.end();
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml());
  } catch (err) {
    sendJson(res, 400, { error: err.message || '알 수 없는 오류' });
  }
});

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function findEdge() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
function openApp(url) {
  if (process.env.WC_DATA_DIR) return; // 클라우드(서버 전용)에선 앱 창을 열지 않음
  if (db.readConfig().autoOpen === false) return;
  try {
    if (process.platform !== 'win32') { exec(`xdg-open "${url}"`); return; }
    // 우선: 우리 네이티브 앱 창(WebView2) — 작업표시줄에 원두 아이콘이 뜬다
    const viewer = path.join(path.dirname(process.execPath), 'WHOSCOFFEE-창.exe');
    if (fs.existsSync(viewer)) { exec(`"${viewer}" ${url}`); return; }
    // 폴백: Edge 앱 모드 (viewer/DLL 이 없을 때)
    const edge = findEdge();
    if (edge) exec(`"${edge}" --app=${url} --window-size=380,720`);
    else exec(`start "" "${url}"`);
  } catch { /* 실패해도 서버는 계속 */ }
}

server.listen(PORT, () => {
  const ips = lanIPs();
  const localUrl = `http://localhost:${PORT}`;
  console.log('\n  ☕  WHOSCOFFEE 서버가 시작됐어요!\n');
  console.log('  잠시 후 앱 창이 자동으로 열려요.');
  console.log('  안 열리면 아래 주소로 직접 접속하세요.\n');
  console.log(`  내 PC에서:   ${localUrl}`);
  if (ips.length) {
    console.log('  팀원에게 알려줄 주소 (사내망):');
    for (const ip of ips) console.log(`               http://${ip}:${PORT}`);
  }
  console.log('\n  종료하려면 이 창을 닫거나 Ctrl+C\n');
  openApp(localUrl);
});
