-- 迁移 004：全站配置表——首个键 visit_tracking（访客采集总开关，docs/访客治理方案.md）
-- 后台「访客」页可切换；主站 Worker 60s 实例缓存读取，关闭后停止写 visits / scan_stats
-- 执行：wrangler d1 execute whizzzest --remote --file scripts/migrations/004-20260908-site-settings.sql
--       wrangler d1 execute whizzzest --local  --file scripts/migrations/004-20260908-site-settings.sql
-- 执行记录：生产 ✅（2026-09-08，19 表确认；upsert 语法已验证）；本地 ✅（2026-09-08）。幂等 DDL + INSERT OR IGNORE，可安全重跑

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 默认开启采集（历史行为不变）；后台切到 '0' 即全网停止记录
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('visit_tracking', '1');
