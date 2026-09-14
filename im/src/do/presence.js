/**
 * 焰境密语 — DO IMPresence：每用户一实例（idFromName='u<uid>'，docs/IM在线与实时同步方案.md P1）
 * 职责：承载「登录即在线」的常驻存在性 WS——连接/心跳写 im_presence.last_ping（内存节流），
 *       最后一条连接断开即删行；在线判定读时按 90s 窗口计算（异常断线自愈，无需 alarm）。
 * 隐私边界：查询侧（src/api/presence.js）只对「好友或同会话成员」返回在线，本 DO 不做可见性判断。
 * P2 预留：本实例将兼任该用户的推送枢纽（/deliver → 全部 socket 扇出），见方案文档 P2 章。
 */

import { PRESENCE_WRITE_THROTTLE_MS, WS_PER_UID_LIMIT } from '../config.js';

export class IMPresence {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.uid = 0;
    this.lastWrite = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.connect(request);
    return new Response('not found', { status: 404 });
  }

  /* ---- WS 接入（身份由 Worker 注入，信任 header 不查库，同 IMRoom） ---- */

  async connect(request) {
    const uid = Number(request.headers.get('x-im-uid') || 0);
    if (!uid) return new Response('bad identity', { status: 403 });

    // 单 uid 并发存在性连接上限（多标签场景，与 IMRoom 同款约束）
    let count = 0;
    for (const ws of this.state.getWebSockets()) {
      try { const a = ws.deserializeAttachment(); if (a && a.uid === uid) count++; } catch { /* 忽略坏附件 */ }
    }
    if (count >= WS_PER_UID_LIMIT) return new Response('too many connections', { status: 429 });

    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ uid });
    this.state.acceptWebSocket(pair[1]);
    this.uid = uid;
    await this.touch(uid, true); // 连接即置在线（首个标签秒级可见）
    this.safeSend(pair[1], { t: 'hello', you: uid });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, raw) {
    // Hibernation 唤醒后实例内存归零：uid 必须从 socket attachment 取（this.uid 仅作兜底）
    let a;
    try { a = ws.deserializeAttachment(); } catch { return; }
    const uid = (a && a.uid) || this.uid;
    if (!uid) return;
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m && m.t === 'ping') {
      await this.touch(uid);
      this.safeSend(ws, { t: 'pong' }); // 回执供客户端探活（半开连接可感知）
    }
  }

  async webSocketClose(ws) {
    // 多标签：仅最后一个连接断开才落离线。close 事件里被关连接可能仍在 getWebSockets() 列表，必须排除自身；
    // 行删除失败也无碍（读时 90s 窗口兜底）
    if (this.state.getWebSockets().filter((s) => s !== ws).length) return;
    let a;
    try { a = ws.deserializeAttachment(); } catch { /* 用实例 uid 兜底 */ }
    const uid = (a && a.uid) || this.uid;
    if (!uid) return;
    try {
      await this.env.DB.prepare('DELETE FROM im_presence WHERE uid = ?1').bind(uid).run();
    } catch (err) {
      console.error('im presence close:', err);
    }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* 已关 */ }
  }

  /* ---- 内部 ---- */

  /** 心跳落库（节流：距上次写 <20s 跳过，每用户 D1 写 ≤3 次/min；force 用于连接置在线） */
  async touch(uid, force) {
    const now = Date.now();
    if (!force && now - this.lastWrite < PRESENCE_WRITE_THROTTLE_MS) return;
    this.lastWrite = now;
    try {
      await this.env.DB.prepare(
        'INSERT INTO im_presence (uid, last_ping) VALUES (?1, ?2) ON CONFLICT(uid) DO UPDATE SET last_ping = ?2'
      ).bind(uid, now).run();
    } catch (err) {
      console.error('im presence touch:', err);
    }
  }

  safeSend(ws, frame) {
    try { ws.send(JSON.stringify(frame)); } catch { /* 死连接交给 webSocketClose/Error */ }
  }
}
