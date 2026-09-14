# IM 在线判定与实时同步方案（P0-P2）

> 立项：业主报修「登录进网站还显示离线，必须打开对话页面才显示在线；消息和联系人同步延迟很大」（2026-09-14，附截图：dm 头部「Nathan 离线」）。
> 性能调查结论与三阶段改造。业主拍板记录见 §2；本方案与 [IM聊天方案.md](./IM聊天方案.md) 互引，冲突时以本文为准（在线/同步域）。

## 1. 调查结论（根因）

### 1.1 在线判定 = 「开着这个会话的 WS」，没有用户级在线
- v1 在线定义在会话 DO 内：`IMRoom.onlineUids()` 数「该会话 DO 实例上的开放 WS」（im/src/do/room.js）。
- 客户端 WS 每会话一条，**仅 openChat 时建立、退出聊天即关**（chat.js connect / app.js closeChat）。
- 由此：登录进 /app 停在列表 = 零条 WS = 在所有会话里离线；即便双方都在线，也要求**恰好开着同一个会话**才互见在线。
- 头部副标拿这套房间内名单渲染（chat.js renderSub）；`im_users.last_seen_at` 仅登录时更新，全站无展示（死字段）。

### 1.2 同步延迟 = 实时性只覆盖「当前打开的会话」
| # | 事实 | 后果 |
|---|------|------|
| 1 | 非活跃会话全靠 20s 轮询（app.js setInterval，visibility 门控） | 别的会话来消息最多 20s+ 才进列表/未读 |
| 2 | 切回标签页不立即刷（无 visibilitychange/focus 监听） | 回前台必延迟 |
| 3 | 好友申请横幅仅 boot 拉一次；联系人列表仅面板打开时拉 | 别人加你/同意你完全无感知 |
| 4 | 每次轮询 `previews.clear()` → 全部会话末条每 20s 重解密 + 「…」闪烁 | 纯浪费 CPU + UI 抖动 |
| 5 | 群事件（拉人/改名/重钥）对未打开会话同样等轮询 | 延迟感的一部分 |

服务端核查：/api/convs 的相关子查询均有 `(conversation_id, seq)` 主键覆盖，当前规模 D1 查询非瓶颈——延迟来自轮询架构而非慢 SQL。

## 2. 业主拍板（2026-09-14）

1. **在线口径：登录 IM 即在线**（P1）；
2. **P0 先行单独提交**；
3. **P2 采用 A 方案：轻量 activity 通知**（枢纽只发「有动静」信号，前端节流回源；弃全量帧推送）；
4. **P3（列表在线点/标题徽标/最后上线时间外显等）暂不做**。

A/B 取舍备忘：全量帧推送（B）省一次 REST 往返但要求全部帧型（msg/read/rekey/members/rename/kicked）写路由+去重、未打开会话也要处理 rekey/成员帧，改动量约 2-3 倍；A 方案 90% 体验收益、两条通道职责不重叠（打开中会话仍走原房间 WS），是当前架构下的最优性价比。若将来要「单长连复用一切」（取消每会话 WS），再做 B，属更大重构。

## 3. P0 · 同步止血（已上线，commit 66a18b6）

- `visibilitychange`/`focus`/`online` 三事件立即对齐（`syncTick`：refreshConvs + refreshPendingIn），与 20s 轮询共用 2s 合并去抖；
- `refreshConvs` 去掉 `previews.clear()`——预览缓存由 previewFor 按 last_msg.seq 精确失效，未变会话不再重解密、无「…」闪烁；
- 20s 轮询顺带刷好友申请横幅（原仅 boot 一次）。

## 4. P1 · 用户级在线（已实施，本文档提交时上线）

### 4.1 架构
- **DO IMPresence**（im/src/do/presence.js，每用户一实例 `idFromName('u<uid>')`，wrangler 迁移 v2）：承载常驻存在性 WS。连接/心跳写 `im_presence.last_ping`（内存节流 20s，每用户 D1 写 ≤3 次/min；连接即强写）；**最后一条**连接断开才删行落离线（多标签；close 事件里被关连接可能仍在 getWebSockets()，须排除自身）。
- **存在性通道**：`/ws` **不带 conv 参数** = 存在性连接（worker 验会话后注入 x-im-uid 升级进 IMPresence，同 IMRoom 信任注入模式）；带 conv 参数 = 原会话通道，零改动。run_worker_first 无需新增路径。
- **读侧**：`GET /api/presence?uids=…`（im/src/api/presence.js，≤100 uid 按 40 分块查）：**在线 = last_ping 距今 < 90s（读时计算）**——异常断线自愈，无需 alarm；**隐私边界：仅返回「好友或同会话成员」中的在线者**（陌生人不可见，防 uid 探测）。
- **前端**（app.js/chat.js/ws.js）：登录后 boot 开一条常驻 WS（25s 心跳 {t:'ping'}，服务端回 pong 供探活；断线指数退避重连连接器泛化为 connectWs）；登出即关。聊天窗打开期间 30s 轮询 /api/presence（dm 查对方、群查全员），与房间 hello/join/leave 实时集**取并集**渲染头部（dm 在线/离线；群 N 人 · M 在线）——房间集贡献「同会话同屏」的秒级翻转，presence 集贡献「登录即在线」的全局口径。
- 迁移 007：`im_presence(uid PK, last_ping)`。

### 4.2 踩坑记录（复盘防再犯）
1. **Hibernation 唤醒后 DO 实例内存归零**——`this.uid` 在心跳路径为 0，写进 uid=0 幽灵行；uid 必须从 `ws.deserializeAttachment()` 取（同 room.js 的 attachment 纪律）。
2. **webSocketClose 事件里被关连接可能仍在 `getWebSockets()` 列表**——「还有存活连接」判断恒真、离线永不落库；须 `filter(s => s !== ws)` 后计数。
3. 本地验证期反复被自家基建咬：登录限流 5 次/10min/IP、注册 3/时/IP 是**worker 内存桶**，重启 dev 即清；wrangler dev 必须从 im/ 目录起（cwd 错了起成主站 worker，/api 全 404）；dev 热重载会无声断 socket（无 close 帧），测试脚本 close 须带超时兜底。

### 4.3 验收（全过）
- 本地脚本 im/.build-tmp/p1-test.mjs **18 断言全过**：登录即在线（存在性 WS hello→presence 可查）/ 未登录 401 / 心跳落库与 20s 节流 / 95s 过期读时判离线 + 重连强写恢复 / 多标签最后一条断开才离线且行删除 / 陌生人不可见（双向）/ 坏参数与空参。
- 真浏览器（本地 dev，双账号）：B 仅登录（未开会话）→ A 的 dm 头部显示**在线**（房间集必为空，「在线」只能来自 presence）；断开 B → 重开会话显示**离线**；console 零报错。
- bundle（check-frontend esbuild 全模块）+ wrangler dry-run + check-i18n 全绿。

## 5. P2 · 轻量 activity 通知（业主选 A，待实施）

### 5.1 设计
- **服务端**：IMRoom 在现有广播之外，对「非本房间在线」的成员无法触达——新增枢纽投递：广播帧时对每个成员 uid `env.PRESENCE.get(idFromName('u'+uid)).fetch('/deliver', …)`；IMPresence /deliver 把**轻量信号**扇出给该用户全部存在性 socket：
  - 消息/系统消息：`{t:'activity', conv, seq}`（不含密文）；
  - 社交事件（好友申请/同意/删除、入群/被移出/解散/重钥/改名）：`{t:'contact'}`（前端拉权威数据，服务端不做文案）。
- **前端**：app.js 存在性 WS 的 onFrame 分流——`activity` → 节流（≥2s 合并）调 `refreshConvs()`；`contact` → 节流调 `refreshPendingIn()` + 若联系人面板正打开则重拉。打开中的会话仍走原房间 WS（seenSeq 去重照旧），两通道职责不重叠、无重复投递。
- **轮询降级**：20s 轮询降为 60s 兜底（事件驱动为主后兜底意义大于时效）。
- 防回环：IMRoom 广播给房间内 socket 的原帧不带 activity；投递前按 attachment.uid 查目标用户是否在本房间有 socket（有则跳过，省一次 DO 往返）。

### 5.2 验收标准（预设）
- 本地脚本：A、B 互不为活跃会话时，B 发消息 → A 存在性 WS 收到 activity（含正确 conv/seq）→ A 的列表刷新后未读/预览更新；B 不在线（无存在性 socket）→ 无投递无报错；A 开着该会话 → 不收 activity（房间帧直达）。
- 真浏览器：双账号跨会话实时性（对端发消息 → 本端列表秒级更新）；好友申请横幅秒级出现。
- bundle + dry-run + check-i18n 全绿。

## 6. P3 · 暂不做（业主拍板，勿主动重提）

会话列表在线小圆点、document.title 未读徽标、「最后上线于 HH:MM」外显（数据源 last_seen_at/im_presence 已具备）、移动端 PWA 推送。将来要做时从 §4 架构直接长出来，无返工。

## 7. 成本量级

- 每在线用户：1 条存在性 WS（Hibernation 空闲不计费）+ D1 写 ≤3 次/min（20s 节流）；
- presence 查询：聊天窗打开期间 1 次/30s（≤2 条分块查询）；
- P2 增量：每条消息 1 次房间内广播 + 在线成员数 次 DO 内部 fetch（同区域内网转发，亚毫秒）。
