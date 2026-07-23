-- WHOSCOFFEE 멀티룸 이관 (일회성) : 기존 단일 방(config.room) 보존
-- 실행: wrangler d1 execute whoscoffee --remote --file=migrate-multiroom.sql
-- (한 번만 실행. 두 번째부터는 ALTER 가 "duplicate column" 로 실패하니 재실행 금지.)

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  pin        TEXT NOT NULL,
  data       TEXT NOT NULL,   -- JSON {creator:{key,name,avatar}, joiner:{...}|null}
  created_at TEXT NOT NULL
);

ALTER TABLE events   ADD COLUMN room_id TEXT;
ALTER TABLE sessions ADD COLUMN room_id TEXT;

-- 기존 단일 방(config.room)이 있으면 rooms 1행으로 이관.
-- data = {pin 제거한 나머지} = {creator, joiner}
INSERT INTO rooms (id, pin, data, created_at)
SELECT 'rlegacy0001',
       json_extract(v, '$.pin'),
       json_remove(v, '$.pin'),
       datetime('now')
FROM config
WHERE k = 'room' AND v IS NOT NULL AND json_valid(v);

-- 기존 기록/세션은 전부 그 이관된 방 소속으로 백필
UPDATE events   SET room_id = 'rlegacy0001' WHERE room_id IS NULL;
UPDATE sessions SET room_id = 'rlegacy0001' WHERE room_id IS NULL;

-- 과거 방 저장 자리 정리(rooms 로 옮겼으므로)
DELETE FROM config WHERE k = 'room';
