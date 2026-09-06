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

-- 访客监控（后台「访客分析」数据源，2026-09-06；会话/环境维度 2026-09-06 二期）
-- vid = 第一方匿名 Cookie（HttpOnly，主站 Worker 下发，1 年）
-- sid = 会话 Cookie（30 分钟滑动过期）；pv_id = 单次页面浏览 ID（页面关闭时回报停留时长）
-- 未携带 Cookie 的访问按 IP 归组展示；国家取自 Cloudflare 边缘地理信息
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vid TEXT,
  sid TEXT,
  pv_id TEXT,
  path TEXT NOT NULL,
  referrer TEXT,
  ref_host TEXT,
  kind TEXT,
  country TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  lang TEXT,
  ua TEXT,
  ip TEXT,
  engage_ms INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits(vid, created_at);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at);
CREATE INDEX IF NOT EXISTS idx_visits_sid ON visits(sid);
CREATE INDEX IF NOT EXISTS idx_visits_pvid ON visits(pv_id);

-- 商户展示与入驻（M1，docs/商户功能方案.md）
-- tier: free 基础卡片 | verified 认证商户 | featured 置顶推荐
-- status: pending 待审核 | approved 已上线 | rejected 已驳回 | expired 已过期
-- paid_until: 付费展示到期日（NULL = 免费期）；slug 为空时审核通过自动生成 m<id>
CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,              -- food|stay|specialty|fireworks|other
  tier TEXT NOT NULL DEFAULT 'free',
  intro TEXT NOT NULL,
  detail TEXT,
  cover TEXT,
  images TEXT,
  address TEXT,
  phone TEXT,
  wechat TEXT,
  hours TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  paid_until TEXT,
  sort_weight INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status, sort_weight DESC, id DESC);
