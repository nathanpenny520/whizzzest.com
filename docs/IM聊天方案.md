# IM —— 站内即时聊天板块方案（im.whizzzest.com）

> 文档版本：**v1.0** ｜ 2026-09-13 ｜ 状态：**方案落档，待业主拍板 §9 后开工**（M1 未动工，未改任何业务代码）
> 需求（业主 2026-09-13）：新板块 **im.whizzzest.com**——好友关系（通过邮箱或手机号查找添加）+ 1v1 聊天 + 多人群组聊天；仅支持文字（图片不做）；**必须注册登录后才能使用**。
> 已拍板：
> ① **不做端到端加密**（业主同日拍板放弃 E2EE 做简单聊天；服务器存明文，站长可经 D1 处理举报与治理——此前 E2EE 评估见会话记录，未落档）；
> ② 账号体系**独立**（`im_users`，照 `writer_users` / `merchant_users` 先例，互不相通）；
> ③ 注册登录照 writer 门户双方式（手机号+密码 ｜ 邮箱+验证码），复用 `shared/phone.js`（E.164 归一，国际区号）与 `worker/smtp.js`（notifications@whizzzest.com 发信，secrets SMTP_USER/SMTP_PASS 配在 whizzzest-im）；
> ④ 实时通道用 **Durable Objects**（WebSocket Hibernation，SQLite 后端）——免费版可用已核官方文档（2026-08 状态：Workers Free 仅 SQLite 后端 DO）。

---

## 1. 架构

```
浏览器 SPA（im.whizzzest.com，Worker 自托管 im/public/ 静态资产，原生 HTML/CSS/JS）
  │  WebSocket /ws?conv=<id>（实时收发/在线/typing） ＋ REST /api/*（好友/群管理/历史分页）
  ▼
whizzzest-im Worker（im/ 新目录，index.js + wrangler.jsonc，custom_domain im.whizzzest.com）
  ├─ 鉴权：会话 Cookie im_session（HMAC 签名，独立 IM_SESSION_SECRET，照 writer 先例）
  ├─ WS 升级：Worker 验 cookie → 携 X-IM-UID 转发到 Durable Object
  ├─ Durable Object「IMRoom」（每会话一实例，idFromName='c<convId>'）：
  │    seq 分配（单线程单调，不重不漏）＋ 在线扇出 ＋ 落库 D1
  ├─ D1 whizzzest（绑定 DB，表全 im_ 前缀）
  └─ 登录/注册页复用 shared/portal-ui.js 壳（与 writer/merchant 三门户一致，passkey 留位）
```

服务器职责 = 账号、关系、转发、存储；**明文方案**，内容可查（治理见 §6）。

## 2. 数据模型（D1 `whizzzest` 库，全部 im_ 前缀）

```sql
im_users            id, phone(E.164, UNIQUE, 可空), email(UNIQUE, 可空),
                    pass_hash, pass_salt(PBKDF2, 照 writer 参数),
                    display_name(≤20), avatar_color(0-7 预设色，首字头像，v1 不存图),
                    bio(≤100 可空), status(normal|disabled), created_at, last_seen_at
                    -- CHECK：phone 与 email 至少其一非空
im_friend_requests  id, from_uid, to_uid, message(≤100 可空),
                    status(pending|accepted|rejected|canceled), created_at, handled_at,
                    UNIQUE(from_uid, to_uid)          -- 防重复轰炸
im_friendships      id, user_id, friend_id, created_at, UNIQUE(user_id, friend_id)
                    -- 双行制（A→B 一行 + B→A 一行），删好友删两行
im_blocks           id, user_id, blocked_uid, created_at, UNIQUE(user_id, blocked_uid)
im_conversations    id, type(dm|group), dm_key(UNIQUE, 可空, ='dm:min:max'),
                    name(群名≤30, dm 为空), owner_id(群主), created_at
im_members          conversation_id, user_id, role(owner|member), joined_at,
                    last_read_seq DEFAULT 0,          -- 未读数基准
                    PK(conversation_id, user_id)
im_messages         conversation_id, seq, sender_id(0=系统), type(text|system),
                    body(≤2000), created_at, PK(conversation_id, seq)
                    -- 复合主键天然按会话聚簇；seq 由 DO 分配；系统行记录进群/退群/改名
im_reports          id, reporter_uid, conversation_id, seq_from, seq_to, reason(≤200),
                    status(open|closed), created_at
```

设计要点：① dm_key UNIQUE 保证 1v1 会话幂等（重复点「发消息」不重复建）；② 分页全走 `(conversation_id, seq)`，`after_seq` 拉增量 / `before_seq` 往回翻，禁止全量；③ 拉黑后申请**静默拒**（对发起方表现同「不存在」）；④ 邮箱验证码表复用 `email_login_codes`（purpose 加 im- 前缀区分门户，M1 实施时对齐 writer 先例）。

## 3. 实时通道（Durable Object IMRoom）

- **绑定**：`durable_objects` binding `ROOM` + `migrations: new_sqlite_classes=["IMRoom"]`（免费版仅 SQLite 后端）。
- **升级链**：`GET /ws?conv=<id>` → Worker 验 cookie/成员资格 → `env.ROOM.idFromName('c'+id)` stub.fetch（带 X-IM-UID）→ DO accept。**DO 不再查库鉴权**，信任 Worker 传递的 uid。
- **seq 分配**：实例内存 nextSeq，休眠唤醒后首条消息前 `SELECT MAX(seq)` 冷启动一次；DO 单线程，无竞态。
- **消息流**：client 发 `{t:'msg', tag:'<uuid>', body}` → DO 校验成员+限流 → 写 D1 → 广播 `{t:'msg', conv, seq, uid, body, at, tag}` 给全部连接（含发送者，tag 回显做确认/去重）。
- **Hibernation**：空连接不占内存不计时；`webSocketMessage`/`webSocketClose` 处理上下线。
- **在线/typing**：接入时广播 `{t:'online', uids:[...]}`；`{t:'typing', uid}` 纯转发不落库。
- **成员变更联动**：被踢/退群 → DO 对该成员 WS 发 `{t:'kicked'}` 并 close(4003)；建会话/拉人走 REST，DO 下次唤醒自然读到新成员。
- **断线补拉**：重连后 REST `?after_seq=<本地最大seq>` 拉增量，再上 WS——不搞 DO 内回放，简单可靠。
- **推送**：v1 不做（Web Push 留待后续；iOS PWA 后台推送本就不承诺）。

## 4. API 一览（均 JSON；未登录 401）

```
POST /api/register/phone | /api/register/email     注册（双方式，writer 同构）
POST /api/login/phone   | /api/login/email         登录
POST /api/logout ／ GET /api/me ／ PATCH /api/me    会话/资料（display_name/bio/avatar_color）
GET  /api/users/search?q=<完整邮箱|手机号>          精确匹配，仅回 id/display_name/bio/avatar_color
POST /api/friends/requests                         发好友申请（附言≤100）
GET  /api/friends/requests?box=in|out              申请列表
POST /api/friends/requests/<id>/accept|reject      处理申请
DELETE /api/friends/<uid>                          删好友（双向删行）
PUT|DELETE /api/blocks/<uid>                       拉黑/取消
GET  /api/friends                                  好友列表（含未读汇总）
POST /api/convs/dm {peer_uid}                      幂等建/取 1v1（dm_key）
POST /api/convs/group {name, member_uids[]}        建群（≤100 人，成员限好友）
POST /api/convs/<id>/members {uids}                拉人（群主）
DELETE /api/convs/<id>/members/<uid>               踢人（群主）／退群（本人）
DELETE /api/convs/<id>                             解散（群主）　PATCH …/{name} 改群名（群主）
GET  /api/convs                                    会话列表（末条概要+未读数）
GET  /api/convs/<id>/messages?after_seq=&before_seq=&limit=50
POST /api/reports                                  举报（会话+seq 区间+理由）
GET  /ws?conv=<id>                                 WS 升级
```

## 5. 前端（Worker 自托管，原生三件套）

- `im/public/`（wrangler assets binding）单页应用：左侧会话列表 + 右侧聊天窗，移动端两态切换；`/api/*` 与 `/ws` 过 Worker，其余直达静态资产。
- 登录/注册用 `shared/portal-ui.js` 壳（三门户视觉一致）；**仓库铁律不用框架**，聊天窗口原生 JS 渲染。
- 明文渲染仍**必须 esc 转义**（存明文 ≠ 可以 innerHTML，XSS 照防）；时间分组、未读红点、在线点、首字预设色头像。
- v1 不传任何媒体（头像也不传）；PWA 清单不并入（主站 PWA 是主域的，im 域将来另议）。

## 6. 安全、限流与滥用治理

| 项 | 策略 |
|---|---|
| 验证码发码 | 照 merchant M2.1：IP 10 分钟 6 次、同邮箱 60 秒间隔、登录用途恒成功防枚举 |
| 用户搜索 | uid+IP 30 次/小时；**仅精确匹配**（不做模糊），结果不暴露联系方式本身 |
| 好友申请 | 待处理 ≤50、每用户 20 条/天、同对 UNIQUE |
| 发消息 | 每会话 10 条/10s、全局 60 条/10min；注册 <1h 新号 5 条/min；body ≤2000 字符 |
| WS 并发 | 单 uid ≤5 连接 |
| 拉黑 | 申请静默拒、消息拒收、互相不可再搜到对方的可交互入口 |
| 停用 | `im_users.status=disabled` 全接口 401（站长经 D1 处置；admin 面板 IM Tab 属可选后续） |
| 举报 | im_reports 落库；明文方案下站长可直接按 seq 区间查证 |

**明文交底**：聊天内容服务器可见，站长有查看能力也有治理义务（违规内容处置、举报响应）——这是放弃 E2EE 的既定取舍。

## 7. 里程碑（每期 = 看板登记 + 验收 + commit + push，CI 自动部署）

| 期 | 内容 | 预估 | 验收要点 |
|---|---|---|---|
| M1 | 账号+骨架：wrangler（DO migration）+ D1 迁移 + 双方式注册/登录 + 会话 + SPA 骨架 + deploy.yml 增 whizzzest-im | 2-3 天 | 真浏览器注册→登录→登出→资料改存；线上 / 与 /api/me 核验 |
| M2 | 好友+1v1：搜索/申请/同意/拉黑/删除 + dm 幂等 + DO 实时收发 + 历史分页 + 未读 | 3-4 天 | 双浏览器实时互发 seq 一致；离线补拉不丢不重（tag 去重）；限流命中 |
| M3 | 群组：建群/拉人/退群/踢人/解散/改名 + system 消息 + 扇出 + 群未读 | 3-4 天 | 3 浏览器群聊扇出有序；被踢即刻收不到新消息（close 4003）；重复建 dm 不重复 |
| M4 | 加固收尾：在线/typing、断线重连+多标签、举报流、限额调参、文档/上线记录 | 2-3 天 | 重连不丢消息；举报落库可查；全限流参数生效 |

总量 **约 10-14 天**（本仓库并行节奏估算）。

## 8. 风险与额度评估

- **DO 免费额度**：每日 10 万请求级，WS Hibernation 空闲不计——hobby 规模充足；若日后超限再议付费（$5/mo Workers Paid）。
- **D1 免费额度**：文字消息体量极小，5GB 与每日行数限远够；分页必做（§2 要点②）。
- **WS 调试复杂度**高于普通 Worker；本地 `wrangler dev` 支持 DO，M1 先把 DO 通路在本地打穿再上量。
- **滥用面**（明文 + 开放注册）：广告/骚扰靠拉黑+举报+限流+停用兜底；搜索虽限流仍存在枚举可能（精确匹配降低收益，剩余风险接受）。
- **手机号注册无短信验证**：未验证号码可被抢注——与 writer/merchant 现行完全一致（既有接受度），沿用。
- **并行会话**：im/ 全新目录 + im_ 表 + 新 Worker 名，与游戏批次在办会话文件范围零交集；`deploy.yml` 改动属共享文件，M1 动手前看板登记。

## 9. 待业主拍板（开工前）

1. **群成员加入方式**：群主从好友**直接拉入**（推荐，被拉者可退）vs 被邀确认流（多一张邀请表+通知，+1 天）。
2. **群上限 100 人、消息永久保留**——按此推荐执行？
3. **主站导航**是否加「聊天」入口，还是仅直链 im.whizzzest.com？
4. **v1 界面仅中文**（推荐；EN 随后续 i18n 补）？

## 10. 决策记录

| # | 决策 | 日期 |
|---|---|---|
| 1 | 不做端到端加密，明文方案（业主拍板放弃 E2EE） | 2026-09-13 |
| 2 | 独立账号 im_users；注册双方式照 writer；独立会话密钥 IM_SESSION_SECRET | 2026-09-13 |
| 3 | 实时通道 = DO IMRoom（SQLite 后端 Hibernation，免费版可用已核官方文档） | 2026-09-13 |
| 4 | 仅文字不传媒体；头像 v1 用首字+预设色（避开 R2 与图片审核面） | 2026-09-13 |
