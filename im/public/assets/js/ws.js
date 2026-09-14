/**
 * 焰境密语 — WebSocket 客户端（每会话一条，指数退避重连）
 * 帧协议见 docs/IM聊天方案.md §5：
 *   收：hello/ msg/ typing/ join/ leave/ err ＋ M3 群组帧：members（成员变更）/ rekey（重钥）/
 *       rename（改名）/ kicked（被移出·退群·解散，服务端随后 close 4003）＋ v2：read（已读回执，{uid, seq}）
 *   发：msg {tag, body 密文} ／ typing
 */

export function connectConv(convId, handlers) {
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
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?conv=${convId}`);
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
