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
 * 访客分析（数据来自主站 Worker 写入的 visits 表）：
 *  - GET  /api/stats             概览：今日/7天/累计 PV·UV + 热门页面/来源/国家（7天）
 *  - GET  /api/visitors          访客列表（?offset=0），按匿名 Cookie ID / IP 分组
 *  - GET  /api/visitors/:gid     单个访客的完整访问轨迹
 *
 * 会话：无状态 HMAC 签名（过期时间戳 + 签名），改 ADMIN_SESSION_SECRET 即全体下线。
 * 凭据：wrangler secret 配 ADMIN_PASSWORD / ADMIN_SESSION_SECRET，不进代码、不进仓库。
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const COOKIE_NAME = 'wa_session';
const PAGE_SIZE = 50;
// 后台页内嵌 favicon（32px PNG data URI——Safari 不认 SVG 图标）
const FAVICON_LINK = '<link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAAgoAMABAAAAAEAAAAgAAAAAKyGYvMAAAGfaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjEwMjQ8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+MTAyNDwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgpVgmNYAAADxklEQVRYCe1VXWxURRT+7s/u9m9FqcVAKG2hjVFCYqgajVWexKgRSYySmBhDSUxQolEg+ID4AMYHMUXrCxqKJgUFH8QoD0olhIgRElQCWK22YIWmxe52u3v37/7M8dxZvO3tLdBdS3jpPNx75vx855szZ2YU4oEbONRiclunTyL17hvFhFzT109AEFJtW2B8tB0iORIItv/uQ/7oN4BwArZSFR4BEqOAYiLc3ILs/g7EVi2D+eMRP65lQSmvYD8vzG8vYXYZSYDMbl7YECIPLUf1vqOIPPgIEuufR+bz3WOwtgWtrpEJKJ6O8jnA+R8VcZuwMOz/BO9v/nycYmueoMyBTqlL793J8p6CXQhKf/ohxVofJyc+7MUUK2BigDDzJHJZItvyTOn9HWSd66Vs10FyEnGyes5S/KWn6Z8V91Du2HeeXymC4gbZvb8h++VeWGdOQgwPgSwTSkUVtPkN3BP387Y8CoQHAF2H6Msj//0h6E2LUbb8Se6JSm87ShEUchxKbFojG06bWwutvhEhBtcW3g59QYPEFIlRUMM+2Xxaah3U6luhRmeVki8QIytA2QzADaZURgF1rMPNn35A9otOVLa+xls1CCUUglrWgFzXAVjdp6S/Xt8EvW4RtHkLoN42D0qkLJDkagpJYDKH9K42pDt24OYdnXCT5I58C722nrdBRfjuFth/9SJ/+Gvkj3XBOf8nnyKTK1OD6PqtiLQ8PBnk5LpA43B3J7dvpoGmEBm735Pm1M53yNjVRs7oCMVWP0b2QL8vzBmJkfX7GTJ/OU6uXMwInALj4/c5eZjiL6wkbkYix6bhVcvI+OQDiTv69kY5d8lMx/ARMLtP0eC9c2nogTqy/vhV4tv9fTTYXMME2gvzwYs01FJP8bVPkcgYlzkIshIHyYp/RiSC98nViI51HO+QewWL2CVUvbwFeuMdcs/cIypSSchGZY3GjRbd+BY34ldIbn1VNq/rKHKn4aRP+G5JCXCNjz7ersy6BVXrNqPimVZPbV84Lx8fMpKernzFs7D7emC0b4NWuxBVa19HeM4Gtrsvu29NXsyVBB+B6Ctvsp8FcvqhaPMlGCXi/FdkFcaDuL5q9Rw453o4r2AXbbx5yrKPgBvlZA/DSrYjUrOHHz33suFV8eNDGcMPyrrK517060qYBQiokfsQnl3HyflS4qHOrinA8lN8PUaAgLvqwsoL6UJLmpmFBqWs/HrkR4DAxCyhxUtx04Zt0O+8a6JpWuZXvIqnBX0KIMWdmSkAFusyQ2CmAjMVmKnADa/AvwgPPxERb4uLAAAAAElFTkSuQmCC">';

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

  if (path === '/api/stats' && method === 'GET') return statsOverview(env);
  if (path === '/api/visitors' && method === 'GET') return listVisitors(env, request);
  if ((m = path.match(/^\/api\/visitors\/([A-Za-z0-9:%._-]+)$/)) && method === 'GET') {
    return visitorDetail(env, decodeURIComponent(m[1]));
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

/* ---------------- 访客分析（D1 visits） ---------------- */

// 北京时区「今日零点」的 UTC 表达（D1 created_at 存 UTC）
const BJ_TODAY = "datetime('now','+8 hours','start of day','-8 hours')";
const BJ_WEEK = "datetime('now','+8 hours','start of day','-8 hours','-6 days')";
// 访客分组：优先匿名 Cookie ID；无 Cookie 时按 IP 归组（gid 前缀 anon:）
const GID = "COALESCE(NULLIF(vid,''),'anon:'||COALESCE(ip,'x'))";

async function statsOverview(env) {
  const db = env.DB;
  const [today, week, total, pages, refs, countries] = await Promise.all([
    db.prepare(`SELECT COUNT(*) pv, COUNT(DISTINCT ${GID}) uv FROM visits WHERE created_at >= ${BJ_TODAY}`).first(),
    db.prepare(`SELECT COUNT(*) pv FROM visits WHERE created_at >= ${BJ_WEEK}`).first(),
    db.prepare(`SELECT COUNT(*) pv, COUNT(DISTINCT ${GID}) uv FROM visits`).first(),
    db.prepare(`SELECT path, COUNT(*) n FROM visits WHERE created_at >= ${BJ_WEEK} GROUP BY path ORDER BY n DESC LIMIT 8`).all(),
    db.prepare(`SELECT COALESCE(NULLIF(referrer,''),'直接访问') ref, COUNT(*) n FROM visits WHERE created_at >= ${BJ_WEEK} GROUP BY ref ORDER BY n DESC LIMIT 8`).all(),
    db.prepare(`SELECT COALESCE(NULLIF(country,''),'未知') country, COUNT(*) n FROM visits WHERE created_at >= ${BJ_WEEK} GROUP BY country ORDER BY n DESC LIMIT 8`).all(),
  ]);
  return json({
    ok: true,
    today_pv: today?.pv || 0,
    today_uv: today?.uv || 0,
    week_pv: week?.pv || 0,
    total_pv: total?.pv || 0,
    total_uv: total?.uv || 0,
    top_pages: pages.results || [],
    top_refs: refs.results || [],
    top_countries: countries.results || [],
  });
}

async function listVisitors(env, request) {
  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const { results } = await env.DB
    .prepare(
      `SELECT ${GID} gid, COUNT(*) n, MIN(created_at) first, MAX(created_at) last,
              MAX(country) country, MAX(device) device
       FROM visits GROUP BY gid ORDER BY last DESC LIMIT ?1 OFFSET ?2`
    )
    .bind(PAGE_SIZE, offset)
    .all();
  const total = (await env.DB.prepare(`SELECT COUNT(DISTINCT ${GID}) n FROM visits`).first())?.n || 0;

  return json({ ok: true, total, visitors: results || [] });
}

async function visitorDetail(env, gid) {
  const where = `${GID} = ?1`;
  const summary = await env.DB
    .prepare(`SELECT COUNT(*) n, MIN(created_at) first, MAX(created_at) last FROM visits WHERE ${where}`)
    .bind(gid)
    .first();
  const { results } = await env.DB
    .prepare(
      `SELECT path, referrer, country, device, created_at FROM visits WHERE ${where} ORDER BY created_at DESC LIMIT 200`
    )
    .bind(gid)
    .all();
  return json({ ok: true, gid, n: summary?.n || 0, first: summary?.first, last: summary?.last, views: results || [] });
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
  /* 访客分析 */
  .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 20px 0; }
  .card2 { background: #16161b; border: 1px solid #26262e; border-radius: 12px; padding: 18px 14px; text-align: center; }
  .card2 b { display: block; font-size: 24px; font-weight: 600; }
  .card2 span { display: block; margin-top: 4px; color: #8a8a96; font-size: 12px; }
  .tops { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .top { background: #16161b; border: 1px solid #26262e; border-radius: 12px; padding: 16px 18px; }
  .top h3 { font-size: 13px; color: #8a8a96; font-weight: 600; margin-bottom: 10px; }
  .top li { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 7px 0; border-bottom: 1px solid #1e1e26; word-break: break-all; }
  .top li:last-child { border-bottom: 0; }
  .top li b { color: #d64524; flex-shrink: 0; }
  .top li.dim, .dim { color: #55555f; }
  .sec { margin: 28px 0 4px; font-size: 14px; color: #8a8a96; font-weight: 600; }
  .vrow { margin-top: 12px; padding: 14px 18px; background: #16161b; border: 1px solid #26262e; border-radius: 12px; cursor: pointer; }
  .vrow:hover { border-color: #d64524; }
  .vrow .r1 { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
  .vrow .vid { font-family: ui-monospace, Menlo, monospace; color: #e8e8ec; }
  .vrow .dim { color: #8a8a96; }
  .vrow .n { margin-left: auto; color: #d64524; font-weight: 600; }
  .vdetail { padding: 4px 18px 14px; }
  .vdetail table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .vdetail th { color: #8a8a96; font-weight: 600; text-align: left; }
  .vdetail td, .vdetail th { padding: 6px 8px; border-bottom: 1px solid #1e1e26; text-align: left; color: #c9c9d2; word-break: break-all; }
  @media (max-width: 860px) {
    .cards { grid-template-columns: repeat(2, 1fr); }
    .tops { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <h1>焰境·万载 · 后台<span>whizzzest.com</span></h1>
  <button id="vtab-msg" class="tab active" type="button">留言</button>
  <button id="vtab-visit" class="tab" type="button">访客</button>
  <button id="refresh" type="button">刷新</button>
  <button id="logout" type="button">退出</button>
</header>
<div id="view-msg">
  <div class="tabs">
    <button class="tab active" id="tab-unread" type="button">未读</button>
    <button class="tab" id="tab-all" type="button">全部</button>
  </div>
  <p class="stats" id="stats"></p>
  <div class="list" id="list"><p class="empty">加载中…</p></div>
  <button class="more" id="more" type="button" style="display:none">加载更多</button>
</div>
<div id="view-visit" style="display:none">
  <div class="cards">
    <div class="card2"><b id="s-today-pv">–</b><span>今日浏览</span></div>
    <div class="card2"><b id="s-today-uv">–</b><span>今日访客</span></div>
    <div class="card2"><b id="s-week-pv">–</b><span>近 7 天浏览</span></div>
    <div class="card2"><b id="s-total-pv">–</b><span>总浏览</span></div>
    <div class="card2"><b id="s-total-uv">–</b><span>总访客</span></div>
  </div>
  <div class="tops">
    <div class="top"><h3>热门页面（近 7 天）</h3><ul id="top-pages"></ul></div>
    <div class="top"><h3>来源网站（近 7 天）</h3><ul id="top-refs"></ul></div>
    <div class="top"><h3>国家 / 地区（近 7 天）</h3><ul id="top-countries"></ul></div>
  </div>
  <h3 class="sec">访客列表（点击展开访问轨迹）</h3>
  <div class="list" id="vlist"><p class="empty">加载中…</p></div>
  <button class="more" id="vmore" type="button" style="display:none">加载更多</button>
</div>

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
el('refresh').addEventListener('click', function () {
  if (currentView === 'visit') { loadStats(); loadVisitors(true); } else { load(true); }
});
el('more').addEventListener('click', function () { state.offset += ${PAGE_SIZE}; load(false); });
el('logout').addEventListener('click', function () {
  api('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
});

/* ---------- 访客分析 ---------- */
var currentView = 'msg';
var vOffset = 0;

function showView(v) {
  currentView = v;
  el('view-msg').style.display = v === 'msg' ? '' : 'none';
  el('view-visit').style.display = v === 'visit' ? '' : 'none';
  el('vtab-msg').classList.toggle('active', v === 'msg');
  el('vtab-visit').classList.toggle('active', v === 'visit');
  if (v === 'visit') { loadStats(); loadVisitors(true); }
}
el('vtab-msg').addEventListener('click', function () { showView('msg'); });
el('vtab-visit').addEventListener('click', function () { showView('visit'); });

function loadStats() {
  api('/api/stats').then(function (d) {
    el('s-today-pv').textContent = d.today_pv;
    el('s-today-uv').textContent = d.today_uv;
    el('s-week-pv').textContent = d.week_pv;
    el('s-total-pv').textContent = d.total_pv;
    el('s-total-uv').textContent = d.total_uv;
    fillList('top-pages', d.top_pages, 'path');
    fillList('top-refs', d.top_refs, 'ref');
    fillList('top-countries', d.top_countries, 'country');
  }).catch(function () {});
}

function fillList(id, arr, key) {
  el(id).innerHTML = (arr && arr.length)
    ? arr.map(function (x) { return '<li><span>' + esc(x[key]) + '</span><b>' + x.n + '</b></li>'; }).join('')
    : '<li class="dim">暂无数据</li>';
}

function loadVisitors(reset) {
  if (reset) { vOffset = 0; el('vlist').innerHTML = '<p class="empty">加载中…</p>'; }
  api('/api/visitors?offset=' + vOffset).then(function (d) {
    var box = el('vlist');
    if (reset) box.innerHTML = '';
    if (reset && (!d.visitors || d.visitors.length === 0)) {
      box.innerHTML = '<p class="empty">还没有访问记录</p>';
      el('vmore').style.display = 'none';
      return;
    }
    d.visitors.forEach(function (v) { box.appendChild(renderVisitor(v)); });
    el('vmore').style.display = (vOffset + ${PAGE_SIZE} < d.total && d.visitors.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('vlist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderVisitor(v) {
  var wrap = document.createElement('div');
  var anon = v.gid.indexOf('anon:') === 0;
  wrap.innerHTML =
    '<div class="vrow"><div class="r1">' +
    '<span class="vid">' + (anon ? '匿名访客' : esc(v.gid.slice(0, 13)) + '…') + '</span>' +
    '<span class="dim">' + esc(v.country || '未知') + ' · ' + esc(v.device || '—') +
    (anon ? ' · IP ' + esc(v.gid.slice(5)) : '') + '</span>' +
    '<span class="dim">' + esc(fmtTime(v.first)) + ' ~ ' + esc(fmtTime(v.last)) + '</span>' +
    '<span class="n">' + v.n + ' 次浏览</span></div></div>' +
    '<div class="vdetail" style="display:none"></div>';
  wrap.querySelector('.vrow').addEventListener('click', function () {
    var det = wrap.querySelector('.vdetail');
    var willOpen = det.style.display === 'none';
    det.style.display = willOpen ? '' : 'none';
    if (!willOpen || det.dataset.loaded) return;
    det.innerHTML = '<p class="empty">加载中…</p>';
    api('/api/visitors/' + encodeURIComponent(v.gid)).then(function (d) {
      det.dataset.loaded = '1';
      det.innerHTML = '<table><tr><th>时间（北京）</th><th>页面</th><th>来源</th><th>地区</th><th>设备</th></tr>' +
        (d.views || []).map(function (w) {
          return '<tr><td>' + esc(fmtTime(w.created_at)) + '</td><td>' + esc(w.path) + '</td><td>' +
            esc(w.referrer || '直接访问') + '</td><td>' + esc(w.country || '—') + '</td><td>' + esc(w.device || '—') + '</td></tr>';
        }).join('') + '</table>';
    }).catch(function (e) {
      det.innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
    });
  });
  return wrap;
}

el('vmore').addEventListener('click', function () { vOffset += ${PAGE_SIZE}; loadVisitors(false); });

load(true);
</script>
</body>
</html>`;
