-- 迁移 002：门户通行密钥表（docs/商户功能方案.md v1.7 / docs/文库方案.md v1.3）——幂等，可安全重跑
-- 执行：wrangler d1 execute whizzzest --remote --file scripts/migrations/002-20260908-webauthn-credentials.sql
--       wrangler d1 execute whizzzest --local  --file scripts/migrations/002-20260908-webauthn-credentials.sql
-- 执行记录：生产 ✅（2026-09-08 随门户 Passkey 上线）；本地 ✅（开发期应用）
-- （收编自 scripts/webauthn-migrate.sql，2026-09-08 迁移纪律正式化，docs/全站优化方案.md W2）
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
