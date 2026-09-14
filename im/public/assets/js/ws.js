/**
 * 焰境密语 — WebSocket 客户端（指数退避重连；泛化连接器 + 两种用法）
 * 帧协议见 docs/IM聊天方案.md §5 与 docs/IM在线与实时同步方案.md：
 *   会话通道 connectConv（每会话一条，聊天窗打开期间）：
 *     收：hello/ msg/ typing/ join/ leave/ err ＋ M3 群组帧：members（成员变更）/ rekey（重钥）/
 *         rename（改名）/ kicked（被移出·退群·解散，服务端随后 close 4003）＋ v2：read（已读回执，{uid, seq}）
 *     发：msg {tag, body 密文} ／ typing
 *   存在性通道 connectWs('/ws')（登录后常驻一条，P1 登录即在线）：
 *     收：hello {you} / pong；发：{t:'ping'}（心跳，保 im_presence.last_ping 新鲜）
 */

export function connectWs(url, handlers) {
  let ws = null;
  let closed = false;
  let retries = 0;
  let timer = null;
  const outbox = []; // 未 OPEN 时的发送排队（连上即冲刷；防冷启动窗口静默丢消息）

  function flush() {
    while (outbox.length && ws && ws.readyState === 1) {
      try { ws.send(outbox.shift()); } catch { break; }
    }
  }

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retries = 0;
      flush();
      if (handlers.onOpen) handlers.onOpen();
    };
    ws.onmessage = (e) => {
      let f = null;
      try { f = JSON.parse(e.data); } catch { return; }
      if (f && handlers.onFrame) handlers.onFrame(f);
    };
    ws.onclose = (e) => {
      if (closed) return;
      if (handlers.onClose) handlers.onClose(e.code);
      if (e.code === 4003) return; // 被移出会话：不重连（M3 kicked）
      const delay = Math.min(15000, 1000 * Math.pow(2, retries++));
      timer = setTimeout(connect, delay);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* 忽略 */ } };
  }

  connect();
  return {
    send(obj) {
      const s = JSON.stringify(obj);
      if (ws && ws.readyState === 1) ws.send(s);
      else if (outbox.length < 50) outbox.push(s); // 超限丢弃由上层 err/超时兜底
    },
    close() {
      closed = true;
      clearTimeout(timer);
      try { if (ws) ws.close(); } catch { /* 忽略 */ }
    },
  };
}

/** 每会话一条（聊天窗打开期间建立、退出即关） */
export function connectConv(convId, handlers) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return connectWs(`${proto}//${location.host}/ws?conv=${convId}`, handlers);
}
