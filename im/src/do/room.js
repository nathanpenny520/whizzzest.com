/**
 * 焰境密语 — DO IMRoom：每会话一实例（idFromName='c<convId>'，方案 §5）
 * WebSocket Hibernation（workers-chat-demo 模式 + D1 持久化改造）：
 *   - 会话元数据随 serializeAttachment 休眠持久（uid/ip/convType），唤醒零成本
 *   - seq 分配（v1.3 修订）：不再用 DO 内存计数器——M3 起系统消息由 REST 侧插入，分配器必须共用。
 *     改为「INSERT 内 MAX(seq)+1 标量子查询」（D1 单语句原子），DO/REST 撞不了号；
 *     分配后落库失败留空洞无害（拉历史按 seq 排序）
 *   - 消息流：成员校验（信任 attachment）→ 限流（每会话 10条/10s + 注册<1h 新号 5条/min + 全局 RateLimiter
 *     按发送者 IP 分键）→ 拉黑拒收（仅 dm，群聊不按私聊拉黑拦截）→ 写 D1 → 广播（含发送者，tag 回显确认）
 *   - 在线：hello 名单 + join/leave 广播；typing 纯转发不落库
 *   - /sys（仅 Worker 经 binding 可达）：成员变更通知——kick 名单收 kicked 帧并 close(4003)，frame 广播余员
 */

import { MSG_BODY_MAX, NEW_ACCT_SEND, SEND_MAX_PER_WINDOW, SEND_WINDOW_MS, WS_PER_UID_LIMIT } from '../config.js';
import { dbTimeMs } from '../util.js';
import { RateLimiterClient } from './rate-limiter.js';

export class IMRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.convId = Number(String(state.id.name || '').replace(/^c/, '')) || 0;
    this.sends = new Map();      // uid → 最近发送时间戳（保留 60s 供新号限流复用）
    this.rls = new Map();        // 发送者 IP → RateLimiterClient（M4 顺修：原整会话共用首个发送者的 IP 键，他人会互相消耗预算）
    this.acctAge = new Map();    // uid → 'new' | 'old'（账号年龄缓存，每 uid 每实例查一次 D1）
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.connect(request);
    if (url.pathname === '/sys' && request.method === 'POST') return this.sys(request);
    if (url.pathname === '/ping') {
      return new Response(
        JSON.stringify({ ok: true, room: this.state.id.name || '', online: this.onlineUids().length }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('not found', { status: 404 });
  }

  /* ---- WS 接入 ---- */

  async connect(request) {
    const uid = Number(request.headers.get('x-im-uid') || 0);
    const ip = request.headers.get('x-im-ip') || '';
    const convType = request.headers.get('x-im-conv-type') === 'group' ? 'group' : 'dm';
    if (!uid || !this.convId) return new Response('bad identity', { status: 403 });

    // 单 uid 并发连接上限（方案 §8）
    let count = 0;
    for (const ws of this.state.getWebSockets()) {
      try { const a = ws.deserializeAttachment(); if (a && a.uid === uid) count++; } catch { /* 忽略坏附件 */ }
    }
    if (count >= WS_PER_UID_LIMIT) return new Response('too many connections', { status: 429 });

    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ uid, ip, type: convType });
    this.state.acceptWebSocket(pair[1]);
    this.safeSend(pair[1], { t: 'hello', you: uid, conv: this.convId, online: this.onlineUids() });
    this.broadcast({ t: 'join', uid }, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /* ---- 成员变更通知（Worker 经 binding 调用，方案 §5） ---- */

  async sys(request) {
    let m;
    try { m = await request.json(); } catch { return new Response('bad request', { status: 400 }); }
    const kick = Array.isArray(m && m.kick) ? m.kick : [];
    if (kick.length) {
      for (const ws of this.state.getWebSockets()) {
        let a;
        try { a = ws.deserializeAttachment(); } catch { continue; }
        if (!a || !kick.some((k) => Number(k && k.uid) === a.uid)) continue;
        this.safeSend(ws, { t: 'kicked', conv: this.convId, why: String(kick.find((k) => Number(k && k.uid) === a.uid).why || 'kicked') });
        try { ws.close(4003, 'removed'); } catch { /* 已关 */ }
      }
    }
    if (m && m.frame && typeof m.frame === 'object') this.broadcast(m.frame);
    return new Response('ok');
  }

  async webSocketMessage(ws, raw) {
    let att;
    try { att = ws.deserializeAttachment(); } catch { return; }
    if (!att || !att.uid) return;
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'typing') {
      this.broadcast({ t: 'typing', uid: att.uid }, ws);
      return;
    }
    if (m.t === 'msg') {
      await this.onMessage(ws, att, m);
    }
  }

  async onMessage(ws, att, m) {
    const tag = String(m.tag || '').slice(0, 64);
    const body = String(m.body || '');
    const fail = (error) => this.safeSend(ws, { t: 'err', tag, error });
    if (!tag || !body) return fail('format');
    if (body.length > MSG_BODY_MAX) return fail('too_long');

    const now = Date.now();
    const hits = (this.sends.get(att.uid) || []).filter((t) => now - t < NEW_ACCT_SEND.windowMs);
    hits.push(now);
    this.sends.set(att.uid, hits);
    // 每会话每 uid 10 条/10s（方案 §8）
    if (hits.filter((t) => now - t < SEND_WINDOW_MS).length > SEND_MAX_PER_WINDOW) return fail('rate');
    // 注册<1h 新号 5 条/min（方案 §8，M4 落地；per-conv 粒度，与全局每 IP 限流叠加兜底）
    if ((await this.isNewAccount(att.uid)) && hits.length > NEW_ACCT_SEND.max) return fail('rate');

    // 全局限流（每 IP 一个 RateLimiter DO，照 workers-chat-demo；按发送者 IP 分键，M4 顺修）
    // 修复（随 M3）：原实现漏了 .get()——把 DO ID 当 stub 用，首条消息后 callLimiter 必错、
    // inCooldown 永久卡死（人工慢节奏 + DO 快速逐出掩盖至今）
    const rlKey = att.ip || 'u' + att.uid;
    if (!this.rls.has(rlKey)) {
      this.rls.set(rlKey, new RateLimiterClient(
        () => this.env.LIMITERS.get(this.env.LIMITERS.idFromName(rlKey)),
        (err) => console.error('im rate limiter:', err)
      ));
    }
    if (!this.rls.get(rlKey).checkLimit()) return fail('rate');

    // 拉黑双向 → 拒收：仅 1v1 生效（群聊不按私聊拉黑拦截，v1.3）；不落库不广播，仅发送方收错误帧（方案 §8）
    if (att.type !== 'group') {
      const peer = await this.peerOf(att.uid);
      if (peer) {
        const blocked = await this.env.DB.prepare(
          'SELECT 1 FROM im_blocks WHERE (user_id = ?1 AND blocked_uid = ?2) OR (user_id = ?2 AND blocked_uid = ?1) LIMIT 1'
        ).bind(att.uid, peer).first();
        if (blocked) return fail('blocked');
      }
    }

    let row = null;
    try {
      row = await this.env.DB.prepare(
        `INSERT INTO im_messages (conversation_id, seq, sender_id, type, body)
         VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM im_messages WHERE conversation_id = ?1), ?2, 'text', ?3)
         RETURNING seq, created_at`
      ).bind(this.convId, att.uid, body).first();
    } catch (err) {
      console.error('im room insert failed:', err);
      return fail('retry');
    }
    // 「删除会话」隐藏解除：任一方来新消息即恢复列表可见（min_seq 挡旧史，见 convs.js convState）
    await this.env.DB.prepare('UPDATE im_members SET hidden = 0 WHERE conversation_id = ?1 AND hidden = 1')
      .bind(this.convId).run().catch((err) => console.error('im unhide failed:', err));
    // 广播含发送者自己（tag 回显 = 发送确认 + 去重）
    this.broadcast({ t: 'msg', conv: this.convId, seq: row ? row.seq : 0, uid: att.uid, body, at: row ? row.created_at : null, tag });
  }

  async webSocketClose(ws) {
    let att;
    try { att = ws.deserializeAttachment(); } catch { return; }
    if (att && att.uid) this.broadcast({ t: 'leave', uid: att.uid });
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* 已关 */ }
  }

  /* ---- 内部 ---- */

  /** 账号是否注册<1h（结果按 uid 缓存：实例生命周期内判定不变，查一次即可） */
  async isNewAccount(uid) {
    if (this.acctAge.has(uid)) return this.acctAge.get(uid) === 'new';
    let isNew = false;
    try {
      const row = await this.env.DB.prepare('SELECT created_at FROM im_users WHERE id = ?1').bind(uid).first();
      isNew = !row || (Date.now() - dbTimeMs(row.created_at)) < NEW_ACCT_SEND.ageMs;
    } catch (err) {
      console.error('im room account age:', err); // 查询失败按老号放行（per-conv 与全局限流仍在）
    }
    this.acctAge.set(uid, isNew ? 'new' : 'old');
    return isNew;
  }

  peerOf(uid) {
    return this.env.DB.prepare('SELECT user_id AS peer FROM im_members WHERE conversation_id = ?1 AND user_id != ?2 LIMIT 1')
      .bind(this.convId, uid).first().then((r) => (r ? r.peer : 0));
  }

  onlineUids() {
    const set = new Set();
    for (const ws of this.state.getWebSockets()) {
      try { const a = ws.deserializeAttachment(); if (a && a.uid) set.add(a.uid); } catch { /* 忽略 */ }
    }
    return [...set];
  }

  broadcast(frame, except) {
    const s = JSON.stringify(frame);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch { /* 死连接交给 webSocketClose/Error */ }
    }
  }

  safeSend(ws, frame) {
    try { ws.send(JSON.stringify(frame)); } catch { /* 同上 */ }
  }
}
