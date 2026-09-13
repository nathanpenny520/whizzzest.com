/**
 * 焰境密语 — 会话 Cookie（HMAC 签名，照 writer 门户模式）
 * Cookie 形态：im_session=<uid>.<exp毫秒>.<hmac-sha256hex(secret, "uid.exp")>
 */

import { COOKIE_NAME, SESSION_TTL_MS, SESSION_TTL_S } from './config.js';
import { hmacHex, json, timingSafeEqual } from './util.js';

/** 登录/注册成功：JSON + 会话 Cookie（extra 携密钥备份给前端恢复流程） */
export async function authedJson(secret, uid, extra) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmacHex(secret, uid + '.' + exp);
  const payload = Object.assign({ ok: true, uid }, extra || {});
  const res = json(payload);
  res.headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${uid}.${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`
  );
  return res;
}

/** 从 Cookie 还原当前用户（D1 行：uid/login_phone/login_email/display_name/bio/avatar_color/status）；无效 → null */
export async function currentUser(request, env) {
  if (!env.IM_SESSION_SECRET) return null;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([0-9]+)\\.([0-9]+)\\.([a-f0-9]{64})`));
  if (!m) return null;
  const [, uid, exp, sig] = m;
  if (Number(exp) < Date.now()) return null;
  const expected = await hmacHex(env.IM_SESSION_SECRET, uid + '.' + exp);
  if (!timingSafeEqual(sig, expected)) return null;
  return env.DB.prepare(
    'SELECT id AS uid, phone AS login_phone, email AS login_email, display_name, bio, avatar_color, status FROM im_users WHERE id = ?1'
  ).bind(Number(uid)).first();
}

export function logoutResponse() {
  const res = json({ ok: true });
  res.headers.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return res;
}
