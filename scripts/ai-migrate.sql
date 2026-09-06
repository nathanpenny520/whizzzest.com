-- AI 助手「花傩」建表迁移（docs/AI助手方案.md）——纯 DDL，幂等，可对已有多表的线上库直接执行。
-- （schema.sql 是全量权威结构，但含不幂等的 ALTER，适合全新库；已有库用本文件增量迁移。）
--
-- 执行：wrangler d1 execute whizzzest --remote --file scripts/ai-migrate.sql
--       wrangler d1 execute whizzzest --local  --file scripts/ai-migrate.sql

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
