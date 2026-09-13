# IM —— 站内即时聊天板块方案（im.whizzzest.com）

> 文档版本：**v1.1** ｜ 2026-09-13 ｜ 状态：**完整方案落档，待业主确认后 M1 开工**
> v1.1 变更：**端到端加密恢复 + 参考项目分析入档**——业主 2026-09-13 拍板「参考项目里有现成 E2EE 就做」；实读 `im/reference/` 两参考仓库后确认：**ZQ-Chat 是现成的 Workers+DO+原生 JS 端到端加密聊天**（架构可搬），**workers-chat-demo 补齐 CF 官方 DO 聊天范式**（服务端可搬）；加密设计定稿为「账号身份密钥 + 会话密钥信封分发」（§3），采纳 ZQ 架构但**弃其加密原语**（无认证加密/TOFU 洞，§1.3）；四项拍板落定（§11）；里程碑更新为 M1-M4 约 13-17 天。
> v1.0 变更：明文方案初稿（业主当日先拍板放弃 E2EE，后中途改口，见 §11 拍板记录）。
> 需求：新板块 **im.whizzzest.com**——好友关系（通过邮箱或手机号查找添加）+ 1v1 聊天 + 多人群组聊天；仅支持文字（图片不做）；**必须注册登录后才能使用**；**端到端加密**。

---

## 1. 参考项目分析（im/reference/，已 gitignore 不入 git）

### 1.1 ZQ-Chat（业主克隆，812K）——「现成 E2EE」的主要来源

Workers + Durable Objects（SQLite 类）+ WebSocket + **无框架原生 ES6 前端** + Vite——与本仓库技术选型完全同路。核心特征：

- **零知识架构**：服务器仅做加密数据盲转，不落库（内存态、无历史），客户端全权加解密；
- **双层信道**：客户端↔服务器信道（ECDH P-384 + 服务器 RSA 签名核验 + AES-CBC）之上，再建客户端↔客户端**成对 E2E 信道**（每对成员一个 curve25519 静态 ECDH 共享密钥 XOR SHA256(房间密码)）；群发 = 发送方对每个成员分别加密一次（`sendChannelMessage` 扇出）；
- `NodeCrypt.js`（624 行）是完整可读的客户端加密模块：连接管理/重连/心跳/回调分层的类结构直接可参照。

**采纳**：服务器盲转架构、成对信道+成员列表驱动的密钥协商流程、按成员扇出的思路、NodeCrypt 的客户端分层结构。
**弃用（重要）**：① 加密原语——AES-CBC 与裸 ChaCha20 **均无认证标签**（可篡改、无完整性），curve25519/AES/ChaCha 用 JS 库而非原生 WebCrypto；② 服务器身份层存在 **TOFU 漏洞**——客户端把服务器推送的 `server-key` 直接信任并存 localStorage（`handleServerKey()` 无任何校验），RSA 验签形同虚设；③ XOR 密码派生密钥的土法 KDF。本方案一律改用 **原生 WebCrypto 标准原语**（ECDH P-256 + HKDF-SHA256 + AES-256-GCM 自带认证），详见 §3。

### 1.2 workers-chat-demo（Cloudflare 官方 Edge Chat Demo）——服务端范式来源

单 DO 管一个房间，几百行注释详尽的参考实现。**直接采纳的服务端模式**：

| 模式 | 用途 |
|---|---|
| WebSocket Hibernation + `serializeAttachment` | 空连接不占内存；会话元数据（uid/limiterId）随休眠持久，唤醒时构造器重水合 |
| `blockedMessages` 队列 | 会话完成初始化前暂存消息，防早到消息丢失 |
| broadcast 时死连接清理 + `quit` 广播 | 在线列表自动维护 |
| `RateLimiter` DO（每 IP 一个纯协调对象，无持久化，5s/条 + 20s 宽限） | 跨房间全局发消息限流 |
| `lastTimestamp` 单调递增技巧 | 并发消息时间戳不回退 |
| WS 升级出错走 101+错误帧（浏览器 DevTools 可见） | 调试体验 |

**差异改造**：历史不存 DO storage 而存 **D1**（要跨会话查询：会话列表/未读数/成员资格）；成员资格校验走 D1（开放房间→注册制成员制）；首消息身份由 Worker 鉴权后注入 uid（不信任客户端自报姓名）。

## 2. 架构

```
浏览器 SPA（im.whizzzest.com，Worker 自托管 im/public/ 静态资产，原生 HTML/CSS/JS + Vite 可选）
  │  WebSocket /ws?conv=<id>（实时收发/在线/typing） ＋ REST /api/*（账号/好友/群/历史/密钥信封）
  ▼
whizzzest-im Worker（im/ 新目录，custom_domain im.whizzzest.com）
  ├─ 鉴权：Cookie im_session（HMAC 签名，IM_SESSION_SECRET，照 writer 先例）
  ├─ REST API + WS 升级（验 cookie + D1 成员资格 → X-IM-UID 注入转发 DO）
  ├─ DO「IMRoom」（每会话一实例，idFromName='c<convId>'）：seq 分配 + 在线扇出（§5）
  ├─ DO「RateLimiter」（每 IP 一个，照 workers-chat-demo）
  ├─ D1 whizzzest（表全 im_ 前缀，§4；只存密文+信封+公钥）
  └─ 登录/注册页复用 shared/portal-ui.js 壳（与 writer/merchant 三门户一致）
```

**加密学全部在浏览器 WebCrypto**；服务器=账号目录+密文邮局，永远不持有能解密的钥（明文方案时代的治理能力随之消失，见 §8 交底）。

## 3. 加密设计（E2EE 定稿）

### 3.1 身份密钥（每账号一把，多设备可恢复）

- 注册时浏览器生成 **ECDH P-256** 密钥对（WebCrypto）；
- 私钥用**登录密码**派生的包裹钥加密后随注册上传：`wrapKey = PBKDF2-HMAC-SHA256(密码, salt, 310000 次)`（独立 salt，与服务器端认证哈希完全独立，服务器永不见原始密码）→ `enc_priv_key = AES-GCM(wrapKey, 私钥 JWK)`；
- 本机 IndexedDB 缓存明文私钥；**换设备/清浏览器 = 用登录密码恢复**（服务器下发 enc_priv_key + salt，本地解包裹）——信封收件人是账号公钥，恢复后历史全部可解，从根上解决 v0 方案的丢钥事故面；
- 公钥 `pub_key` 存 `im_users`，账号 uid 即身份。

### 3.2 会话密钥与信封分发（1v1 与群组统一模型）

- 每个会话一把随机 256bit **会话密钥 K**，带 `key_version`（v1 起）；
- **信封** = 对每个成员：`ECDH(发送方临时 P-256 密钥, 成员身份公钥) → HKDF-SHA256 → AES-GCM 包裹 K`；信封存服务器（`im_conv_keys`），成员拉取后用自己的身份私钥解包得 K；
- 建会话（1v1 首条消息/建群）时生成 K 并出全套信封；**成员变动即重钥**：群主生成 K_{v+1} 对现存成员重新出信封（被踢者拿不到新钥，收不到后续消息）；
- 100 人群成本可控：每条消息只加密 **1 次**（共享 K），N 个信封只在建群/拉人/踢人时产生——优于 ZQ 每消息按成员扇出 N 次的做法。

### 3.3 消息加密

- `AES-256-GCM(K)`；96bit nonce = `key_version(4B) || seq(8B)`——(key_version, seq) 在会话内唯一，nonce 永不复用；
- AAD 绑定 `(conv_id, seq, sender_uid, key_version)`——防篡改、防重排、防跨会话重放；
- 密文即 `im_messages.body`，服务器只见盲文；系统消息（进群/退群/踢人/改名）由服务器生成，**不加密**（本就是成员可见的事件通知）。

### 3.4 安全边界（诚实交底）

| 威胁场景 | 结果 |
|---|---|
| 服务器被攻破/站长 | 只有密文、公钥、信封；无私钥读不了内容 ✓ |
| 传输链路 | TLS + GCM 自带认证，无篡改面 ✓ |
| 某设备被攻破 | 本机私钥泄露→该账号历史可解；**无前向保密/后向保密**（非双棘轮）✗ |
| 服务器作恶换公钥 | 服务器是公钥目录，可对首会话做中间人——v1 接受（同多数 IM 首信模型），**安全数字/指纹核验列 M4 可选**；ZQ 的 RSA 层因 TOFU 洞不采纳 |
| 密码忘 + 无其他已登录设备 | enc_priv_key 永久不可解 = 该账号历史不可恢复（注册页明示） |
| 被踢成员 | 已收旧消息仍可读（持有旧 K）；新消息收不到（重钥隔离）✗ 属已知取舍 |

升级路径：`key_version` 已留位，将来可平滑升级双棘轮/MLS，不动表结构。

## 4. 数据模型（D1 `whizzzest`，im_ 前缀）

```sql
im_users            id, phone(E.164,UNIQUE,可空), email(UNIQUE,可空),
                    pass_hash, pass_salt,                    -- 认证（服务器 PBKDF2，照 writer）
                    pub_key(TEXT, P-256 raw B64), enc_priv_key(TEXT), kdf_salt, kdf_iters,
                    display_name(≤20), avatar_color(0-7), bio(≤100,明文,个人简介非聊天内容),
                    status(normal|disabled), created_at, last_seen_at
                    -- CHECK phone/email 至少其一非空
im_friend_requests  id, from_uid, to_uid, message(≤100), status(pending|accepted|rejected|canceled),
                    created_at, handled_at, UNIQUE(from_uid,to_uid)
im_friendships      id, user_id, friend_id, created_at, UNIQUE(user_id,friend_id)   -- 双行制
im_blocks           id, user_id, blocked_uid, created_at, UNIQUE(user_id,blocked_uid)
im_conversations    id, type(dm|group), dm_key(UNIQUE,可空,'dm:min:max'), name(≤30), owner_id, created_at
im_members          conversation_id, user_id, role(owner|member), joined_at, last_read_seq DEFAULT 0,
                    min_seq DEFAULT 0,                        -- 入群时点（新成员不回看更早历史）
                    PK(conversation_id,user_id)
im_conv_keys        conversation_id, key_version, uid, envelope(B64), created_at,
                    PK(conversation_id, key_version, uid)     -- 每成员每版一枚信封
im_messages         conversation_id, seq, sender_id(0=系统), type(text|system),
                    body(≤2000 密文), created_at, PK(conversation_id, seq)
im_reports          id, reporter_uid, conversation_id, seq_from, seq_to, reason, status, created_at
```

要点：① dm_key UNIQUE 幂等建 1v1；② 分页全走 `(conversation_id, seq)`；③ `min_seq` 实现「新成员看不到入群前历史」（拉人时置当时 max(seq)，解密层按 key_version+min_seq 双重隔离）；④ 信封按 (会话,版本,成员) 三键唯一。

## 5. 实时通道（DO IMRoom，融合 workers-chat-demo 模式）

- `durable_objects` binding `ROOM` + `migrations: new_sqlite_classes=["IMRoom"]`；另有 `LIMITERS` binding（RateLimiter，每 IP）。
- **升级链**：`GET /ws?conv=<id>` → Worker 验 cookie + **D1 查成员资格** → stub.fetch 携 X-IM-UID → DO accept。DO 信任 Worker 注入的 uid，不查库。
- **Hibernation**：`serializeAttachment` 存 {uid, limiterId}；构造器重水合 sessions；`webSocketMessage/Close/Error` 三件套照搬官方实现。
- **seq 分配**：内存 nextSeq，唤醒后首条消息前 `SELECT MAX(seq)` 冷启动；DO 单线程无竞态。
- **消息流**：client `{t:'msg', tag:'<uuid>', body:<密文>}` → DO 校验成员+限流（RateLimiterClient 模式）→ 写 D1 → 广播 `{t:'msg', conv, seq, uid, body, at, tag}`（含发送者，tag 回显去重/确认）。
- **在线/typing**：接入广播在线表；`{t:'typing', uid}` 纯转发不落库。
- **成员变更**：被踢/退群 → DO 对其 WS 发 `{t:'kicked'}` 并 close(4003)。
- **断线补拉**：重连 REST `?after_seq=` 拉增量再上 WS；不搞 DO 内回放。
- **推送**：v1 不做（Web Push 后议；iOS PWA 后台推送本就不承诺）。

## 6. API 一览（均 JSON；未登录 401）

```
POST /api/register/phone | /api/register/email     注册（双方式；含 pub_key/enc_priv_key/kdf_salt 上传）
POST /api/login/phone   | /api/login/email         登录（响应含 enc_priv_key+kdf_salt 供恢复私钥）
POST /api/logout ／ GET|PATCH /api/me               会话/资料
GET  /api/users/search?q=<完整邮箱|手机号>          精确匹配，仅回 id/display_name/bio/avatar_color/pub_key
POST /api/friends/requests（+GET ?box=in|out、POST /<id>/accept|reject、DELETE /api/friends/<uid>）
PUT|DELETE /api/blocks/<uid>
GET  /api/friends                                   好友列表（含未读汇总）
POST /api/convs/dm {peer_uid}                       幂等建/取 1v1（首条消息时出信封）
POST /api/convs/group {name, member_uids[], envelopes[]}   建群（≤100 人，限好友；信封随建群提交）
POST /api/convs/<id>/members {uids[], envelopes[]}         拉人（群主；对全员重钥出新信封）
DELETE /api/convs/<id>/members/<uid> | DELETE /api/convs/<id> | PATCH /api/convs/<id>
GET  /api/convs                                     会话列表（末条概要+未读数）
GET  /api/convs/<id>/keys?version=                  拉本会话信封（解出 K）
GET  /api/convs/<id>/messages?after_seq=&before_seq=&limit=50
POST /api/reports                                   举报（会话+seq 区间+理由；明文不可见，举报人可附本地解密的引用文）
GET  /ws?conv=<id>                                  WS 升级
```

## 7. 前端（Worker 自托管，原生三件套）

- `im/public/`（wrangler assets binding）单页：左侧会话列表 + 右侧聊天窗，移动端两态切换；登录/注册用 `shared/portal-ui.js` 壳；仓库铁律不用框架。
- **加密模块 `im-crypto.js`（自写约 200 行，参照 NodeCrypt 分层结构）**：身份密钥生成/包裹/恢复、信封生成/解包、消息加解密；全部原生 WebCrypto，零第三方加密依赖（ZQ 的 elliptic/aes-js/js-chacha20 一律不引）。
- 渲染**必须 esc 转义**（密文解出的明文照样不得 innerHTML）；未读红点、时间分组、在线点、首字预设色头像；不发媒体（头像也不发）。

## 8. 安全、限流与滥用治理

| 项 | 策略 |
|---|---|
| 验证码发码 | 照 merchant M2.1（IP 10 分钟 6 次、同邮箱 60s 间隔、登录用途恒成功防枚举） |
| 用户搜索 | uid+IP 30 次/小时，仅精确匹配，不暴露联系方式本身 |
| 好友申请 | 待处理 ≤50、每用户 20 条/天、同对 UNIQUE |
| 发消息 | RateLimiter DO 全局 + 每会话 10 条/10s；注册 <1h 新号 5 条/min；body ≤2000 字符 |
| WS 并发 | 单 uid ≤5 连接 |
| 拉黑 | 申请静默拒、消息拒收 |
| 停用 | im_users.status=disabled 全接口 401（站长经 D1 处置） |
| 举报 | **E2EE 后站长也读不了内容**——举报人可自愿附上本地解密的引用文（类似 WhatsApp 举报机制）；im_reports 照存；这是 E2EE 的既定治理取舍 |

## 9. 里程碑（每期 = 看板登记 + 验收 + commit + push，CI 自动部署）

| 期 | 内容 | 预估 | 验收要点 |
|---|---|---|---|
| M1 | 账号+密钥目录+骨架：wrangler（DO×2 migration）+ D1 迁移 + 双方式注册/登录 + **im-crypto.js**（生成/包裹/恢复）+ SPA 骨架 + deploy.yml 增 whizzzest-im | 3-4 天 | 注册→自动生成密钥→**换浏览器用密码恢复私钥成功**；线上 / 与 /api/me 核验 |
| M2 | 好友+1v1 E2EE：搜索/申请/同意/拉黑/删除 + dm 幂等 + 信封分发 + DO 实时 + 历史分页解密 + 未读 | 4-5 天 | 双浏览器互发实时解密；**D1 中核实为密文**；离线补拉不丢不重（tag）；换设备恢复后仍能解历史 |
| M3 | 群组 E2EE：建群（直接拉人制）/拉人/退群/踢人/解散/改名 + **重钥** + system 消息 + 群未读 | 4-5 天 | 3 浏览器群聊扇出有序；**踢人重钥后被踢者解不开新消息**；100 人群建群信封正确；重复建 dm 不重复 |
| M4 | 加固+上线：RateLimiter DO + 全限流 + 举报拉黑 + 重连多标签 + 安全数字（可选）+ **主站导航「焰境万象」加入口** + 文档/上线记录 | 2-3 天 | 限流命中；举报落库可查；nav 入口 zh 生效（EN 随英文版批次后补） |

总量 **约 13-17 天**。M1 先在本地 `wrangler dev` 把 DO 通路打穿再上量。

## 10. 风险与额度评估

- **DO/D1 免费额度**：DO 每日 10 万请求级 + Hibernation 空闲不计时、D1 5GB——hobby 规模充足；超限再议 $5/mo Workers Paid。
- **加密实现风险**：原语全用标准 WebCrypto（不手搓密码学、不引第三方加密库）；M2 增加解密回归脚本（密文向量固定用例，仿 ai-retrieval-test.mjs 惯例）。
- **无前向保密**（§3.4）：v1 明示取舍，协议留升级位。
- **滥用治理弱化**：E2EE 后无内容审核能力，靠拉黑+举报（自愿附引用）+限流+停用兜底；业主知悉并接受（§11 拍板）。
- **手机号注册无短信验证**：与 writer/merchant 现行一致（未验证号码可被抢注），沿用既有接受度。
- **并行会话**：im/ 新目录 + im_ 表 + 新 Worker，与游戏批次会话零交集；`deploy.yml` 属共享文件，M1 动手前看板登记。

## 11. 拍板记录（业主，2026-09-13）

1. **群成员加入**：群主从好友**直接拉入**，被拉者可退（不做邀请确认流）；
2. **群上限 100 人**；**消息永久保留**（「应该没多少人用」，后续可加过期）；
3. **主站导航**：加入「焰境万象」下拉（现含焰境流光/焰境仙曲/焰境之梦），**中英都要、英文版后做，v1 仅中文**（随 M4 上线时加，避免提前挂死链）；
4. **E2EE 拍板过程**：先拍板放弃 → 同日改口「**如果参考项目有现成的就做**」→ 实读确认 ZQ-Chat 有现成 E2EE（本栈同构）→ **做**（§3，弃其原语取其架构）。

## 12. 决策记录

| # | 决策 | 日期 |
|---|---|---|
| 1 | E2EE：做（ZQ-Chat 提供现成架构参考；原语改用原生 WebCrypto 标准件） | 2026-09-13 |
| 2 | 身份密钥=账号级 ECDH P-256 + 密码包裹私钥服务器备份（换设备可恢复） | 2026-09-13 |
| 3 | 会话密钥信封分发（ECDH 临时×身份 + HKDF + AES-GCM），群组共享单钥+成员变动重钥 | 2026-09-13 |
| 4 | 独立账号 im_users；注册双方式照 writer；独立会话密钥 IM_SESSION_SECRET | 2026-09-13 |
| 5 | 实时通道 = DO IMRoom（SQLite Hibernation）+ RateLimiter DO，模式照 workers-chat-demo | 2026-09-13 |
| 6 | 仅文字不传媒体；头像 v1 首字+预设色；新成员不回看入群前历史 | 2026-09-13 |
| 7 | 导航「焰境万象」加入口：v1 仅中文，EN 随英文版后补 | 2026-09-13 |
