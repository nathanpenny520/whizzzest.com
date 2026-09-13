/**
 * 焰境密语 — WebSocket 客户端（每会话一条，指数退避重连）
 * 帧协议见 docs/IM聊天方案.md §5：
 *   收：hello/ msg/ typing/ join/ leave/ err
 *   发：msg {tag, body 密文} ／ typing
 */

export function connectConv(convId, handlers) {
  let ws = null;
  let closed = false;
  let retries = 0;
  let timer = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?conv=${convId}`);
    ws.onopen = () => {
      retries = 0;
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
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() {
      closed = true;
      clearTimeout(timer);
      try { if (ws) ws.close(); } catch { /* 忽略 */ }
    },
  };
}
