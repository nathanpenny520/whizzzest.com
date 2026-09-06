/**
 * 焰境·万载 — 管理后台 Worker（admin.whizzzest.com，整域即后台）
 *
 * 安全层次：Cloudflare Access（第一道门，dashboard 开通）→ 本应用密码登录（第二道门）
 *  - GET  /login                 登录页
 *  - GET  /                      管理页（留言列表）
 *  - POST /api/login             密码登录 → 签名会话 Cookie（HttpOnly/Secure/SameSite=Strict）
 *  - POST /api/logout            退出登录
 *  - GET  /api/messages          留言列表（?filter=unread|all&offset=0），含 total/unread 计数
 *  - POST /api/messages/:id/read 标记已读/未读 {read: true|false}
 *  - DELETE /api/messages/:id    删除留言
 *
 * 会话：无状态 HMAC 签名（过期时间戳 + 签名），改 ADMIN_SESSION_SECRET 即全体下线。
 * 凭据：wrangler secret 配 ADMIN_PASSWORD / ADMIN_SESSION_SECRET，不进代码、不进仓库。
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const COOKIE_NAME = 'wa_session';
const PAGE_SIZE = 50;
// 后台页内嵌 favicon（32px PNG data URI——Safari 不认 SVG 图标）
const FAVICON_LINK = '<link rel="icon" type="image/png" href="data:image/png;base64,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">';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // 全站响应统一带安全头
    const baseHeaders = {
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    };

    try {
      if (path.startsWith('/api/')) {
        const res = await handleApi(request, env, path);
        Object.entries(baseHeaders).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }

      const res = await handlePage(request, env, path);
      Object.entries(baseHeaders).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set('content-security-policy', [
        "default-src 'self'",
        "script-src 'unsafe-inline'", // MVP：内联脚本，无外部依赖
        "style-src 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
      return res;
    } catch (err) {
      console.error('admin worker error:', err);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  },
};

/* ---------------- 路由 ---------------- */

async function handlePage(request, env, path) {
  if (path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (path === '/login') return html(LOGIN_HTML);

  if (path === '/') {
    if (!(await isAuthed(request, env))) return redirect('/login');
    return html(APP_HTML);
  }
  return redirect('/');
}

function redirect(path) {
  return new Response(null, { status: 302, headers: { location: path } });
}

async function handleApi(request, env, path) {
  const method = request.method;

  // 登录：限流 + 验密
  if (path === '/api/login' && method === 'POST') return handleLogin(request, env);
  if (path === '/api/logout' && method === 'POST') {
    const res = json({ ok: true });
    res.headers.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return res;
  }

  // 其余 API 一律先过会话
  if (!(await isAuthed(request, env))) return json({ ok: false, error: 'unauthorized' }, 401);

  // 变更请求校验来源（配合 SameSite=Strict 双保险）
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== 'https://admin.whizzzest.com') {
      return json({ ok: false, error: 'bad_origin' }, 403);
    }
  }

  let m;
  if ((m = path.match(/^\/api\/messages\/(\d+)\/read$/)) && method === 'POST') {
    return setRead(env, Number(m[1]), request);
  }
  if ((m = path.match(/^\/api\/messages\/(\d+)$/)) && method === 'DELETE') {
    return removeMessage(env, Number(m[1]));
  }
  if (path === '/api/messages' && method === 'GET') {
    return listMessages(env, request);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

/* ---------------- 登录 / 会话 ---------------- */

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX = 5;

function loginLimited(ip) {
  const now = Date.now();
  const hits = (loginAttempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  hits.push(now);
  loginAttempts.set(ip, hits);
  if (loginAttempts.size > 5000) loginAttempts.clear();
  return hits.length > LOGIN_MAX;
}

async function handleLogin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ ok: false, error: 'config_missing' }, 500);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && loginLimited(ip)) return json({ ok: false, error: 'rate_limited' }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const given = await sha256Hex(String(body?.password ?? ''));
  const expected = await sha256Hex(env.ADMIN_PASSWORD);
  if (!timingSafeEqual(given, expected)) {
    return json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmacHex(env.ADMIN_SESSION_SECRET, exp);
  const res = json({ ok: true });
  res.headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`
  );
  return res;
}

async function isAuthed(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() || !sig) return false;
  const expected = await hmacHex(env.ADMIN_SESSION_SECRET, exp);
  return timingSafeEqual(sig, expected);
}

/* ---------------- 留言管理（D1） ---------------- */

const MSG_FIELDS = 'id, name, email, message, ip, user_agent, created_at, read_at';

async function listMessages(env, request) {
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('filter') === 'unread';
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const counts = await env.DB
    .prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM messages')
    .first();

  const sql = unreadOnly
    ? `SELECT ${MSG_FIELDS} FROM messages WHERE read_at IS NULL ORDER BY id DESC LIMIT ?1 OFFSET ?2`
    : `SELECT ${MSG_FIELDS} FROM messages ORDER BY id DESC LIMIT ?1 OFFSET ?2`;
  const { results } = await env.DB.prepare(sql).bind(PAGE_SIZE, offset).all();

  return json({ ok: true, total: counts?.total || 0, unread: counts?.unread || 0, messages: results || [] });
}

async function setRead(env, id, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  const read = body?.read !== false;
  const { meta } = await env.DB
    .prepare('UPDATE messages SET read_at = CASE WHEN ?2 = 1 THEN datetime(\'now\') ELSE NULL END WHERE id = ?1')
    .bind(id, read ? 1 : 0)
    .run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
}

async function removeMessage(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM messages WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
}

/* ---------------- 工具 ---------------- */

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return toHex(sig);
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return toHex(digest);
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

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/* ---------------- 页面 ---------------- */

const LOGIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${FAVICON_LINK}
<title>登录 — 焰境·万载 后台</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0b0b0e; color: #e8e8ec;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: min(360px, calc(100vw - 48px)); padding: 40px 32px;
    background: #16161b; border: 1px solid #26262e; border-radius: 16px;
  }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: .02em; }
  p.sub { color: #8a8a96; font-size: 13px; margin: 6px 0 28px; }
  label { display: block; font-size: 13px; color: #8a8a96; margin-bottom: 8px; }
  input {
    width: 100%; padding: 12px 14px; font-size: 15px; color: #e8e8ec;
    background: #0b0b0e; border: 1px solid #33333d; border-radius: 10px; outline: none;
  }
  input:focus { border-color: #d64524; }
  button {
    width: 100%; margin-top: 20px; padding: 12px; font-size: 15px; font-weight: 600;
    color: #fff; background: #d64524; border: 0; border-radius: 10px; cursor: pointer;
  }
  button:hover { background: #e8552f; }
  button:disabled { opacity: .5; cursor: default; }
  .err { display: none; margin-top: 16px; color: #ff7a5c; font-size: 13px; }
</style>
</head>
<body>
<form class="card" id="f">
  <h1>焰境·万载 · 管理后台</h1>
  <p class="sub">whizzzest.com 联系表单留言管理</p>
  <label for="pw">管理密码</label>
  <input id="pw" type="password" autocomplete="current-password" required autofocus>
  <button id="btn" type="submit">登 录</button>
  <div class="err" id="err"></div>
</form>
<script>
var f = document.getElementById('f');
f.addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = document.getElementById('btn');
  var err = document.getElementById('err');
  btn.disabled = true; err.style.display = 'none';
  fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('pw').value })
  }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
    .then(function (r) {
      if (r.s === 200 && r.d.ok) { location.href = '/'; return; }
      var msg = r.d.error === 'rate_limited' ? '尝试过于频繁，请 10 分钟后再试'
        : r.d.error === 'config_missing' ? '服务端未配置凭据'
        : r.d.error === 'invalid_credentials' ? '密码不正确' : '登录失败，请重试';
      err.textContent = msg; err.style.display = 'block'; btn.disabled = false;
    })
    .catch(function () { err.textContent = '网络错误，请重试'; err.style.display = 'block'; btn.disabled = false; });
});
</script>
</body>
</html>`;

const APP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${FAVICON_LINK}
<title>留言管理 — 焰境·万载 后台</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    background: #0b0b0e; color: #e8e8ec; padding: 0 20px 60px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px;
    padding: 18px 0; background: rgba(11,11,14,.85); backdrop-filter: blur(12px);
    border-bottom: 1px solid #1e1e26;
  }
  h1 { font-size: 17px; font-weight: 600; margin-right: auto; }
  h1 span { color: #8a8a96; font-weight: 400; font-size: 13px; margin-left: 8px; }
  button {
    padding: 7px 14px; font-size: 13px; color: #e8e8ec; background: #1c1c23;
    border: 1px solid #33333d; border-radius: 8px; cursor: pointer;
  }
  button:hover { border-color: #d64524; color: #fff; }
  button.primary { background: #d64524; border-color: #d64524; color: #fff; }
  button.primary:hover { background: #e8552f; }
  .tabs { display: flex; gap: 8px; margin: 20px 0 4px; }
  .tab {
    padding: 7px 16px; font-size: 13px; color: #8a8a96; background: none;
    border: 1px solid #26262e; border-radius: 999px; cursor: pointer;
  }
  .tab.active { color: #fff; background: #1c1c23; border-color: #d64524; }
  .stats { color: #8a8a96; font-size: 13px; margin: 12px 0 0; }
  .list { max-width: 860px; }
  .msg {
    margin-top: 16px; padding: 18px 20px; background: #16161b;
    border: 1px solid #26262e; border-left: 3px solid #d64524; border-radius: 12px;
  }
  .msg.read { border-left-color: #33333d; }
  .row1 { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .name { font-weight: 600; font-size: 15px; }
  .email a { color: #8ab4ff; font-size: 13px; text-decoration: none; }
  .email a:hover { text-decoration: underline; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #d64524; margin-left: auto; }
  .msg.read .dot { background: #33333d; }
  .time { color: #8a8a96; font-size: 12px; margin-top: 2px; }
  .body { margin: 12px 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .meta { color: #55555f; font-size: 12px; word-break: break-all; }
  .ops { display: flex; gap: 8px; margin-top: 14px; }
  .ops button { padding: 5px 12px; font-size: 12px; }
  .empty { color: #8a8a96; text-align: center; padding: 80px 0; font-size: 14px; }
  .more { display: block; margin: 24px auto 0; }
</style>
</head>
<body>
<header>
  <h1>焰境·万载 · 后台<span>whizzzest.com</span></h1>
  <button id="refresh" type="button">刷新</button>
  <button id="logout" type="button">退出</button>
</header>
<div class="tabs">
  <button class="tab active" id="tab-unread" type="button">未读</button>
  <button class="tab" id="tab-all" type="button">全部</button>
</div>
<p class="stats" id="stats"></p>
<div class="list" id="list"><p class="empty">加载中…</p></div>
<button class="more" id="more" type="button" style="display:none">加载更多</button>

<script>
var state = { filter: 'unread', offset: 0, total: 0, unread: 0 };

function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtTime(utc) {
  if (!utc) return '';
  var d = new Date(utc.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return utc;
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function api(path, opts) {
  return fetch(path, opts).then(function (r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    return r.json().then(function (d) {
      if (!r.ok || d.ok === false) throw new Error(d.error || r.status);
      return d;
    });
  });
}

function load(reset) {
  if (reset) { state.offset = 0; el('list').innerHTML = '<p class="empty">加载中…</p>'; }
  var q = '?filter=' + state.filter + '&offset=' + state.offset;
  api('/api/messages' + q).then(function (d) {
    state.total = d.total; state.unread = d.unread;
    el('stats').textContent = '共 ' + d.total + ' 条留言，未读 ' + d.unread + ' 条';
    var list = d.messages || [];
    var box = el('list');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">' + (state.filter === 'unread' ? '没有未读留言 🎉' : '还没有留言') + '</p>';
    } else {
      list.forEach(function (m) { box.appendChild(render(m)); });
    }
    el('more').style.display = (state.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('list').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function render(m) {
  var div = document.createElement('div');
  div.className = 'msg' + (m.read_at ? ' read' : '');
  var emailHtml = m.email
    ? '<div class="email"><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a></div>' : '';
  div.innerHTML =
    '<div class="row1"><span class="name">' + esc(m.name) + '</span>' + emailHtml + '<span class="dot"></span></div>' +
    '<div class="time">' + esc(fmtTime(m.created_at)) + (m.read_at ? ' · 已读' : ' · 未读') + '</div>' +
    '<div class="body">' + esc(m.message) + '</div>' +
    '<div class="meta">IP ' + esc(m.ip || '—') + ' · ' + esc(m.user_agent || '') + '</div>' +
    '<div class="ops"><button type="button" data-act="read">' + (m.read_at ? '标为未读' : '标为已读') + '</button>' +
    '<button type="button" data-act="del">删除</button></div>';
  var ops = div.querySelector('.ops');
  ops.addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'read') {
      api('/api/messages/' + m.id + '/read', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read: !m.read_at })
      }).then(function () { load(true); });
    } else if (act === 'del') {
      if (!confirm('确定删除 ' + m.name + ' 的这条留言？不可恢复。')) return;
      api('/api/messages/' + m.id, { method: 'DELETE' }).then(function () { load(true); });
    }
  });
  return div;
}

el('tab-unread').addEventListener('click', function () {
  state.filter = 'unread';
  el('tab-unread').classList.add('active'); el('tab-all').classList.remove('active');
  load(true);
});
el('tab-all').addEventListener('click', function () {
  state.filter = 'all';
  el('tab-all').classList.add('active'); el('tab-unread').classList.remove('active');
  load(true);
});
el('refresh').addEventListener('click', function () { load(true); });
el('more').addEventListener('click', function () { state.offset += ${PAGE_SIZE}; load(false); });
el('logout').addEventListener('click', function () {
  api('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
});

load(true);
</script>
</body>
</html>`;
