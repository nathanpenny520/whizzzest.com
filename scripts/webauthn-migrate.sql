-- 门户通行密钥表（2026-09-08）：线上执行
--   wrangler d1 execute whizzzest --remote --file scripts/webauthn-migrate.sql
-- 本地开发各 Worker 目录执行（--local 同名文件）
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_portal_user ON webauthn_credentials(portal, user_id);
