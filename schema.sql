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

-- 剧集/合集级信息（2026-09-06）：货架「总封面」（竖版海报最佳）；name 与 videos.series 对应
CREATE TABLE IF NOT EXISTS video_series (
  name TEXT PRIMARY KEY,
  cover TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 文库（2026-09-06，docs/文库方案.md）：小说/图文连载，作者投稿 → admin 审核 → 主站 /library/ 上线
-- status: pending 待审 | approved 上线 | rejected 已驳回 | hidden 站长下线；slug 审核通过生成 b<id>
-- 冗余 chapter_count/word_count 在章节变更时重算；views 为作品详情+阅读页浏览合计
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',  -- novel 小说 | story 故事 | essay 随笔 | other 其他
  intro TEXT NOT NULL,
  cover TEXT,                              -- R2 键 book/c-*.jpg（主站 /media/ 代理公开读取）
  author_name TEXT,                        -- 展示笔名（投稿时填，可空）
  writer_id INTEGER,                       -- writer_users.id；admin 后台直建时为 NULL（免审）
  status TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  sort_weight INTEGER NOT NULL DEFAULT 0,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_books_pub ON books(status, sort_weight DESC, updated_at DESC);

-- 章节：body 为分段纯文本（[图] 占位行，渲染时按 images 顺序替换 <figure>）；
-- 章节级审核：已上线作品加新章/改章不影响上架，新章 approved 后才可读
CREATE TABLE IF NOT EXISTS book_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id),
  idx INTEGER NOT NULL,                    -- 章节序号（1 起），阅读页 URL 用
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  images TEXT,                             -- JSON 数组：R2 键列表 book/b<bookId>/…
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reject_reason TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON book_chapters(book_id, idx);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON book_chapters(status, id DESC);

-- 万载音乐（2026-09-06）：admin 直传 MP3 → 主站 /music/ 播放器页
-- file_key: R2 键（music/ 前缀，主站 /media/* 代理，Range 已支持 → 拖进度条 seek 可用）
-- cover: R2 键（music/c-*）或站内路径（/assets/img/…），空则前台「焰」字占位
-- status: published 上线 | hidden 隐藏；sort 小者靠前（列表顺序即专辑曲序）
CREATE TABLE IF NOT EXISTS music_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  cover TEXT,
  file_key TEXT NOT NULL,
  duration INTEGER DEFAULT 0,              -- 秒；上传时浏览器端预读元数据自动带出
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  plays INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_music_pub ON music_tracks(status, sort, id);

-- 旅游景点（2026-09-06）：瀑布流推荐栏 + 详情页（对标 /tv/* /merchants/*，D1 权威）
-- slug 详情 URL（后台唯一）；body 空行分段纯文本，渲染时 esc 包 <p>——白名单结构，天然免疫 XSS
-- status: published 上线 | hidden 下线；sort 小者靠前
CREATE TABLE IF NOT EXISTS attractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT,                               -- 逗号分隔（古城,山水）
  cover TEXT,                              -- R2 键（attra/c-*）或站内路径（/assets/img/…）
  body TEXT,
  address TEXT,
  hours TEXT,
  tickets TEXT,
  transport TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attractions_pub ON attractions(status, sort, id DESC);

-- 作者账号（writer.whizzzest.com，docs/文库方案.md）：与商户门户完全独立的账号体系，
-- 同手机号/邮箱可在两边各注册（不同表不同会话密钥）；登录方式与商户一致
-- 2026-09-06 二次迁移：phone 允许 NULL（支持纯邮箱注册），部分唯一索引仅约束非空手机号
-- （线上旧表迁移：DROP TABLE writer_users; 后按本结构重建——当时为空表，无数据损失）
CREATE TABLE IF NOT EXISTS writer_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,                              -- 手机号注册账号填；纯邮箱注册为 NULL
  email TEXT,
  pass_hash TEXT NOT NULL,                 -- PBKDF2-SHA256(pass_salt, 10万次)
  pass_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wu_email ON writer_users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wu_phone ON writer_users(phone) WHERE phone IS NOT NULL;
