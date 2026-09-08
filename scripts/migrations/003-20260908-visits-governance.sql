-- 迁移 003：访客治理——读取侧复合索引 + 扫描器日计数表（docs/访客治理方案.md 阶段一第 4 项 / 阶段二第 1 项）
-- 执行：wrangler d1 execute whizzzest --remote --file scripts/migrations/003-20260908-visits-governance.sql
--       wrangler d1 execute whizzzest --local  --file scripts/migrations/003-20260908-visits-governance.sql
-- 执行记录：生产 ✅（2026-09-08，wrangler d1 execute --remote，18 表确认）；本地 ✅（2026-09-08）。幂等 DDL，可安全重跑

-- R3/R4：让「排除爬虫 + 时间窗」组合查询从全表过滤变索引范围扫描
CREATE INDEX IF NOT EXISTS idx_visits_bot_created ON visits(is_bot, created_at);

-- 阶段二第 1 项：扫描器不再写 visits 明细，改为「天 × 特征分类」累加，保留宏观可见性
-- date 为北京时区日期（与 visits 展示口径一致）；写入侧见 worker/index.js trackVisit
CREATE TABLE IF NOT EXISTS scan_stats (
  date TEXT NOT NULL,
  category TEXT NOT NULL,                  -- scan-path 命中扫描特征路径 | 404 落点不存在路径
  count INTEGER NOT NULL DEFAULT 0,
  last_path TEXT,                          -- 最近一次样本
  last_ua TEXT,
  last_at TEXT,
  PRIMARY KEY (date, category)
);
