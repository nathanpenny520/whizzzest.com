# AI 助手（花傩）方案（2026-09-06 v1.0；2026-09-08 v1.2 检索大升级）

> 复刻旧站（reference/old-site）左下角 AI 小助手的核心能力，按新站架构（零依赖原生 + Cloudflare Workers）重写。
> 定位：**专业问答助手**——帮用户解答万载文旅问题、引导站内内容；不做人设状态机、不做 Live2D/2D 切换。
> LLM 用 **Cloudflare Workers AI binding**（账号内推理，无 API Key、无 egress），非流式 + 前端打字机（与旧站一致），流式列 M2。

## 一、后端（主站 Worker `worker/ai.js`）

### API

| 端点 | 说明 |
|---|---|
| `POST /api/ai/chat` | 问答主接口。`{question, history?, path?}` → `{ok, text, action?, sources?}` |
| `GET /api/ai/config` | 前端配置（公开、轻缓存）：`{enabled, greeting, quick[]}`；不暴露 system_prompt/model |

`run_worker_first` 已含 `/api/*`，wrangler.jsonc 只需加 `"ai": {"binding": "AI"}`。

### 生成链路（单次请求内完成）

1. **前置**：Honeypot 无表单不需要；IP 滑动窗口限流（隔离内存 Map，同 [index.js](../worker/index.js) contact 模式）10 条/5 分钟 → 429；question 截断 200 字、history 取最近 6 条（每条 ≤500 字）；**日额度熔断**——当日 `ai_chats` 达 `AI_DAILY_CAP`（默认 500，免费额度 ≈450 问）后降级纯检索模式：跳过模型与语义通道，直接返回 Top-2 知识条目原文（日志 action 记 `capped`），功能不断、成本归零
2. **RAG 混合检索 v2（Top-3 拼 `[参考知识]` 块）**，三路归并（`worker/ai.js` 纯函数可测，回归集 `scripts/ai-retrieval-test.mjs`）：
   - **关键词计分**：keywords 命中 +1（经泛词映射扩展：好吃→美食、好玩→景点、带孩子→亲子 等口语改写）；类目名两字滑窗 +2；正问两字滑窗（滤「什么/怎么」虚词）与正文互证 +1（独立计分，keywords 挑漏的条目凭正文捞回）
   - **向量语义**：问题嵌入 `@cf/qwen/qwen3-embedding-0.6b`（1024 维）→ Vectorize `whizzzest-ai-knowledge` 查 Top-5（metadata filter `status='published'`）→ 余弦过地板 0.42 后 ×12 计分（2026-09-08 线上校准：相关 ≥0.45、噪声 ≤0.40，取中）；嵌入/向量查询只依赖问题文本，**与 D1 检索并行点火**不串行排队；失败自动退纯关键词
   - **实体名直配**：全部上线景点/认证商户名称（上限各 100）字面命中问题即以 4 分注入合成条目——修实时数据只注入 Top8 的盲区，问第 9 个之后的景点也能答
   - 命中条目类目去重作为 `sources` 返回（admin「知识缺口」报表按 sources IS NULL 统计）
3. **站内实时数据注入**（超出旧站的增强）：并行查 D1——上线景点（Top8 名称+简介 + 超 8 个时补全量名称行）、认证商户（同法）、音乐/视频/文库数量，拼 `[站内实时数据]` 块，使「现在有哪些景点/有什么歌」答实时数据；**30s 短缓存**（2026-09-08 时延治理，后台增删景点/商户最迟 30s 进问答）
4. **多轮上下文**：system（人设+规则+JSON 契约+参考块）→ history → user（原始问题）
5. **Workers AI**：`env.AI.run(model, {messages, max_tokens:1200, temperature:0.6})`，30s 超时；qwen3 系推理模型注入 `chat_template_kwargs:{enable_thinking:false}` 关思考直出（实测快 ~10 倍）；模型名存 `ai_settings` 可后台切换（白名单：qwen3-30b-a3b-fp8（默认）/ glm-4.7-flash / deepseek-v4-flash / qwen3.8-27b）。binding 失败自动切 **OpenAI 兼容 REST 兜底**（secret `AI_API_BASE` + `AI_API_KEY` 可选配置，Cloudflare 自家即 `/ai/v1/chat/completions`）；`AI_PROVIDER=rest` 直走 REST（本地联调 workerd 出站受限时用，.dev.vars 配置）。注意关思考后答案可能落在 `reasoning` 字段，提取链 `response → content → reasoning_content → reasoning` 全兜住
6. **解析**：剥 ```json 围栏 → `JSON.parse` 取 `{text, action}`；解析失败降级纯文本（同旧站）
7. **Action 白名单校验**（服务端，防任意跳转，一律归一成 `open_page` 返回前端）：
   - `open_page`：route 必须匹配站内路由白名单（/ /about/ /cuisine/ /heritage/ /industry/ /spots/ /tourism/ /pay/ /merchants /library /music /attractions /tv /digital-fireworks 及其子路径），否则丢弃 action
   - `open_merchant` / `open_attraction`：模型回显参考块中的精确名称 → D1 等值/LIKE 查 slug → 解析成 `/merchants/<slug>` / `/attractions/<slug>`；查不到丢弃 action（纯文本回答）
   - `open_music`（v1.2）：歌曲名查 `music_tracks` → `/music/?t=<id>` 深链（音乐页自动播放）；`open_firework`（v1.2）：固定跳 `/digital-fireworks/`
   - 旧站的 map_navigation / show_coupon 随地图页/优惠券一起砍掉，功能上线再回
8. **日志**：`ctx.waitUntil` 写 `ai_chats`（问题、回复长度、action、sources、耗时、IP、vid Cookie），不阻塞响应
9. **失败兜底**：限流 429 / 停用 503 / AI 异常与超时均返回花傩语气的中文文案（克制，不卖萌）

### 成本（Workers AI，2026-09 价）

`@cf/qwen/qwen3-30b-a3b-fp8`：单轮 ≈1.5k 入 + 0.5k 出 token ≈ **22 neuron**；免费 10,000 neuron/天 ≈ **每天 ~450 次对话零成本**；超出 $0.011/千 neuron（每万次 ≈ $2.4）。
嵌入（v1.2）：`qwen3-embedding-0.6b` ≈1075 neuron/百万 token——单问 ≈20 token 可忽略；68 条知识全量重嵌入 ≈7k token ≈ 8 neuron（仅在条目数漂移/脏标记时发生）。保险起见设日额度熔断（`AI_DAILY_CAP`，默认 500）。。

## 二、数据（schema.sql 追加，幂等 DDL）

- `ai_knowledge`：category / content / keywords(逗号分隔) / sort / status(published|hidden) / 时间戳；种子 = 旧站 knowledgeBase.ts 全量 68 条迁移（烟花/表演/美食/非遗/景点/线路/商家/实用/联系/团队/愿景/历程/伙伴；其中联系方式/团队/发展历程已对齐新站现况），`scripts/ai-seed.sql` 一次性执行（INSERT OR IGNORE 固定 id）
- `ai_settings`：key-value。键：`enabled`(1/0)、`model`、`system_prompt`、`greeting`(空=不弹招呼气泡)、`quick_questions`(JSON 数组)
- `ai_chats`：用量日志，admin 看问题分布找知识缺口，可清空

## 三、前端（全站悬浮入口）

- 资产独立：`src/assets/js/ai-chat.js`（原生，无依赖）+ `src/assets/css/ai-chat.css`，由 **footer partial** 引入 → 静态页、5 个动态页（/tv /library /music /attractions /merchants 共用 dist/partials/footer.html）、404 全覆盖
- build.js：两文件纳入指纹体系（`?v=hash`）+ ai-chat.css 随 style.css 一起压缩；组件 DOM 全由 JS 构建，零 HTML 侵入、不阻塞加载（defer + 末尾 link）
- **样式**：站内 Apple 视觉语言（焰色 #d64524 点缀/20px 圆角/系统字体/毛玻璃）。图标（2026-09-07）由焰形 SVG 换为**旧站纯 CSS 花傩娃娃移植**：静态 idle 单一形态（呼吸+浮动动画，无 Live2D、无状态机）；悬浮球 52px 红橙渐变底（`linear-gradient(135deg,#dc2626→#d97706)`，旧站同款配色），面板头部与欢迎气泡用同款娃娃（`--s` 变量缩放）；原 FLAME 常量留作备用
- **入口**：左下角 52px 圆形悬浮球（红橙渐变底 + CSS 花傩娃娃），hover 微放大；招呼气泡已移除（2026-09-07，用户打开面板即见欢迎态，外显提示词属打扰）
- **面板**：桌面左下 380×560 白卡片；移动端（≤640px）全屏 bottom sheet。头部（花傩·智能问答 + 清空 + 关闭）、消息区、快捷问题 chips（来自 config）、输入行
- **渲染**：轻量 Markdown（先全文转义，仅放行粗体/斜体/行内代码/列表/链接——文库方案同款白名单思路防 XSS；v1.2 起链接再过域名白名单：站内相对路径 + `*.whizzzest.com` 放行，其余外链降级纯文本，防模型被注入后借花傩之名导流钓鱼站）；>40 字打字机逐字（25ms/tick）；回复下可显示「知识来源」灰色小字；action 落地为站内链接按钮（`/music/?t=` 显示「▶ 播放这首歌」）
- **历史（v1.1，2026-09-07）**：多会话管理，全部存浏览器。key `hn_chat_sessions`（会话数组，上限 30 个，每会话消息上限 20 条；`hn_chat_current` 记当前会话；v1.0 旧 key `hn_chat_history` 首次加载自动迁移为单会话后删除）。头部「历史」按钮切换会话列表视图：置顶在前、按最近更新排序，支持新对话 / 切换 / 置顶 / 重命名（prompt）/ 删除（confirm）；标题默认取首问前 16 字；头部清空按钮只清当前会话。发送时附当前会话最近 6 条做上下文 + `location.pathname` 当前页语境
- **层级**：面板 z-index 150，必须高于站点导航（.nav z-100）——移动端全屏面板头部与导航重叠，层级不足时关闭按钮被遮、点关闭命中汉堡按钮（2026-09-07 实测修复）

## 四、后台（admin「AI 助手」Tab，`#/ai`）

- **设置卡**：启用开关、模型下拉（白名单）、系统提示词 textarea、快捷问题（每行一条）；招呼语字段已随外显气泡一并移除（`ai_settings.greeting` 键保留但不再展示，config 接口字段保留兼容）
- **知识库卡**：列表（分类/摘要/关键词/状态/排序）+ 新增/编辑/删除（删除二次确认）；上下线即从检索剔除
- **用量卡**：今日/7 天/30 天对话数 + 最近 20 条问题（时间/问题/耗时/action）+ 清空日志；**知识缺口报表**（v1.2）：7 天内「有回答但无知识来源、无 action」的问题列表（降级 capped 与失败响应不计入），按缺口补知识条目即闭环
- API：`GET/POST /api/ai/settings`、`GET/POST /api/ai/knowledge`、`POST/DELETE /api/ai/knowledge/:id`、`GET /api/ai/stats`、`DELETE /api/ai/log`（全部走既有会话鉴权 + Origin 校验）

## 五、人设（System Prompt，存 ai_settings 可后台改）

花傩——万载文旅智能问答助手。以傩文化为意象（名字源于万载开口傩），语气专业友善、简洁准确，可偶尔用「傩愿」等傩文化词汇点缀但不过度。只答万载文旅/站内内容相关话题，无关话题礼貌拉回；答案以参考知识与站内数据为准，不编造；合适时附 action 引导跳转。旧站的夜间状态、表情卖萌、烟花彩蛋全部不做。

## 六、分期

- **M1（本次）**：以上全部
- **M2 可选**：SSE 真流式（Workers AI `stream:true`）；问题聚类报表（多会话管理已于 v1.1 以浏览器存储实现，招呼语 A/B 随气泡移除作废）
- **M3 语义检索：已于 v1.2（2026-09-08）落地**——Vectorize 混合检索替换纯关键词（见 §生成链路第 2 步）；用量图表待做

## 七、上线清单

0. Vectorize 索引（v1.2，**先于部署**——binding 校验要求索引已存在；维度建后不可改）：
   ```bash
   npx wrangler vectorize create whizzzest-ai-knowledge --dimensions=1024 --metric=cosine
   npx wrangler vectorize create-metadata-index whizzzest-ai-knowledge --property-name=status --type=string
   ```
   预置数据（可选，懒同步也会自动补）：D1 导出 published 知识 → OAuth token 打 REST `/ai/run/@cf/qwen/qwen3-embedding-0.6b` 批量嵌入（`{text:[...]}` → `{data:[[1024 维]]}`，32 条/批）→ NDJSON（id `k<知识id>`，metadata `{status:'published', kid}`）→ `wrangler vectorize insert`。2026-09-08 已执行，68 条就位
1. 线上 D1 迁移：`wrangler d1 execute whizzzest --remote --file scripts/ai-migrate.sql`（纯 DDL 幂等；schema.sql 含不幂等 ALTER 仅适合全新库）+ 一次性 `--file scripts/ai-seed.sql`（固定 id INSERT OR IGNORE，重复执行不覆盖后台编辑）
2. 部署双 Worker（主站 + admin，push → CI；dist 由 CI build）
3. 后台检查：设置卡默认值、知识库 68 条、发几条真实问题验证 action 与来源；改检索逻辑先跑 `node scripts/ai-retrieval-test.mjs` 回归集

## 八、检索 v2 运维备忘（2026-09-08）

- **向量维护**：admin 增/改知识 → 即时重嵌入该条 upsert（id `k<id>`）；admin 删除 → `deleteByIds`；主站每次问答后台懒同步兜底（describe().vectorCount ≠ published 数或 `ai_settings.vec_dirty='1'` → 全量重建，60s 缓存，失败不缓存下问重试）
- **残余风险**：admin 删除时 `deleteByIds` 失败会留幽灵向量（metadata 仍 published，能被检索）——主站懒同步修不了（无法枚举向量 id），需手动 `wrangler vectorize delete-by-ids`；概率极低
- **语义校准**：地板/权重在 `worker/ai.js` SEM_FLOOR/SEM_WEIGHT；校准方法＝REST 嵌入一批真实问法打 `/vectorize/v2/indexes/<名>/query` 看分数分布（本次样本：相关 ≥0.45、噪声 ≤0.40）
- **本地 dev**：语义通道不可用（workerd 出站挂起 + .dev.vars 的 cfoat token 已失效——REST 嵌入 401），问答自动退纯关键词模式，功能不断；admin 保存知识时嵌入 8s 超时落脏标记，保存不受影响。要在本地验语义需换有效 API token
- **语义实测摘录**（2026-09-08，k<id> 对应 ai_knowledge）：「万载有什么非物质文化遗产表演」→ k48 非遗文化 0.785 ✓；「晚上古城有烟花看吗」→ 烟花表演 0.673 ✓；「想买点特产带回家送人」→ 美食特产 0.516 ✓；「带女朋友去哪里约会」→ 0.374 联系方式（噪声，被地板挡）
