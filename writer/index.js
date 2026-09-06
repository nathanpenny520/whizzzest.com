/**
 * 焰境·万载 — 文库作者门户 Worker（writer.whizzzest.com，docs/文库方案.md）
 *
 *  - GET  /register          作者注册（手机号 + 密码；与商户门户完全独立的账号体系）
 *  - GET  /login             登录（手机号+密码 或 邮箱+验证码，照抄商户门户交互）
 *  - GET  /dashboard         作品台：我的作品（状态/章节数/字数/驳回原因）+ 账号安全
 *  - GET  /book/new          新建作品（标题/分类/笔名/简介/封面）
 *  - GET  /book/<id>/edit    编辑作品元数据（内容改动 → 整本重新审核）
 *  - GET  /book/<id>/chapters        章节管理（列表：序号/状态/驳回原因）
 *  - GET  /book/<id>/chapter/new     新建章节（分段纯文本 + [图] 占位 + 插图上传）
 *  - GET  /book/<id>/chapter/<cid>   编辑章节
 *  - POST /api/register      注册 → 自动登录
 *  - POST /api/login         手机号+密码 → HMAC 会话 Cookie（wr_session）
 *  - POST /api/email-code    发送 6 位邮箱验证码（无会话=login；带会话=bind）
 *  - POST /api/login/email   邮箱+验证码登录
 *  - POST /api/bind-email    绑定/更换登录邮箱
 *  - POST /api/logout
 *  - POST /api/book          创建作品（multipart）→ 进入章节编辑
 *  - POST /api/book/<id>     更新作品元数据（multipart；整本回 pending 重审）
 *  - POST /api/book/<id>/delete        删除作品（级联章节 + R2 图片）
 *  - POST /api/book/<id>/chapter       新建章节（该章 pending；已上线作品不受影响）
 *  - POST /api/chapter/<cid>           更新章节（回 pending 重审；重传插图则整体替换）
 *  - POST /api/chapter/<cid>/delete    删除章节（不触发作品审核，即时生效）
 *
 * 审核：作品级（新建/元数据改动 → pending）+ 章节级（新章/改章 → pending，审过才可读）；
 *       admin 直接创建的作品免审。驳回原因在作品台可见。
 * 媒体：R2 桶 whizzzest-media，封面 book/c-*.jpg、插图 book/b<bookId>/…；
 *       公开读取走主站 https://whizzzest.com/media/<key>（主 Worker 代理）。
 * 邮件：验证码经 notifications@whizzzest.com（worker/smtp.js），需 secret SMTP_USER / SMTP_PASS。
 */
import { sendMail } from '../worker/smtp.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const COOKIE_NAME = 'wr_session';

const SITE = 'https://whizzzest.com';
const CONTACT_EMAIL = 'contact@whizzzest.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^1\d{10}$/;

const CATEGORIES = { novel: '小说', story: '故事', essay: '随笔', other: '其他' };
const IMG_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_FIGURES = 9;             // 每章插图上限
const MAX_IMG_BYTES = 5 * 1024 * 1024;
const MAX_CHAPTERS = 500;          // 每部作品章节上限
const MAX_BODY = 30000;            // 单章正文字符上限

const FAVICON_LINK = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiBwLWlkPSI4NTM4IiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6aHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9Ijg1MzgiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTExLjggNDIwLjhjLTE1Ni44IDIzNC40LTE0MS42IDU3Ni44LTQ4IDU3OC40IDk2LjggMi40LTE0LjQtMzk0LjQgNDgtNTc4LjR6TTQ4MC44IDM5NS4yYy0yMjcuMiA3NC40LTM5MiAzMTEuMi0zMjguOCAzNjEuNiA2NC44IDUyIDE5MS4yLTI3MiAzMjguOC0zNjEuNnpNNDg3LjIgMzc2QzI5MC40IDI4OCAyNCAzMzIgMzEuMiAzOTkuMmM3LjIgNjguOCAzMDcuMi00OS42IDQ1Ni0yMy4yek01MTIuOCAzNTQuNGMtODkuNi0xNjkuNi0zMDAtMzAwLjgtMzMxLjItMjU2LTMyIDQ2LjQgMjQxLjYgMTUyIDMzMS4yIDI1NnpNNTMxLjIgMzU0LjRjNjI2LjQgMjI4IDYzMiAzNC40IDU4MC44IDI5LjYtNTIuOC00LjgtNy4yIDIyMy4yLTQ5LjYgMzI0Ljh6TTU0OCAzNjYuNGMxNDQuOCAzLjIgMjk1LjItOTQuNCAyNzItMTM1LjItMjQtNDEuNi0xNzMuNiAxMTItMjcyIDEzNS4yek01NjEuNiAzOTkuMmMxNjAgMTE5LjIgNDIwIDE2MC44IDQzMS4yIDEwOS42IDExLjItNTIuOC0yOTkuMi00OC44LTQzMS4yLTEwOS42ek01MzkuMiA0MjYuNGMyOS42IDIxNiAyMTEuMiA0MTcuNiAyNjQuOCAzNzUuMiA1NS4yLTQzLjItMjA3LjItMjMzLjYtMjY0LjgtMzc1LjJ6IiBmaWxsPSIjRTgzNTE4IiBwLWlkPSI4NTM5Ij48L3BhdGg+PHBhdGggZD0iTTkxOS4yIDYyMi40bDE2IDMyLjggMzYgNC44LTI1LjYgMjUuNiA1LjYgMzYtMzItMTYuOC0zMiAxNi44IDYuNC0zNi0yNi40LTI1LjYgMzYtNC44ek01MjAgMzM5LjJsMTYgMzIuOCAzNiA1LjYtMjUuNiAyNC44IDUuNiAzNi0zMi0xNi44LTMyIDE2LjggNi40LTM2LTI2LjQtMjQuOCAzNi01LjZ6TTIzOS4yIDc5Mi44bDE0LjQgMzAuNCAzNC40IDQuOC0yNC44IDI0IDUuNiAzMy42LTI5LjYtMTYtMzAuNCAxNiA1LjYtMzMuNi0yNC44LTI0IDM0LjQtNC44eiIgZmlsbD0iI0Y0RDMxRiIgcC1pZD0iODU0MCI+PC9wYXRoPjxwYXRoIGQ9Ik01MjAgMzM5LjJsMTYgMzIuOCAzNiA1LjYtMjUuNiAyNC44IDUuNiAzNi0zMi0xNi44LTMyIDE2LjggNi40LTM2LTI2LjQtMjQuOCAzNi01LjZ6TTIzOS4yIDc5Mi44bDE0LjQgMzAuNCAzNC40IDQuOC0yNC44IDI0IDUuNiAzMy42LTI5LjYtMTYtMzAuNCAxNiA1LjYtMzMuNi0yNC44LTI0IDM0LjQtNC44eiIgZmlsbD0iI0Y1RTMyOCIgcC1pZD0iODU0MSI+PC9wYXRoPjwvc3ZnPg==">';

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
      if (path.startsWith('/api/')) {
        const res = await handleApi(request, env, path, url);
        Object.entries(baseHeaders).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }

      const res = await handlePage(request, env, path, url);
      Object.entries(baseHeaders).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set('content-security-policy', [
        "default-src 'self'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' data: https://whizzzest.com", // 封面/插图缩略走主站 /media/ 代理
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
      return res;
    } catch (err) {
      console.error('writer worker error:', err);
      return new Response('服务暂时不可用，请稍后再试。', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

/* ---------------- 路由 ---------------- */

async function handlePage(request, env, path, url) {
  if (path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const user = await currentUser(request, env);

  if (path === '/register') {
    if (user) return redirect('/dashboard');
    return html(registerHtml(url));
  }
  if (path === '/login') {
    if (user) return redirect('/dashboard');
    return html(loginHtml(url));
  }
  if (path === '/') return redirect(user ? '/dashboard' : '/login');

  // 以下全部需要登录
  if (!user) return redirect('/login');

  if (path === '/dashboard') return html(await dashboardHtml(env, user, url));

  let m;
  if (path === '/book/new') return html(bookFormHtml(null));
  if ((m = path.match(/^\/book\/(\d+)\/edit$/))) {
    const book = await ownedBook(env, user, Number(m[1]));
    if (!book) return redirect('/dashboard');
    return html(bookFormHtml(book));
  }
  if ((m = path.match(/^\/book\/(\d+)\/chapters$/))) {
    const book = await ownedBook(env, user, Number(m[1]));
    if (!book) return redirect('/dashboard');
    return html(await chaptersHtml(env, book, url));
  }
  if ((m = path.match(/^\/book\/(\d+)\/chapter\/new$/))) {
    const book = await ownedBook(env, user, Number(m[1]));
    if (!book) return redirect('/dashboard');
    const { results } = await env.DB.prepare(
      'SELECT COALESCE(MAX(idx), 0) + 1 next FROM book_chapters WHERE book_id = ?1'
    ).bind(book.id).all();
    const nextIdx = results?.[0]?.next || 1;
    return html(chapterFormHtml(book, null, nextIdx));
  }
  if ((m = path.match(/^\/book\/(\d+)\/chapter\/(\d+)$/))) {
    const book = await ownedBook(env, user, Number(m[1]));
    if (!book) return redirect('/dashboard');
    const ch = await env.DB.prepare(
      'SELECT * FROM book_chapters WHERE id = ?1 AND book_id = ?2'
    ).bind(Number(m[2]), book.id).first();
    if (!ch) return redirect(`/book/${book.id}/chapters`);
    return html(chapterFormHtml(book, ch, ch.idx));
  }

  return redirect('/dashboard');
}

async function handleApi(request, env, path, url) {
  const method = request.method;

  // 公开接口（自行限流）
  if (path === '/api/register' && method === 'POST') return handleRegister(request, env);
  if (path === '/api/login' && method === 'POST') return handleLogin(request, env);
  if (path === '/api/email-code' && method === 'POST') {
    const u = await currentUser(request, env);
    return sendEmailCode(request, env, u);
  }
  if (path === '/api/login/email' && method === 'POST') return handleEmailLogin(request, env);
  if (path === '/api/logout' && method === 'POST') {
    const res = json({ ok: true });
    res.headers.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return res;
  }

  // 以下接口需登录 + 同源校验
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);
  const origin = request.headers.get('origin');
  if (origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === request.headers.get('host');
    } catch { /* 非法 origin 一律拒绝 */ }
    if (!sameOrigin) return json({ ok: false, error: 'bad_origin' }, 403);
  }

  let m;
  if (path === '/api/book' && method === 'POST') return handleBookCreate(request, env, user);
  if ((m = path.match(/^\/api\/book\/(\d+)$/)) && method === 'POST') {
    return handleBookUpdate(request, env, user, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/book\/(\d+)\/delete$/)) && method === 'POST') {
    return handleBookDelete(env, user, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/book\/(\d+)\/chapter$/)) && method === 'POST') {
    return handleChapterSave(request, env, user, Number(m[1]), null);
  }
  if ((m = path.match(/^\/api\/chapter\/(\d+)$/)) && method === 'POST') {
    return handleChapterUpdate(request, env, user, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/chapter\/(\d+)\/delete$/)) && method === 'POST') {
    return handleChapterDelete(env, user, Number(m[1]));
  }
  if (path === '/api/bind-email' && method === 'POST') return handleBindEmail(request, env, user);

  return json({ ok: false, error: 'not_found' }, 404);
}

/* ---------------- 限流 ---------------- */

const buckets = new Map();
function limited(key, windowMs, max) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return hits.length > max;
}

/* ---------------- 注册 / 登录 / 会话 ---------------- */

async function handleRegister(request, env) {
  if (!env.WRITER_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('wreg:' + ip, 60 * 60 * 1000, 3)) return json({ ok: false, error: 'rate' }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'format' }, 400);
  }
  // Honeypot：机器人填了隐藏字段 → 假装成功
  if (String(body?.website || '') !== '') return json({ ok: true });

  const phone = String(body?.phone || '').replace(/\s/g, '');
  const password = String(body?.password || '');
  if (!PHONE_RE.test(phone)) return json({ ok: false, error: 'phone' }, 400);
  if (password.length < 8 || password.length > 64) return json({ ok: false, error: 'password' }, 400);

  const dup = await env.DB.prepare('SELECT id FROM writer_users WHERE phone = ?1').bind(phone).first();
  if (dup) return json({ ok: false, error: 'dup' }, 409);

  const salt = crypto.randomUUID().replace(/-/g, '');
  const hash = await pbkdf2Hex(password, salt);
  const r = await env.DB.prepare(
    'INSERT INTO writer_users (phone, pass_hash, pass_salt) VALUES (?1,?2,?3)'
  ).bind(phone, hash, salt).run();
  return authedResponse(env.WRITER_SESSION_SECRET, r.meta.last_row_id);
}

async function handleLogin(request, env) {
  if (!env.WRITER_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('wlogin:' + ip, 10 * 60 * 1000, 5)) return json({ ok: false, error: 'rate' }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'format' }, 400);
  }
  const phone = String(body?.phone || '').replace(/\s/g, '');
  const password = String(body?.password || '');

  const row = await env.DB.prepare(
    'SELECT id, pass_hash, pass_salt FROM writer_users WHERE phone = ?1'
  ).bind(phone).first();
  if (!row) return json({ ok: false, error: 'bad' }, 401);

  const hash = await pbkdf2Hex(password, row.pass_salt);
  if (!timingSafeEqual(hash, row.pass_hash)) return json({ ok: false, error: 'bad' }, 401);

  return authedResponse(env.WRITER_SESSION_SECRET, row.id);
}

function authedResponse(secret, uid) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  return hmacHex(secret, uid + '.' + exp).then((sig) => {
    const res = json({ ok: true });
    res.headers.set(
      'Set-Cookie',
      `${COOKIE_NAME}=${uid}.${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`
    );
    res.headers.set('Location', '/dashboard');
    return new Response(null, { status: 302, headers: res.headers });
  });
}

async function currentUser(request, env) {
  if (!env.WRITER_SESSION_SECRET) return null;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([0-9]+)\\.([0-9]+)\\.([a-f0-9]{64})`));
  if (!m) return null;
  const [, uid, exp, sig] = m;
  if (Number(exp) < Date.now()) return null;
  const expected = await hmacHex(env.WRITER_SESSION_SECRET, uid + '.' + exp);
  if (!timingSafeEqual(sig, expected)) return null;
  return env.DB.prepare(
    'SELECT id AS uid, phone AS login_phone, email AS login_email FROM writer_users WHERE id = ?1'
  ).bind(Number(uid)).first();
}

/* ---------------- 邮箱验证码（登录补充 / 绑定邮箱，照抄商户门户逻辑） ---------------- */

async function sendEmailCode(request, env, user) {
  if (!env.SMTP_USER || !env.SMTP_PASS) return json({ ok: false, error: 'config' }, 500);
  const purpose = user ? 'bind' : 'login';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'format' }, 400);
  }
  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 100) return json({ ok: false, error: 'format' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('wecode:' + ip, 10 * 60 * 1000, 6)) return json({ ok: false, error: 'rate' }, 429);

  if (user) {
    const dup = await env.DB.prepare(
      'SELECT id FROM writer_users WHERE email = ?1 AND id != ?2'
    ).bind(email, user.uid).first();
    if (dup) return json({ ok: false, error: 'taken' }, 400);
  } else {
    // 登录用途：邮箱未绑定任何账号时不发码、不落库，仍返回成功（防枚举）
    const known = await env.DB.prepare('SELECT id FROM writer_users WHERE email = ?1').bind(email).first();
    if (!known) return json({ ok: true });
  }

  const last = await env.DB.prepare('SELECT created_at FROM email_login_codes WHERE email = ?1').bind(email).first();
  if (last) {
    const age = Date.now() - new Date(String(last.created_at).replace(' ', 'T') + 'Z').getTime();
    if (age < 60_000) return json({ ok: false, error: 'too_fast' }, 429);
  }

  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(100000 + (buf[0] % 900000));
  await env.DB.prepare(
    `INSERT INTO email_login_codes (email, code_hash, purpose, expires_at, attempts, created_at)
     VALUES (?1, ?2, ?3, datetime('now', '+10 minutes'), 0, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET code_hash = ?2, purpose = ?3,
       expires_at = datetime('now', '+10 minutes'), attempts = 0, created_at = datetime('now')`
  ).bind(email, await sha256Hex(code), purpose).run();

  if (user) {
    try {
      await sendCodeEmail(env, email, code, purpose);
    } catch (err) {
      console.error('email code send failed:', err);
      return json({ ok: false, error: 'send_failed' }, 500);
    }
  } else {
    try {
      await sendCodeEmail(env, email, code, purpose);
    } catch (err) {
      console.error('email code send failed (login):', err);
    }
  }
  return json({ ok: true });
}

async function sendCodeEmail(env, email, code, purpose) {
  const action = purpose === 'bind' ? '绑定焰境文库邮箱' : '登录焰境文库作者中心';
  const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";
  await sendMail({
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    to: email,
    fromName: '焰境·万载文库',
    subject: '验证码（10 分钟内有效）',
    html: `<div style="margin:0;padding:32px 16px;background:#f5f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:20px;">
  <tr><td style="padding:30px 36px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;vertical-align:middle;"><img src="https://whizzzest.com/logo.png" width="30" height="30" alt="焰境·万载" style="display:block;border:0;"></td>
      <td style="vertical-align:middle;font-family:${FONT};font-size:17px;font-weight:600;color:#1d1d1f;">焰境·万载 · 焰境文库</td>
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
        <a href="https://writer.whizzzest.com/dashboard" style="display:inline-block;padding:11px 34px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">前往作者中心</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 36px 30px;">
    <div style="font-family:${FONT};font-size:12px;color:#86868b;line-height:1.8;">按钮无法点击？复制链接打开：<a href="https://writer.whizzzest.com/dashboard" style="color:#d64524;text-decoration:none;">writer.whizzzest.com/dashboard</a></div>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#fafafc;border-top:1px solid rgba(0,0,0,.06);border-radius:0 0 20px 20px;">
    <div style="font-family:${FONT};font-size:12px;color:#86868b;line-height:1.9;">焰境·万载 · 焰境文库（<a href="https://whizzzest.com/" style="color:#86868b;text-decoration:none;">whizzzest.com</a>）｜ 联系：<a href="mailto:contact@whizzzest.com" style="color:#86868b;">contact@whizzzest.com</a><br>本邮件由系统自动发送，请勿直接回复。</div>
  </td></tr>
</table>
</td></tr></table>
</div>`,
  });
}

async function verifyEmailCode(env, email, purpose, code) {
  const row = await env.DB.prepare(
    'SELECT code_hash, purpose, expires_at, attempts FROM email_login_codes WHERE email = ?1'
  ).bind(email).first();
  if (!row || row.purpose !== purpose || row.attempts >= 5) return 'bad';
  if (new Date(String(row.expires_at).replace(' ', 'T') + 'Z').getTime() < Date.now()) return 'expired';
  const okCode = timingSafeEqual(await sha256Hex(code), row.code_hash);
  if (!okCode) {
    await env.DB.prepare('UPDATE email_login_codes SET attempts = attempts + 1 WHERE email = ?1').bind(email).run();
    return 'bad';
  }
  await env.DB.prepare('DELETE FROM email_login_codes WHERE email = ?1').bind(email).run();
  return null;
}

async function handleEmailLogin(request, env) {
  if (!env.WRITER_SESSION_SECRET) return json({ ok: false, error: 'config' }, 500);
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('wlogine:' + ip, 10 * 60 * 1000, 10)) return json({ ok: false, error: 'rate' }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'format' }, 400);
  }
  const email = String(body?.email || '').trim().toLowerCase();
  const code = String(body?.code || '').replace(/\s/g, '');
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ ok: false, error: 'bad' }, 401);

  const verr = await verifyEmailCode(env, email, 'login', code);
  if (verr) return json({ ok: false, error: verr }, 401);

  const row = await env.DB.prepare('SELECT id FROM writer_users WHERE email = ?1').bind(email).first();
  if (!row) return json({ ok: false, error: 'bad' }, 401);
  return authedResponse(env.WRITER_SESSION_SECRET, row.id);
}

async function handleBindEmail(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'format' }, 400);
  }
  const email = String(body?.email || '').trim().toLowerCase();
  const code = String(body?.code || '').replace(/\s/g, '');
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ ok: false, error: 'format' }, 400);

  const dup = await env.DB.prepare(
    'SELECT id FROM writer_users WHERE email = ?1 AND id != ?2'
  ).bind(email, user.uid).first();
  if (dup) return json({ ok: false, error: 'taken' }, 400);

  const verr = await verifyEmailCode(env, email, 'bind', code);
  if (verr) return json({ ok: false, error: verr }, 401);

  try {
    await env.DB.prepare('UPDATE writer_users SET email = ?1 WHERE id = ?2').bind(email, user.uid).run();
  } catch {
    return json({ ok: false, error: 'taken' }, 400);
  }
  return json({ ok: true });
}

function maskEmail(email) {
  const i = email.indexOf('@');
  if (i <= 1) return email;
  return email.slice(0, Math.min(2, i - 1)) + '***' + email.slice(i);
}

/* ---------------- 作品 ---------------- */

/** 当前作者拥有的作品（admin 直建的 writer_id 为 NULL，作者端不可见） */
async function ownedBook(env, user, id) {
  return env.DB.prepare('SELECT * FROM books WHERE id = ?1 AND writer_id = ?2').bind(id, user.uid).first();
}

function readBookForm(form) {
  const clean = (k, max) => String(form.get(k) ?? '').trim().slice(0, max);
  return {
    title: clean('title', 80),
    category: clean('category', 20),
    author_name: clean('author_name', 40),
    intro: clean('intro', 500),
  };
}

async function handleBookCreate(request, env, user) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('wbook:' + ip, 60 * 60 * 1000, 10)) return redirect('/book/new?err=rate');

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect('/book/new?err=format');
  }
  if (String(form.get('website') || '') !== '') return redirect('/dashboard');

  const f = readBookForm(form);
  if (!f.title || !f.intro || !CATEGORIES[f.category]) return redirect('/book/new?err=fields');

  const r = await env.DB.prepare(
    `INSERT INTO books (title, category, intro, author_name, writer_id, status)
     VALUES (?1,?2,?3,?4,?5,'pending')`
  ).bind(f.title, f.category, f.intro, f.author_name || null, user.uid).run();
  const bookId = r.meta.last_row_id;

  try {
    const cover = await storeCover(env, bookId, form);
    if (cover) {
      await env.DB.prepare('UPDATE books SET cover = ?1 WHERE id = ?2').bind(cover, bookId).run();
    }
  } catch (err) {
    console.error('cover upload failed:', err);
  }

  return redirect(`/book/${bookId}/chapters?created=1`);
}

async function handleBookUpdate(request, env, user, id) {
  const book = await ownedBook(env, user, id);
  if (!book) return json({ ok: false, error: 'not_found' }, 404);

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect(`/book/${id}/edit?err=format`);
  }
  const f = readBookForm(form);
  if (!f.title || !f.intro || !CATEGORIES[f.category]) return redirect(`/book/${id}/edit?err=fields`);

  // 元数据改动 → 整本回 pending 重审（slug 保留，重审期间书架不可见）
  await env.DB.prepare(
    `UPDATE books SET title = ?1, category = ?2, intro = ?3, author_name = ?4,
      status = 'pending', reject_reason = NULL, updated_at = datetime('now') WHERE id = ?5`
  ).bind(f.title, f.category, f.intro, f.author_name || null, id).run();

  try {
    const cover = await storeCover(env, id, form);
    if (cover) {
      const old = book.cover && !book.cover.startsWith('/') ? book.cover : null;
      await env.DB.prepare('UPDATE books SET cover = ?1 WHERE id = ?2').bind(cover, id).run();
      if (old && old !== cover) await env.MEDIA.delete(old).catch(() => {});
    }
  } catch (err) {
    console.error('cover upload failed:', err);
    return redirect(`/book/${id}/edit?err=img`);
  }

  return redirect('/dashboard?saved=1');
}

async function handleBookDelete(env, user, id) {
  const book = await ownedBook(env, user, id);
  if (!book) return json({ ok: false, error: 'not_found' }, 404);
  await deleteBookCascade(env, book);
  return json({ ok: true });
}

/** 级联删除作品：章节行 + 章节插图（book/b<id>/ 前缀）+ 封面；尽力而为不回滚 */
async function deleteBookCascade(env, book) {
  const { results } = await env.DB.prepare('SELECT images FROM book_chapters WHERE book_id = ?1').bind(book.id).all();
  await env.DB.prepare('DELETE FROM book_chapters WHERE book_id = ?1').bind(book.id).run();
  await env.DB.prepare('DELETE FROM books WHERE id = ?1').bind(book.id).run();

  const keys = [];
  for (const row of results || []) keys.push(...safeImages(row.images));
  if (book.cover && !book.cover.startsWith('/')) keys.push(book.cover);
  for (const k of keys) {
    try { await env.MEDIA.delete(k); } catch (err) { console.error(`R2 cleanup failed for ${k}:`, err); }
  }
  // 前缀兜底清扫（覆盖历史遗留对象）
  try {
    let cursor;
    do {
      const list = await env.MEDIA.list({ prefix: `book/b${book.id}/`, cursor });
      await Promise.all(list.objects.map((o) => env.MEDIA.delete(o.key)));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`R2 prefix cleanup failed for book ${book.id}:`, err);
  }
}

/* ---------------- 章节 ---------------- */

const countWords = (body) => String(body || '').replace(/\[图\]/g, '').replace(/\s/g, '').length;

/** 章节变更后重算作品冗余计数并刷新 updated_at（书架「最近更新」排序依赖） */
async function refreshBookCounts(env, bookId) {
  await env.DB.prepare(
    `UPDATE books SET
       chapter_count = (SELECT COUNT(*) FROM book_chapters WHERE book_id = ?1),
       word_count = (SELECT COALESCE(SUM(word_count), 0) FROM book_chapters WHERE book_id = ?1),
       updated_at = datetime('now')
     WHERE id = ?1`
  ).bind(bookId).run();
}

async function storeFigures(env, bookId, form) {
  const files = form.getAll('figures').filter((x) => x && typeof x === 'object' && x.size > 0);
  const keys = [];
  for (let i = 0; i < Math.min(files.length, MAX_FIGURES); i++) {
    const img = await readImage(files[i]);
    if (!img) continue;
    const key = `book/b${bookId}/${Date.now().toString(36)}-${i}.${img.ext}`;
    await env.MEDIA.put(key, img.bytes, { httpMetadata: { contentType: IMG_TYPES[img.ext] } });
    keys.push(key);
  }
  return keys;
}

/** 删除一组 R2 对象（尽力而为） */
async function deleteMedia(env, keys) {
  for (const k of keys) {
    if (!k) continue;
    try { await env.MEDIA.delete(k); } catch (err) { console.error(`R2 cleanup failed for ${k}:`, err); }
  }
}

function readChapterForm(form) {
  return {
    idx: Math.max(1, Math.min(MAX_CHAPTERS, parseInt(String(form.get('idx') || ''), 10) || 1)),
    title: String(form.get('title') ?? '').trim().slice(0, 100),
    body: String(form.get('body') ?? '').replace(/\r\n/g, '\n').slice(0, MAX_BODY),
  };
}

async function handleChapterSave(request, env, user, bookId) {
  const book = await ownedBook(env, user, bookId);
  if (!book) return redirect('/dashboard');

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect(`/book/${bookId}/chapter/new?err=format`);
  }
  const f = readChapterForm(form);
  if (!f.title || !f.body.trim()) return redirect(`/book/${bookId}/chapter/new?err=fields`);

  const dup = await env.DB.prepare(
    'SELECT id FROM book_chapters WHERE book_id = ?1 AND idx = ?2'
  ).bind(bookId, f.idx).first();
  if (dup) return redirect(`/book/${bookId}/chapter/new?err=dupidx`);

  const images = await storeFigures(env, bookId, form).catch((err) => {
    console.error('figure upload failed:', err);
    return null;
  });
  if (images === null) return redirect(`/book/${bookId}/chapter/new?err=img`);
  if (!images.length && /\[图\]/.test(f.body)) return redirect(`/book/${bookId}/chapter/new?err=img`);

  await env.DB.prepare(
    `INSERT INTO book_chapters (book_id, idx, title, body, images, status, word_count)
     VALUES (?1,?2,?3,?4,?5,'pending',?6)`
  ).bind(bookId, f.idx, f.title, f.body, JSON.stringify(images), countWords(f.body)).run();
  await refreshBookCounts(env, bookId);

  return redirect(`/book/${bookId}/chapters?saved=1`);
}

async function handleChapterUpdate(request, env, user, cid) {
  const ch = await env.DB.prepare('SELECT * FROM book_chapters WHERE id = ?1').bind(cid).first();
  if (!ch) return json({ ok: false, error: 'not_found' }, 404);
  const book = await ownedBook(env, user, ch.book_id);
  if (!book) return json({ ok: false, error: 'not_found' }, 404);

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect(`/book/${book.id}/chapter/${cid}?err=format`);
  }
  const f = readChapterForm(form);
  if (!f.title || !f.body.trim()) return redirect(`/book/${book.id}/chapter/${cid}?err=fields`);

  const dup = await env.DB.prepare(
    'SELECT id FROM book_chapters WHERE book_id = ?1 AND idx = ?2 AND id != ?3'
  ).bind(book.id, f.idx, cid).first();
  if (dup) return redirect(`/book/${book.id}/chapter/${cid}?err=dupidx`);

  const oldImages = safeImages(ch.images);
  let imagesJson = ch.images;
  const hasNewFiles = form.getAll('figures').some((x) => x && typeof x === 'object' && x.size > 0);
  if (hasNewFiles) {
    const images = await storeFigures(env, book.id, form).catch((err) => {
      console.error('figure upload failed:', err);
      return null;
    });
    if (images === null) return redirect(`/book/${book.id}/chapter/${cid}?err=img`);
    if (!images.length && /\[图\]/.test(f.body)) return redirect(`/book/${book.id}/chapter/${cid}?err=img`);
    imagesJson = JSON.stringify(images);
  } else if (!oldImages.length && /\[图\]/.test(f.body)) {
    return redirect(`/book/${book.id}/chapter/${cid}?err=img`);
  }

  await env.DB.prepare(
    `UPDATE book_chapters SET idx = ?1, title = ?2, body = ?3, images = ?4,
      status = 'pending', reject_reason = NULL, word_count = ?5, updated_at = datetime('now')
     WHERE id = ?6`
  ).bind(f.idx, f.title, f.body, imagesJson, countWords(f.body), cid).run();
  await refreshBookCounts(env, book.id);

  // 重传了新图：旧的弃用对象清理
  if (hasNewFiles) {
    const keep = safeImages(imagesJson);
    await deleteMedia(env, oldImages.filter((k) => !keep.includes(k)));
  }

  return redirect(`/book/${book.id}/chapters?saved=1`);
}

async function handleChapterDelete(env, user, cid) {
  const ch = await env.DB.prepare('SELECT * FROM book_chapters WHERE id = ?1').bind(cid).first();
  if (!ch) return json({ ok: false, error: 'not_found' }, 404);
  const book = await ownedBook(env, user, ch.book_id);
  if (!book) return json({ ok: false, error: 'not_found' }, 404);

  await env.DB.prepare('DELETE FROM book_chapters WHERE id = ?1').bind(cid).run();
  await refreshBookCounts(env, book.id);
  await deleteMedia(env, safeImages(ch.images));
  return json({ ok: true });
}

/* ---------------- 图片（R2） ---------------- */

/** 魔数校验 JPEG/PNG/WebP；返回 { bytes, ext } 或 null（与商户门户同款） */
async function readImage(file) {
  if (!file || typeof file === 'string' || !file.size || file.size > MAX_IMG_BYTES) return null;
  const buf = new Uint8Array(await file.arrayBuffer());
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : isWebp ? 'webp' : null;
  return ext ? { bytes: buf, ext } : null;
}

async function storeCover(env, bookId, form) {
  const files = form.getAll('cover').filter((x) => x && typeof x === 'object' && x.size > 0);
  if (!files.length) return null;
  const img = await readImage(files[0]);
  if (!img) return null;
  const key = `book/c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${img.ext}`;
  await env.MEDIA.put(key, img.bytes, { httpMetadata: { contentType: IMG_TYPES[img.ext] } });
  return key;
}

function safeImages(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/* ---------------- 页面骨架 ---------------- */

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100vh; background: #f5f5f7; color: #1d1d1f; padding: 0 20px 60px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  header {
    max-width: 860px; margin: 0 auto; display: flex; align-items: center; gap: 12px; padding: 18px 4px;
  }
  h1 { font-size: 17px; font-weight: 600; margin-right: auto; }
  button, .btn {
    padding: 8px 16px; font-size: 13px; color: #1d1d1f; background: #fff; cursor: pointer;
    border: 1px solid rgba(0,0,0,.12); border-radius: 980px; transition: all .2s;
  }
  button:hover, .btn:hover { border-color: #d64524; color: #d64524; }
  button.primary, .btn.primary { background: #d64524; border-color: #d64524; color: #fff; }
  button.primary:hover, .btn.primary:hover { background: #b5371a; color: #fff; }
  .btn-text { color: #d64524; font-size: 13px; border: 0; background: none; padding: 0; }
  .btn-text:hover { text-decoration: underline; }
  .btn-danger { color: #d64524; }
  .wrap { max-width: 860px; margin: 0 auto; }
  .card {
    margin-top: 18px; padding: 22px 24px; background: #fff; border-radius: 18px;
    box-shadow: 0 2px 12px rgba(0,0,0,.04); display: flex; gap: 16px; align-items: flex-start;
  }
  .card .ico { font-size: 28px; line-height: 1.2; }
  .card h2 { font-size: 17px; font-weight: 600; }
  .card p { margin-top: 8px; color: #6e6e73; font-size: 14px; line-height: 1.7; }
  .card p.row { margin-top: 12px; }
  .card a { color: #d64524; }
  .state.pending h2 { color: #9a6b00; }
  .state.ok h2 { color: #1a7f37; }
  .state.bad h2 { color: #d64524; }
  .ok-line {
    margin-top: 18px; padding: 12px 16px; background: #e5f3e8; color: #1a7f37;
    border-radius: 12px; font-size: 13px;
  }
  .panel {
    margin-top: 14px; background: #fff; border-radius: 16px; padding: 20px 22px;
    box-shadow: 0 2px 12px rgba(0,0,0,.04);
  }
  .panel h3 { font-size: 13px; font-weight: 600; color: #6e6e73; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { color: #6e6e73; font-weight: 500; text-align: left; padding: 8px 0; width: 6em; vertical-align: top; }
  td { padding: 8px 0; word-break: break-word; }
  .tip { color: #6e6e73; font-size: 13px; line-height: 1.8; }
  .tip b { color: #1d1d1f; }
  .thumbs { display: flex; gap: 10px; flex-wrap: wrap; }
  .thumbs img { width: 72px; height: 96px; object-fit: cover; border-radius: 8px; background: #f5f5f7; }
  .thumbs img.land { width: 96px; height: 72px; }
  .bcard {
    margin-top: 14px; padding: 18px 20px; background: #fff; border-radius: 16px;
    box-shadow: 0 2px 12px rgba(0,0,0,.04); display: flex; gap: 16px;
  }
  .bcard .bcover {
    width: 84px; height: 112px; border-radius: 10px; background: #f0f0f2; object-fit: cover; flex: 0 0 auto;
  }
  .bcard .bcover.ph {
    display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 600; color: #b9b9be;
  }
  .bcard .bmain { flex: 1; min-width: 0; }
  .brow1 { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .brow1 .name { font-weight: 600; font-size: 16px; }
  .bmeta { margin-top: 4px; color: #86868b; font-size: 12px; }
  .bintro { margin-top: 8px; color: #6e6e73; font-size: 13px; line-height: 1.6;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ops { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .ops button { padding: 5px 12px; font-size: 12px; }
  .mst { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
  .mst-pending { background: #fbf3dd; color: #9a6b00; }
  .mst-approved { background: #e5f3e8; color: #1a7f37; }
  .mst-rejected { background: #fdeee8; color: #d64524; }
  .mst-hidden { background: #f0f0f2; color: #6e6e73; }
  .chrow { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid rgba(0,0,0,.05); font-size: 14px; }
  .chrow:last-child { border-bottom: 0; }
  .chrow .idx { color: #86868b; width: 3.5em; flex: 0 0 auto; }
  .chrow .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chrow .w { color: #86868b; font-size: 12px; flex: 0 0 auto; }
  form.card { display: block; }
  .fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; margin-top: 16px; }
  .fgrid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #6e6e73; }
  .fgrid label.wide { grid-column: 1 / -1; }
  .fgrid input, .fgrid select, .fgrid textarea {
    padding: 11px 13px; font-size: 15px; color: #1d1d1f; background: #f5f5f7;
    border: 1px solid transparent; border-radius: 12px; outline: none; font-family: inherit;
    transition: border-color .2s, background .2s;
  }
  .fgrid input:focus, .fgrid select:focus, .fgrid textarea:focus { border-color: #d64524; background: #fff; }
  .fgrid input[type="file"] { padding: 9px; font-size: 13px; }
  .fgrid textarea { resize: vertical; line-height: 1.7; }
  .inl {
    padding: 11px 13px; font-size: 15px; color: #1d1d1f; background: #f5f5f7;
    border: 1px solid transparent; border-radius: 12px; outline: none; font-family: inherit;
    transition: border-color .2s, background .2s;
  }
  .inl:focus { border-color: #d64524; background: #fff; }
  .fcol { display: flex; flex-direction: column; gap: 12px; }
  .fcol > .inl { width: 100%; }
  .tabbtn.active { background: #d64524; border-color: #d64524; color: #fff; }
  .tabbtn.active:hover { background: #b5371a; }
  .hint { font-size: 11px; color: #86868b; }
  .err-line {
    margin-top: 18px; padding: 12px 16px; background: #fdeee8; color: #d64524;
    border-radius: 12px; font-size: 13px;
  }
  @media (max-width: 640px) {
    .fgrid { grid-template-columns: 1fr; }
    .bcard { flex-direction: row; }
  }
`;

function shell(body, title = '焰境文库 · 作者中心') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${FAVICON_LINK}
<title>${esc(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
${body}
<script>
document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'out') {
    fetch('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
  }
});
</script>
</body>
</html>`;
}

const ERR_TEXT = {
  fields: '请填写带 * 的必填项',
  phone: '手机号格式不正确',
  password: '密码至少 8 位',
  dup: '该手机号已注册，请直接登录',
  dupidx: '该章节序号已存在，请换一个序号或修改原章节',
  rate: '提交过于频繁，请稍后再试',
  bad: '手机号或密码不正确',
  format: '提交内容格式有误',
  config: '服务端未配置完成，请联系站长',
  img: '插图上传失败（仅支持 JPG/PNG/WebP、单张 ≤5MB），本次未保存',
  internal: '服务器开小差了，请稍后再试',
};

function errLine(url) {
  const err = url.searchParams.get('err');
  return err ? `<div class="err-line">${esc(ERR_TEXT[err] || '提交失败，请重试')}</div>` : '';
}

/* ---------------- 注册 / 登录页 ---------------- */

function registerHtml(url) {
  return shell(`
  <header><h1>焰境文库 · 作者注册</h1><a class="btn-text" href="/login">已有账号，登录</a></header>
  <div class="wrap">
    <div class="card" style="display:block">
      <h2>把你的万载故事，写给每一位读者</h2>
      <p>注册后在「作品台」新建作品、写章节。作品与章节均需站长审核通过后才会在 whizzzest.com/library/ 上线展示。</p>
    </div>
    ${errLine(url)}
    <form class="card" id="f" style="display:block">
      <input type="hidden" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true">
      <h2 style="margin-bottom:12px">作者注册</h2>
      <div class="fcol">
        <input class="inl" id="phone" maxlength="11" inputmode="numeric" autocomplete="username" placeholder="手机号">
        <input class="inl" id="pw" type="password" minlength="8" maxlength="64" autocomplete="new-password" placeholder="设置密码（至少 8 位）">
        <button class="primary" id="go" type="submit">注册并进入作品台</button>
        <p class="err-line" id="err" style="display:none"></p>
        <p class="tip" style="font-size:12px">注册即表示同意站长对投稿内容进行审核；审核结果会显示在作品台。与商户中心账号相互独立。</p>
      </div>
    </form>
  </div>
  <script>
  (function () {
    var ERR = { phone: '手机号格式不正确', password: '密码至少 8 位', dup: '该手机号已注册，请直接登录',
      rate: '注册过于频繁，请稍后再试', format: '提交内容格式有误', config: '服务端未配置完成，请联系站长' };
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('go');
      btn.disabled = true;
      fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: document.getElementById('phone').value.trim(),
          password: document.getElementById('pw').value, website: '' }) })
        .then(function (r) {
          if (r.ok) { location.href = '/dashboard'; return; }
          return r.json().catch(function () { return {}; }).then(function (d) {
            btn.disabled = false;
            showErr((r.status === 429 ? ERR.rate : ERR[d.error]) || '注册失败，请重试');
          });
        })
        .catch(function () { btn.disabled = false; showErr('网络错误，请重试'); });
      function showErr(t) { var e = document.getElementById('err'); e.textContent = t; e.style.display = 'block'; }
    });
  })();
  </script>
  `);
}

function loginHtml(url) {
  return shell(`
  <header><h1>焰境文库 · 作者登录</h1><a class="btn-text" href="/register">没有账号？注册作者</a></header>
  <div class="wrap">
    ${errLine(url)}
    <div class="card" style="display:block">
      <h2 style="margin-bottom:12px">作者登录</h2>
      <div class="ops" style="margin-bottom:16px">
        <button type="button" class="tabbtn active" id="mt-phone">手机号 + 密码</button>
        <button type="button" class="tabbtn" id="mt-email">邮箱 + 验证码</button>
      </div>
      <form class="fcol" id="f">
        <input class="inl" id="phone" maxlength="11" inputmode="numeric" autocomplete="username" placeholder="手机号">
        <input class="inl" id="pw" type="password" autocomplete="current-password" placeholder="密码">
        <button class="primary" id="go" type="submit">登 录</button>
        <p class="err-line" id="err" style="display:none"></p>
      </form>
      <form class="fcol" id="fe" style="display:none">
        <input class="inl" id="email" type="email" placeholder="已绑定的邮箱">
        <div style="display:flex;gap:10px">
          <input class="inl" id="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" style="flex:1">
          <button class="btn" id="send" type="button">发送验证码</button>
        </div>
        <button class="primary" id="goe" type="submit">登 录</button>
        <p class="err-line" id="erre" style="display:none"></p>
        <p class="tip" style="font-size:12px">仅支持已在「作品台 → 账号安全」绑定邮箱的账号。与商户中心账号相互独立。</p>
      </form>
    </div>
  </div>
  <script>
  (function () {
    var PHONE_ERR = { bad: '手机号或密码不正确', rate: '尝试过于频繁，请 10 分钟后再试', format: '提交内容格式有误', config: '服务端未配置完成，请联系站长' };
    var EMAIL_ERR = { bad: '验证码错误或邮箱未绑定', expired: '验证码已过期，请重新发送', rate: '尝试过于频繁，请 10 分钟后再试', too_fast: '发送太频繁，请 1 分钟后再试', send_failed: '邮件发送失败，请稍后再试', format: '请输入邮箱和 6 位验证码', config: '邮件服务未配置，请联系站长' };
    function showErr(id, text) { var e = document.getElementById(id); e.textContent = text; e.style.display = 'block'; }
    function post(path, data) {
      return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { s: r.status, d: d }; }); });
    }
    function submitPost(path, data, errId, btn, msgs) {
      return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) {
          if (r.ok) { location.href = '/dashboard'; return; }
          return r.json().catch(function () { return {}; }).then(function (d) {
            btn.disabled = false;
            showErr(errId, (r.status === 429 ? msgs.rate : msgs[d.error]) || '登录失败，请重试');
          });
        })
        .catch(function () { btn.disabled = false; showErr(errId, '网络错误，请重试'); });
    }
    function switchMode(email) {
      document.getElementById('f').style.display = email ? 'none' : 'flex';
      document.getElementById('fe').style.display = email ? 'flex' : 'none';
      document.getElementById('mt-phone').classList.toggle('active', !email);
      document.getElementById('mt-email').classList.toggle('active', email);
    }
    document.getElementById('mt-phone').addEventListener('click', function () { switchMode(false); });
    document.getElementById('mt-email').addEventListener('click', function () { switchMode(true); });

    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('go');
      btn.disabled = true;
      submitPost('/api/login', { phone: document.getElementById('phone').value.trim(), password: document.getElementById('pw').value }, 'err', btn, PHONE_ERR);
    });

    document.getElementById('send').addEventListener('click', function () {
      var btn = this;
      if (btn.disabled) return;
      post('/api/email-code', { email: document.getElementById('email').value.trim() })
        .then(function (r) {
          if (r.s === 200 && r.d.ok) {
            var n = 60;
            btn.disabled = true; btn.textContent = n + 's 后重发';
            var t = setInterval(function () {
              n--;
              if (n <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '发送验证码'; return; }
              btn.textContent = n + 's 后重发';
            }, 1000);
            showErr('erre', '✅ 若该邮箱已绑定作者账号，验证码已发送（10 分钟内有效）');
            return;
          }
          showErr('erre', (r.s === 429 ? (r.d.error === 'too_fast' ? EMAIL_ERR.too_fast : EMAIL_ERR.rate) : EMAIL_ERR[r.d.error]) || '发送失败，请重试');
        })
        .catch(function () { showErr('erre', '网络错误，请重试'); });
    });

    document.getElementById('fe').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('goe');
      btn.disabled = true;
      submitPost('/api/login/email', { email: document.getElementById('email').value.trim(), code: document.getElementById('code').value.trim() }, 'erre', btn, EMAIL_ERR);
    });
  })();
  </script>
  `);
}

/* ---------------- 作品台 ---------------- */

const STATUS_LABEL = { pending: '审核中', approved: '已上线', rejected: '已驳回', hidden: '已下线' };

async function dashboardHtml(env, user, url) {
  const { results: books } = await env.DB.prepare(
    `SELECT b.*,
       (SELECT COUNT(*) FROM book_chapters c WHERE c.book_id = b.id AND c.status = 'pending') pending_ch
     FROM books b WHERE b.writer_id = ?1 ORDER BY b.id DESC`
  ).bind(user.uid).all();

  const saved = url.searchParams.get('saved');
  const list = (books || []).map((b) => {
    const cover = b.cover
      ? `<img class="bcover" loading="lazy" alt="" src="${SITE}/media/${esc(b.cover)}">`
      : '<div class="bcover ph" aria-hidden="true">书</div>';
    const meta = [
      CATEGORIES[b.category] || b.category,
      b.author_name || null,
      `${b.chapter_count || 0} 章 · ${(b.word_count || 0).toLocaleString('zh-CN')} 字`,
    ].filter(Boolean).join(' · ');
    const pendBadge = b.status === 'approved' && b.pending_ch > 0
      ? `<span class="mst mst-pending">${b.pending_ch} 章审核中</span>` : '';
    const reject = b.status === 'rejected'
      ? `<div class="bmeta" style="color:#d64524">驳回原因：${esc(b.reject_reason || '资料待完善')}</div>` : '';
    return `<div class="bcard">
      ${cover}
      <div class="bmain">
        <div class="brow1"><span class="name">${esc(b.title)}</span>
          <span class="mst mst-${esc(b.status)}">${STATUS_LABEL[b.status] || b.status}</span>${pendBadge}
          ${b.status === 'approved' && b.slug ? `<a class="btn-text" href="${SITE}/library/${esc(b.slug)}/" target="_blank" rel="noopener">查看页面 ↗</a>` : ''}
        </div>
        <div class="bmeta">${esc(meta)}</div>
        ${b.intro ? `<div class="bintro">${esc(b.intro)}</div>` : ''}
        ${reject}
        <div class="ops">
          <a class="btn" href="/book/${b.id}/chapters">章节管理</a>
          <a class="btn" href="/book/${b.id}/edit">编辑信息</a>
          <button type="button" class="btn-danger" data-del="${b.id}" data-title="${esc(b.title)}">删除</button>
        </div>
      </div>
    </div>`;
  }).join('');

  const bindEmailPanel = `
    <div class="panel">
      <h3>账号安全</h3>
      <table>
        <tr><th>登录手机号</th><td>${esc(user.login_phone || '—')}</td></tr>
        <tr><th>登录邮箱</th><td>${user.login_email ? esc(maskEmail(user.login_email)) + ' ' : ''}<button type="button" class="btn-text" id="bind-toggle">${user.login_email ? '更换' : '绑定邮箱'}</button></td></tr>
      </table>
      <p class="tip" style="margin-top:8px">绑定邮箱后，可用「邮箱 + 验证码」登录作者中心。验证码由 notifications@whizzzest.com 发送。</p>
      <div id="bindbox" style="display:none;margin-top:14px">
        <div class="ops" style="flex-wrap:wrap;align-items:center">
          <input class="inl" id="bind-email" type="email" placeholder="邮箱" style="flex:1;min-width:200px">
          <button class="btn" id="bind-send" type="button">发送验证码</button>
        </div>
        <div class="ops" style="flex-wrap:wrap;align-items:center;margin-top:10px">
          <input class="inl" id="bind-code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" style="width:10em">
          <button class="primary" id="bind-ok" type="button">确认绑定</button>
        </div>
        <p class="err-line" id="bind-err" style="display:none;margin-top:10px"></p>
      </div>
    </div>`;

  return shell(`
    <header><h1>焰境文库 · 作者中心</h1>
      <a class="btn primary" href="/book/new">+ 新建作品</a>
      <button id="out" type="button">退出</button>
    </header>
    <div class="wrap">
      ${saved ? '<div class="ok-line">✅ 已保存。作品信息更新会重新审核，通过后自动上线（已上线作品的新章节会单独审核，不影响作品展示）。</div>' : ''}
      ${url.searchParams.get('deleted') ? '<div class="ok-line">作品已删除。</div>' : ''}
      ${(books || []).length
        ? list
        : `<div class="card state pending"><span class="ico">📝</span>
            <div><h2>还没有作品</h2><p>点右上角「新建作品」，填好标题、简介和封面，然后开始写第一章。</p>
            <p class="row"><a class="btn" href="/book/new">新建作品</a></p></div>
          </div>`}
      ${bindEmailPanel}
      <div class="panel">
        <h3>创作与审核说明</h3>
        <p class="tip">· 作品信息（标题/分类/简介/封面）改动后整本重新审核；<br>
        · <b>已上线的作品不受影响</b>——新写/修改的章节单独审核，通过后读者即可阅读；<br>
        · 章节正文用空行分段，需要插图的位置单独写一行 <b>[图]</b>，上传的图片会按顺序填入；<br>
        · 审核通常 24 小时内完成，驳回原因会显示在作品卡片上。有疑问联系 <b>${CONTACT_EMAIL}</b>。</p>
      </div>
    </div>
  <script>
  (function () {
    document.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('确定删除「' + btn.getAttribute('data-title') + '」？所有章节与图片将一并删除，不可恢复。')) return;
        if (!confirm('再次确认：删除后无法找回。')) return;
        fetch('/api/book/' + btn.getAttribute('data-del') + '/delete', { method: 'POST' })
          .then(function (r) { if (r.ok) { location.href = '/dashboard?deleted=1'; return; } alert('删除失败，请重试'); })
          .catch(function () { alert('网络错误，请重试'); });
      });
    });

    var toggle = document.getElementById('bind-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var box = document.getElementById('bindbox');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    var ERR = {
      format: '请输入正确的邮箱', taken: '该邮箱已被其他作者账号绑定',
      too_fast: '发送太频繁，请 1 分钟后再试', rate: '尝试过于频繁，请 10 分钟后再试',
      send_failed: '邮件发送失败，请稍后再试', config: '邮件服务未配置，请联系站长'
    };
    function showErr(color, text) {
      var e = document.getElementById('bind-err');
      e.style.color = color; e.textContent = text; e.style.display = 'block';
    }
    function countdown(btn) {
      var n = 60;
      btn.disabled = true; btn.textContent = n + 's 后重发';
      var t = setInterval(function () {
        n--;
        if (n <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '发送验证码'; return; }
        btn.textContent = n + 's 后重发';
      }, 1000);
    }
    document.getElementById('bind-send').addEventListener('click', function () {
      var btn = this;
      fetch('/api/email-code', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('bind-email').value.trim() }) })
        .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
        .then(function (r) {
          if (r.s === 200 && r.d.ok) { countdown(btn); showErr('#1a7f37', '✅ 验证码已发送，请查收邮箱（10 分钟内有效）'); return; }
          showErr('#d64524', ERR[r.d.error] || '发送失败，请重试');
        })
        .catch(function () { showErr('#d64524', '网络错误，请重试'); });
    });
    document.getElementById('bind-ok').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      fetch('/api/bind-email', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('bind-email').value.trim(),
          code: document.getElementById('bind-code').value.trim() }) })
        .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
        .then(function (r) {
          if (r.s === 200 && r.d.ok) { location.reload(); return; }
          btn.disabled = false;
          showErr('#d64524', ({ format: '请输入邮箱和 6 位验证码', taken: '该邮箱已被其他作者账号绑定',
            bad: '验证码错误', expired: '验证码已过期，请重新发送' })[r.d.error] || '绑定失败，请重试');
        })
        .catch(function () { btn.disabled = false; showErr('#d64524', '网络错误，请重试'); });
    });
  })();
  </script>
  `);
}

/* ---------------- 作品表单 / 章节管理 ---------------- */

function bookFormHtml(book) {
  const isEdit = !!book;
  const coverThumb = book && book.cover
    ? `<div class="wide thumbs" style="grid-column:1/-1"><img src="${SITE}/media/${esc(book.cover)}" alt=""></div>`
    : '';
  return shell(`
    <header><h1>${isEdit ? '编辑作品 — ' + esc(book.title) : '新建作品'}</h1><a class="btn-text" href="/dashboard">返回作品台</a></header>
    <div class="wrap">
      <div class="ok-line">${isEdit ? '提示：保存后作品信息会重新进入审核，通过后自动上线。' : '填好作品信息后进入章节编辑；全部内容经站长审核后上线 whizzzest.com/library/。'}</div>
      <form class="card" method="post" action="${isEdit ? `/api/book/${book.id}` : '/api/book'}" enctype="multipart/form-data">
        <input type="hidden" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="fgrid">
          <label>书名 *<input name="title" maxlength="80" required value="${isEdit ? esc(book.title) : ''}"></label>
          <label>分类 *
            <select name="category">
              ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}"${isEdit && k === book.category ? ' selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label>笔名（展示在作品页，可空）<input name="author_name" maxlength="40" value="${isEdit ? esc(book.author_name || '') : ''}"></label>
          <label class="wide">简介 *（书架与详情页展示）<textarea name="intro" rows="3" maxlength="500" required>${isEdit ? esc(book.intro) : ''}</textarea></label>
          <label class="wide">封面（选填，竖版 2:3 最佳；JPG/PNG/WebP，≤5MB${isEdit ? '；不选则保留现有' : ''}）<input type="file" name="cover" accept="image/jpeg,image/png,image/webp"></label>
          ${coverThumb}
        </div>
        <div class="ops" style="margin-top:18px">
          <button class="primary" type="submit">${isEdit ? '保存并重新提交审核' : '创建作品，去写章节'}</button>
          <a class="btn" href="${isEdit ? '/dashboard' : '/dashboard'}">取消</a>
        </div>
      </form>
    </div>
  `);
}

async function chaptersHtml(env, book, url) {
  const { results: chapters } = await env.DB.prepare(
    'SELECT id, idx, title, status, reject_reason, word_count FROM book_chapters WHERE book_id = ?1 ORDER BY idx'
  ).bind(book.id).all();

  const rows = (chapters || []).map((c) => {
    const st = c.status === 'approved' ? 'mst-approved' : c.status === 'rejected' ? 'mst-rejected' : 'mst-pending';
    const reason = c.status === 'rejected' && c.reject_reason
      ? `<div class="bmeta" style="color:#d64524;margin-top:2px">驳回原因：${esc(c.reject_reason)}</div>` : '';
    return `<div class="chrow" style="flex-wrap:wrap">
      <span class="idx">第${c.idx}章</span>
      <span class="t"><a href="/book/${book.id}/chapter/${c.id}">${esc(c.title)}</a>${reason}</span>
      <span class="w">${(c.word_count || 0).toLocaleString('zh-CN')} 字</span>
      <span class="mst ${st}" style="flex:0 0 auto">${c.status === 'approved' ? '已上线' : c.status === 'rejected' ? '已驳回' : '审核中'}</span>
      <button type="button" data-del="${c.id}" class="btn-danger">删除</button>
    </div>`;
  }).join('');

  const pubLine = book.status === 'approved'
    ? '作品已上线——新写/修改的章节单独审核，通过后读者即可阅读。'
    : '作品尚未上线（' + (STATUS_LABEL[book.status] || book.status) + '），章节审核通过后随作品一起上线。';

  return shell(`
    <header><h1>章节管理 — ${esc(book.title)}</h1>
      <a class="btn-text" href="/book/${book.id}/edit">编辑信息</a>
      <a class="btn primary" href="/book/${book.id}/chapter/new">+ 新建章节</a>
    </header>
    <div class="wrap">
      ${url.searchParams.get('saved') ? '<div class="ok-line">✅ 章节已保存，进入审核。</div>' : ''}
      ${url.searchParams.get('created') ? '<div class="ok-line">✅ 作品已创建，写完第一章后即可提交审核（章节随写随存）。</div>' : ''}
      ${errLine(url)}
      <div class="panel" style="margin-top:18px"><p class="tip">${esc(pubLine)} 共 ${(chapters || []).length} 章。</p></div>
      <div class="panel">
        <h3>章节列表</h3>
        ${(chapters || []).length ? rows : '<p class="tip">还没有章节，点右上角「新建章节」开始写作。</p>'}
      </div>
    </div>
  <script>
  (function () {
    document.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('确定删除该章节？删除后不可恢复（不影响作品其余章节的上线状态）。')) return;
        fetch('/api/chapter/' + btn.getAttribute('data-del') + '/delete', { method: 'POST' })
          .then(function (r) { if (r.ok) { location.reload(); return; } alert('删除失败，请重试'); })
          .catch(function () { alert('网络错误，请重试'); });
      });
    });
  })();
  </script>
  `);
}

function chapterFormHtml(book, ch, idx) {
  const isEdit = !!ch;
  const imgs = isEdit ? safeImages(ch.images) : [];
  const thumbs = imgs.length
    ? `<div class="wide thumbs" style="grid-column:1/-1">${imgs.map((k) => `<img class="land" src="${SITE}/media/${esc(k)}" alt="" loading="lazy">`).join('')}</div>
       <p class="hint wide" style="grid-column:1/-1">以上为现有插图；重新上传会整体替换（占位 [图] 按新图顺序填入）。</p>`
    : '';
  return shell(`
    <header><h1>${isEdit ? '编辑章节 — ' + esc(ch.title) : '新建章节'} — ${esc(book.title)}</h1><a class="btn-text" href="/book/${book.id}/chapters">返回章节列表</a></header>
    <div class="wrap">
      <div class="ok-line">保存后该章进入审核（已上线作品不受影响，新章审过即对读者可见）。</div>
      <form class="card" method="post" action="${isEdit ? `/api/chapter/${ch.id}` : `/api/book/${book.id}/chapter`}" enctype="multipart/form-data">
        <input type="hidden" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="fgrid">
          <label>章节序号 *（阅读页按序号排列）<input name="idx" type="number" min="1" max="500" value="${idx}" required></label>
          <label>章节标题 *<input name="title" maxlength="100" required value="${isEdit ? esc(ch.title) : ''}"></label>
          <label class="wide">正文 *（空行分段；需要插图的位置单独写一行 <b>[图]</b>，下方图片按顺序填入）
            <textarea name="body" id="body" rows="16" maxlength="30000" required placeholder="第一段……&#10;&#10;[图]&#10;&#10;第二段……">${isEdit ? esc(ch.body) : ''}</textarea>
          </label>
          <label class="wide">插图（最多 ${MAX_FIGURES} 张，按 [图] 出现顺序填入；JPG/PNG/WebP，单张 ≤5MB）
            <input type="file" name="figures" accept="image/jpeg,image/png,image/webp" multiple></label>
          ${thumbs}
        </div>
        <p class="hint" style="margin-top:10px">当前字数（不含图）：<b id="wc">${isEdit ? (ch.word_count || 0).toLocaleString('zh-CN') : 0}</b></p>
        <div class="ops" style="margin-top:14px">
          <button class="primary" type="submit">保存并提交审核</button>
          <a class="btn" href="/book/${book.id}/chapters">取消</a>
        </div>
      </form>
    </div>
  <script>
  (function () {
    var ta = document.getElementById('body');
    var wc = document.getElementById('wc');
    ta.addEventListener('input', function () {
      wc.textContent = ta.value.replace(/\\[图\\]/g, '').replace(/\\s/g, '').length.toLocaleString('zh-CN');
    });
  })();
  </script>
  `);
}

/* ---------------- 工具 ---------------- */

async function pbkdf2Hex(password, saltHex) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt }, key, 256
  );
  return toHex(bits);
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return toHex(digest);
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
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

function redirect(path) {
  return new Response(null, { status: 302, headers: { location: path } });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
