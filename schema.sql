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
  is_bot INTEGER DEFAULT 0,
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

-- 商户门户账号（M2，merchant.whizzzest.com）：一商户一账号，手机号+密码登录；
-- email（M2.1）：绑定的登录邮箱（可空），绑定后可用「邮箱+验证码」免密登录
-- pass_hash = PBKDF2-SHA256(pass_salt, 10万次)，密码不明文存储
CREATE TABLE IF NOT EXISTS merchant_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL UNIQUE REFERENCES merchants(id),
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mu_email ON merchant_users(email);

-- M3 变现闭环：商户自助申请升级/续费 → 站长核销
-- tier_request: 商户申请的目标等级（verified|featured，NULL = 无待核销申请）
-- paid_requested_at: 申请时间（admin 排序/提醒用）
ALTER TABLE merchants ADD COLUMN tier_request TEXT;
ALTER TABLE merchants ADD COLUMN paid_requested_at TEXT;

-- M2.1 邮箱验证码登录（2026-09-06）：发往已绑定邮箱的 6 位验证码
-- code_hash = SHA-256(6位码)，10 分钟有效，≤5 次尝试；purpose 区分 login / bind
-- （既有库迁移：ALTER TABLE merchant_users ADD COLUMN email TEXT; + 上面那条 UNIQUE 索引）
CREATE TABLE IF NOT EXISTS email_login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',   -- login 登录 | bind 绑定邮箱
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 管理后台多账号（2026-09-06）：ADMIN_PASSWORD 仍是主账号「站长」；
-- admin_users 为后台「账号」Tab 自助添加的运营账号，权限与站长相同
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,           -- 2-20 位字母/数字/下划线/连字符
  pass_hash TEXT NOT NULL,                 -- PBKDF2-SHA256(pass_salt, 10万次)
  pass_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 万载TV 视频频道（2026-09-06，docs/万载TV方案.md）
-- source: bilibili B站嵌入（bvid）| upload R2 直传（file_key，桶 whizzzest-media，主站 /media/* 代理）
-- cover: R2 键（不带 / 前缀 → /media/…）或站内路径（/assets/img/…）；B站封面有防盗链需后台上传
-- series/episode：短剧剧集聚合（如《一朝相逢便是万载》第 N 集）
-- status: published 上线 | hidden 隐藏；featured：频道页焦点大位
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',  -- drama|fireworks|heritage|food|tourism|other
  source TEXT NOT NULL DEFAULT 'bilibili',
  bvid TEXT,
  file_key TEXT,
  cover TEXT,
  duration INTEGER DEFAULT 0,              -- 秒；上传时浏览器端预读元数据自动带出
  series TEXT,
  episode INTEGER,
  intro TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_pub ON videos(status, category, id DESC);
CREATE INDEX IF NOT EXISTS idx_videos_series ON videos(series);
