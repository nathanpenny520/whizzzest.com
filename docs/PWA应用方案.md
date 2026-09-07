# PWA 应用方案 — 「焰境·万载」可下载安装

> 2026-09-07 · 目标：whizzzest.com 做成可下载安装的应用（手机/桌面浏览器一键安装，免上架商店），
> 并明确「下载后各部分功能是否可用」的边界。

## 1. 选型：PWA（渐进式 Web 应用）

- 手机（Android Chrome / iOS Safari）与桌面（Chrome/Edge）都可「安装」：桌面出现独立窗口图标，免商店、免签名、免审核。
- 现有 Cloudflare 架构（Workers + D1 + R2 + Static Assets）原样不动，新增 manifest + Service Worker 即可。
- 备选 Capacitor 包 APK（wkwebview 加载站点）暂不做：需签名/分发渠道，且离线能力与 PWA 完全相同，收益只剩「商店上架」本身。

## 2. 安装后各功能可用性（关键边界）

| 功能 | 离线表现 | 机制 |
| --- | --- | --- |
| 首页/非遗/美食/烟花/旅游/about/pay 等静态页 | ✅ 完整可用 | SW 预缓存页面 + 指纹资产 |
| 数字烟花 /digital-fireworks/ | ✅ 完整可用 | 纯静态，JS/CSS 均在预缓存清单 |
| 站内图片（WebP 变体） | ✅ 可用 | 指纹/不可变资产 runtime 缓存 |
| 音乐 /music/ | ⚠️ 半可用 | 列表页需联网；**听过的 MP3 整文件缓存可离线听** |
| 景点/商户/文库/万载TV 动态页 | ⚠️ 半可用 | HTML network-first，断网回退「上次看到的缓存版」 |
| AI 助手 花傩 | ❌ 需联网 | Workers AI 服务端推理；离线时前端直接提示 |
| 联系表单 | ❌ 需联网 | 离线提交提示网络异常 |
| 访客采集（pv-dwell） | 静默失败 | sendBeacon 离线丢弃，无影响，联网后自动恢复 |
| admin / writer / 商户后台三站 | 不纳入 | 独立子域（SW scope 仅 whizzzest.com），保持 Access 登录网页形态 |

> TV 视频与 AI 问答在任何打包方式（含 APK）下都离线不可用：数据/推理在服务端。

## 3. 组成

### 3.1 manifest（public/manifest.webmanifest）

- `name` 焰境·万载 / `display: standalone` / `start_url: "/"` / `scope: "/"`，theme 与 background 用站点默认 `#fbfbfd`。
- 图标：`favicon.svg` 矢量渲染 192/512 透明 PNG + maskable 版（浅底 `#fbfbfd` + 火焰缩至 76% 安全区）；
  另出 180px `apple-touch-icon`（iOS 不读 manifest 图标）。由 `scripts/gen-icons.js`（sharp）一次性生成入库。
- 快捷方式（长按图标）：数字烟花、万载音乐、旅游景点。

### 3.2 Service Worker（public/sw.js 模板 + build.js 注入）

**预缓存清单由构建生成**：build.js 把全部静态页 slug + `/offline.html` + manifest + 图标 + 带 `?v=` 指纹的
CSS/JS（含 fireworks 的）注入 `__PRECACHE__`；`__BUILD__` 为指纹哈希站内脏戳——指纹一变 SW 字节即变，
浏览器自动重装换新缓存，杜绝「改了样式访客仍拿旧缓存」（与 build.js 指纹机制同一套逻辑）。

| 请求类型 | 策略 |
| --- | --- |
| 页面导航（request.mode=navigate） | network-first；失败回退运行时缓存的同名页（含 query 变体），再回退 `/offline.html` |
| `/assets/*`（带指纹，immutable） | cache-first，运行时缓存上限 150 条 |
| `/media/music/*` 音频（.mp3 等） | cache-first 整文件（≤25MB 才缓存，上限 24 首）；带 Range 时从缓存整文件切片回 206，离线可播可拖进度 |
| `/media/*` 其余（封面图） | cache-first；`/media/tv/*` 视频与任何带 Range 的非音频**直通不缓存**（流媒体体积大，避免破坏 seek） |
| `/assets-merchant/*` 商户图 | cache-first（响应已 immutable） |
| `/api/*`、非 GET | 永不缓存，直通 |
| 缓存满员 | 按写入顺序淘汰最旧（Cache API keys 近似插入序） |

### 3.3 页面接入（全部页面都拿得到 PWA 能力）

- 静态页：`src/partials/head.html` 注入 `<link rel="manifest">` + apple-touch-icon。
- 动态页（/music /attractions /tv /library /merchants 由 Worker 渲染）：五个 worker 的 head 模板同样注入。
- SW 注册 / 安装入口 / 离线提示全放 `main.js`（全站统一脚本，动态页也加载，零额外请求）。

### 3.4 安装入口（不弹窗 —— 2026-09-07 用户定调）

主动安装提示一律不做（站内安装胶囊、iOS 引导已实现过又移除；Chrome Android 的自动横幅经
`beforeinstallprompt` 的 `preventDefault` 静默压制）。安装完全走浏览器原生入口，用户主动找：

- 桌面 Chrome/Edge：地址栏安装图标
- Android：三点菜单「安装应用」
- iOS Safari：分享 → 添加到主屏幕
- macOS Safari 17+：文件 → 添加到程序坞

> 同日用户反馈追加：离线提示胶囊也不做（不做任何主动弹出的 UI）。

### 3.5 离线兜底（全部为被动响应，零主动弹窗）

- `/offline.html`：离线兜底页（未缓存页面打开时 SW 回退到此），含重试按钮；本身也在预缓存内。
- AI 助手：离线发问直接在对话里提示「花傩需要联网」，不发请求。
- 音频离线可播、动态页缓存兜底见 §3.2 策略。

## 4. 验证清单

1. `node build.js` → 检查 dist/sw.js 预缓存清单含指纹版本。
2. `wrangler dev` + Chrome：Application 面板 Manifest 无错、SW activated、缓存逐项命中。
3. DevTools Offline 断网逐页：静态页/数字烟花完整可用；音乐已听曲目可播；动态页出缓存版 + 离线胶囊；AI 提示需联网。
4. Lighthouse PWA 审计。
5. 部署后真机：Android Chrome 安装 → 桌面图标 → 断网开应用；iOS Safari 分享 → 添加到主屏幕。

## 5. 文件清单

| 文件 | 动作 |
| --- | --- |
| `docs/PWA应用方案.md` | 本文档 |
| `scripts/gen-icons.js` + `public/icons/*.png` | 图标生成脚本与产物（一次性，产物入库） |
| `public/manifest.webmanifest`、`public/sw.js`、`public/offline.html` | 新增 |
| `src/partials/head.html`、`worker/{music,attractions,tv,library,merchants}.js` | head 注入 manifest 链接 |
| `src/assets/js/main.js` | SW 注册（UI 零弹窗：安装/离线提示均不做，§3.4） |
| `src/assets/js/ai-chat.js` | 离线发问在对话内提示 |
| `public/_headers` | /sw.js 与 /manifest.webmanifest 协商缓存（no-cache） |
| `build.js` | 生成 dist/sw.js（预缓存清单 + 脏戳） |
