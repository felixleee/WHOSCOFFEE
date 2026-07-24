-- WHOSCOFFEE D1 스키마 (멀티룸 · userkey 기반)
-- 방(room)은 여러 개(rooms 테이블). 사람은 user_key(불변)로 식별.
-- 이름·아바타는 rooms.data 안 멤버 정보에. 세션은 token→(user_key, room_id).
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS undo_requests;
DROP TABLE IF EXISTS rooms;

CREATE TABLE rooms (
  id         TEXT PRIMARY KEY,   -- 방 id
  pin        TEXT NOT NULL,      -- 초대 코드(4자리)
  created_at TEXT NOT NULL
);
-- 멤버(방장/참가자): 방마다 최대 2행. 이름·아바타 변경은 여기서.
CREATE TABLE members (
  room_id  TEXT NOT NULL,        -- 어느 방
  role     TEXT NOT NULL,        -- 'creator' | 'joiner'
  user_key TEXT NOT NULL,        -- 불변 사용자 식별자
  name     TEXT NOT NULL,
  avatar   TEXT,                 -- data:image base64 (nullable)
  PRIMARY KEY (room_id, role)
);
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT NOT NULL,      -- 어느 방
  date       TEXT NOT NULL,
  user_key   TEXT NOT NULL,      -- 누가 샀나 (이름 아님)
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_key   TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- 마지막 기록 취소 요청(방마다 최대 1건). 상대가 승인하면 실제 삭제.
CREATE TABLE undo_requests (
  room_id    TEXT PRIMARY KEY,
  event_id   INTEGER NOT NULL,   -- 취소 대상 이벤트
  by_key     TEXT NOT NULL,      -- 요청한 사람(=그 기록 작성자)
  created_at TEXT NOT NULL
);
-- config 테이블은 더 이상 방 저장에 쓰지 않음(과거 데이터 이관용으로만 남을 수 있음)
CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,
  v TEXT
);
-- 웹푸시 구독(기기별). endpoint 로 유일. 상대가 품앗이하면 이 구독으로 푸시 발송.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_key   TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_key);
