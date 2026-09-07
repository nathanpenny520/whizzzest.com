# 焰境・万载

> **一朝相逢，便是万载。**
> 围绕江西省万载县（中国花炮之乡）打造的现代化文旅数字平台 —— 烟花文化、非遗传承、美食特产、旅游线路、赏烟地点、数字烟花体验、AI 智能向导，一站式呈现。

**官方网站：**[https://whizzzest.com](https://whizzzest.com)

![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1%20%2B%20R2-orange)
![Zero Deps](https://img.shields.io/badge/frontend-zero--deps%20native%20Web-brightgreen)
![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-red.svg)



***

## 目录



* [项目亮点](#项目亮点)

* [功能模块](#功能模块)

* [技术架构](#技术架构)

* [快速开始](#快速开始)

* [部署方式](#部署方式)

* [数据模型](#数据模型)

* [团队](#团队)

* [联系方式](#联系方式)

* [版权声明](#版权声明)



***

## 项目亮点

### 文化深度



* **1400 年烟花文化**：万载花炮始于唐、盛于宋，2008 年列入国家级非物质文化遗产，4000 多个规格品种畅销全球 40 多个国家和地区

* **5 项非遗系统化呈现**：万载花炮、得胜鼓、夏布织造、开口傩、纸棚山歌，每项配独立页面、影像资料与详细图文

* **地道美食全收录**：万载六大碗（富贵油卷、扎肉、诈肉、块鱼、康乐三黄鸡、清炖黑山羊）、罗城扎粉、万载剁肉、龙牙百合、南酸枣糕等 15+ 道特色美食

* **本地内容生态**：焰境文库连载本地作者小说与随笔，万载 TV 播出自制短剧《一朝相逢便是万载》与城市宣传片《遇见万载》

### 技术特色



* **零依赖前端**：不使用任何前端框架，纯原生 HTML/CSS/JavaScript + 自研构建管线，首屏加载约 1.5 秒（弱网环境）

* **全球边缘计算**：全站托管于 Cloudflare 全球 300+ 边缘节点，静态资源直达边缘，动态内容由 Workers 就近渲染

* **AI 原生**：内置 AI 助手「花傩」，基于 Workers AI + RAG 站内知识库，随问随答万载文旅，回答附可追溯来源

* **沉浸式交互**：浏览器数字烟花模拟器（Canvas + Web Audio API），选弹体、定节奏，亲手点亮一场万载焰火

* **完整商户闭环**：「焰境好店」商户体系 —— 展示、自助入驻、邮箱验证码登录、认证置顶变现，全流程打通

### 工程质量



* **数据驱动渲染**：所有页面内容由 JSON 数据驱动，新增页面只需「建目录 + index.html + 数据 JSON」，构建脚本自动发现

* **自研模板引擎**：支持 partial 嵌入、`{{#each}}` 循环、点路径取值、HTML 转义 / 原样输出，零依赖

* **图片自动优化**：构建期自动生成 WebP 响应式多档图片（sharp，可选）

* **PWA 支持**：Service Worker 离线缓存、manifest.webmanifest、可安装到桌面

* **SEO 友好**：多页静态 HTML、自动生成 sitemap.xml/robots.txt、语义化标签、OG 图



***

## 功能模块



| 模块    | 路径                    | 说明                                            |
| ----- | --------------------- | --------------------------------------------- |
| 首页    | `/`                   | Hero 轮播、核心特色、走进万载、景点精选、焰境好店、万载 TV、万载音乐、玩在万载   |
| 非遗文化  | `/heritage/`          | 5 项非遗概览 + 各非遗独立子页（花炮 / 得胜鼓 / 夏布 / 开口傩 / 纸棚山歌） |
| 美食特产  | `/cuisine/`           | 万载六大碗、其他美食、传统特产，每道含做法 / 历史 / 口感               |
| 烟花产业  | `/industry/`          | 产业历史、发展现状、花炮企业                                |
| 赏烟地点  | `/spots/`             | 万载古城（每周六晚 8 点「焰火之吻」）、龙湖公园，含最佳观赏位与交通指南         |
| 旅游景点  | `/attractions/`       | 万载古城、竹山洞、九龙原始森林、三十把水库、仙源红色研学等                 |
| 旅游线路  | `/tourism/`           | 主题线路规划（烟花之旅、非遗之旅、美食之旅、山水之旅）                   |
| 万载 TV | `/tv/`                | 视频频道，支持后台流式上传 + B 站内容联动，短剧 / 宣传片 / 烟花实况       |
| 万载音乐  | `/music/`             | 本地音乐播放器，主题曲《有一个地方叫万载》等                        |
| 焰境文库  | `/library/`           | 本地作者小说与随笔，作品 / 章节双级审核，免费阅读持续连载                |
| 数字烟花  | `/digital-fireworks/` | 浏览器烟花模拟器，多种弹体 / 特效 / 音效，全屏沉浸式体验               |
| 焰境好店  | `/merchants/`         | 商户指南（美食 / 住宿 / 特产），自助入驻、认证置顶                  |
| 关于我们  | `/about/`             | 团队介绍、项目背景、技术架构、发展历程、合作伙伴                      |
| AI 助手 | 全站                    | 「花傩」智能问答，Workers AI + RAG 站内知识库               |

### 子站与后台



| 子站   | 域名                       | 说明                                                 |
| ---- | ------------------------ | -------------------------------------------------- |
| 管理后台 | `admin.whizzzest.com`    | 多账号管理、内容审核、访客分析看板、媒体上传（Cloudflare Access + 应用密码双门） |
| 商户门户 | `merchant.whizzzest.com` | 商户自助入驻、信息管理、认证申请                                   |
| 作者门户 | `writer.whizzzest.com`   | 作者注册、作品 / 章节管理、提交审核                                |



***

## 技术架构

### 整体架构图



```
&#x20;                       ┌─────────────────────────────────────┐

&#x20;                       │         whizzzest.com (CDN)         │

&#x20;                       │    Cloudflare 全球 300+ 边缘节点     │

&#x20;                       └──────────────┬──────────────────────┘

&#x20;                                      │

&#x20;             ┌────────────────────────┼────────────────────────┐

&#x20;             │                        │                        │

&#x20;   ┌─────────▼─────────┐    ┌────────▼────────┐    ┌────────▼─────────┐

&#x20;   │   静态资产直达边缘   │    │  Workers 动态渲染 │    │  Workers AI 推理  │

&#x20;   │  图片/CSS/JS/字体   │    │  页面/API/商户/TV │    │  「花傩」RAG 问答 │

&#x20;   │  (ASSETS binding)  │    │  /文库/音乐/景点  │    │  (AI binding)    │

&#x20;   └────────────────────┘    └────────┬────────┘    └─────────┬────────┘

&#x20;                                        │                          │

&#x20;                              ┌─────────▼─────────┐      ┌───────▼───────┐

&#x20;                              │   Cloudflare D1    │      │  向量索引(RAG) │

&#x20;                              │   (SQLite 边缘数据库)│      │  站内内容向量化 │

&#x20;                              └─────────┬─────────┘      └───────────────┘

&#x20;                                        │

&#x20;                              ┌─────────▼─────────┐

&#x20;                              │   Cloudflare R2    │

&#x20;                              │  (对象存储)         │

&#x20;                              │  - whizzzest-merchant (商户图片)│

&#x20;                              │  - whizzzest-media (TV/音乐媒体)│

&#x20;                              └────────────────────┘
```

### 技术栈



| 层级       | 技术                                 | 说明                                                                              |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| **前端**   | 原生 HTML / CSS / JavaScript         | 零框架、零运行时依赖，系统字体栈，Apple 式毛玻璃视觉语言                                                 |
| **构建**   | 自研 `build.js` (Node.js)            | 零依赖构建管线：模板引擎、页面自动发现、数据驱动渲染、sitemap/robots 生成、hash 缓存戳                           |
| **图片优化** | `sharp` (可选，devDependency)         | 构建期 WebP 响应式多档生成，不装也能构建（仅跳过优化）                                                  |
| **托管**   | Cloudflare Workers + Static Assets | 静态资源直达边缘，动态路径 Worker 优先，`run_worker_first` 精细路由                                 |
| **数据库**  | Cloudflare D1 (SQLite)             | 商户、文库、TV、音乐、景点、留言、管理账号、访客分析                                                     |
| **对象存储** | Cloudflare R2                      | 商户图片桶 + 媒体桶，Worker 代理公开读取                                                       |
| **AI**   | Cloudflare Workers AI              | 站内推理，无需外部 API Key；RAG 检索增强生成                                                    |
| **邮件**   | Cloudflare Workers + 外部 SMTP       | 商户邮箱验证码、联系表单                                                                    |
| **PWA**  | Service Worker + Web App Manifest  | 离线缓存、可安装、apple-touch-icon                                                       |
| **部署**   | GitHub Actions                     | push `main` 自动构建 + Wrangler 部署                                                  |
| **DNS**  | Cloudflare DNS                     | [whizzzest.com](https://whizzzest.com) 主域 + www 301 + 子域（admin/merchant/writer） |

### 性能指标



* **首屏加载**：约 1.5 秒（弱网 3G 环境）

* **Lighthouse Performance**：95+

* **全球边缘延迟**：< 50ms（300+ 节点）

* **静态资源缓存**：永久缓存 + hash 文件名戳

* **无第三方脚本**：全站无外部分析 / 广告 / 字体脚本，零隐私泄漏



***

## 快速开始

### 环境要求



* **Node.js** >= 18（构建脚本仅使用内置模块）

* **Python 3**（可选，用于本地预览）

* **Wrangler CLI**（可选，用于本地 Worker 调试和部署）

### 安装与构建



```
\# 克隆仓库

git clone https://github.com/nathanpenny520/whizzzest.com.git

cd whizzzest.com

\# 安装依赖（仅 sharp，用于构建期 WebP 图片优化；不装也能构建）

npm install

\# 构建（零依赖，生成 dist/）

npm run build
```

### 本地预览



```
\# 方式一：Python 静态服务器（仅预览静态页面，无 Worker 动态功能）

python3 -m http.server 8788 -d dist

\# 访问 http://localhost:8788

\# 方式二：Wrangler 本地开发（完整 Worker 环境，需配置 D1/R2）

npx wrangler dev
```

### 新增页面

构建脚本支持**页面自动发现**，新增页面只需三步：



```
\# 1. 建页面目录（支持任意深度嵌套）

mkdir -p src/pages/my-new-page

\# 2. 写页面模板

cat > src/pages/my-new-page/index.html << 'EOF'

{{> head}}

{{> header}}

\<main>

&#x20; \<h1>{{ title }}\</h1>

&#x20; \<p>{{ description }}\</p>

\</main>

{{> footer}}

EOF

\# 3. 写对应数据文件（路径与页面对应）

cat > src/data/my-new-page.json << 'EOF'

{

&#x20; "title": "我的新页面",

&#x20; "description": "这是一个示例页面"

}

EOF

\# 重新构建即可

npm run build
```

### 模板引擎语法

构建脚本内置轻量模板引擎，零依赖：



```
\<!-- 嵌入公共片段 -->

{{> header}}

\<!-- 变量输出（自动 HTML 转义） -->

\<h1>{{ title }}\</h1>

\<!-- 原样输出（不转义，用于富文本） -->

\<div>{{{ content }}}\</div>

\<!-- 循环 -->

{{#each items as item}}

&#x20; \<article>

&#x20;   \<h2>{{@index}}. {{ item.title }}\</h2>

&#x20;   \<p>{{ item.desc }}\</p>

&#x20; \</article>

{{/each}}

\<!-- 点路径取值 -->

\<p>{{ hero.subtitle }}\</p>
```



***

## 部署方式

### 自动部署（推荐）

push 到 `main` 分支触发 GitHub Actions 自动部署：



```
\# .github/workflows/deploy.yml

\# 1. npm install（安装 sharp）

\# 2. npm run build（构建 dist/）

\# 3. wrangler deploy（部署主站 Worker + 静态资产）

\# 4. wrangler deploy --config admin/wrangler.jsonc（管理后台）

\# 5. wrangler deploy --config merchant/wrangler.jsonc（商户门户）

\# 6. wrangler deploy --config writer/wrangler.jsonc（作者门户）
```

### 手动部署



```
\# 构建

npm run build

\# 部署主站

npx wrangler deploy

\# 部署子站

npx wrangler deploy --config admin/wrangler.jsonc

npx wrangler deploy --config merchant/wrangler.jsonc

npx wrangler deploy --config writer/wrangler.jsonc
```

### 数据库初始化



```
\# 本地 D1 初始化

npx wrangler d1 execute whizzzest --local --file=schema.sql

\# 远程 D1 初始化（首次部署）

npx wrangler d1 execute whizzzest --remote --file=schema.sql

\# 种子数据

npx wrangler d1 execute whizzzest --remote --file=scripts/attractions-seed.sql
```

### 环境变量

在 Cloudflare Dashboard 或 `.dev.vars` 中配置：



| 变量                                                    | 说明                   |
| ----------------------------------------------------- | -------------------- |
| `ADMIN_PASSWORD`                                      | 管理后台主账号（站长）密码        |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 邮件服务配置（商户验证码 / 联系表单） |



***

## 数据模型

核心数据表（详见 `schema.sql`）：



| 表名                  | 说明                                         |
| ------------------- | ------------------------------------------ |
| `merchants`         | 商户信息（名称 / 分类 / 地址 / 电话 / 图片 / 认证状态 / 置顶权重） |
| `merchant_sessions` | 商户邮箱验证码登录会话                                |
| `library_works`     | 文库作品（标题 / 作者 / 简介 / 封面 / 状态）               |
| `library_chapters`  | 文库章节（作品 ID / 标题 / 正文 / 排序 / 审核状态）          |
| `tv_videos`         | 万载 TV 视频（标题 / 描述 / R2 对象键 / 时长 / 分类 / 排序）  |
| `music_tracks`      | 万载音乐（标题 / 艺术家 / R2 对象键 / 时长 / 封面）          |
| `attractions`       | 旅游景点（名称 / 描述 / 图片 / 坐标 / 排序）               |
| `messages`          | 访客留言（姓名 / 邮箱 / 内容 / 已读状态 / 时间）             |
| `admin_users`       | 管理后台账号（用户名 / PBKDF2 密码哈希 / 权限）             |
| `visitors`          | 访客分析（路径 / UA/IP 哈希 / 时间）                   |
| `ai_knowledge`      | AI 知识库向量索引（内容 / 向量 / 来源 / 分类）              |



***

## 团队

「焰境・万载」由一群热爱家乡文化的**北京高校在读生**发起，6 人核心团队 + AI 智能伙伴：



| 成员        | 角色     | 职责                         |
| --------- | ------ | -------------------------- |
| 龙紫琴       | 项目负责人  | 全局战略规划与团队协作，资源整合           |
| 聂磐        | 技术架构师  | 全栈开发与系统架构，零依赖构建管线          |
| 黄婧瑶       | 品牌运营总监 | 新媒体矩阵运营与品牌传播策略             |
| 龙子萱       | 视频创意总监 | 视觉内容策划与制作，万载 TV            |
| 闻可佳       | 内容战略总监 | 内容规划与项目方案，品牌叙事             |
| Claude AI | 智能赋能助手 | 「花傩」AI 问答驱动、文案生成、代码评审、视觉创作 |

### 合作伙伴



* 万载县文旅局

* 万载古城景区

* 彩天艺术焰火

* 泰麟花炮



***

## 联系方式

* **官方网站**：[whizzzest.com](https://whizzzest.com)
* **电子邮箱**：[contact@whizzzest.com](mailto:contact@whizzzest.com)
* **企业客服**：[点击咨询](https://work.weixin.qq.com/kfid/kfc339afcb020ce4dd8)
* **微信公众号**：云上万载 - 焰遇乡旅（扫码关注）
* **微信视频号**：焰境・万载（扫码关注）
* **抖音**：[@焰境・万载](https://www.douyin.com/user/MS4wLjABAAAA0fPcuNv5vy46rDu3W1laQUVvZQiyr9MbDl7E60WUnrOKVkG_JKKy68tZiWA_L3A8)
* **小红书**：[@焰境・万载](https://www.xiaohongshu.com/user/profile/69a2d84a0000000021023fd4)
* **哔哩哔哩**：[@焰境・万载](https://space.bilibili.com/3546949301045835)



***

## 版权声明

本项目（包括但不限于源代码、文案、图片、设计、数据结构、架构方案）的版权归 **焰境・万载团队** 所有，保留所有权利。

未经版权所有者事先书面许可，任何人不得以任何形式复制、修改、分发、再许可或用于商业用途。详见 [LICENSE](LICENSE)。



***

> **一朝相逢，便是万载。**
> 用 AI 技术赋能县域文旅，让千年烟花文化在数字世界继续绽放。