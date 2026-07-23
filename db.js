'use strict';
// 로컬 node 버전 — 배포 Worker(src/worker.js)와 동일한 모델로 정합 유지.
// 멀티룸 · user_key(불변) 기반. 이름/아바타는 rooms.data 안 멤버 정보(변경 가능).
// 세션 token→(user_key, room_id). getState 반환 shape도 worker.js와 동일.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('path');
const fs = require('fs');

// 데이터 위치: 클라우드(WC_DATA_DIR=볼륨) > SEA(단일 exe, exe 옆) > dev(소스 폴더)
let sea = null;
try { sea = require('node:sea'); } catch { /* dev 환경 */ }
const BASE_DIR = process.env.WC_DATA_DIR
  ? process.env.WC_DATA_DIR
  : (sea && sea.isSea() ? path.dirname(process.execPath) : __dirname);
try { if (process.env.WC_DATA_DIR) fs.mkdirSync(BASE_DIR, { recursive: true }); } catch { }

const DB_PATH = path.join(BASE_DIR, 'whoscoffee.db');
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');

const db = new DatabaseSync(DB_PATH);

// 레거시(이름 기반) events/sessions 가 있으면 옆으로 치워두고(무손실) 새 스키마로.
// person→user_key 는 손실 변환이라 자동 이관하지 않고 *_legacy 로 보존만 한다.
function hasColumn(table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col); }
  catch { return false; }
}
function tableExists(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}
if (tableExists('events') && !hasColumn('events', 'user_key')) {
  db.exec('ALTER TABLE events RENAME TO events_legacy_person');
}
if (tableExists('sessions') && !hasColumn('sessions', 'user_key')) {
  db.exec('ALTER TABLE sessions RENAME TO sessions_legacy_person');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id         TEXT PRIMARY KEY,
    pin        TEXT NOT NULL,
    data       TEXT NOT NULL,   -- JSON {creator:{key,name,avatar}, joiner:{...}|null}
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    TEXT NOT NULL,
    date       TEXT NOT NULL,
    user_key   TEXT NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_key   TEXT NOT NULL,
    room_id    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ---- config (port 등 앱 설정만; 방은 rooms 테이블에) ----
const DEFAULT_CONFIG = { port: 9210 };
function readConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

// ---- 유틸 ----
function newKey() { return 'u' + Date.now().toString(36) + crypto.randomInt(0, 1679616).toString(36); }
function newRoomId() { return 'r' + Date.now().toString(36) + crypto.randomInt(0, 1679616).toString(36); }
function nowIso() { return new Date().toISOString(); }
function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function pin4() { return String(crypto.randomInt(1000, 10000)); }

// ---- 방(rooms 테이블) ----
function rowToRoom(r) {
  if (!r) return null;
  const d = JSON.parse(r.data);
  return { id: r.id, pin: r.pin, creator: d.creator, joiner: d.joiner || null };
}
function getRoomById(id) {
  if (!id) return null;
  return rowToRoom(db.prepare('SELECT id, pin, data FROM rooms WHERE id = ?').get(id));
}
function getRoomByPin(pin) {
  if (!pin) return null;
  return rowToRoom(db.prepare('SELECT id, pin, data FROM rooms WHERE pin = ?').get(pin));
}
function insertRoom(room) {
  const data = JSON.stringify({ creator: room.creator, joiner: room.joiner || null });
  db.prepare('INSERT INTO rooms(id, pin, data, created_at) VALUES(?, ?, ?, ?)')
    .run(room.id, room.pin, data, nowIso());
}
function saveRoom(room) {
  const data = JSON.stringify({ creator: room.creator, joiner: room.joiner || null });
  db.prepare('UPDATE rooms SET data = ? WHERE id = ?').run(data, room.id);
}
function memberByKey(room, key) {
  if (!room || !key) return null;
  if (room.creator && room.creator.key === key) return room.creator;
  if (room.joiner && room.joiner.key === key) return room.joiner;
  return null;
}
function keyName(room, key) { const mb = memberByKey(room, key); return mb ? mb.name : '상대'; }
function pub(mb) { return mb ? { key: mb.key, name: mb.name, avatar: mb.avatar || null } : null; }

// ---- 세션 ----
function sessionFromToken(token) {
  if (!token) return null;
  const r = db.prepare('SELECT user_key, room_id FROM sessions WHERE token = ?').get(token);
  return r ? { key: r.user_key, roomId: r.room_id } : null;
}
// 토큰 → { room, key, me } (그 방의 멤버일 때만) / 아니면 null
function meAndRoom(token) {
  const sess = sessionFromToken(token);
  if (!sess) return null;
  const room = getRoomById(sess.roomId);
  const me = memberByKey(room, sess.key);
  if (!room || !me) return null;
  return { room, key: sess.key, me };
}
function newSession(key, roomId) {
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO sessions(token, user_key, room_id, created_at) VALUES(?, ?, ?, ?)')
    .run(token, key, roomId, nowIso());
  return token;
}
function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ---- 차례 ----
function lastEvent(roomId) {
  return db.prepare('SELECT * FROM events WHERE room_id = ? ORDER BY id DESC LIMIT 1').get(roomId);
}
function currentTurnKey(room, last) {
  if (!room || !room.joiner) return null;
  if (!last) return room.creator.key;
  return last.user_key === room.creator.key ? room.joiner.key : room.creator.key;
}

// ---- 방 만들기 / 참여 ----
function createRoom(name) {
  name = (name || '').trim();
  if (!name) throw new Error('이름을 입력해주세요.');
  let pin = pin4();
  for (let i = 0; i < 50 && getRoomByPin(pin); i++) pin = pin4();
  const id = newRoomId(), key = newKey();
  const room = { id, pin, creator: { key, name, avatar: null }, joiner: null };
  insertRoom(room);
  return { pin, token: newSession(key, id), me: { key, name } };
}
function joinRoom(name, pin) {
  name = (name || '').trim();
  if (!name) throw new Error('이름을 입력해주세요.');
  pin = String(pin || '').trim();
  const room = getRoomByPin(pin);
  if (!room) throw new Error('그 PIN의 품앗이를 찾을 수 없어요.');
  if (name === room.creator.name) return { token: newSession(room.creator.key, room.id), me: { key: room.creator.key, name } };
  if (room.joiner && name === room.joiner.name) return { token: newSession(room.joiner.key, room.id), me: { key: room.joiner.key, name } };
  if (!room.joiner) {
    const key = newKey();
    room.joiner = { key, name, avatar: null };
    saveRoom(room);
    return { token: newSession(key, room.id), me: { key, name } };
  }
  throw new Error('이 방은 이미 두 명이 참여 중이에요.');
}
// 이 방만 닫기 (그 방의 기록·세션·방 정보 삭제)
function closeRoom(roomId) {
  db.prepare('DELETE FROM events WHERE room_id = ?').run(roomId);
  db.prepare('DELETE FROM sessions WHERE room_id = ?').run(roomId);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
}

// ---- 이름 / 아바타 변경 ----
function rename(token, name) {
  name = (name || '').trim();
  if (!name) throw new Error('이름을 입력해주세요.');
  if (name.length > 20) throw new Error('이름은 20자 이내로 해주세요.');
  const ctx = meAndRoom(token);
  if (!ctx) throw new Error('로그인이 필요해요.');
  const { room, key, me } = ctx;
  const other = room.creator.key === key ? room.joiner : room.creator;
  if (other && other.name === name) throw new Error('상대와 같은 이름은 쓸 수 없어요.');
  me.name = name;
  saveRoom(room);
  return { ok: true, name };
}
function setAvatar(token, avatar) {
  const ctx = meAndRoom(token);
  if (!ctx) throw new Error('로그인이 필요해요.');
  const { room, me } = ctx;
  if (avatar && avatar.length > 80000) throw new Error('이미지가 너무 커요. 더 작게 잘라주세요.');
  me.avatar = avatar || null;
  saveRoom(room);
  return { ok: true };
}

// ---- 이벤트 ----
function recordBuy(roomId, key, note) {
  db.prepare('INSERT INTO events(room_id, date, user_key, note, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(roomId, todayStr(), key, note || null, nowIso());
}
function undoLast(roomId) {
  const row = db.prepare('SELECT id FROM events WHERE room_id = ? ORDER BY id DESC LIMIT 1').get(roomId);
  if (!row) throw new Error('취소할 기록이 없어요.');
  db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
}

// ---- 상태 (worker.js getState 와 동일 shape) ----
function getState(token) {
  const sess = sessionFromToken(token);
  if (!sess) return { phase: 'setup', me: null };
  const room = getRoomById(sess.roomId);
  const meKey = sess.key;
  const me = memberByKey(room, meKey);
  if (!room || !me) return { phase: 'setup', me: null };

  if (!room.joiner) {
    return { phase: 'waiting', pin: room.pin, me: { name: me.name } };
  }
  const last = lastEvent(room.id);
  const nextKey = currentTurnKey(room, last);
  const mate = room.creator.key === meKey ? room.joiner : room.creator;
  const rows = db.prepare('SELECT * FROM events WHERE room_id = ? ORDER BY id DESC LIMIT 15').all(room.id);
  const recent = rows.map(e => {
    const mb = memberByKey(room, e.user_key);
    return { date: e.date, name: mb ? mb.name : '?', avatar: mb ? mb.avatar || null : null, isMe: e.user_key === meKey, note: e.note };
  });
  return {
    phase: 'active',
    me: pub(me), mate: pub(mate),
    creator: pub(room.creator), joiner: pub(room.joiner),
    myTurn: meKey === nextKey,
    turn: pub(memberByKey(room, nextKey)),
    last: last ? { name: keyName(room, last.user_key), date: last.date } : null,
    recent,
  };
}

module.exports = {
  readConfig, writeConfig,
  getState, createRoom, joinRoom, closeRoom,
  meAndRoom, currentTurnKey, lastEvent, keyName,
  rename, setAvatar,
  recordBuy, undoLast, deleteSession,
};
