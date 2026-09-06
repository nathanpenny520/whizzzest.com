-- 焰境·万载 —— 官网留言表（联系表单）
-- read_at：后台标记已读的时间（NULL = 未读），由 admin worker 写入（2026-09-06 迁移）
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  message TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  read_at TEXT
);

-- 访客监控（后台「访客分析」数据源，2026-09-06）
-- vid = 第一方匿名 Cookie（HttpOnly，主站 Worker 下发，有效期 1 年）
-- 未携带 Cookie 的访问按 IP 归组展示；国家取自 Cloudflare 边缘地理信息
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vid TEXT,
  path TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  device TEXT,
  ua TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits(vid, created_at);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
