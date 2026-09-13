/**
 * 焰境密语 — 账号 API：双方式注册/登录、登出、我的资料、E2EE 密钥材料（方案 §3.1/§6）
 * 服务器是「账号公钥目录」：只存 pub_key + 密码包裹的私钥备份，永远不持有可解密钥。
 */

import { normalizePhone, maskPhone } from '../../../shared/phone.js';
import { AVATAR_COLORS, EMAIL_RE, ENC_PRIV_KEY_MAX, KDF_ITERS_MIN, KDF_ITERS_MAX } from '../config.js';
import { authedJson, logoutResponse } from '../session.js';
import { cleanDisplayName, isB64, b64ToBuf, json, limited, maskEmail, pbkdf2Hex, readJson, timingSafeEqual } from '../util.js';
import { verifyEmailCode } from '../mail.js';

export async function registerPhone(request, env) {
  if (!env.IM_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('imreg:' + ip, 60 * 60 * 1000, 3)) return json({ ok: false, error: 'rate' }, 429);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  if (String(body.website || '') !== '') return json({ ok: true }); // Honeypot

  const phone = normalizePhone(String(body.phone || ''), String(body.country || ''));
  const password = String(body.password || '');
  if (!phone.ok) return json({ ok: false, error: 'phone' }, 400);
  if (password.length < 8 || password.length > 64) return json({ ok: false, error: 'password' }, 400);

  const keys = await parseKeyMaterial(body);
  if (!keys) return json({ ok: false, error: 'keys' }, 400);

  const dup = await env.DB.prepare('SELECT id FROM im_users WHERE phone = ?1').bind(phone.e164).first();
  if (dup) return json({ ok: false, error: 'dup' }, 409);

  const salt = crypto.randomUUID().replace(/-/g, '');
  const hash = await pbkdf2Hex(password, salt);
  const name = cleanDisplayName(body.display_name) || '';
  const r = await env.DB.prepare(
    `INSERT INTO im_users (phone, pass_hash, pass_salt, pub_key, enc_priv_key, kdf_salt, kdf_iters, display_name)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(phone.e164, hash, salt, keys.pubKey, keys.encPrivKey, keys.kdfSalt, keys.kdfIters, name).run();
  const uid = r.meta.last_row_id;
  if (!name) {
    await env.DB.prepare('UPDATE im_users SET display_name = ?2 WHERE id = ?1').bind(uid, '焰友' + uid).run();
  }
  return authedJson(env.IM_SESSION_SECRET, uid);
}

export async function registerEmail(request, env) {
  if (!env.IM_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('imrege:' + ip, 60 * 60 * 1000, 3)) return json({ ok: false, error: 'rate' }, 429);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  if (String(body.website || '') !== '') return json({ ok: true }); // Honeypot

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').replace(/\s/g, '');
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email) || email.length > 100) return json({ ok: false, error: 'email' }, 400);
  if (password.length < 8 || password.length > 64) return json({ ok: false, error: 'password' }, 400);

  const keys = await parseKeyMaterial(body);
  if (!keys) return json({ ok: false, error: 'keys' }, 400);

  const dup = await env.DB.prepare('SELECT id FROM im_users WHERE email = ?1').bind(email).first();
  if (dup) return json({ ok: false, error: 'taken' }, 409);

  const verr = await verifyEmailCode(env, email, 'im-register', code);
  if (verr) return json({ ok: false, error: verr }, 401);

  const salt = crypto.randomUUID().replace(/-/g, '');
  const hash = await pbkdf2Hex(password, salt);
  const name = cleanDisplayName(body.display_name) || '';
  const r = await env.DB.prepare(
    `INSERT INTO im_users (email, pass_hash, pass_salt, pub_key, enc_priv_key, kdf_salt, kdf_iters, display_name)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(email, hash, salt, keys.pubKey, keys.encPrivKey, keys.kdfSalt, keys.kdfIters, name).run();
  const uid = r.meta.last_row_id;
  if (!name) {
    await env.DB.prepare('UPDATE im_users SET display_name = ?2 WHERE id = ?1').bind(uid, '焰友' + uid).run();
  }
  return authedJson(env.IM_SESSION_SECRET, uid);
}

export async function loginPhone(request, env) {
  if (!env.IM_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('imlogin:' + ip, 10 * 60 * 1000, 5)) return json({ ok: false, error: 'rate' }, 429);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const phone = normalizePhone(String(body.phone || ''), String(body.country || ''));
  const password = String(body.password || '');
  if (!phone.ok) return json({ ok: false, error: 'bad' }, 401);

  const row = await env.DB.prepare(
    'SELECT id, pass_hash, pass_salt, status FROM im_users WHERE phone = ?1'
  ).bind(phone.e164).first();
  if (!row) return json({ ok: false, error: 'bad' }, 401);
  const hash = await pbkdf2Hex(password, row.pass_salt);
  if (!timingSafeEqual(hash, row.pass_hash)) return json({ ok: false, error: 'bad' }, 401);
  if (row.status === 'disabled') return json({ ok: false, error: 'disabled' }, 403);

  return authedJson(env.IM_SESSION_SECRET, row.id, await keyBackupFor(env, row.id));
}

export async function loginEmail(request, env) {
  if (!env.IM_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('imlogine:' + ip, 10 * 60 * 1000, 10)) return json({ ok: false, error: 'rate' }, 429);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').replace(/\s/g, '');
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ ok: false, error: 'bad' }, 401);

  const verr = await verifyEmailCode(env, email, 'im-login', code);
  if (verr) return json({ ok: false, error: verr }, 401);

  const row = await env.DB.prepare('SELECT id, status FROM im_users WHERE email = ?1').bind(email).first();
  if (!row) return json({ ok: false, error: 'bad' }, 401);
  if (row.status === 'disabled') return json({ ok: false, error: 'disabled' }, 403);

  return authedJson(env.IM_SESSION_SECRET, row.id, await keyBackupFor(env, row.id));
}

export function logout() {
  return logoutResponse();
}

/* ---------------- 我的资料 / 密钥目录 ---------------- */

export async function meGet(env, user) {
  const full = await env.DB.prepare(
    'SELECT id, phone, email, display_name, bio, avatar_color, pub_key, enc_priv_key, kdf_salt, kdf_iters, status, created_at FROM im_users WHERE id = ?1'
  ).bind(user.uid).first();
  if (!full) return json({ ok: false, error: 'auth' }, 401);
  await env.DB.prepare('UPDATE im_users SET last_seen_at = datetime(\'now\') WHERE id = ?1').bind(user.uid).run();
  return json({
    ok: true,
    uid: full.id,
    display_name: full.display_name,
    bio: full.bio,
    avatar_color: full.avatar_color,
    login_phone: full.phone ? maskPhone(full.phone) : '',
    login_email: full.email ? maskEmail(full.email) : '',
    pub_key: full.pub_key,
    has_backup: !!full.enc_priv_key,
    kdf_salt: full.kdf_salt,
    kdf_iters: full.kdf_iters,
    status: full.status,
    created_at: full.created_at,
  });
}

export async function mePatch(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const name = cleanDisplayName(body.display_name);
  const bio = String(body.bio ?? '').trim();
  const color = Number(body.avatar_color);
  if (name === null) return json({ ok: false, error: 'display_name' }, 400);
  if (bio.length > 100) return json({ ok: false, error: 'bio' }, 400);
  if (!Number.isInteger(color) || color < 0 || color >= AVATAR_COLORS) return json({ ok: false, error: 'avatar_color' }, 400);
  if (!name) return json({ ok: false, error: 'display_name' }, 400);
  await env.DB.prepare('UPDATE im_users SET display_name = ?1, bio = ?2, avatar_color = ?3 WHERE id = ?4')
    .bind(name, bio, color, user.uid).run();
  return json({ ok: true });
}

/* ---------------- E2EE 密钥材料 ---------------- */

/** 登录响应附带的密钥备份（浏览器用密码本地解包，方案 §3.1 换机恢复） */
async function keyBackupFor(env, uid) {
  const row = await env.DB.prepare(
    'SELECT pub_key, enc_priv_key, kdf_salt, kdf_iters FROM im_users WHERE id = ?1'
  ).bind(uid).first();
  if (!row) return {};
  return { keys: { pub_key: row.pub_key, enc_priv_key: row.enc_priv_key, kdf_salt: row.kdf_salt, kdf_iters: row.kdf_iters } };
}

/** 注册密钥材料校验：公钥可被 WebCrypto 导入（真 P-256 点）；包裹备份与 KDF 参数在约束内 */
export async function parseKeyMaterial(body) {
  const pubKey = String(body.pub_key || '');
  const encPrivKey = String(body.enc_priv_key || '');
  const kdfSalt = String(body.kdf_salt || '');
  const kdfIters = Number(body.kdf_iters);
  if (!pubKey || pubKey.length > 256 || !isB64(pubKey)) return null;
  try {
    const raw = b64ToBuf(pubKey);
    if (raw.byteLength !== 65 || new Uint8Array(raw)[0] !== 0x04) return null;
    await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch { return null; }
  if (!encPrivKey || encPrivKey.length > ENC_PRIV_KEY_MAX || !isB64(encPrivKey)) return null;
  if (!/^[0-9a-f]{64}$/.test(kdfSalt)) return null;
  if (!Number.isInteger(kdfIters) || kdfIters < KDF_ITERS_MIN || kdfIters > KDF_ITERS_MAX) return null;
  return { pubKey, encPrivKey, kdfSalt, kdfIters };
}
