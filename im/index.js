/**
 * 焰境·万载 — IM 即时聊天 Worker（im.whizzzest.com，docs/IM聊天方案.md v1.1）——M1：账号 + 密钥目录 + 骨架
 *
 *  - GET  /                     无会话→认证页（登录/注册双方式 + E2EE 密钥生成/恢复）；有会话→302 /app
 *  - GET  /app                  聊天应用 SPA 壳（会话必需；M1 为骨架视图）
 *  - POST /api/register/phone   手机号+密码+密钥材料 → 自动登录
 *  - POST /api/register/email   邮箱+验证码+密码+密钥材料 → 自动登录
 *  - POST /api/email-code       发送 6 位邮箱验证码（purpose: im-register ／ im-login）
 *  - POST /api/login/phone      手机号+密码（响应携密钥备份，供本机恢复）
 *  - POST /api/login/email      邮箱+验证码（响应携密钥备份，供本机恢复）
 *  - POST /api/logout
 *  - GET   /api/me              资料 + 密钥目录信息
 *  - PATCH /api/me              display_name / bio / avatar_color
 *  - GET  /ws                   WebSocket 升级 —— M2 实装（docs/IM聊天方案.md §5），M1 占位 501
 *
 * E2EE（方案 §3）：服务器是「账号公钥目录 + 密文邮局」，永远不持有可解密钥——
 *   注册上传 pub_key（ECDH P-256 raw）+ enc_priv_key（登录密码 PBKDF2 包裹的私钥备份，独立 kdf_salt/iters）；
 *   登录响应下发备份，浏览器用密码本地解包恢复（换设备不丢历史）。
 * 验证码：im_email_codes 表（与 email_login_codes 隔离，防三门户同邮箱互相覆盖验证码）。
 * 实时：DO IMRoom（M2 实装 Hibernation 全量逻辑）+ RateLimiter（每 IP，模式照 workers-chat-demo）。
 * 复用：shared/portal-ui.js 认证壳（与 writer/merchant 三门户一致）；shared/phone.js E.164；worker/smtp.js 发信。
 */
import { sendMail } from '../worker/smtp.js';
import { authPage, ICO } from '../shared/portal-ui.js';
import { normalizePhone, maskPhone } from '../shared/phone.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const COOKIE_NAME = 'im_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SITE = 'https://whizzzest.com';
const IM_HOME = 'https://im.whizzzest.com';
const CONTACT_EMAIL = 'contact@whizzzest.com';

/* E2EE 密钥材料约束（方案 §3.1） */
const KDF_ITERS = 310000;
const KDF_ITERS_MIN = 100000;
const KDF_ITERS_MAX = 1000000;
const ENC_PRIV_KEY_MAX = 4096;   // base64 长度上限（iv 12B + 密文，私钥 JWK 实际 ~1.5KB）

const AVATAR_COLORS = 8;

/* 认证页门户配置（与 writer/merchant 同构，文案为 IM） */
const FAVICON_LINK = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiBwLWlkPSI4NTM4IiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB2ZXJzaW9uPSIxLjEiIHQ9IjE3NzA2Mzk4MTY5MzciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNIDUxMi44IDQyMC44IEMgMzU2IDY1NS4yIDM3MS4yIDk5Ny42IDQ2NC44IDk5OS4yIEMgNTYxLjYgMTAwMS42IDQ1MC40IDYwNSA1MTIuOCA0MjAuOCBaIE0gNDgwLjggMzk1LjIgQyAyNTMuNiA0NjkuNiA4OC44IDcwNi40IDE1MiA3NTYuOCBDIDIxNi44IDgwOC44IDM0My4yIDUzNiA0ODAuOCAzOTUuMiBaIE0gNDg3LjIgMzc2IEMgMjkwLjQgMjg4IDI0IDMzMiAzMS4yIDM5OS4yIEMgMzguNCA0NjggMzM4LjQgMzQ5LjYgNDg3LjIgMzc2IFogTSA1MTIuOCAzNTQuNCBDIDQyMy4yIDE4NC44IDIxMi44IDUzLjYgMTgxLjYgOTguNCBDIDE0OS42IDE0NC44IDQyMy4yIDI1MC40IDUxMi44IDM1NC40IFogTSA1MzEuMiAzNTQuNCBDIDYyNi40IDIyOCA2MzIgMzQuNCA1ODAuOCAyOS42IEMgNTI4IDI0LjggNTczLjYgMjUyLjggNTMxLjIgMzU0LjQgWiBNIDU0OCAzNjYuNCBDIDY5Mi44IDM2OS42IDg0My4yIDI3MiA4MjAgMjMxLjIgQyA3OTYgMTg5LjYgNjQ2LjQgMzQzLjIgNTQ4IDM2Ni40IFogTSA1NjEuNiAzOTkuMiBDIDcyMS42IDUxOC40IDk4MS42IDU2MCA5OTIuOCA1MDguOCBDIDEwMDQgNDU2IDY5My42IDQ2MCA1NjEuNiAzOTkuMiBaIE0gNTM5LjIgNDI2LjQgQyA1NjguOCA2NDIuNCA3NTAuNCA4NDQgODA0IDgwMS42IEMgODU5LjIgNzU4LjQgNTk3IDU2OCA1MzkuMiA0MjYuNCBaIiBmaWxsPSIjRTgzNTE4IiBwLWlkPSI4NTM5Ij48L3BhdGg+PHBhdGggZD0iTSBOTTkgLjIgNjIyLjQgWiIgcC1pZD0iODU0MCI+PC9wYXRoPjwvc3ZnPg==">';
const LOGO_URI = (FAVICON_LINK.match(/href="([^"]+)"/) || [])[1] || '';

const PORTAL_UI = {
  brand: '焰境密语',
  area: '加密聊天',
  home: SITE + '/',
  logoUri: LOGO_URI,
  slogan: '说给对的人，密语不过夜',
  sideSlogan: '端到端加密 · 服务器只递信，不看信',
  highlights: [
    '好友私聊与百人群组（M2/M3 陆续开放）',
    '端到端加密：密文进出，服务器不可读',
    '身份密钥本机生成，密码加密备份可换机恢复',
    '仅文字，轻量纯净',
  ],
};

/* ---------------- 入口路由 ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const baseHeaders = {
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    };

    try {
      let res;
      if (path.startsWith('/api/') || path === '/ws') {
        res = path === '/ws' ? handleWs(request, env) : await handleApi(request, env, path, url);
      } else {
        res = await handlePage(request, env, path);
      }
      Object.entries(baseHeaders).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set('content-security-policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'", // 认证页内嵌脚本 + /assets 模块文件
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' data: https://whizzzest.com",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
      return res;
    } catch (err) {
      console.error('im worker error:', err);
      return new Response('服务暂时不可用，请稍后再试。', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

async function handlePage(request, env, path) {
  if (path !== '/' && path !== '/app') return new Response('Not found', { status: 404 });
  const user = await currentUser(request, env);
  if (path === '/') {
    if (user) return redirect('/app');
    return html(authPage(PORTAL_UI, {
      titleTag: '登录 / 注册',
      entry: { href: SITE + '/', label: '前往官网' },
      panelHtml: authPanelHtml(),
      script: AUTH_PAGE_JS,
    }));
  }
  // /app：会话必需
  if (!user) return redirect('/');
  return html(appShellHtml());
}

function handleWs(request, env) {
  return json({ ok: false, error: 'not_yet', detail: 'WebSocket 实时通道随 M2 上线（docs/IM聊天方案.md §5）' }, 501);
}

/* ---------------- API 路由 ---------------- */

async function handleApi(request, env, path, url) {
  const method = request.method;

  if (path === '/api/email-code' && method === 'POST') return sendEmailCode(request, env);
  if (path === '/api/register/phone' && method === 'POST') return handleRegisterPhone(request, env);
  if (path === '/api/register/email' && method === 'POST') return handleRegisterEmail(request, env);
  if (path === '/api/login/phone' && method === 'POST') return handleLoginPhone(request, env);
  if (path === '/api/login/email' && method === 'POST') return handleLoginEmail(request, env);
  if (path === '/api/logout' && method === 'POST') return handleLogout();

  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'auth' }, 401);
  if (user.status === 'disabled') return json({ ok: false, error: 'disabled' }, 403);

  if (path === '/api/me' && method === 'GET') return handleMeGet(env, user);
  if (path === '/api/me' && method === 'PATCH') return handleMePatch(request, env, user);

  return json({ ok: false, error: 'not_found' }, 404);
}

/* ---------------- 注册 / 登录 / 会话（照 writer 门户模式） ---------------- */

async function handleRegisterPhone(request, env) {
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

async function handleRegisterEmail(request, env) {
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

async function handleLoginPhone(request, env) {
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

async function handleLoginEmail(request, env) {
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

function handleLogout() {
  const res = json({ ok: true });
  res.headers.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return res;
}

/** 登录/注册成功：JSON + HMAC 会话 Cookie（authedResponse 的 fetch 版，附密钥备份给恢复流程） */
async function authedJson(secret, uid, extra) {
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

async function currentUser(request, env) {
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

/* ---------------- 我的资料 / 密钥目录 ---------------- */

async function handleMeGet(env, user) {
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

async function handleMePatch(request, env, user) {
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

/** 登录响应附带的密钥备份（浏览器用密码本地解包，方案 §3.1 换机恢复） */
async function keyBackupFor(env, uid) {
  const row = await env.DB.prepare(
    'SELECT pub_key, enc_priv_key, kdf_salt, kdf_iters FROM im_users WHERE id = ?1'
  ).bind(uid).first();
  if (!row) return {};
  return { keys: { pub_key: row.pub_key, enc_priv_key: row.enc_priv_key, kdf_salt: row.kdf_salt, kdf_iters: row.kdf_iters } };
}

/** 注册密钥材料校验：公钥可被 WebCrypto 导入（真 P-256 点）；包裹备份与 KDF 参数在约束内 */
async function parseKeyMaterial(body) {
  const pubKey = String(body.pub_key || '');
  const encPrivKey = String(body.enc_priv_key || '');
  const kdfSalt = String(body.kdf_salt || '');
  const kdfIters = Number(body.kdf_iters);
  if (!pubKey || pubKey.length > 256 || !isB64(pubKey)) return null;
  try {
    const raw = b64ToBuf(pubKey);
    const u = new Uint8Array(raw);
    if (raw.byteLength !== 65 || u[0] !== 0x04) return null;
    await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch { return null; }
  if (!encPrivKey || encPrivKey.length > ENC_PRIV_KEY_MAX || !isB64(encPrivKey)) return null;
  if (!/^[0-9a-f]{64}$/.test(kdfSalt)) return null;
  if (!Number.isInteger(kdfIters) || kdfIters < KDF_ITERS_MIN || kdfIters > KDF_ITERS_MAX) return null;
  return { pubKey, encPrivKey, kdfSalt, kdfIters };
}

/* ---------------- 邮箱验证码（im_email_codes 独立表，照 merchant/writer 逻辑） ---------------- */

async function sendEmailCode(request, env) {
  if (!env.SMTP_USER || !env.SMTP_PASS) return json({ ok: false, error: 'config' }, 500);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const purpose = String(body.purpose || '') === 'register' ? 'im-register' : 'im-login';
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 100) return json({ ok: false, error: 'format' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('imcode:' + ip, 10 * 60 * 1000, 6)) return json({ ok: false, error: 'rate' }, 429);

  if (purpose === 'im-register') {
    const dup = await env.DB.prepare('SELECT id FROM im_users WHERE email = ?1').bind(email).first();
    if (dup) return json({ ok: false, error: 'taken' }, 400);
  } else {
    // 登录用途：邮箱未注册时不发码不落库，仍返回成功（防枚举）
    const known = await env.DB.prepare('SELECT id FROM im_users WHERE email = ?1').bind(email).first();
    if (!known) return json({ ok: true });
  }

  const last = await env.DB.prepare('SELECT created_at FROM im_email_codes WHERE email = ?1').bind(email).first();
  if (last) {
    const age = Date.now() - new Date(String(last.created_at).replace(' ', 'T') + 'Z').getTime();
    if (age < 60_000) return json({ ok: false, error: 'too_fast' }, 429);
  }

  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(100000 + (buf[0] % 900000));
  await env.DB.prepare(
    `INSERT INTO im_email_codes (email, code_hash, purpose, expires_at, attempts, created_at)
     VALUES (?1, ?2, ?3, datetime('now', '+10 minutes'), 0, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET code_hash = ?2, purpose = ?3,
       expires_at = datetime('now', '+10 minutes'), attempts = 0, created_at = datetime('now')`
  ).bind(email, await sha256Hex(code), purpose).run();

  try {
    await sendCodeEmail(env, email, code, purpose);
  } catch (err) {
    console.error('im email code send failed:', err);
    if (purpose === 'im-register') return json({ ok: false, error: 'send_failed' }, 500); // 注册场景如实报错
  }
  return json({ ok: true });
}

async function sendCodeEmail(env, email, code, purpose) {
  const action = purpose === 'im-register' ? '注册焰境密语' : '登录焰境密语';
  const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";
  await sendMail({
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    to: email,
    fromName: '焰境·万载 · 焰境密语',
    subject: `验证码（10 分钟内有效）· ${code.slice(0, 2)}${Date.now().toString(36).slice(-4)}`,
    html: `<div style="margin:0;padding:32px 16px;background:#f5f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:20px;">
  <tr><td style="padding:30px 36px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;vertical-align:middle;"><img src="${SITE}/logo.png" width="30" height="30" alt="焰境·万载" style="display:block;border:0;"></td>
      <td style="vertical-align:middle;font-family:${FONT};font-size:17px;font-weight:600;color:#1d1d1f;">焰境·万载 · 焰境密语</td>
    </tr></table>
    <div style="margin-top:24px;font-family:${FONT};font-size:15px;color:#1d1d1f;line-height:1.7;">你正在进行<b>${action}</b>操作，验证码：</div>
  </td></tr>
  <tr><td align="center" style="padding:16px 36px 4px;">
    <div style="font-family:${FONT};font-size:42px;font-weight:700;letter-spacing:12px;color:#d64524;">${code}</div>
  </td></tr>
  <tr><td style="padding:8px 36px 0;">
    <div style="font-family:${FONT};font-size:13px;color:#6e6e73;line-height:1.8;">验证码 10 分钟内有效，请勿泄露给他人。<br>若非本人操作，请忽略本邮件。</div>
  </td></tr>
  <tr><td align="center" style="padding:26px 36px 6px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:#d64524;border-radius:980px;">
        <a href="${IM_HOME}/" style="display:inline-block;padding:11px 34px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">前往焰境密语</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 36px 30px;">
    <div style="font-family:${FONT};font-size:12px;color:#86868b;line-height:1.8;">按钮无法点击？复制链接打开：<a href="${IM_HOME}/" style="color:#d64524;text-decoration:none;">im.whizzzest.com</a></div>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#fafafc;border-top:1px solid rgba(0,0,0,.06);border-radius:0 0 20px 20px;">
    <div style="font-family:${FONT};font-size:12px;color:#86868b;line-height:1.9;">焰境·万载 · 焰境密语（<a href="${SITE}/" style="color:#86868b;text-decoration:none;">whizzzest.com</a>）｜ 联系：<a href="mailto:${CONTACT_EMAIL}" style="color:#86868b;">${CONTACT_EMAIL}</a><br>本邮件由系统自动发送，请勿直接回复。</div>
  </td></tr>
</table>
</td></tr></table>
</div>`,
  });
}

async function verifyEmailCode(env, email, purpose, code) {
  const row = await env.DB.prepare(
    'SELECT code_hash, purpose, expires_at, attempts FROM im_email_codes WHERE email = ?1'
  ).bind(email).first();
  if (!row || row.purpose !== purpose || row.attempts >= 5) return 'bad';
  if (new Date(String(row.expires_at).replace(' ', 'T') + 'Z').getTime() < Date.now()) return 'expired';
  if (!timingSafeEqual(await sha256Hex(code), row.code_hash)) {
    await env.DB.prepare('UPDATE im_email_codes SET attempts = attempts + 1 WHERE email = ?1').bind(email).run();
    return 'bad';
  }
  await env.DB.prepare('DELETE FROM im_email_codes WHERE email = ?1').bind(email).run();
  return null;
}

/* ---------------- 页面：认证面板（authPage 壳）+ /app 壳 ---------------- */

function authPanelHtml() {
  // 说明：面板内 JS 一律字符串拼接，不用模板字符串（内嵌脚本反斜杠/嵌套模板坑，见 admin 先例）
  return `
  <style>
    .im-subtabs { margin: 2px 0 14px; gap: 8px; }
    .im-subtabs .atab { font-size: 13px; padding: 6px 14px; }
    .im-cc { border: 0; background: transparent; font: inherit; font-size: 14px; color: inherit; outline: none; cursor: pointer; padding-right: 4px; flex: 0 0 auto; }
    .im-code-btn { border: 0; background: rgba(214,69,36,.08); color: #d64524; font: inherit; font-size: 13px; font-weight: 600; border-radius: 9px; padding: 8px 12px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; }
    .im-code-btn:disabled { opacity: .5; cursor: default; }
    .im-note { font-size: 12.5px; color: #8a5a2b; background: #fdf6ec; border: 1px solid #f0e0c0; border-radius: 10px; padding: 10px 12px; line-height: 1.7; margin: 0; }
    .im-rec { border: 1px solid #f0d8c8; background: #fffaf6; border-radius: 12px; padding: 14px; margin-top: 4px; }
    .im-rec-tip { font-size: 12.5px; color: #8a5a3b; line-height: 1.7; margin: 0 0 10px; }
  </style>
  <div class="auth-tabs" role="tablist">
    <button type="button" class="atab active" id="mt-login">登录</button>
    <button type="button" class="atab" id="mt-reg">注册</button>
  </div>

  <form class="afcol" id="f-login" autocomplete="on">
    <div class="auth-tabs im-subtabs" role="tablist">
      <button type="button" class="atab active" id="lt-phone">手机号＋密码</button>
      <button type="button" class="atab" id="lt-email">邮箱＋验证码</button>
    </div>
    <div class="afcol" id="lp-pane-phone">
      <label class="afield"><span class="aico">${ICO.phone}</span>
        <span class="acc-wrap">
          <select class="acc-label im-cc" id="lp-cc"></select>
          <input id="lp-phone" maxlength="15" inputmode="tel" autocomplete="username" placeholder="手机号">
        </span></label>
      <label class="afield"><span class="aico">${ICO.lock}</span><input id="lp-pass" type="password" maxlength="64" autocomplete="current-password" placeholder="密码"></label>
      <button class="abtn" type="submit">登录</button>
    </div>
    <div class="afcol" id="lp-pane-email" hidden>
      <label class="afield"><span class="aico">${ICO.mail}</span><input id="le-email" type="email" maxlength="100" autocomplete="email" placeholder="邮箱"></label>
      <label class="afield"><span class="aico">${ICO.lock}</span><input id="le-code" maxlength="6" inputmode="numeric" placeholder="6 位验证码"><button type="button" class="im-code-btn" id="le-send">发验证码</button></label>
      <button class="abtn" type="submit">登录</button>
    </div>
    <div class="im-rec" id="rec-box" hidden>
      <p class="im-rec-tip">首次在本设备登录：输入登录密码，解密你的端到端加密密钥（方案 docs/IM聊天方案.md §3.1）。</p>
      <label class="afield"><span class="aico">${ICO.lock}</span><input id="rec-pass" type="password" maxlength="64" placeholder="登录密码"></label>
      <button class="abtn" type="button" id="rec-go">恢复密钥并进入</button>
    </div>
    <p class="aerr" id="err-login" style="display:none"></p>
  </form>

  <form class="afcol" id="f-reg" hidden>
    <label class="afield"><span class="aico">${ICO.key}</span><input id="rg-name" maxlength="20" placeholder="昵称（可留空，默认焰友+编号）"></label>
    <div class="auth-tabs im-subtabs" role="tablist">
      <button type="button" class="atab active" id="rt-phone">手机号注册</button>
      <button type="button" class="atab" id="rt-email">邮箱注册</button>
    </div>
    <div class="afcol" id="rp-pane-phone">
      <label class="afield"><span class="aico">${ICO.phone}</span>
        <span class="acc-wrap">
          <select class="acc-label im-cc" id="rg-cc"></select>
          <input id="rg-phone" maxlength="15" inputmode="tel" autocomplete="tel" placeholder="手机号">
        </span></label>
      <label class="afield"><span class="aico">${ICO.lock}</span><input id="rg-pass" type="password" minlength="8" maxlength="64" autocomplete="new-password" placeholder="密码（至少 8 位）"></label>
    </div>
    <div class="afcol" id="rp-pane-email" hidden>
      <label class="afield"><span class="aico">${ICO.mail}</span><input id="re-email" type="email" maxlength="100" placeholder="邮箱"></label>
      <label class="afield"><span class="aico">${ICO.lock}</span><input id="re-code" maxlength="6" inputmode="numeric" placeholder="6 位验证码"><button type="button" class="im-code-btn" id="re-send">发验证码</button></label>
      <label class="afield"><span class="aico">${ICO.lock}</span><input id="re-pass" type="password" minlength="8" maxlength="64" autocomplete="new-password" placeholder="密码（至少 8 位）"></label>
    </div>
    <p class="im-note">端到端加密：注册时本机自动生成你的专属密钥；私钥副本用<b>登录密码</b>加密后上传作备份。忘记密码且没有已登录的设备时，历史消息将不可恢复——请牢记密码。</p>
    <input type="text" name="website" value="" hidden aria-hidden="true" tabindex="-1" autocomplete="off">
    <button class="abtn" type="submit">注册并生成密钥</button>
    <p class="aerr" id="err-reg" style="display:none"></p>
  </form>`;
}

const AUTH_PAGE_JS = `
(function () {
  var ICO_ERR = { phone: '手机号格式不正确', email: '邮箱格式不正确', password: '密码至少 8 位', keys: '密钥生成失败，请换现代浏览器重试', dup: '该手机号已注册，请直接登录', taken: '该邮箱已注册，请直接登录', bad: '账号或验证码不正确', expired: '验证码已过期', rate: '操作太频繁，稍后再试', too_fast: '发送太频繁，60 秒后再试', send_failed: '验证码发送失败，请稍后再试', disabled: '账号已被停用', format: '输入格式不正确', rec_bad: '密码不正确，无法解密密钥备份' };
  function $(id) { return document.getElementById(id); }
  function showErr(id, code) { var el = $(id); el.textContent = ICO_ERR[code] || ('出错了（' + code + '）'); el.style.display = 'block'; }
  function clearErr(id) { var el = $(id); el.textContent = ''; el.style.display = 'none'; }
  function tabs(prefix, ids, onPick) {
    ids.forEach(function (k) {
      $(prefix + k).addEventListener('click', function () {
        ids.forEach(function (k2) { $(prefix + k2).classList.toggle('active', k2 === k); });
        onPick(k);
      });
    });
  }
  tabs('mt-', ['login', 'reg'], function (k) {
    $('f-login').hidden = k !== 'login';
    $('f-reg').hidden = k !== 'reg';
  });
  tabs('lt-', ['phone', 'email'], function (k) {
    $('lp-pane-phone').hidden = k !== 'phone';
    $('lp-pane-email').hidden = k !== 'email';
  });
  tabs('rt-', ['phone', 'email'], function (k) {
    $('rp-pane-phone').hidden = k !== 'phone';
    $('rp-pane-email').hidden = k !== 'email';
  });
  // 区号下拉（与 shared/phone.js 同源区号；normalizePhone 以区号识别国家）
  var CC = [['+86', '中国大陆 +86'], ['+852', '中国香港 +852'], ['+853', '中国澳门 +853'], ['+886', '中国台湾 +886'], ['+1', '美国/加拿大 +1'], ['+44', '英国 +44'], ['+81', '日本 +81'], ['+82', '韩国 +82'], ['+65', '新加坡 +65'], ['+60', '马来西亚 +60'], ['+66', '泰国 +66'], ['+61', '澳大利亚 +61']];
  ['lp-cc', 'rg-cc'].forEach(function (id) {
    CC.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c[0]; o.textContent = c[1];
      $(id).appendChild(o);
    });
  });
  function countryIso(cc) { return cc.replace('+', ''); }
  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  }
  // ---- 验证码发送（60s 冷却；报错写回各自面板） ----
  function bindSend(btnId, emailId, purpose, errId) {
    $(btnId).addEventListener('click', function () {
      var email = $(emailId).value.trim();
      if (!email) { showErr(errId, 'format'); return; }
      $(btnId).disabled = true; $(btnId).textContent = '发送中…';
      post('/api/email-code', { email: email, purpose: purpose }).then(function (r) {
        if (!r.j.ok) { showErr(errId, r.j.error); }
        var left = 60;
        var t = setInterval(function () {
          left--; $(btnId).textContent = left > 0 ? left + 's' : '发验证码';
          if (left <= 0) { clearInterval(t); $(btnId).disabled = false; }
        }, 1000);
      }).catch(function () { $(btnId).disabled = false; $(btnId).textContent = '发验证码'; });
    });
  }
  bindSend('le-send', 'le-email', 'login', 'err-login');
  bindSend('re-send', 're-email', 'register', 'err-reg');
  // ---- E2EE 密钥（/assets/js/im-crypto.js 动态加载） ----
  var imc = null;
  function cryptoMod() {
    if (!imc) imc = import('/assets/js/im-crypto.js');
    return imc;
  }
  function localIdentity() { return cryptoMod().then(function (m) { return m.loadIdentity(); }); }
  function saveIdentity(id) { return cryptoMod().then(function (m) { return m.saveIdentity(id); }); }
  function genAndWrap(password) {
    return cryptoMod().then(function (m) {
      return m.generateIdentity().then(function (id) {
        return m.wrapPrivateKey(id.privateKeyJwk, password, id.kdfSalt, id.kdfIters).then(function (enc) {
          return { pub_key: id.publicKeyB64, enc_priv_key: enc, kdf_salt: id.kdfSalt, kdf_iters: id.kdfIters, identity: id };
        });
      });
    });
  }
  function recoverWith(keys, password, uid) {
    return cryptoMod().then(function (m) {
      return m.unwrapPrivateKey(keys.enc_priv_key, password, keys.kdf_salt, keys.kdf_iters).then(function (jwk) {
        return { pub_key: keys.pub_key, privateKeyJwk: jwk, kdfSalt: keys.kdf_salt, kdfIters: keys.kdf_iters, uid: uid };
      });
    });
  }
  function finishRecover(keys, password, uid) {
    return recoverWith(keys, password, uid).then(function (id) {
      return saveIdentity(id).then(function () { location.href = '/app'; });
    }).catch(function () {
      $('rec-box').hidden = false;
      showErr('err-login', 'rec_bad');
    });
  }
  // ---- 登录提交 ----
  $('f-login').addEventListener('submit', function (e) {
    e.preventDefault();
    clearErr('err-login');
    var usePhone = !$('lp-pane-phone').hidden;
    var p;
    if (usePhone) {
      p = post('/api/login/phone', { phone: $('lp-phone').value.trim(), country: countryIso($('lp-cc').value), password: $('lp-pass').value });
    } else {
      p = post('/api/login/email', { email: $('le-email').value.trim(), code: $('le-code').value.trim() });
    }
    p.then(function (r) {
      if (!r.j.ok) { showErr('err-login', r.j.error); return; }
      var uid = r.j.uid;
      localIdentity().then(function (local) {
        // 本机已有同账号密钥 → 直接进；否则恢复（手机号路径用刚输的密码，邮箱路径请再输一次）
        if (local && local.uid === uid) { location.href = '/app'; return; }
        var password = usePhone ? $('lp-pass').value : '';
        if (password) { return finishRecover(r.j.keys, password, uid); }
        $('rec-box').hidden = false;
        $('rec-box').dataset.keys = JSON.stringify(r.j.keys);
        $('rec-box').dataset.uid = uid;
      }).catch(function () { location.href = '/app'; });
    }).catch(function () { showErr('err-login', 'format'); });
  });
  $('rec-go').addEventListener('click', function () {
    var keys = null, uid = 0;
    try { keys = JSON.parse($('rec-box').dataset.keys || 'null'); uid = Number($('rec-box').dataset.uid || 0); } catch (e) {}
    if (!keys || !uid) { location.href = '/app'; return; }
    finishRecover(keys, $('rec-pass').value, uid);
  });
  // ---- 注册提交：本机生成密钥 → 密码包裹 → 上传 → 本机留存 ----
  $('f-reg').addEventListener('submit', function (e) {
    e.preventDefault();
    clearErr('err-reg');
    var usePhone = !$('rp-pane-phone').hidden;
    var password = usePhone ? $('rg-pass').value : $('re-pass').value;
    if (password.length < 8) { showErr('err-reg', 'password'); return; }
    var btn = e.target.querySelector('.abtn');
    btn.disabled = true; btn.textContent = '正在生成端到端加密密钥…';
    var p1 = genAndWrap(password).then(function (kg) {
      var data = {
        display_name: $('rg-name').value.trim(),
        password: password,
        website: '',
        pub_key: kg.pub_key,
        enc_priv_key: kg.enc_priv_key,
        kdf_salt: kg.kdf_salt,
        kdf_iters: kg.kdf_iters,
      };
      var p2 = usePhone
        ? post('/api/register/phone', Object.assign({ phone: $('rg-phone').value.trim(), country: countryIso($('rg-cc').value) }, data))
        : post('/api/register/email', Object.assign({ email: $('re-email').value.trim(), code: $('re-code').value.trim() }, data));
      return p2.then(function (r) {
        if (!r.j.ok) { showErr('err-reg', r.j.error); btn.disabled = false; btn.textContent = '注册并生成密钥'; return null; }
        kg.identity.uid = r.j.uid;
        return saveIdentity(kg.identity).then(function () { location.href = '/app'; });
      });
    }).catch(function () {
      btn.disabled = false; btn.textContent = '注册并生成密钥';
      showErr('err-reg', 'keys');
    });
  });
})();
`;

function appShellHtml() {
  // /app 壳：会话已由服务端校验；bootstrap 数据由 /api/me 拉取
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="${LOGO_URI}">
<title>焰境密语 — 加密聊天</title>
<link rel="stylesheet" href="/assets/css/im.css">
</head>
<body class="im-app">
<div class="im-layout">
  <aside class="im-side" id="im-side"></aside>
  <main class="im-main" id="im-main"></main>
</div>
<script type="module" src="/assets/js/app.js"></script>
</body>
</html>`;
}

/* ---------------- DO：RateLimiter（workers-chat-demo 模式，最终版）+ IMRoom（M1 桩） ---------------- */

/** 每 IP 一个纯协调对象：无持久化，只关心最近请求节奏，重启丢失无碍（照 workers-chat-demo） */
export class RateLimiter {
  constructor(state, env) {
    this.nextAllowedTime = 0;
  }
  async fetch(request) {
    const now = Date.now() / 1000;
    this.nextAllowedTime = Math.max(now, this.nextAllowedTime);
    if (request.method === 'POST') this.nextAllowedTime += 5; // 一动作 5 秒
    const cooldown = Math.max(0, this.nextAllowedTime - now - 20); // 20s 宽限：允许 4-5 连发再限
    return new Response(String(cooldown));
  }
}

/** 客户端侧限流调用（M2 的 IMRoom.webSocketMessage 使用；照 workers-chat-demo RateLimiterClient） */
export class RateLimiterClient {
  constructor(getLimiterStub, reportError) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;
    this.limiter = getLimiterStub();
    this.inCooldown = false;
  }
  checkLimit() {
    if (this.inCooldown) return false;
    this.inCooldown = true;
    this.callLimiter();
    return true;
  }
  async callLimiter() {
    try {
      let response;
      try {
        response = await this.limiter.fetch('https://rate-limiter');
      } catch {
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch('https://rate-limiter');
      }
      const cooldown = +(await response.text());
      if (cooldown > 0) await new Promise((resolve) => setTimeout(resolve, cooldown * 1000));
      this.inCooldown = false;
    } catch (err) {
      this.reportError(err);
    }
  }
}

/**
 * IMRoom：每会话一实例（idFromName='c<convId>'）。
 * M1 仅提供存活桩（DO 绑定/migration 生效）；WebSocket Hibernation 全量逻辑（seq 分配/扇出/落库）
 * 随 M2 实装，设计见 docs/IM聊天方案.md §5（workers-chat-demo 模式 + D1 持久化改造）。
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

/* ---------------- 工具（照 writer 门户） ---------------- */

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function cleanDisplayName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (s.length > 20) return null;
  return s;
}

function maskEmail(email) {
  const i = email.indexOf('@');
  if (i <= 0) return '***';
  const name = email.slice(0, i);
  const head = name.slice(0, Math.min(2, name.length));
  return head + '***' + email.slice(i);
}

/* 内存限流桶（同 writer；单隔离岛内有效，够用） */
const buckets = new Map();
function limited(key, windowMs, max) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return hits.length > max;
}

async function pbkdf2Hex(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt }, key, 256);
  return toHex(bits);
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return toHex(digest);
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return toHex(sig);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { location } });
}

function isB64(s) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

function b64ToBuf(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
