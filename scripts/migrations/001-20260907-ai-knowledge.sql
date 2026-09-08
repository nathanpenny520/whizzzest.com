-- 迁移 001：AI 助手「花傩」建表（docs/AI助手方案.md）——纯 DDL，幂等，可安全重跑
-- 执行：wrangler d1 execute whizzzest --remote --file scripts/migrations/001-20260907-ai-knowledge.sql
--       wrangler d1 execute whizzzest --local  --file scripts/migrations/001-20260907-ai-knowledge.sql
-- 执行记录：生产 ✅（2026-09-07 随 AI 助手上线上线）；本地 ✅（开发期应用）
-- （收编自 scripts/ai-migrate.sql，2026-09-08 迁移纪律正式化，docs/全站优化方案.md W2）

CREATE TABLE IF NOT EXISTS ai_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_pub ON ai_knowledge(status, sort, id);

CREATE TABLE IF NOT EXISTS ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer_len INTEGER DEFAULT 0,
  action TEXT,
  sources TEXT,
  duration_ms INTEGER DEFAULT 0,
  ip TEXT,
  vid TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_chats_created ON ai_chats(created_at);
