# 焰境·万载 — whizzzest.com

> 一朝相逢，便是万载。

「焰境·万载」是围绕**江西省万载县**（中国花炮之乡）打造的官方宣传网站：千年烟花文化、非物质文化遗产、特色美食物产、旅游线路与赏烟地点，一站式了解这座赣西小城。

- 🌐 **线上地址**：**https://whizzzest.com**
- 🛠 管理后台：https://admin.whizzzest.com（仅限团队）
- 📬 联系我们：whizzzest@outlook.com

## 网站内容

| 页面 | 内容 |
|---|---|
| 首页 | 全屏轮播 · 核心特色 · 风物速览 |
| 非遗文化 | 万载花炮、得胜鼓、开口傩、夏布织造、纸棚山歌（含非遗影像） |
| 美食特产 | 万载六大碗、其他美食、传统特产 |
| 烟花产业 | 1400 年花炮史 · 产业规模 · 文旅融合 |
| 旅游线路 | 古城 / 山水 / 红色三条文化之旅（逐站行程） |
| 赏烟地点 | 最佳观赏位置、交通与贴士 |
| 关于 | 团队、使命、发展历程、合作伙伴、联系方式与留言表单 |

## 技术实现

**零框架、零 npm 依赖**的原生多页静态站，构建即文件拼装：

- **前端**：手写语义化 HTML + CSS（Apple 视效风格：毛玻璃导航、系统字体栈）+ 原生 ES Modules
- **构建**：`build.js`（仅用 Node 内置模块）——模板拼装、内容数据渲染、自动生成 `sitemap.xml` / `robots.txt`
- **内容**：全部文案与图片数据化在 `src/data/`，由 `scripts/extract-content.py` 从旧站源码提取
- **托管**：Cloudflare Workers（Static Assets），自定义域名 + SSL 自动签发
- **后端**：单入口 Worker（`worker/index.js`）——`www → @` 301、`POST /api/contact` 留言（Honeypot 反垃圾 → D1 权威存储 → 阿里云企业邮通知）
- **数据库**：Cloudflare D1（留言表结构见 `schema.sql`）
- **CI/CD**：push `main` 分支 → GitHub Actions 自动构建部署（`.github/workflows/deploy.yml`）

## 本地开发

```bash
# 构建并本地预览
node build.js
python3 -m http.server 8788 -d dist   # http://127.0.0.1:8788

# 手动部署（通常不需要——push main 会自动部署）
wrangler deploy
```

## 项目结构

```
├─ src/
│  ├─ pages/        # 各页面模板（含 meta 注释）
│  ├─ partials/     # 公共片段（导航 / 页脚 / head）
│  ├─ data/         # 全站内容数据（JSON）
│  └─ assets/       # 样式 / 脚本 / 图片
├─ worker/          # Worker 入口与 SMTP 通知
├─ public/          # 原样复制到 dist 根（_headers / favicon 等）
├─ scripts/         # 内容提取脚本
├─ admin/           # 管理后台（独立 Worker）
└─ build.js         # 零依赖构建脚本
```

设计架构与实施细节见 [docs/设计架构与方案.md](docs/设计架构与方案.md)。
