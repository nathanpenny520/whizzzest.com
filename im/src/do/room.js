/**
 * 焰境密语 — DO IMRoom：每会话一实例（idFromName='c<convId>'）
 * M1 仅存活桩（DO 绑定/migration 生效）；WebSocket Hibernation 全量逻辑随 M2 实装
 * （seq 分配/扇出/落库，设计见 docs/IM聊天方案.md §5：workers-chat-demo 模式 + D1 持久化改造）。
 */

export class IMRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ping') {
      return new Response(JSON.stringify({ ok: true, room: this.state.id.name || '' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }
}
