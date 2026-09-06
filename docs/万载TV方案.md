# 万载TV —— 视频频道方案

> 文档版本：**v1.0** ｜ 2026-09-06 ｜ 状态：T1 实施中
> 需求：前端新增【万载TV】页面集中承载视频与短剧，采用大平台式 UI、空间利用充分；后台可随时更新视频（B站嵌入 + 直接上传），不依赖重新构建上线。
> 已拍板：① 频道页/详情页采用**深色「影院模式」**基调（页头页脚不变）；② URL 前缀 **`/tv/`**；③ **新建独立 R2 桶 `whizzzest-media`**，不混入商户图片桶；④ 内容以**自有上传为优先打磨方向**（首批内容：B站《一朝相逢便是万载》系列短剧 12 集 + 万载宣传片《遇见万载》）。

---

## 1. 架构决策

站点是构建时静态渲染（build.js 烘数据），但 TV 内容要求后台更新即时生效——与 `/merchants/` 场景完全相同，直接复用其已验证模式：

> **D1 为权威数据 + 主站 Worker 动态渲染 `/tv/` 页面**（对标 `worker/merchants.js` 的目录页 + 详情页双页结构，复用构建产物 `dist/partials/*.html` 页头页脚与带指纹的 style.css）。

| 决策 | 结论 | 理由 |
|---|---|---|
| 存储 | 新建 R2 桶 `whizzzest-media`，主站 Worker 与 admin Worker 都挂 `MEDIA` 绑定 | 桶职责清晰；视频删除/容量统计独立于商户图片；主站经 `/media/<key>` 代理公开读取（immutable 缓存），admin 直传 |
| 页面形态 | `/tv/` 频道页 + `/tv/<id>/` 详情页，Worker 渲染 | 每条视频独立 URL：可分享、可收录（VideoObject）；详情页「大播放器 + 选集/相关」是大平台标准布局 |
| 基调 | 频道主体深色（#0d0d12 系）+ 焰色点缀 | 视频平台通例，缩略图更突出；频道自带辨识度 |
| 短剧模型 | 不建独立表，`videos.series + episode` 两字段聚合出剧货架与选集列表 | 一部剧 = 同 series 值的多行；首部剧《一朝相逢便是万载》 |
| 播放计数 | 详情页加载即 `views+1`（ctx.waitUntil），不设防刷 | 宣传站量级，够用 |

## 2. 数据模型（D1 `videos` 表，2026-09-06 迁移）

```sql
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',  -- drama短剧|fireworks烟花|heritage非遗|food美食|tourism文旅|other其他
  source TEXT NOT NULL DEFAULT 'bilibili', -- bilibili B站嵌入 | upload R2 直传
  bvid TEXT,                               -- B站 BV 号（source=bilibili）
  file_key TEXT,                           -- R2 对象键（source=upload，形如 tv/v-xxx.mp4）
  cover TEXT,                              -- 封面：R2 键（不带 / 前缀 → /media/…）或站内路径（/assets/img/…）
  duration INTEGER DEFAULT 0,              -- 秒；上传时浏览器端预读元数据自动带出
  series TEXT,                             -- 剧名/合集名（短剧用，可空）
  episode INTEGER,                         -- 集数（可空）
  intro TEXT,
  featured INTEGER NOT NULL DEFAULT 0,     -- 1 = 频道页焦点大位
  status TEXT NOT NULL DEFAULT 'published',-- published 上线 | hidden 隐藏
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_pub ON videos(status, category, id DESC);
CREATE INDEX IF NOT EXISTS idx_videos_series ON videos(series);
```

封面防盗链说明：B站封面图（hdslb.com）校验 Referer 不能热链，故 B站视频封面由后台上传一张（或留空用焰色占位图）。

## 3. 前台页面（worker/tv.js）

### `/tv/` 频道页（深色，`container-wide` 全宽）

1. **焦点位**：featured=1 的最新一条，左 2/3 播放器（点击封面后才插入 B站 iframe——lite facade，LCP 不被拖垮）+ 右 1/3 信息卡
2. **短剧剧场**：`series` 非空的已发布视频按剧聚合，横向滑动货架，9:16 竖版卡片 + 「更新至 N 集」角标
3. **分类 Tab + 视频网格**：全部/短剧/烟花/非遗/美食/文旅（`?cat=` 筛选）；桌面 4 列 16:9 卡片（封面 + 时长角标 + 分类/日期/播放量），短剧剧集也进网格填充空间

### `/tv/<id>/` 详情页

左 2/3 播放器（B站 iframe 或原生 `<video controls preload="metadata">`）+ 标题/分类/日期/播放量/简介；右 1/3：是短剧 → **本剧选集**列表；否则 → **相关视频**（同分类最新 8 条）。底部面包屑。加载即播放计数 +1。

### 其他

- `/tv/sitemap.xml`：已发布视频动态片段（对标 `/merchants/sitemap.xml`）；`/tv/` 进主 sitemap
- 每详情页 JSON-LD `VideoObject`（embedUrl/contentUrl + thumbnailUrl）
- `/media/<key>`：R2 代理，支持 Range（视频拖动进度条必须），immutable 缓存
- 首批内容：B站《一朝相逢便是万载》短剧 12 集（BV18Hbn6SEJa / BV1bWbn6EEU9 / BV1bWbn6EE7G / BV1UWbn6EE25 / BV1bWbn6EE43 / BV18Wbn6EEFE / BV18Wbn6EEF5 / BV1SWbn6EEbW / BV1bWbn6EEtC / BV1bWbn6EEuf / BV1bWbn6EEdP / BV1hHbn6DENG）+ 宣传片《遇见万载》（BV1aHbp6tEno）

## 4. 后台管理（admin「视频」Tab）

- 列表：状态筛选（全部/已发布/已隐藏）、封面缩略图、发布↔隐藏一键切换、编辑、删除（二次点击确认，级联删 R2 视频与封面）；统计行含已用存储（R2 list 求和，5 分钟缓存）
- 表单：标题 / 分类 / 状态 / 来源（B站嵌入填 BV号 ｜ 直接上传选文件）/ 剧名+集数 / 简介封面 / 焦位点 / 时长
- **上传管线（流式，规避 Worker 128MB 内存限制）**：
  1. 前端选文件即预读时长（`<video>` objectURL）并校验 ≤95MB
  2. 保存时 `XHR PUT /api/tv/upload?ext=mp4`（File 直作 body，**带进度条**）→ Worker 校验会话/扩展名/Content-Length 后 `request.body` 流式转发 `MEDIA.put()`（content-length 已知，不整读内存）
  3. 封面走 `PUT /api/tv/cover`（≤5MB，魔数校验 JPG/PNG/WebP，复用商户图片校验逻辑）
  4. 最后 `POST /api/tv`（JSON 元数据）落 D1；编辑换文件/封面时服务端删除旧 R2 对象
- 硬限制：单视频 **95MB**（Cloudflare 免费版请求体上限 100MB）；无转码，推荐 MP4(H.264)/WebM

## 5. 改动清单

| 位置 | 改动 |
|---|---|
| `schema.sql` | `videos` 表 + 两索引（线上用 `wrangler d1 execute` 迁移） |
| `wrangler.jsonc` | 主站 `MEDIA` 绑定；`run_worker_first` 增加 `/tv`、`/tv/*`、`/media`、`/media/*`（不加则 /tv/ 被静态资产层 404） |
| `admin/wrangler.jsonc` | admin `MEDIA` 绑定 |
| `worker/tv.js`（新） | 频道页/详情页/sitemap/媒体代理 |
| `worker/index.js` | 挂 `/tv/*` 与 `/media/*` 路由 |
| `build.js` | sitemap + robots 增补 /tv/ |
| `src/data/site.json` | 导航加「万载TV」（赏烟地点之后） |
| `admin/index.js` | `/api/tv/*` CRUD + 流式上传路由；APP_HTML「视频」Tab |
| `src/assets/css/style.css` | tv-* 深色组件段 |

## 6. 风险与限制

1. 单视频 ≤95MB（免费版硬限制）；更大体积先压缩或改走 B站嵌入
2. R2 免费额度 10GB；后台统计行显示已用容量，超限前提醒（超出 $0.015/GB·月）
3. 无转码：上传即所播；封面无法自动取帧（封面必传或用占位图）
4. B站封面防盗链 → 后台上传封面或占位图（服务端代抓列为后续增强）
5. CSP（主站为 Report-Only、admin img-src 增补 whizzzest.com）已核对，B站 iframe 与 /media 封面可正常加载

## 7. 后续增强（T2/T3）

- 首页「焰境影像」横滑条（`GET /api/tv/latest` 公开 JSON + 内联脚本）
- 瘦页扩写：赏烟地点点位扩充、美食/旅游纵深内容（内容需用户参与）
- B站封面服务端代抓回填；播放量趋势
