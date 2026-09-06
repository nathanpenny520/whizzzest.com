/**
 * 焰境·万载 — 管理后台 Worker（admin.whizzzest.com，整域即后台）
 *
 * 安全层次：Cloudflare Access（第一道门，dashboard 开通）→ 本应用密码登录（第二道门）
 *  - GET  /login                 登录页
 *  - GET  /                      管理页（留言管理 + 访客分析）
 *  - POST /api/login             密码登录 → 签名会话 Cookie（HttpOnly/Secure/SameSite=Strict）
 *  - POST /api/logout            退出登录
 *  - GET  /api/messages          留言列表（?filter=unread|all&offset=0），含 total/unread 计数
 *  - POST /api/messages/:id/read 标记已读/未读 {read: true|false}
 *  - DELETE /api/messages/:id    删除留言
 *
 * 访客分析（数据来自主站 Worker 写入的 visits 表）：
 *  - GET  /api/stats?days=7|30|90   概览卡片 + 每日趋势 + 页面/来源/设备/浏览器/OS/语言/地区 + 最近浏览
 *  - GET  /api/visitors             访客列表（?offset=0），按匿名 Cookie ID / IP 分组
 *  - GET  /api/visitors/:gid        单个访客的会话与页面轨迹
 *
 * 会话：无状态 HMAC 签名（过期时间戳 + 签名），改 ADMIN_SESSION_SECRET 即全体下线。
 * 凭据：wrangler secret 配 ADMIN_PASSWORD / ADMIN_SESSION_SECRET，不进代码、不进仓库。
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const COOKIE_NAME = 'wa_session';
const PAGE_SIZE = 50;
// 后台页内嵌 favicon（SVG data URI，与主站标签页同款）
const FAVICON_LINK = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzcwNjM5ODE2OTM3IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9Ijg1MzgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+PHBhdGggZD0iTTUxMi44IDQyMC44Yy0xNTYuOCAyMzQuNC0xNDEuNiA1NzYuOC00OCA1NzguNCA5Ni44IDIuNC0xNC40LTM5NC40IDQ4LTU3OC40ek00ODAuOCAzOTUuMmMtMjI3LjIgNzQuNC0zOTIgMzExLjItMzI4LjggMzYxLjYgNjQuOCA1MiAxOTEuMi0yNzIgMzI4LjgtMzYxLjZ6TTQ4Ny4yIDM3NkMyOTAuNCAyODggMjQgMzMyIDMxLjIgMzk5LjJjNy4yIDY4LjggMzA3LjItNDkuNiA0NTYtMjMuMnpNNTEyLjggMzU0LjRjLTg5LjYtMTY5LjYtMzAwLTMwMC44LTMzMS4yLTI1Ni0zMiA0Ni40IDI0MS42IDE1MiAzMzEuMiAyNTZ6TTUzMS4yIDM1NC40QzYyNi40IDIyOCA2MzIgMzQuNCA1ODAuOCAyOS42Yy01Mi44LTQuOC03LjIgMjIzLjItNDkuNiAzMjQuOHpNNTQ4IDM2Ni40YzE0NC44IDMuMiAyOTUuMi05NC40IDI3Mi0xMzUuMi0yNC00MS42LTE3My42IDExMi0yNzIgMTM1LjJ6TTU2MS42IDM5OS4yYzE2MCAxMTkuMiA0MjAgMTYwLjggNDMxLjIgMTA5LjYgMTEuMi01Mi44LTI5OS4yLTQ4LjgtNDMxLjItMTA5LjZ6TTUzOS4yIDQyNi40YzI5LjYgMjE2IDIxMS4yIDQxNy42IDI2NC44IDM3NS4yIDU1LjItNDMuMi0yMDcuMi0yMzMuNi0yNjQuOC0zNzUuMnoiIGZpbGw9IiNFODM1MTgiIHAtaWQ9Ijg1MzkiPjwvcGF0aD48cGF0aCBkPSJNOTE5LjIgNjIyLjRsMTYgMzIuOCAzNiA0LjgtMjUuNiAyNS42IDUuNiAzNi0zMi0xNi44LTMyIDE2LjggNi40LTM2LTI2LjQtMjUuNiAzNi00Ljh6IiBmaWxsPSIjRjREMzFGIiBwLWlkPSI4NTQwIj48L3BhdGg+PHBhdGggZD0iTTUyMCAzMzkuMmwxNiAzMi44IDM2IDUuNi0yNS42IDI0LjggNS42IDM2LTMyLTE2LjgtMzIgMTYuOCA2LjQtMzYtMjYuNC0yNC44IDM2LTUuNnpNMjM5LjIgNzkyLjhsMTQuNCAzMC40IDM0LjQgNC44LTI0LjggMjQgNS42IDMzLjYtMjkuNi0xNi0zMC40IDE2IDUuNi0zMy42LTI0LjgtMjQgMzQuNC00Ljh6TTE1MS4yIDE4OGgtMzJ2LTMyYzAtMi40LTEuNi00LTQtNHMtNCAxLjYtNCA0djMyaC0zMmMtMi40IDAtNCAxLjYtNCA0czEuNiA0IDQgNGgzMnYzMmMwIDIuNCAxLjYgNCA0IDRzNC0xLjYgNC00di0zMmgzMmMyLjQgMCA0LTEuNiA0LTRzLTEuNi00LTQtNHoiIGZpbGw9IiNGNUUzMjgiIHAtaWQ9Ijg1NDEiPjwvcGF0aD48L3N2Zz4=">';

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

  if (path === '/api/stats' && method === 'GET') return statsOverview(env, request);
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
const bjToday = "datetime('now','+8 hours','start of day','-8 hours')";
// 访客分组：优先匿名 Cookie ID；无 Cookie 时按 IP 归组（gid 前缀 anon:）
const GID = "COALESCE(NULLIF(vid,''),'anon:'||COALESCE(ip,'x'))";
const KIND_LABEL = {
  direct: '直接访问', internal: '站内跳转', search: '搜索引擎',
  social: '社交媒体', referral: '外部链接', other: '其他',
};

/** 天数参数 → SQL since 表达式（含边界校验） */
function sinceExpr(daysParam) {
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;
  const back = days === 1 ? '' : `,'-${days - 1} days'`;
  return { days, sql: `datetime('now','+8 hours','start of day','-8 hours'${back})` };
}

async function statsOverview(env, request) {
  const url = new URL(request.url);
  const { days, sql: SINCE } = sinceExpr(url.searchParams.get('days'));
  const db = env.DB;

  const [cards, bounce, avgTime, newUv, daily, pages, kinds, sources, devices, browsers, oses, langs, countries, recent] =
    await Promise.all([
      db.prepare(
        `SELECT COUNT(*) pv, COUNT(DISTINCT ${GID}) uv, COUNT(DISTINCT sid) sessions
         FROM visits WHERE created_at >= ${SINCE}`
      ).first(),
      db.prepare(
        `SELECT COUNT(*) n FROM (
           SELECT sid FROM visits WHERE sid IS NOT NULL AND created_at >= ${SINCE}
           GROUP BY sid HAVING COUNT(*) = 1
         )`
      ).first(),
      db.prepare(
        `SELECT AVG(engage_ms) t FROM visits WHERE engage_ms > 0 AND created_at >= ${SINCE}`
      ).first(),
      db.prepare(
        `SELECT COUNT(*) n FROM (
           SELECT vid FROM visits WHERE vid IS NOT NULL AND created_at >= ${SINCE}
           GROUP BY vid HAVING MIN(created_at) >= ${SINCE}
         )`
      ).first(),
      db.prepare(
        `SELECT date(created_at, '+8 hours') d, COUNT(*) pv, COUNT(DISTINCT vid) uv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY d ORDER BY d`
      ).all(),
      db.prepare(
        `SELECT path, COUNT(*) pv, COUNT(DISTINCT vid) uv, AVG(engage_ms) avg_ms
         FROM visits WHERE created_at >= ${SINCE} GROUP BY path ORDER BY pv DESC LIMIT 10`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(kind,''),'other') kind, COUNT(DISTINCT sid) sessions, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY kind ORDER BY pv DESC`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(ref_host,''),'直接访问') src, COUNT(DISTINCT sid) sessions, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY src ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(device,'—'),'—') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY device ORDER BY pv DESC`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(browser,'Other'),'Other') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY browser ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(os,'Other'),'Other') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY os ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(lang,'—'),'—') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY lang ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(country,''),'未知') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM visits WHERE created_at >= ${SINCE} GROUP BY country ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT created_at, path, COALESCE(NULLIF(kind,''),'other') kind, ref_host, country, device, engage_ms
         FROM visits WHERE created_at >= ${SINCE} ORDER BY created_at DESC LIMIT 30`
      ).all(),
    ]);

  const sessions = cards?.sessions || 0;
  return json({
    ok: true,
    days,
    cards: {
      pv: cards?.pv || 0,
      uv: cards?.uv || 0,
      sessions,
      bounce: sessions ? Math.round(((bounce?.n || 0) / sessions) * 100) : 0,
      avg_time_s: Math.round((avgTime?.t || 0) / 1000),
      new_uv: newUv?.n || 0,
    },
    daily: (daily.results || []),
    top_pages: (pages.results || []).map((p) => ({ ...p, avg_s: Math.round((p.avg_ms || 0) / 1000) })),
    kinds: (kinds.results || []).map((k) => ({ ...k, label: KIND_LABEL[k.kind] || k.kind })),
    sources: sources.results || [],
    devices: devices.results || [],
    browsers: browsers.results || [],
    os: oses.results || [],
    langs: langs.results || [],
    countries: countries.results || [],
    recent: (recent.results || []).map((r) => ({ ...r, kind: r.kind || 'other' })),
  });
}

async function listVisitors(env, request) {
  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const { results } = await env.DB
    .prepare(
      `SELECT ${GID} gid, COUNT(*) views, COUNT(DISTINCT sid) sessions,
              MIN(created_at) first, MAX(created_at) last,
              MAX(country) country, MAX(device) device, MAX(browser) browser, MAX(os) os
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
  const { results: sessions } = await env.DB
    .prepare(
      `SELECT sid, MIN(created_at) start, MAX(created_at) end, COUNT(*) views
       FROM visits WHERE ${where} AND sid IS NOT NULL GROUP BY sid ORDER BY start DESC LIMIT 50`
    )
    .bind(gid)
    .all();
  const { results: views } = await env.DB
    .prepare(
      `SELECT path, kind, ref_host, country, device, engage_ms, created_at
       FROM visits WHERE ${where} ORDER BY created_at DESC LIMIT 300`
    )
    .bind(gid)
    .all();
  return json({
    ok: true,
    gid,
    n: summary?.n || 0,
    first: summary?.first,
    last: summary?.last,
    sessions: (sessions || []).map((s) => ({ ...s, sid: s.sid ? `${s.sid.slice(0, 8)}…` : '' })),
    views: views || [],
  });
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

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body {
    background: #f5f5f7; color: #1d1d1f; padding: 0 20px 60px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  header {
    position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 10px;
    padding: 14px 4px; background: rgba(251,251,253,.82); backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid rgba(0,0,0,.08);
  }
  h1 { font-size: 16px; font-weight: 600; margin-right: auto; }
  h1 span { color: #6e6e73; font-weight: 400; font-size: 12px; margin-left: 8px; }
  button {
    padding: 7px 14px; font-size: 13px; color: #1d1d1f; background: #fff;
    border: 1px solid rgba(0,0,0,.12); border-radius: 980px; cursor: pointer;
    transition: all .2s cubic-bezier(.25,.1,.25,1);
  }
  button:hover { border-color: #d64524; color: #d64524; }
  button.primary { background: #d64524; border-color: #d64524; color: #fff; }
  button.primary:hover { background: #b5371a; color: #fff; }
  .tab { color: #6e6e73; background: transparent; border-color: transparent; }
  .tab.active { color: #1d1d1f; background: #fff; border-color: rgba(0,0,0,.12); font-weight: 600; }
  .panel {
    max-width: 1060px; margin: 18px auto 0; background: #fff; border-radius: 18px;
    padding: 22px 24px; box-shadow: 0 2px 12px rgba(0,0,0,.04);
  }
  .panel h3 { font-size: 13px; font-weight: 600; color: #6e6e73; margin-bottom: 14px; }
  .empty { color: #86868b; text-align: center; padding: 60px 0; font-size: 14px; }
  .more { display: block; margin: 20px auto 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { color: #6e6e73; font-weight: 600; text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,.08); white-space: nowrap; }
  td { padding: 9px 10px; border-bottom: 1px solid rgba(0,0,0,.05); color: #1d1d1f; word-break: break-word; }
  tr:last-child td { border-bottom: 0; }
`;

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
    background: #f5f5f7; color: #1d1d1f;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: min(360px, calc(100vw - 48px)); padding: 40px 32px;
    background: #fff; border-radius: 20px; box-shadow: 0 4px 24px rgba(0,0,0,.07);
  }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
  p.sub { color: #6e6e73; font-size: 13px; margin: 6px 0 28px; }
  label { display: block; font-size: 13px; color: #6e6e73; margin-bottom: 8px; }
  input {
    width: 100%; padding: 12px 14px; font-size: 15px; color: #1d1d1f;
    background: #f5f5f7; border: 1px solid transparent; border-radius: 12px; outline: none;
    transition: border-color .2s;
  }
  input:focus { border-color: #d64524; background: #fff; }
  button {
    width: 100%; margin-top: 20px; padding: 12px; font-size: 15px; font-weight: 600;
    color: #fff; background: #d64524; border: 0; border-radius: 980px; cursor: pointer;
  }
  button:hover { background: #b5371a; }
  button:disabled { opacity: .5; cursor: default; }
  .err { display: none; margin-top: 16px; color: #d64524; font-size: 13px; }
</style>
</head>
<body>
<form class="card" id="f">
  <h1>焰境·万载 · 管理后台</h1>
  <p class="sub">whizzzest.com 留言与访客数据管理</p>
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
<title>管理后台 — 焰境·万载</title>
<style>
${BASE_CSS}
  .wrap { max-width: 1060px; margin: 0 auto; }
  /* 访客分析 */
  .range { display: flex; align-items: center; gap: 10px; margin: 18px auto 0; max-width: 1060px; }
  .range .updated { margin-left: auto; color: #86868b; font-size: 12px; }
  .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin: 14px 0 0; }
  .card2 { background: #fff; border-radius: 16px; padding: 16px 14px; box-shadow: 0 2px 12px rgba(0,0,0,.04); }
  .card2 b { display: block; font-size: 24px; font-weight: 600; letter-spacing: -.02em; }
  .card2 span { display: block; margin-top: 4px; color: #6e6e73; font-size: 12px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 86px; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
  .bar-row .label { color: #1d1d1f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 8px; background: #f0f0f2; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #d64524, #f2a03d); border-radius: 999px; }
  .bar-row b { color: #6e6e73; font-weight: 500; text-align: right; white-space: nowrap; }
  svg.chart { width: 100%; height: 240px; }
  svg.chart text { font-size: 12px; fill: #86868b; font-family: inherit; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: #6e6e73; margin-bottom: 8px; }
  .legend i { display: inline-block; width: 16px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 5px; }
  .k-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #f5f5f7; font-size: 12px; color: #6e6e73; }
  .list .msg {
    margin-top: 14px; padding: 18px 20px; background: #fff;
    border: 1px solid rgba(0,0,0,.06); border-left: 3px solid #d64524; border-radius: 14px;
  }
  .list .msg.read { border-left-color: rgba(0,0,0,.15); }
  .row1 { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .name { font-weight: 600; font-size: 15px; }
  .email a { color: #6e6e73; font-size: 13px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #d64524; margin-left: auto; }
  .msg.read .dot { background: rgba(0,0,0,.15); }
  .time { color: #86868b; font-size: 12px; margin-top: 2px; }
  .body { margin: 12px 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .meta { color: #86868b; font-size: 12px; word-break: break-all; }
  .ops { display: flex; gap: 8px; margin-top: 14px; }
  .ops button { padding: 5px 12px; font-size: 12px; }
  .stat-line { color: #6e6e73; font-size: 13px; margin: 12px 0 0; }
  .vwrap { margin-top: 12px; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.04); }
  .vrow td { cursor: pointer; }
  .vrow:hover td { background: #fafafc; }
  .flag { margin-right: 4px; }
  .detail td { color: #6e6e73; font-size: 12px; }
  @media (max-width: 900px) {
    .cards { grid-template-columns: repeat(3, 1fr); }
    .grid3, .grid2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .cards { grid-template-columns: repeat(2, 1fr); }
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

<div id="view-msg" class="wrap">
  <div class="tabs" style="display:flex;gap:8px;margin:18px 0 4px;">
    <button class="tab active" id="tab-unread" type="button">未读</button>
    <button class="tab" id="tab-all" type="button">全部</button>
  </div>
  <p class="stat-line" id="stats"></p>
  <div class="list" id="list"><p class="empty">加载中…</p></div>
  <button class="more" id="more" type="button" style="display:none">加载更多</button>
</div>

<div id="view-visit" class="wrap" style="display:none">
  <div class="range">
    <button class="tab" data-days="7" type="button">7 天</button>
    <button class="tab active" data-days="30" type="button">30 天</button>
    <button class="tab" data-days="90" type="button">90 天</button>
    <span class="updated" id="updated"></span>
    <button id="vrefresh" type="button">刷新</button>
  </div>
  <div class="cards">
    <div class="card2"><b id="c-pv">–</b><span>浏览量</span></div>
    <div class="card2"><b id="c-uv">–</b><span>访客数</span></div>
    <div class="card2"><b id="c-sessions">–</b><span>会话数</span></div>
    <div class="card2"><b id="c-bounce">–</b><span>跳出率</span></div>
    <div class="card2"><b id="c-avg">–</b><span>平均停留</span></div>
    <div class="card2"><b id="c-new">–</b><span>新访客</span></div>
  </div>
  <div class="panel">
    <h3>每日浏览与访客</h3>
    <div class="legend"><span><i style="background:#d64524"></i>浏览量</span><span><i style="background:#8ab4ff"></i>访客数</span><span id="chart-empty" style="margin-left:auto"></span></div>
    <svg class="chart" id="chart" viewBox="0 0 1000 240" preserveAspectRatio="none"></svg>
  </div>
  <div class="panel">
    <h3>热门页面</h3>
    <table><thead><tr><th>路径</th><th>浏览</th><th>访客</th><th>平均停留</th></tr></thead><tbody id="top-pages"></tbody></table>
  </div>
  <div class="grid3" style="margin-top:14px">
    <div class="panel" style="margin:0"><h3>流量类型</h3><div id="kinds"></div></div>
    <div class="panel" style="margin:0"><h3>来源网站</h3><div id="sources"></div></div>
    <div class="panel" style="margin:0"><h3>设备</h3><div id="devices"></div></div>
  </div>
  <div class="grid3" style="margin-top:14px">
    <div class="panel" style="margin:0"><h3>浏览器</h3><div id="browsers"></div></div>
    <div class="panel" style="margin:0"><h3>操作系统</h3><div id="os"></div></div>
    <div class="panel" style="margin:0"><h3>语言</h3><div id="langs"></div></div>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="panel" style="margin:0"><h3>国家 / 地区</h3><div id="countries"></div></div>
    <div class="panel" style="margin:0"><h3>最近页面浏览</h3><table><tbody id="recent"></tbody></table></div>
  </div>
  <div class="panel">
    <h3>访客列表（最近活跃在前，点击展开会话与轨迹）</h3>
    <div class="vwrap"><table>
      <thead><tr><th>最近活跃</th><th>地区</th><th>设备</th><th>浏览器 · 系统</th><th>浏览</th><th>会话</th><th>首次访问</th></tr></thead>
      <tbody id="vlist"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody>
    </table></div>
    <button class="more" id="vmore" type="button" style="display:none">加载更多</button>
  </div>
</div>

<script>
var state = { filter: 'unread', offset: 0, total: 0, unread: 0 };
var currentView = 'msg';
var visitDays = 30;
var vOffset = 0;
var KIND_LABEL = { direct: '直接访问', internal: '站内跳转', search: '搜索引擎', social: '社交媒体', referral: '外部链接', other: '其他' };

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
function flag(code) {
  if (!code || code.length !== 2) return '';
  var cc = code.toUpperCase();
  if (cc === 'TW') cc = 'CN';
  return String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1));
}
function fmtDur(sec) { return sec >= 60 ? Math.floor(sec / 60) + 'm' + Math.round(sec % 60) + 's' : sec + 's'; }

function api(path, opts) {
  return fetch(path, opts).then(function (r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    return r.json().then(function (d) {
      if (!r.ok || d.ok === false) throw new Error(d.error || r.status);
      return d;
    });
  });
}

/* ---------- 视图切换 ---------- */
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
document.querySelectorAll('#view-visit .range [data-days]').forEach(function (b) {
  b.addEventListener('click', function () {
    visitDays = Number(b.getAttribute('data-days'));
    document.querySelectorAll('#view-visit .range [data-days]').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    loadStats(); loadVisitors(true);
  });
});

/* ---------- 留言管理 ---------- */
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

/* ---------- 访客分析 ---------- */
function loadStats() {
  el('updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  api('/api/stats?days=' + visitDays).then(function (d) {
    el('c-pv').textContent = d.cards.pv;
    el('c-uv').textContent = d.cards.uv;
    el('c-sessions').textContent = d.cards.sessions;
    el('c-bounce').textContent = d.cards.bounce + '%';
    el('c-avg').textContent = fmtDur(d.cards.avg_time_s);
    el('c-new').textContent = d.cards.uv ? Math.round((d.cards.new_uv / d.cards.uv) * 100) + '%' : '0%';
    drawChart(d.daily || []);
    fillTable('top-pages', d.top_pages, function (p) {
      return '<td>' + esc(p.path) + '</td><td>' + p.pv + '</td><td>' + p.uv + '</td><td>' + fmtDur(p.avg_s) + '</td>';
    });
    fillBars('kinds', (d.kinds || []).map(function (k) { return { label: k.label || k.kind, uv: k.sessions, pv: k.pv }; }));
    fillBars('sources', (d.sources || []).map(function (s) { return { label: s.src, uv: s.sessions, pv: s.pv }; }));
    fillBars('devices', d.devices);
    fillBars('browsers', d.browsers);
    fillBars('os', d.os);
    fillBars('langs', d.langs);
    fillBars('countries', (d.countries || []).map(function (c) {
      return { label: (flag(c.name) || '') + ' ' + c.name, uv: c.uv, pv: c.pv };
    }));
    el('recent').innerHTML = (d.recent || []).map(function (r) {
      return '<tr><td>' + esc(fmtTime(r.created_at)) + '</td><td>' + esc(r.path) + '</td><td>' +
        '<span class="k-badge">' + esc(KIND_LABEL[r.kind] || r.kind) + '</span></td><td>' +
        (flag(r.country) || '') + ' ' + esc(r.device || '—') + '</td><td>' + fmtDur(Math.round((r.engage_ms || 0) / 1000)) + '</td></tr>';
    }).join('') || '<tr><td class="empty">暂无数据</td></tr>';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('chart-empty').textContent = '加载失败：' + esc(e.message);
  });
}

function fillTable(id, rows, fn) {
  el(id).innerHTML = (rows && rows.length)
    ? rows.map(fn).join('')
    : '<tr><td class="empty">暂无数据</td></tr>';
}

function fillBars(id, rows) {
  var max = 0;
  (rows || []).forEach(function (r) { if (r.pv > max) max = r.pv; });
  el(id).innerHTML = (rows && rows.length)
    ? rows.map(function (r) {
        var w = max ? Math.round((r.pv / max) * 100) : 0;
        return '<div class="bar-row"><span class="label" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
          '<b>' + r.uv + ' 访客 · ' + r.pv + ' 浏览</b></div>';
      }).join('')
    : '<div class="bar-row"><span class="label dim">暂无数据</span></div>';
}

function drawChart(daily) {
  var svg = el('chart');
  el('chart-empty').textContent = daily.length ? '' : '暂无数据';
  if (!daily.length) { svg.innerHTML = ''; return; }
  var W = 1000, H = 240, PAD = 24;
  var max = 1;
  daily.forEach(function (d) { if (d.pv > max) max = d.pv; if (d.uv > max) max = d.uv; });
  var step = daily.length > 1 ? (W - PAD * 2) / (daily.length - 1) : 0;
  var y = function (v) { return H - PAD - (v / max) * (H - PAD * 2); };
  var pts = function (key) {
    return daily.map(function (d, i) { return (PAD + i * step).toFixed(1) + ',' + y(d[key]).toFixed(1); }).join(' ');
  };
  var grid = '';
  for (var g = 0; g <= 4; g++) {
    var gy = (PAD + ((H - PAD * 2) * g) / 4).toFixed(1);
    grid += '<line x1="' + PAD + '" y1="' + gy + '" x2="' + (W - PAD) + '" y2="' + gy + '" stroke="rgba(0,0,0,.06)"/>';
    grid += '<text x="4" y="' + (+gy + 4) + '">' + Math.round(max - (max * g) / 4) + '</text>';
  }
  var xLabels = '';
  [0, Math.floor((daily.length - 1) / 2), daily.length - 1].forEach(function (i, k) {
    if (i < 0 || i >= daily.length || (k === 1 && daily.length < 5)) return;
    xLabels += '<text x="' + (PAD + i * step) + '" y="' + (H - 4) + '" text-anchor="middle">' + daily[i].d.slice(5) + '</text>';
  });
  svg.innerHTML = grid +
    '<polyline points="' + pts('pv') + '" fill="none" stroke="#d64524" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<polyline points="' + pts('uv') + '" fill="none" stroke="#8ab4ff" stroke-width="2.5" stroke-linejoin="round"/>' +
    daily.map(function (d, i) {
      return '<circle cx="' + (PAD + i * step).toFixed(1) + '" cy="' + y(d.pv).toFixed(1) + '" r="3" fill="#d64524"/>' +
        '<circle cx="' + (PAD + i * step).toFixed(1) + '" cy="' + y(d.uv).toFixed(1) + '" r="3" fill="#8ab4ff"/>';
    }).join('') + xLabels;
}

var vOffset = 0;
function loadVisitors(reset) {
  if (reset) { vOffset = 0; el('vlist').innerHTML = '<tr><td colspan="7" class="empty">加载中…</td></tr>'; }
  api('/api/visitors?offset=' + vOffset).then(function (d) {
    var box = el('vlist');
    if (reset) box.innerHTML = '';
    if (reset && (!d.visitors || d.visitors.length === 0)) {
      box.innerHTML = '<tr><td colspan="7" class="empty">还没有访问记录</td></tr>';
      el('vmore').style.display = 'none';
      return;
    }
    d.visitors.forEach(function (v) { box.appendChild(renderVisitor(v)); });
    el('vmore').style.display = (vOffset + ${PAGE_SIZE} < d.total && d.visitors.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('vlist').innerHTML = '<tr><td colspan="7" class="empty">加载失败：' + esc(e.message) + '</td></tr>';
  });
}

function renderVisitor(v) {
  var tr = document.createElement('tr');
  tr.className = 'vrow';
  tr.innerHTML =
    '<td>' + esc(fmtTime(v.last)) + '</td>' +
    '<td><span class="flag">' + flag(v.country) + '</span>' + esc(v.country || '—') + '</td>' +
    '<td>' + esc(v.device || '—') + '</td>' +
    '<td>' + esc(v.browser || '—') + ' · ' + esc(v.os || '—') + '</td>' +
    '<td>' + v.views + '</td><td>' + v.sessions + '</td>' +
    '<td>' + esc(fmtTime(v.first)) + '</td>';
  tr.addEventListener('click', function () {
    var open = tr.dataset.open === '1';
    var existing = tr.nextElementSibling;
    if (open && existing && existing.className === 'detail') { existing.remove(); tr.dataset.open = ''; return; }
    if (existing && existing.className === 'detail') existing.remove();
    tr.dataset.open = '1';
    var det = document.createElement('tr');
    det.className = 'detail';
    det.innerHTML = '<td colspan="7">加载中…</td>';
    tr.after(det);
    api('/api/visitors/' + encodeURIComponent(v.gid)).then(function (d) {
      det.innerHTML = '<td colspan="7">' +
        '<div style="margin-bottom:8px">共 ' + d.n + ' 次浏览 · 首次 ' + esc(fmtTime(d.first)) + ' · 最近 ' + esc(fmtTime(d.last)) + '</div>' +
        '<table><tr><th>时间</th><th>页面</th><th>来源</th><th>地区</th><th>设备</th><th>停留</th></tr>' +
        (d.views || []).map(function (w) {
          return '<tr><td>' + esc(fmtTime(w.created_at)) + '</td><td>' + esc(w.path) + '</td><td>' +
            esc(KIND_LABEL[w.kind] || w.kind || '—') + (w.ref_host ? '（' + esc(w.ref_host) + '）' : '') + '</td><td>' +
            (flag(w.country) || '') + ' ' + esc(w.country || '—') + '</td><td>' + esc(w.device || '—') + '</td><td>' +
            fmtDur(Math.round((w.engage_ms || 0) / 1000)) + '</td></tr>';
        }).join('') + '</table></td>';
    }).catch(function (e) {
      det.innerHTML = '<td colspan="7">加载失败：' + esc(e.message) + '</td>';
    });
  });
  return tr;
}

el('vrefresh').addEventListener('click', function () { loadStats(); loadVisitors(true); });
el('refresh').addEventListener('click', function () {
  if (currentView === 'visit') { loadStats(); loadVisitors(true); } else { load(true); }
});
el('more').addEventListener('click', function () { state.offset += ${PAGE_SIZE}; load(false); });
el('vmore').addEventListener('click', function () { vOffset += ${PAGE_SIZE}; loadVisitors(false); });
el('logout').addEventListener('click', function () {
  api('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
});

load(true);
</script>
</body>
</html>`;
