/**
 * 焰境密语 — /ws 升级链（方案 §5 + 在线方案 P1）：
 * 不带 conv 参数 = 常驻存在性连接 → 用户 DO IMPresence（登录即在线，docs/IM在线与实时同步方案.md）；
 * 带 conv 参数 = 会话实时通道 → 验 Cookie 会话 → D1 查成员资格（附会话类型）→ stub.fetch 注入
 * X-IM-UID/X-IM-IP/X-IM-CONV-TYPE → DO accept。DO 信任 Worker 注入的身份，不查库（DO 仅经 Worker binding 可达）。
 */

import { currentUser } from './session.js';
import { json } from './util.js';

export async function handleWs(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'auth' }, 401);
  if (user.status === 'disabled') return json({ ok: false, error: 'disabled' }, 403);

  // P1 存在性连接：/ws 不带 conv 参数（升级进用户 DO，身份同款注入）
  if (!url.searchParams.has('conv')) {
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName('u' + user.uid));
    const headers = new Headers(request.headers);
    headers.set('x-im-uid', String(user.uid));
    const doUrl = new URL(request.url);
    doUrl.pathname = '/connect';
    return stub.fetch(new Request(doUrl, { method: 'GET', headers }));
  }

  const convId = Number(url.searchParams.get('conv') || 0);
  if (!Number.isInteger(convId) || convId <= 0) return json({ ok: false, error: 'conv' }, 400);
  const member = await env.DB.prepare(
    'SELECT m.user_id AS uid, c.type AS conv_type FROM im_members m JOIN im_conversations c ON c.id = m.conversation_id WHERE m.conversation_id = ?1 AND m.user_id = ?2'
  ).bind(convId, user.uid).first();
  if (!member) return json({ ok: false, error: 'forbidden' }, 403);

  const stub = env.ROOM.get(env.ROOM.idFromName('c' + convId));
  const headers = new Headers(request.headers);
  headers.set('x-im-uid', String(user.uid));
  headers.set('x-im-ip', request.headers.get('cf-connecting-ip') || '');
  headers.set('x-im-conv-type', member.conv_type === 'group' ? 'group' : 'dm');
  const doUrl = new URL(request.url);
  doUrl.pathname = '/connect'; // DO 内部端点（idFromName 已锁定会话实例）
  return stub.fetch(new Request(doUrl, { method: 'GET', headers }));
}
