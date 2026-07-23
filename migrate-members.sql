-- rooms.data(JSON blob) → members 테이블 정규화 마이그레이션
-- 실행: npx wrangler d1 execute whoscoffee --remote --file migrate-members.sql
CREATE TABLE IF NOT EXISTS members (
  room_id  TEXT NOT NULL,
  role     TEXT NOT NULL,        -- 'creator' | 'joiner'
  user_key TEXT NOT NULL,
  name     TEXT NOT NULL,
  avatar   TEXT,
  PRIMARY KEY (room_id, role)
);

-- 기존 방들의 방장/참가자를 members 로 백필 (data JSON 파싱)
INSERT OR IGNORE INTO members (room_id, role, user_key, name, avatar)
  SELECT id, 'creator',
         json_extract(data, '$.creator.key'),
         json_extract(data, '$.creator.name'),
         json_extract(data, '$.creator.avatar')
  FROM rooms
  WHERE json_extract(data, '$.creator.key') IS NOT NULL;

INSERT OR IGNORE INTO members (room_id, role, user_key, name, avatar)
  SELECT id, 'joiner',
         json_extract(data, '$.joiner.key'),
         json_extract(data, '$.joiner.name'),
         json_extract(data, '$.joiner.avatar')
  FROM rooms
  WHERE json_extract(data, '$.joiner.key') IS NOT NULL;
