// WHOSCOFFEE — Cloudflare Workers + D1 (멀티룸 · userkey 기반)
// 방(room)은 여러 개: rooms(id·pin) + members(room_id·role·user_key·name·avatar) 2행. 사람은 user_key(불변)로 식별.
// 이름/아바타는 members 행에서 변경. 세션은 token→(user_key, room_id).
// 화면(index.html)·favicon 은 [assets], /api/* 만 이 워커가 처리.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url.pathname);
      } catch (e) {
        return json({ error: e.message || '알 수 없는 오류' }, 400);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

function json(obj, code = 200) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleApi(request, env, p) {
  const DB = env.DB;
  const token = request.headers.get('X-Token');
  const m = request.method;

  if (p === '/api/state' && m === 'GET') return json(await getState(DB, token));

  if (p === '/api/create' && m === 'POST') {
    const { name } = await request.json();
    return json(await createRoom(DB, name));
  }
  if (p === '/api/join' && m === 'POST') {
    const { name, pin } = await request.json();
    return json(await joinRoom(DB, name, pin));
  }
  if (p === '/api/reset' && m === 'POST') {
    const ctx = await meAndRoom(DB, token);
    if (!ctx) return json({ error: '권한이 없어요.' }, 401);
    await closeRoom(DB, ctx.room.id);
    return json({ ok: true });
  }
  if (p === '/api/buy' && m === 'POST') {
    const ctx = await meAndRoom(DB, token);
    if (!ctx) return json({ error: '로그인이 필요해요.' }, 401);
    const { room, key } = ctx;
    const nextKey = currentTurnKey(room, await lastEvent(DB, room.id));
    if (key !== nextKey) throw new Error(`지금은 ${keyName(room, nextKey)}님 차례예요.`);
    const { note } = await request.json();
    await recordBuy(DB, room.id, key, note);
    await clearUndoRequest(DB, room.id); // 새 도장 → 이전 취소 요청은 무효
    return json({ ok: true });
  }
  if (p === '/api/undo' && m === 'POST') {
    // 취소 "요청" — 상대 승인 후 실제 삭제. 내가 찍은 마지막 기록만 요청 가능.
    const ctx = await meAndRoom(DB, token);
    if (!ctx) return json({ error: '로그인이 필요해요.' }, 401);
    const last = await lastEvent(DB, ctx.room.id);
    if (!last) return json({ error: '취소할 기록이 없어요.' }, 400);
    if (last.user_key !== ctx.key) return json({ error: '내가 찍은 기록만 취소 요청할 수 있어요.' }, 403);
    await requestUndo(DB, ctx.room.id, last.id, ctx.key);
    return json({ ok: true, pending: true });
  }
  if (p === '/api/undo-approve' && m === 'POST') {
    // 상대(요청자 아님)만 승인 → 실제 삭제
    const ctx = await meAndRoom(DB, token);
    if (!ctx) return json({ error: '로그인이 필요해요.' }, 401);
    const req = await getUndoRequest(DB, ctx.room.id);
    if (!req) return json({ error: '취소 요청이 없어요.' }, 400);
    if (req.by_key === ctx.key) return json({ error: '상대가 승인해야 취소돼요.' }, 403);
    const last = await lastEvent(DB, ctx.room.id);
    if (!last || last.id !== req.event_id) { await clearUndoRequest(DB, ctx.room.id); return json({ error: '상황이 바뀌어 요청이 무효가 됐어요.' }, 409); }
    await DB.prepare('DELETE FROM events WHERE id = ?').bind(req.event_id).run();
    await clearUndoRequest(DB, ctx.room.id);
    return json({ ok: true });
  }
  if (p === '/api/undo-cancel' && m === 'POST') {
    // 요청 철회(요청자) 또는 거절(상대) — 둘 다 요청만 지움
    const ctx = await meAndRoom(DB, token);
    if (!ctx) return json({ error: '로그인이 필요해요.' }, 401);
    await clearUndoRequest(DB, ctx.room.id);
    return json({ ok: true });
  }
  if (p === '/api/logout' && m === 'POST') {
    await deleteSession(DB, token);
    return json({ ok: true });
  }
  if (p === '/api/rename' && m === 'POST') {
    const { name } = await request.json();
    return json(await rename(DB, token, name));
  }
  if (p === '/api/avatar' && m === 'POST') {
    const { avatar } = await request.json();
    return json(await setAvatar(DB, token, avatar));
  }
  return json({ error: '없는 API입니다.' }, 404);
}

// ---- 유틸 ----
function newKey() { return 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }
function newRoomId() { return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }
function nowIso() { return new Date().toISOString(); }
function kstToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function pin4() { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(1000 + (a[0] % 9000)); }

// ---- 방(rooms + members 테이블) ----
// 방 기본정보는 rooms(id,pin,created_at), 멤버(방장/참가자)는 members 테이블 각 1행.
// in-memory room 객체는 예전과 동일: { id, pin, creator:{key,name,avatar}, joiner:{...}|null }
async function roomWithMembers(DB, r) {
  if (!r) return null;
  const ms = (await DB.prepare('SELECT role, user_key, name, avatar FROM members WHERE room_id = ?').bind(r.id).all()).results || [];
  const find = role => { const m = ms.find(x => x.role === role); return m ? { key: m.user_key, name: m.name, avatar: m.avatar || null } : null; };
  return { id: r.id, pin: r.pin, creator: find('creator'), joiner: find('joiner') };
}
async function getRoomById(DB, id) {
  if (!id) return null;
  return roomWithMembers(DB, await DB.prepare('SELECT id, pin FROM rooms WHERE id = ?').bind(id).first());
}
async function getRoomByPin(DB, pin) {
  if (!pin) return null;
  return roomWithMembers(DB, await DB.prepare('SELECT id, pin FROM rooms WHERE pin = ?').bind(pin).first());
}
async function upsertMember(DB, roomId, role, mb) {
  if (!mb) return;
  await DB.prepare(
    `INSERT INTO members(room_id, role, user_key, name, avatar) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(room_id, role) DO UPDATE SET user_key = excluded.user_key, name = excluded.name, avatar = excluded.avatar`
  ).bind(roomId, role, mb.key, mb.name, mb.avatar || null).run();
}
async function insertRoom(DB, room) {
  await DB.prepare('INSERT INTO rooms(id, pin, created_at) VALUES(?, ?, ?)')
    .bind(room.id, room.pin, nowIso()).run();
  await upsertMember(DB, room.id, 'creator', room.creator);
  await upsertMember(DB, room.id, 'joiner', room.joiner);
}
async function saveRoom(DB, room) {
  await upsertMember(DB, room.id, 'creator', room.creator);
  await upsertMember(DB, room.id, 'joiner', room.joiner);
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
async function sessionFromToken(DB, token) {
  if (!token) return null;
  const r = await DB.prepare('SELECT user_key, room_id FROM sessions WHERE token = ?').bind(token).first();
  return r ? { key: r.user_key, roomId: r.room_id } : null;
}
// 토큰 → { room, key, me } (내가 그 방의 멤버일 때만) / 아니면 null
async function meAndRoom(DB, token) {
  const sess = await sessionFromToken(DB, token);
  if (!sess) return null;
  const room = await getRoomById(DB, sess.roomId);
  const me = memberByKey(room, sess.key);
  if (!room || !me) return null;
  return { room, key: sess.key, me };
}
async function newSession(DB, key, roomId) {
  const token = crypto.randomUUID();
  await DB.prepare('INSERT INTO sessions(token, user_key, room_id, created_at) VALUES(?, ?, ?, ?)')
    .bind(token, key, roomId, nowIso()).run();
  return token;
}
async function deleteSession(DB, token) {
  if (token) await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

// ---- 차례 ----
async function lastEvent(DB, roomId) {
  return await DB.prepare('SELECT * FROM events WHERE room_id = ? ORDER BY id DESC LIMIT 1').bind(roomId).first();
}
function currentTurnKey(room, last) {
  if (!room || !room.joiner) return null;
  if (!last) return room.creator.key;
  return last.user_key === room.creator.key ? room.joiner.key : room.creator.key;
}

// ---- 방 만들기 / 참여 ----
async function createRoom(DB, name) {
  name = (name || '').trim();
  if (!name) throw new Error('이름을 입력해주세요.');
  // 다른 방과 겹치지 않는 PIN 뽑기
  let pin = pin4();
  for (let i = 0; i < 50 && (await getRoomByPin(DB, pin)); i++) pin = pin4();
  const id = newRoomId(), key = newKey();
  const room = { id, pin, creator: { key, name, avatar: null }, joiner: null };
  await insertRoom(DB, room);
  return { pin, token: await newSession(DB, key, id), me: { key, name } };
}
async function joinRoom(DB, name, pin) {
  name = (name || '').trim();
  if (!name) throw new Error('이름을 입력해주세요.');
  pin = String(pin || '').trim();
  const room = await getRoomByPin(DB, pin);
  if (!room) throw new Error('그 PIN의 품앗이를 찾을 수 없어요.');
  // 재로그인(다른 기기): 이름이 기존 멤버와 같으면 그 자리로
  if (name === room.creator.name) return { token: await newSession(DB, room.creator.key, room.id), me: { key: room.creator.key, name } };
  if (room.joiner && name === room.joiner.name) return { token: await newSession(DB, room.joiner.key, room.id), me: { key: room.joiner.key, name } };
  // 빈 자리에 신규 합류
  if (!room.joiner) {
    const key = newKey();
    room.joiner = { key, name, avatar: null };
    await saveRoom(DB, room);
    return { token: await newSession(DB, key, room.id), me: { key, name } };
  }
  throw new Error('이 방은 이미 두 명이 참여 중이에요.');
}
// 이 방만 닫기 (이 방의 기록·세션·방 정보 삭제)
async function closeRoom(DB, roomId) {
  await DB.prepare('DELETE FROM events WHERE room_id = ?').bind(roomId).run();
  await DB.prepare('DELETE FROM sessions WHERE room_id = ?').bind(roomId).run();
  await DB.prepare('DELETE FROM members WHERE room_id = ?').bind(roomId).run();
  await DB.prepare('DELETE FROM undo_requests WHERE room_id = ?').bind(roomId).run();
  await DB.prepare('DELETE FROM rooms WHERE id = ?').bind(roomId).run();
}

// ---- 이름 / 아바타 변경 ----
async function rename(DB, token, name) {
  name = (name || '').trim();
  if (!name) throw new Error('이름을 입력해주세요.');
  if (name.length > 20) throw new Error('이름은 20자 이내로 해주세요.');
  const ctx = await meAndRoom(DB, token);
  if (!ctx) throw new Error('로그인이 필요해요.');
  const { room, key, me } = ctx;
  const other = room.creator.key === key ? room.joiner : room.creator;
  if (other && other.name === name) throw new Error('상대와 같은 이름은 쓸 수 없어요.');
  me.name = name;
  await saveRoom(DB, room);
  return { ok: true, name };
}
async function setAvatar(DB, token, avatar) {
  const ctx = await meAndRoom(DB, token);
  if (!ctx) throw new Error('로그인이 필요해요.');
  const { room, me } = ctx;
  if (avatar && avatar.length > 80000) throw new Error('이미지가 너무 커요. 더 작게 잘라주세요.');
  me.avatar = avatar || null;
  await saveRoom(DB, room);
  return { ok: true };
}

// ---- 이벤트 ----
async function recordBuy(DB, roomId, key, note) {
  await DB.prepare('INSERT INTO events(room_id, date, user_key, note, created_at) VALUES(?, ?, ?, ?, ?)')
    .bind(roomId, kstToday(), key, note || null, nowIso()).run();
}
// ---- 취소 요청(undo_requests): 방마다 최대 1건, 상대 승인 시 실제 삭제 ----
async function getUndoRequest(DB, roomId) {
  return await DB.prepare('SELECT event_id, by_key FROM undo_requests WHERE room_id = ?').bind(roomId).first();
}
async function requestUndo(DB, roomId, eventId, byKey) {
  await DB.prepare(
    `INSERT INTO undo_requests(room_id, event_id, by_key, created_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET event_id = excluded.event_id, by_key = excluded.by_key, created_at = excluded.created_at`
  ).bind(roomId, eventId, byKey, nowIso()).run();
}
async function clearUndoRequest(DB, roomId) {
  await DB.prepare('DELETE FROM undo_requests WHERE room_id = ?').bind(roomId).run();
}

// ---- 상태 ----
async function getState(DB, token) {
  const sess = await sessionFromToken(DB, token);
  if (!sess) return { phase: 'setup', me: null };
  const room = await getRoomById(DB, sess.roomId);
  const meKey = sess.key;
  const me = memberByKey(room, meKey);
  if (!room || !me) return { phase: 'setup', me: null }; // 방이 닫혔거나 멤버 아님 → 첫 화면

  if (!room.joiner) {
    // 나는 방장, 상대 대기 중
    return { phase: 'waiting', pin: room.pin, me: { name: me.name } };
  }
  const last = await lastEvent(DB, room.id);
  const nextKey = currentTurnKey(room, last);
  const mate = room.creator.key === meKey ? room.joiner : room.creator;
  const rows = (await DB.prepare('SELECT * FROM events WHERE room_id = ? ORDER BY id DESC LIMIT 15').bind(room.id).all()).results;
  const recent = rows.map(e => {
    const mb = memberByKey(room, e.user_key);
    return { date: e.date, name: mb ? mb.name : '?', avatar: mb ? mb.avatar || null : null, isMe: e.user_key === meKey, note: e.note };
  });
  const ur = await getUndoRequest(DB, room.id);
  return {
    phase: 'active',
    me: pub(me), mate: pub(mate),
    creator: pub(room.creator), joiner: pub(room.joiner),
    myTurn: meKey === nextKey,
    turn: pub(memberByKey(room, nextKey)),
    last: last ? { name: keyName(room, last.user_key), date: last.date, mine: last.user_key === meKey } : null,
    undoReq: ur ? { byMe: ur.by_key === meKey, byName: keyName(room, ur.by_key) } : null,
    recent,
  };
}
