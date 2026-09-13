/**
 * 焰境密语 — /ws 升级链（方案 §5）：
 * 验 Cookie 会话 → D1 查成员资格 → stub.fetch 注入 X-IM-UID/X-IM-IP → DO IMRoom accept。
 * DO 信任 Worker 注入的身份，不查库（DO 仅经 Worker binding 可达）。
 */

import { currentUser } from './session.js';
import { json } from './util.js';

export async function handleWs(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'auth' }, 401);
  if (user.status === 'disabled') return json({ ok: false, error: 'disabled' }, 403);
  const convId = Number(url.searchParams.get('conv') || 0);
  if (!Number.isInteger(convId) || convId <= 0) return json({ ok: false, error: 'conv' }, 400);
  const member = await env.DB.prepare('SELECT 1 FROM im_members WHERE conversation_id = ?1 AND user_id = ?2')
    .bind(convId, user.uid).first();
  if (!member) return json({ ok: false, error: 'forbidden' }, 403);

  const stub = env.ROOM.get(env.ROOM.idFromName('c' + convId));
  const headers = new Headers(request.headers);
  headers.set('x-im-uid', String(user.uid));
  headers.set('x-im-ip', request.headers.get('cf-connecting-ip') || '');
  const doUrl = new URL(request.url);
  doUrl.pathname = '/connect'; // DO 内部端点（idFromName 已锁定会话实例）
  return stub.fetch(new Request(doUrl, { method: 'GET', headers }));
}
