-- IM 板块表结构（docs/IM聊天方案.md §4，M1 全量建表，2026-09-13）
-- 库：whizzzest（与主站/门户共用，表全 im_ 前缀隔离）
-- 时间戳一律 TEXT（UTC，datetime('now')），照 writer/merchant 惯例

-- 账号：手机号/邮箱至少其一（E.164 归一见 shared/phone.js）；E2EE 身份密钥三件套必填
CREATE TABLE IF NOT EXISTS im_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT UNIQUE,                -- E.164，可空（纯邮箱账号）
  email         TEXT UNIQUE,                -- 可空（纯手机号账号）
  pass_hash     TEXT NOT NULL,              -- PBKDF2-SHA256 10 万次（照 writer）
  pass_salt     TEXT NOT NULL,              -- 认证盐 hex（32）
  pub_key       TEXT NOT NULL,              -- E2EE：ECDH P-256 raw 公钥（65B 0x04||X||Y）base64
  enc_priv_key  TEXT NOT NULL,              -- E2EE：密码包裹私钥（iv||ct）base64，服务器永不可解
  kdf_salt      TEXT NOT NULL,              -- E2EE：包裹 KDF salt hex（32；与 pass_salt 独立）
  kdf_iters     INTEGER NOT NULL,           -- E2EE：PBKDF2 迭代数（310000）
  display_name  TEXT NOT NULL DEFAULT '',
  avatar_color  INTEGER NOT NULL DEFAULT 0, -- 首字头像预设色 0-7
  bio           TEXT NOT NULL DEFAULT '',   -- 个人简介（明文，非聊天内容）
  status        TEXT NOT NULL DEFAULT 'normal',  -- normal | disabled
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

-- IM 门户专用邮箱验证码（不复用 email_login_codes：那张表主键 email，三门户同邮箱会互相覆盖）
-- purpose：im-register ｜ im-login
CREATE TABLE IF NOT EXISTS im_email_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 好友申请（拉黑方静默拒：应用层过滤）
CREATE TABLE IF NOT EXISTS im_friend_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uid   INTEGER NOT NULL,
  to_uid     INTEGER NOT NULL,
  message    TEXT NOT NULL DEFAULT '',    -- 附言 ≤100
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|rejected|canceled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT,
  UNIQUE(from_uid, to_uid)
);
CREATE INDEX IF NOT EXISTS idx_im_freq_to ON im_friend_requests(to_uid, status);

-- 好友关系（双行制：A→B 一行 + B→A 一行）
CREATE TABLE IF NOT EXISTS im_friendships (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  friend_id  INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_im_fs_user ON im_friendships(user_id);

-- 拉黑
CREATE TABLE IF NOT EXISTS im_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  blocked_uid INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, blocked_uid)
);

-- 会话（dm 幂等键 dm_key='dm:min:max'；群上限 100 人应用层控制）
CREATE TABLE IF NOT EXISTS im_conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,               -- dm | group
  dm_key     TEXT UNIQUE,
  name       TEXT NOT NULL DEFAULT '',    -- 群名 ≤30（dm 空）
  owner_id   INTEGER,                     -- 群主
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 会话成员（last_read_seq=未读基准；min_seq=入群时点，新成员不回看入群前历史）
CREATE TABLE IF NOT EXISTS im_members (
  conversation_id INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',  -- owner | member
  joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_read_seq   INTEGER NOT NULL DEFAULT 0,
  min_seq         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_im_members_user ON im_members(user_id);

-- 会话密钥信封：每成员每版本一枚（ECDH 临时×成员身份公钥 + HKDF + AES-GCM 包裹会话密钥）
CREATE TABLE IF NOT EXISTS im_conv_keys (
  conversation_id INTEGER NOT NULL,
  key_version     INTEGER NOT NULL,
  uid             INTEGER NOT NULL,
  envelope        TEXT NOT NULL,          -- base64(iv||ephemeral_pub||ct)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, key_version, uid)
);

-- 消息（密文；seq 由 DO IMRoom 单调分配；sender_id=0 为系统行，type=system 明文事件）
CREATE TABLE IF NOT EXISTS im_messages (
  conversation_id INTEGER NOT NULL,
  seq             INTEGER NOT NULL,
  sender_id       INTEGER NOT NULL,
  type            TEXT NOT NULL DEFAULT 'text',    -- text | system
  body            TEXT NOT NULL,          -- ≤2000（密文或系统事件文本）
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, seq)
);

-- 举报（E2EE 下举报人可自愿附本地解密引用文，reason 内）
CREATE TABLE IF NOT EXISTS im_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_uid   INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  seq_from       INTEGER NOT NULL DEFAULT 0,
  seq_to         INTEGER NOT NULL DEFAULT 0,
  reason         TEXT NOT NULL DEFAULT '',         -- ≤200
  status         TEXT NOT NULL DEFAULT 'open',     -- open | closed
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
