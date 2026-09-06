/**
 * 焰境·万载 — 管理后台 Worker（admin.whizzzest.com，整域即后台）
 *
 * 安全层次：Cloudflare Access（第一道门，dashboard 开通）→ 本应用账号登录（第二道门）
 *  - GET  /login                 登录页（用户名选填：留空 = 主账号「站长」ADMIN_PASSWORD）
 *  - GET  /                      管理页（留言 / 访客 / 商户 / 账号；视图记忆在 location.hash，刷新不丢）
 *  - POST /api/login             账号密码登录 → 签名会话 Cookie（HttpOnly/Secure/SameSite=Strict）
 *  - POST /api/logout            退出登录
 *  - GET  /api/me                当前登录账号（导航右上角展示用）
 *  - GET  /api/accounts          运营账号列表（D1 admin_users，权限与站长相同）
 *  - POST /api/accounts          添加账号 {username, password}（PBKDF2 10 万次）
 *  - DELETE /api/accounts/:id    删除账号
 *  - GET  /api/messages          留言列表（?filter=unread|all&offset=0），含 total/unread 计数
 *  - POST /api/messages/:id/read 标记已读/未读 {read: true|false}
 *  - DELETE /api/messages/:id    删除留言
 *
 * 访客分析（数据来自主站 Worker 写入的 visits 表）：
 *  - GET  /api/stats?days=7|30|90   概览卡片 + 每日趋势 + 页面/来源/设备/浏览器/OS/语言/地区 + 最近浏览
 *  - GET  /api/visitors             访客列表（?offset=0），按匿名 Cookie ID / IP 分组
 *  - GET  /api/visitors/:gid        单个访客的会话与页面轨迹
 *
 * 会话：无状态 HMAC 签名（uid + 过期时间戳 + 签名；uid=0 主账号，>0 为 admin_users.id），
 *       改 ADMIN_SESSION_SECRET 即全体下线。
 * 凭据：wrangler secret 配 ADMIN_PASSWORD / ADMIN_SESSION_SECRET，不进代码、不进仓库。
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const COOKIE_NAME = 'wa_session';
const PAGE_SIZE = 50;
// 后台页内嵌 favicon（SVG data URI，与主站标签页同款）
const FAVICON_URI = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzcwNjM5ODE2OTM3IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9Ijg1MzgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+PHBhdGggZD0iTTUxMi44IDQyMC44Yy0xNTYuOCAyMzQuNC0xNDEuNiA1NzYuOC00OCA1NzguNCA5Ni44IDIuNC0xNC40LTM5NC40IDQ4LTU3OC40ek00ODAuOCAzOTUuMmMtMjI3LjIgNzQuNC0zOTIgMzExLjItMzI4LjggMzYxLjYgNjQuOCA1MiAxOTEuMi0yNzIgMzI4LjgtMzYxLjZ6TTQ4Ny4yIDM3NkMyOTAuNCAyODggMjQgMzMyIDMxLjIgMzk5LjJjNy4yIDY4LjggMzA3LjItNDkuNiA0NTYtMjMuMnpNNTEyLjggMzU0LjRjLTg5LjYtMTY5LjYtMzAwLTMwMC44LTMzMS4yLTI1Ni0zMiA0Ni40IDI0MS42IDE1MiAzMzEuMiAyNTZ6TTUzMS4yIDM1NC40QzYyNi40IDIyOCA2MzIgMzQuNCA1ODAuOCAyOS42Yy01Mi44LTQuOC03LjIgMjIzLjItNDkuNiAzMjQuOHpNNTQ4IDM2Ni40YzE0NC44IDMuMiAyOTUuMi05NC40IDI3Mi0xMzUuMi0yNC00MS42LTE3My42IDExMi0yNzIgMTM1LjJ6TTU2MS42IDM5OS4yYzE2MCAxMTkuMiA0MjAgMTYwLjggNDMxLjIgMTA5LjYgMTEuMi01Mi44LTI5OS4yLTQ4LjgtNDMxLjItMTA5LjZ6TTUzOS4yIDQyNi40YzI5LjYgMjE2IDIxMS4yIDQxNy42IDI2NC44IDM3NS4yIDU1LjItNDMuMi0yMDcuMi0yMzMuNi0yNjQuOC0zNzUuMnoiIGZpbGw9IiNFODM1MTgiIHAtaWQ9Ijg1MzkiPjwvcGF0aD48cGF0aCBkPSJNOTE5LjIgNjIyLjRsMTYgMzIuOCAzNiA0LjgtMjUuNiAyNS42IDUuNiAzNi0zMi0xNi44LTMyIDE2LjggNi40LTM2LTI2LjQtMjUuNiAzNi00Ljh6IiBmaWxsPSIjRjREMzFGIiBwLWlkPSI4NTQwIj48L3BhdGg+PHBhdGggZD0iTTUyMCAzMzkuMmwxNiAzMi44IDM2IDUuNi0yNS42IDI0LjggNS42IDM2LTMyLTE2LjgtMzIgMTYuOCA2LjQtMzYtMjYuNC0yNC44IDM2LTUuNnpNMjM5LjIgNzkyLjhsMTQuNCAzMC40IDM0LjQgNC44LTI0LjggMjQgNS42IDMzLjYtMjkuNi0xNi0zMC40IDE2IDUuNi0zMy42LTI0LjgtMjQgMzQuNC00Ljh6TTE1MS4yIDE4OGgtMzJ2LTMyYzAtMi40LTEuNi00LTQtNHMtNCAxLjYtNCA0djMyaC0zMmMtMi40IDAtNCAxLjYtNCA0czEuNiA0IDQgNGgzMnYzMmMwIDIuNCAxLjYgNCA0IDRzNC0xLjYgNC00di0zMmgzMmMyLjQgMCA0LTEuNiA0LTRzLTEuNi00LTQtNHoiIGZpbGw9IiNGNUUzMjgiIHAtaWQ9Ijg1NDEiPjwvcGF0aD48L3N2Zz4=';
const FAVICON_LINK = `<link rel="icon" type="image/svg+xml" href="${FAVICON_URI}">`;

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
    if ((await sessionUid(request, env)) === null) return redirect('/login');
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
  const uid = await sessionUid(request, env);
  if (uid === null) return json({ ok: false, error: 'unauthorized' }, 401);

  // 变更请求校验来源（配合 SameSite=Strict 双保险）：Origin 的 host 必须与 Host 头一致
  // （生产同为 admin.whizzzest.com；本地 wrangler dev 时两者同为 127.0.0.1:<port>，自然放行）
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === request.headers.get('host');
      } catch { /* 非法 origin 一律拒绝 */ }
      if (!sameOrigin) {
        return json({ ok: false, error: 'bad_origin' }, 403);
      }
    }
  }

  let m;
  if (path === '/api/me' && method === 'GET') {
    return json({ ok: true, user: await resolveUser(env, uid) });
  }

  // 运营账号管理（admin_users，权限与主账号相同）
  if (path === '/api/accounts' && method === 'GET') return listAccounts(env);
  if (path === '/api/accounts' && method === 'POST') return createAccount(env, request);
  if ((m = path.match(/^\/api\/accounts\/(\d+)$/)) && method === 'DELETE') {
    return removeAccount(env, Number(m[1]));
  }
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

  // 商户管理（M1，docs/商户功能方案.md）
  if (path === '/api/merchants' && method === 'GET') return listMerchants(env, request);
  if (path === '/api/merchants' && method === 'POST') return createMerchant(env, request);
  if ((m = path.match(/^\/api\/merchants\/(\d+)$/)) && method === 'POST') {
    return editMerchant(env, Number(m[1]), request);
  }
  if ((m = path.match(/^\/api\/merchants\/(\d+)$/)) && method === 'DELETE') {
    return removeMerchant(env, Number(m[1]));
  }
  // 核销：确认收款 → 开通等级 + 一年到期，清除待核销申请（M3）
  if ((m = path.match(/^\/api\/merchants\/(\d+)\/redeem$/)) && method === 'POST') {
    return redeemMerchant(env, Number(m[1]), request);
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

  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');

  // 用户名留空 = 主账号「站长」（ADMIN_PASSWORD 密钥）；填了用户名走 D1 运营账号
  let uid = 0;
  if (username) {
    const row = await env.DB
      .prepare('SELECT id, pass_hash, pass_salt FROM admin_users WHERE username = ?1')
      .bind(username)
      .first();
    if (!row) return json({ ok: false, error: 'invalid_credentials' }, 401);
    if (!timingSafeEqual(await pbkdf2Hex(password, row.pass_salt), row.pass_hash)) {
      return json({ ok: false, error: 'invalid_credentials' }, 401);
    }
    uid = row.id;
  } else {
    const given = await sha256Hex(password);
    const expected = await sha256Hex(env.ADMIN_PASSWORD);
    if (!timingSafeEqual(given, expected)) {
      return json({ ok: false, error: 'invalid_credentials' }, 401);
    }
  }

  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmacHex(env.ADMIN_SESSION_SECRET, uid + '.' + exp);
  const res = json({ ok: true });
  res.headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${uid}.${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`
  );
  return res;
}

/** 会话校验：返回 uid（0 = 主账号「站长」，>0 = admin_users.id）；无效返回 null */
async function sessionUid(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return null;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([0-9]+)\\.([0-9]+)\\.([a-f0-9]{64})`));
  if (!m) return null;
  const [, uid, exp, sig] = m;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return null;
  const expected = await hmacHex(env.ADMIN_SESSION_SECRET, uid + '.' + exp);
  if (!timingSafeEqual(sig, expected)) return null;
  return Number(uid);
}

/** uid → 展示名 */
async function resolveUser(env, uid) {
  if (!uid) return '站长';
  const row = await env.DB.prepare('SELECT username FROM admin_users WHERE id = ?1').bind(uid).first();
  return row?.username || '账号已删除';
}

/* ---------------- 运营账号管理（D1 admin_users） ---------------- */

const USER_RE = /^[A-Za-z0-9_-]{2,20}$/;
const MAX_ACCOUNTS = 10;

async function listAccounts(env) {
  const { results } = await env.DB
    .prepare('SELECT id, username, created_at FROM admin_users ORDER BY id')
    .all();
  return json({ ok: true, accounts: results || [] });
}

async function createAccount(env, request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!USER_RE.test(username)) return json({ ok: false, error: 'bad_username' }, 400);
  if (password.length < 8 || password.length > 64) return json({ ok: false, error: 'bad_password' }, 400);

  const { n } = await env.DB.prepare('SELECT COUNT(*) n FROM admin_users').first();
  if (n >= MAX_ACCOUNTS) return json({ ok: false, error: 'too_many' }, 400);

  const salt = crypto.randomUUID().replace(/-/g, '');
  try {
    await env.DB.prepare(
      'INSERT INTO admin_users (username, pass_hash, pass_salt) VALUES (?1, ?2, ?3)'
    ).bind(username, await pbkdf2Hex(password, salt), salt).run();
  } catch {
    return json({ ok: false, error: 'dup_username' }, 400);
  }
  return json({ ok: true });
}

async function removeAccount(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM admin_users WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
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
  const days = [7, 30, 90, 180, 365].includes(daysParam) ? daysParam : 7;
  const back = days === 1 ? '' : `,'-${days - 1} days'`;
  return { days, sql: `datetime('now','+8 hours','start of day','-8 hours'${back})` };
}

async function statsOverview(env, request) {
  const url = new URL(request.url);
  const { days, sql: SINCE } = sinceExpr(url.searchParams.get('days'));
  const bots = url.searchParams.get('bots') === '1';
  const T = bots ? 'visits' : '(SELECT * FROM visits WHERE is_bot = 0)';
  const db = env.DB;

  const sincePrev = `datetime('now','+8 hours','start of day','-8 hours','-${days} days')`;

  const [cards, bounce, avgTime, newUv, daily, pages, kinds, sources, devices, browsers, oses, langs, countries, recent, prevPv, live, firstSeen, entries, depth] =
    await Promise.all([
      db.prepare(
        `SELECT COUNT(*) pv, COUNT(DISTINCT ${GID}) uv, COUNT(DISTINCT sid) sessions
         FROM ${T} WHERE created_at >= ${SINCE}`
      ).first(),
      db.prepare(
        `SELECT COUNT(*) n FROM (
           SELECT sid FROM ${T} WHERE sid IS NOT NULL AND created_at >= ${SINCE}
           GROUP BY sid HAVING COUNT(*) = 1
         )`
      ).first(),
      db.prepare(
        `SELECT AVG(engage_ms) t FROM ${T} WHERE engage_ms > 0 AND created_at >= ${SINCE}`
      ).first(),
      db.prepare(
        `SELECT COUNT(*) n FROM (
           SELECT vid FROM ${T} WHERE vid IS NOT NULL AND created_at >= ${SINCE}
           GROUP BY vid HAVING MIN(created_at) >= ${SINCE}
         )`
      ).first(),
      db.prepare(
        `SELECT date(created_at, '+8 hours') d, COUNT(*) pv, COUNT(DISTINCT vid) uv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY d ORDER BY d`
      ).all(),
      db.prepare(
        `SELECT path, COUNT(*) pv, COUNT(DISTINCT vid) uv, AVG(engage_ms) avg_ms
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY path ORDER BY pv DESC LIMIT 10`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(kind,''),'other') kind, COUNT(DISTINCT sid) sessions, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY kind ORDER BY pv DESC`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(ref_host,''),'直接访问') src, COUNT(DISTINCT sid) sessions, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY src ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(device,'—'),'—') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY device ORDER BY pv DESC`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(browser,'Other'),'Other') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY browser ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(os,'Other'),'Other') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY os ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(lang,'—'),'—') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY lang ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(country,''),'未知') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY country ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT created_at, path, COALESCE(NULLIF(kind,''),'other') kind, ref_host, country, device, engage_ms
         FROM ${T} WHERE created_at >= ${SINCE} ORDER BY created_at DESC LIMIT 30`
      ).all(),
      // 上一周期 PV（环比用）
      db.prepare(`SELECT COUNT(*) n FROM ${T} WHERE created_at >= ${sincePrev} AND created_at < ${SINCE}`).first(),
      // 实时：近 5 分钟浏览
      db.prepare(`SELECT COUNT(*) n FROM ${T} WHERE created_at >= datetime('now','-5 minutes')`).first(),
      // 每位访客的「首访日」分布（算每日新访客）
      db.prepare(`SELECT date(MIN(created_at), '+8 hours') fd, COUNT(*) n FROM ${T} WHERE vid IS NOT NULL GROUP BY vid`).all(),
      // 入口页 TOP（每会话的第一个页面）
      db.prepare(
        `SELECT path, COUNT(*) n FROM (
           SELECT sid, path, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY created_at) rn
           FROM ${T} WHERE sid IS NOT NULL AND created_at >= ${SINCE}
         ) WHERE rn = 1 GROUP BY path ORDER BY n DESC LIMIT 8`
      ).all(),
      // 会话深度分布（1 页 / 2-3 页 / 4 页以上）
      db.prepare(
        `SELECT SUM(CASE WHEN d = 1 THEN 1 ELSE 0 END) d1,
                SUM(CASE WHEN d BETWEEN 2 AND 3 THEN 1 ELSE 0 END) d23,
                SUM(CASE WHEN d >= 4 THEN 1 ELSE 0 END) d4p
         FROM (SELECT COUNT(*) d FROM ${T} WHERE sid IS NOT NULL AND created_at >= ${SINCE} GROUP BY sid)`
      ).first(),
    ]);

    // 每日新访客：按首访日聚合
    const newMap = {};
    (firstSeen.results || []).forEach((r) => { newMap[r.fd] = (newMap[r.fd] || 0) + r.n; });
    const dailyRows = (daily.results || []).map((r) => ({ ...r, new_uv: newMap[r.d] || 0 }));

  const sessions = cards?.sessions || 0;
  const pv = cards?.pv || 0;
  const prev = prevPv?.n || 0;
  return json({
    ok: true,
    days,
    cards: {
      pv,
      uv: cards?.uv || 0,
      sessions,
      bounce: sessions ? Math.round(((bounce?.n || 0) / sessions) * 100) : 0,
      avg_time_s: Math.round((avgTime?.t || 0) / 1000),
      new_uv: newUv?.n || 0,
      pages_per_session: sessions ? Math.round((pv / sessions) * 10) / 10 : 0,
      delta_pv: prev ? Math.round(((pv - prev) / prev) * 100) : null,
      live5: live?.n || 0,
    },
    daily: dailyRows,
    entries: entries.results || [],
    depth: { d1: depth?.d1 || 0, d23: depth?.d23 || 0, d4p: depth?.d4p || 0 },
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
  const bots = url.searchParams.get('bots') === '1';
  const T = bots ? 'visits' : '(SELECT * FROM visits WHERE is_bot = 0)';
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const { results } = await env.DB
    .prepare(
      `SELECT ${GID} gid, COUNT(*) views, COUNT(DISTINCT sid) sessions,
              MIN(created_at) first, MAX(created_at) last,
              MAX(country) country, MAX(device) device, MAX(browser) browser, MAX(os) os
       FROM ${T} GROUP BY gid ORDER BY last DESC LIMIT ?1 OFFSET ?2`
    )
    .bind(PAGE_SIZE, offset)
    .all();
  const total = (await env.DB.prepare(`SELECT COUNT(DISTINCT ${GID}) n FROM ${T}`).first())?.n || 0;

  return json({ ok: true, total, visitors: results || [] });
}

async function visitorDetail(env, gid) {
  const T = '(SELECT * FROM visits WHERE is_bot = 0)';
  const where = `${GID} = ?1`;
  const summary = await env.DB
    .prepare(`SELECT COUNT(*) n, MIN(created_at) first, MAX(created_at) last FROM ${T} WHERE ${where}`)
    .bind(gid)
    .first();
  const { results: sessions } = await env.DB
    .prepare(
      `SELECT sid, MIN(created_at) start, MAX(created_at) end, COUNT(*) views
       FROM ${T} WHERE ${where} AND sid IS NOT NULL GROUP BY sid ORDER BY start DESC LIMIT 50`
    )
    .bind(gid)
    .all();
  const { results: views } = await env.DB
    .prepare(
      `SELECT path, kind, ref_host, country, device, engage_ms, created_at
       FROM ${T} WHERE ${where} ORDER BY created_at DESC LIMIT 300`
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

/* ---------------- 商户管理（D1 merchants，M1） ---------------- */

const M_CATEGORIES = ['food', 'stay', 'specialty', 'fireworks', 'other'];
const M_TIERS = ['free', 'verified', 'featured'];
const M_STATUSES = ['pending', 'approved', 'rejected', 'expired'];
// 可编辑字段白名单（k → 最大长度；null = 数字）
const M_FIELDS = {
  name: 60, category: 20, tier: 10, intro: 200, detail: 4000,
  cover: 300, address: 120, phone: 30, wechat: 60, hours: 60,
  contact_name: 40, contact_phone: 30, slug: 60, status: 10,
  reject_reason: 200, paid_until: 10, sort_weight: null,
};
// 空串按 NULL 存的字段
const M_NULLABLE = ['detail', 'cover', 'address', 'phone', 'wechat', 'hours',
  'contact_name', 'contact_phone', 'slug', 'reject_reason', 'paid_until'];

function pickFields(body) {
  const out = {};
  for (const [k, max] of Object.entries(M_FIELDS)) {
    if (!(k in body)) continue;
    if (k === 'sort_weight') { out[k] = Math.max(0, Math.min(999, Number(body[k]) || 0)); continue; }
    let v = String(body[k] ?? '').trim().slice(0, max || 200);
    if (k === 'slug') v = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
    out[k] = M_NULLABLE.includes(k) && v === '' ? null : v;
  }
  return out;
}

async function listMerchants(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const counts = await env.DB.prepare('SELECT status, COUNT(*) n FROM merchants GROUP BY status').all();
  const byStatus = {};
  let total = 0;
  (counts.results || []).forEach((r) => { byStatus[r.status] = r.n; total += r.n; });

  const sql = M_STATUSES.includes(status)
    ? `SELECT * FROM merchants WHERE status = ?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3`
    : `SELECT * FROM merchants ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT ?1 OFFSET ?2`;
  const { results } = M_STATUSES.includes(status)
    ? await env.DB.prepare(sql).bind(status, PAGE_SIZE, offset).all()
    : await env.DB.prepare(sql).bind(PAGE_SIZE, offset).all();

  return json({ ok: true, total, byStatus, merchants: results || [] });
}

async function createMerchant(env, request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);
  const f = pickFields(body);
  if (!f.name || !M_CATEGORIES.includes(f.category)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ((f.tier && !M_TIERS.includes(f.tier)) || (f.status && !M_STATUSES.includes(f.status))) {
    return json({ ok: false, error: 'invalid_fields' }, 400);
  }
  const r = await env.DB.prepare(
    `INSERT INTO merchants (name, category, tier, intro, detail, cover, address, phone, wechat, hours,
      contact_name, contact_phone, slug, status, reject_reason, paid_until, sort_weight)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`
  )
    .bind(
      f.name, f.category, f.tier || 'free', f.intro ?? '', f.detail || null, f.cover || null,
      f.address || null, f.phone || null, f.wechat || null, f.hours || null,
      f.contact_name || null, f.contact_phone || null, f.slug || null,
      f.status || 'pending', f.reject_reason || null, f.paid_until || null, f.sort_weight || 0
    )
    .run();
  const newId = r.meta.last_row_id;
  // 直接以已上线状态新建且未给 slug：补 m<id>，保证有公开详情页
  if (f.status === 'approved' && !f.slug) {
    await env.DB.prepare("UPDATE merchants SET slug = ?1 WHERE id = ?2").bind('m' + newId, newId).run();
  }
  return json({ ok: true, id: newId });
}

async function editMerchant(env, id, request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);
  const f = pickFields(body);
  if ('category' in f && !M_CATEGORIES.includes(f.category)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('tier' in f && !M_TIERS.includes(f.tier)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('status' in f && !M_STATUSES.includes(f.status)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if (f.status === 'rejected' && !f.reject_reason) return json({ ok: false, error: 'reject_reason_required' }, 400);

  // 审核通过且还没有 slug：自动生成 m<id>
  if (f.status === 'approved' && !f.slug) {
    const row = await env.DB.prepare('SELECT slug FROM merchants WHERE id = ?1').bind(id).first();
    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    if (!row.slug) f.slug = 'm' + id;
  }

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k} = ?${vals.length + 1}`);
    vals.push(v);
  }
  if (!sets.length) return json({ ok: false, error: 'no_fields' }, 400);
  sets.push(`updated_at = datetime('now')`);
  const { meta } = await env.DB
    .prepare(`UPDATE merchants SET ${sets.join(', ')} WHERE id = ?${vals.length + 1}`)
    .bind(...vals, id)
    .run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
}

async function redeemMerchant(env, id, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  const tier = String(body?.tier || '');
  if (!M_TIERS.includes(tier) || tier === 'free') return json({ ok: false, error: 'invalid_tier' }, 400);
  const { meta } = await env.DB.prepare(
    `UPDATE merchants SET tier = ?1, paid_until = date('now', '+1 year'),
      tier_request = NULL, paid_requested_at = NULL, updated_at = datetime('now')
     WHERE id = ?2`
  ).bind(tier, id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
}

async function removeMerchant(env, id) {
  // 级联删除门户账号，避免孤儿账号残留
  const [, { meta }] = await env.DB.batch([
    env.DB.prepare('DELETE FROM merchant_users WHERE merchant_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM merchants WHERE id = ?1').bind(id),
  ]);
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

// 与商户门户同款：PBKDF2-SHA256(10 万次)，运营账号密码不明文存储
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
  /* 顶栏：对齐官网 .nav 的毛玻璃导航（logo 左 + 板块链接 + 官网入口/账号在右） */
  header.anav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(251,251,253,.8);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid rgba(0,0,0,.08);
  }
  .anav-inner {
    max-width: 1060px; margin: 0 auto; padding: 0 22px; height: 48px;
    display: flex; align-items: center; gap: 24px;
  }
  .anav-logo {
    display: inline-flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600;
    letter-spacing: .01em; white-space: nowrap; color: #1d1d1f; text-decoration: none;
  }
  .anav-logo img { width: 22px; height: 22px; display: block; }
  .anav-menu { display: flex; align-items: center; gap: 30px; margin-right: auto; }
  .anav-link {
    font-size: 12px; letter-spacing: .01em; color: rgba(29,29,31,.8);
    text-decoration: none; transition: color .2s;
  }
  .anav-link:hover { color: #1d1d1f; }
  .anav-link.active { color: #1d1d1f; font-weight: 600; }
  .anav-right { display: flex; align-items: center; gap: 12px; }
  /* 右上角账号菜单 */
  .acct { position: relative; }
  .acct-drop {
    position: absolute; right: 0; top: calc(100% + 10px); min-width: 180px; z-index: 120;
    background: #fff; border: 1px solid rgba(0,0,0,.06); border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.12); padding: 8px;
  }
  .acct-drop button {
    display: block; width: 100%; text-align: left; padding: 9px 12px; font-size: 13px;
    background: none; border: 0; border-radius: 8px; color: #1d1d1f; cursor: pointer;
  }
  .acct-drop button:hover { background: #f5f5f7; color: #1d1d1f; }
  .acct-cur { padding: 8px 12px 6px; font-size: 12px; color: #6e6e73; white-space: nowrap; }
  .acct-cur b { color: #1d1d1f; }
  .acct-sep { height: 1px; background: rgba(0,0,0,.06); margin: 6px 4px; }
  /* 移动端汉堡 + 抽屉（与官网同款：抽屉放 header 外，避免毛玻璃的包含块问题） */
  .anav-burger {
    display: none; width: 40px; height: 40px; position: relative;
    background: none; border: 0; padding: 0; cursor: pointer;
  }
  .anav-burger-line {
    position: absolute; left: 10px; right: 10px; height: 1.5px; background: #1d1d1f;
    transition: transform .3s, top .3s;
  }
  .anav-burger-line:nth-child(1) { top: 16px; }
  .anav-burger-line:nth-child(2) { top: 23px; }
  .anav-burger[aria-expanded="true"] .anav-burger-line:nth-child(1) { top: 19.5px; transform: rotate(45deg); }
  .anav-burger[aria-expanded="true"] .anav-burger-line:nth-child(2) { top: 19.5px; transform: rotate(-45deg); }
  .anav-drawer { display: none; }
  @media (max-width: 900px) {
    .anav-menu { display: none; }
    .anav-burger { display: block; }
    .anav-drawer {
      display: block; position: fixed; inset: 48px 0 0 0; z-index: 90;
      background: rgba(251,251,253,.96);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      backdrop-filter: saturate(180%) blur(20px);
      opacity: 0; visibility: hidden; transform: translateY(-8px);
      transition: opacity .3s, transform .3s, visibility .3s;
    }
    .anav-drawer.open { opacity: 1; visibility: visible; transform: none; }
    .anav-drawer-list { padding: 24px 40px; list-style: none; }
    .anav-drawer-item { padding: 13px 0; border-bottom: 1px solid rgba(0,0,0,.08); }
    .anav-drawer-item .anav-link { font-size: 15px; }
  }
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
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
  td, th { overflow-wrap: anywhere; }
  .panel.collapsible > h3 { cursor: pointer; user-select: none; }
  .panel.collapsible > h3::after { content: ' ▾'; color: #86868b; font-size: 11px; }
  .panel.collapsed > h3::after { content: ' ▸'; }
  .panel.collapsed > *:not(h3) { display: none; }
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
  <p class="sub">whizzzest.com 站点数据管理</p>
  <label for="user">用户名（选填，运营账号）</label>
  <input id="user" autocomplete="username" placeholder="主账号「站长」留空即可">
  <label for="pw">密码</label>
  <input id="pw" type="password" autocomplete="current-password" required>
  <button id="btn" type="submit">登 录</button>
  <div class="err" id="err"></div>
</form>
<script>
document.getElementById('user').value = new URLSearchParams(location.search).get('u') || '';
var f = document.getElementById('f');
f.addEventListener('submit', function (e) {
  e.preventDefault();
  var btn = document.getElementById('btn');
  var err = document.getElementById('err');
  btn.disabled = true; err.style.display = 'none';
  fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('user').value, password: document.getElementById('pw').value })
  }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
    .then(function (r) {
      if (r.s === 200 && r.d.ok) { location.href = '/'; return; }
      var msg = r.d.error === 'rate_limited' ? '尝试过于频繁，请 10 分钟后再试'
        : r.d.error === 'config_missing' ? '服务端未配置凭据'
        : r.d.error === 'invalid_credentials' ? '用户名或密码不正确' : '登录失败，请重试';
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
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 14px 0 0; }
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
  /* 商户管理 */
  .mgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 14px; }
  .mgrid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #6e6e73; }
  .mgrid label.wide { grid-column: 1 / -1; }
  .mgrid input, .mgrid select, .mgrid textarea {
    padding: 9px 12px; font-size: 14px; color: #1d1d1f; background: #f5f5f7;
    border: 1px solid transparent; border-radius: 10px; outline: none; font-family: inherit;
    transition: border-color .2s, background .2s;
  }
  .mgrid input:focus, .mgrid select:focus, .mgrid textarea:focus { border-color: #d64524; background: #fff; }
  .mst { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
  .mst-pending { background: #fdeee8; color: #d64524; }
  .mst-approved { background: #e5f3e8; color: #1a7f37; }
  .mst-rejected { background: #f0f0f2; color: #6e6e73; }
  .mst-expired { background: #fbf3dd; color: #9a6b00; }
  .mrow-pay { margin-top: 10px; padding: 8px 12px; background: #fbf3dd; color: #9a6b00; border-radius: 10px; font-size: 13px; }
  .mslug { font-size: 12px; color: #6e6e73; }
  .mslug:hover { color: #d64524; }
  @media (max-width: 900px) {
    .cards { grid-template-columns: repeat(3, 1fr); }
    .grid3, .grid2 { grid-template-columns: 1fr; }
    .mgrid { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 560px) {
    .cards { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<header class="anav">
  <div class="anav-inner">
    <a class="anav-logo" href="/" aria-label="焰境·万载 管理后台">
      <img src="${FAVICON_URI}" alt="" width="22" height="22" aria-hidden="true">焰境·万载
    </a>
    <nav class="anav-menu" aria-label="后台板块">
      <a class="anav-link active" id="vtab-msg" href="#/msg">留言</a>
      <a class="anav-link" id="vtab-visit" href="#/visit">访客</a>
      <a class="anav-link" id="vtab-merch" href="#/merch">商户</a>
      <a class="anav-link" id="vtab-acct" href="#/acct">账号</a>
    </nav>
    <div class="anav-right">
      <a class="anav-link" href="https://whizzzest.com/" target="_blank" rel="noopener">前往官网 ↗</a>
      <button id="refresh" type="button">刷新</button>
      <div class="acct" id="acct-box">
        <button id="acct-chip" type="button" title="账号菜单"><span id="acct-name">…</span> ▾</button>
        <div class="acct-drop" id="acct-drop" hidden></div>
      </div>
      <button class="anav-burger" id="burger" type="button" aria-label="打开菜单" aria-expanded="false" aria-controls="anav-drawer">
        <span class="anav-burger-line" aria-hidden="true"></span>
        <span class="anav-burger-line" aria-hidden="true"></span>
      </button>
    </div>
  </div>
</header>
<div class="anav-drawer" id="anav-drawer">
  <ul class="anav-drawer-list" aria-label="后台板块">
    <li class="anav-drawer-item"><a class="anav-link" href="#/msg">留言</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="#/visit">访客</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="#/merch">商户</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="#/acct">账号</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="https://whizzzest.com/" target="_blank" rel="noopener">前往官网 ↗</a></li>
    <li class="anav-drawer-item"><a class="anav-link" id="logout-m" href="#">退出登录</a></li>
  </ul>
</div>

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
    <button class="tab" data-days="180" type="button">180 天</button>
    <button class="tab" data-days="365" type="button">365 天</button>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#6e6e73">
      <input id="include-bots" type="checkbox">包含扫描/机器人
    </label>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#6e6e73">
      <input id="auto-refresh" type="checkbox" checked>30s 自动刷新
    </label>
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
    <div class="card2"><b id="c-pps">–</b><span>页 / 会话</span></div>
    <div class="card2"><b id="c-delta">–</b><span>浏览量环比</span></div>
    <div class="card2"><b id="c-live">–</b><span>5 分钟内活跃</span></div>
  </div>
  <div class="panel">
    <h3>每日浏览与访客</h3>
    <div class="legend"><span><i style="background:#d64524"></i>浏览量</span><span><i style="background:#8ab4ff"></i>访客数</span><span><i style="background:#f2a03d"></i>新访客</span><span id="chart-empty" style="margin-left:auto"></span></div>
    <svg class="chart" id="chart" viewBox="0 0 1000 240" preserveAspectRatio="none"></svg>
  </div>
  <div class="panel">
    <h3>热门页面</h3>
    <table><colgroup><col style="width:52%"><col style="width:15%"><col style="width:15%"><col style="width:18%"></colgroup><thead><tr><th>路径</th><th>浏览</th><th>访客</th><th>平均停留</th></tr></thead><tbody id="top-pages"></tbody></table>
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
  <div class="grid2" style="margin-top:14px">
    <div class="panel" style="margin:0"><h3>入口页 TOP（每会话首站）</h3><div id="entries"></div></div>
    <div class="panel" style="margin:0"><h3>会话浏览深度</h3><div id="depth"></div></div>
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

<div id="view-merch" class="wrap" style="display:none">
  <div class="range">
    <button class="tab active" data-mst="" type="button">全部</button>
    <button class="tab" data-mst="pending" type="button">待审核</button>
    <button class="tab" data-mst="approved" type="button">已上线</button>
    <button class="tab" data-mst="rejected" type="button">已驳回</button>
    <button class="tab" data-mst="expired" type="button">已过期</button>
    <span class="updated" id="mstats"></span>
    <button id="madd" type="button" class="primary">新增商户</button>
  </div>
  <div class="panel" id="mform" style="display:none">
    <h3 id="mform-title">新增商户</h3>
    <div class="mgrid">
      <label>名称 *<input id="f-name"></label>
      <label>分类
        <select id="f-cat">
          <option value="food">美食</option><option value="stay">住宿</option>
          <option value="specialty">特产</option><option value="fireworks">花炮</option>
          <option value="other">其他</option>
        </select>
      </label>
      <label>等级
        <select id="f-tier">
          <option value="free">基础（免费）</option>
          <option value="verified">认证商户</option>
          <option value="featured">置顶推荐</option>
        </select>
      </label>
      <label>状态
        <select id="f-status">
          <option value="pending">待审核</option>
          <option value="approved">已上线</option>
          <option value="rejected">已驳回</option>
          <option value="expired">已过期</option>
        </select>
      </label>
      <label>Slug（上线地址，留空自动 m<id）<input id="f-slug" placeholder="liuda-wan"></label>
      <label>付费到期（YYYY-MM-DD，空 = 免费期）<input id="f-paid" placeholder="2027-09-06"></label>
      <label>置顶权重（大者靠前）<input id="f-weight" type="number" value="0"></label>
      <label class="wide">封面图 URL（可用站内图 /assets/img/…）<input id="f-cover" placeholder="/assets/img/wanzaizha1rou.jpeg"></label>
      <label class="wide">一句话简介（卡片展示）<input id="f-intro"></label>
      <label class="wide">详情（空行自动分段）<textarea id="f-detail" rows="4"></textarea></label>
      <label>地址<input id="f-address"></label>
      <label>电话<input id="f-phone"></label>
      <label>微信号<input id="f-wechat"></label>
      <label>营业时间<input id="f-hours"></label>
      <label>联系人（不公开）<input id="f-cname"></label>
      <label>联系电话（不公开）<input id="f-cphone"></label>
    </div>
    <div class="ops"><button class="primary" id="fsave" type="button">保存</button><button id="fcancel" type="button">取消</button></div>
  </div>
  <div class="list" id="mlist"><p class="empty">加载中…</p></div>
  <button class="more" id="mmore" type="button" style="display:none">加载更多</button>
</div>

<div id="view-acct" class="wrap" style="display:none">
  <div class="panel">
    <h3>当前登录</h3>
    <p id="acct-now" style="font-size:15px;font-weight:600"></p>
    <p class="tip" style="margin-top:6px">主账号「站长」的密码由服务器密钥 ADMIN_PASSWORD 配置，此处不可修改；下方添加的运营账号与其权限相同。切换账号：右上角账号菜单，或列表中的「切换到此账号」。</p>
  </div>
  <div class="panel">
    <h3>添加账号</h3>
    <div class="mgrid" style="grid-template-columns:1fr 1fr;max-width:520px">
      <label>用户名（2-20 位字母/数字/_/-）<input id="a-user" maxlength="20" autocomplete="off"></label>
      <label>密码（至少 8 位）<input id="a-pass" type="password" maxlength="64" autocomplete="new-password"></label>
    </div>
    <div class="ops" style="margin-top:12px"><button class="primary" id="a-add" type="button">添加账号</button></div>
  </div>
  <div class="panel">
    <h3>运营账号</h3>
    <div class="vwrap"><table>
      <thead><tr><th>用户名</th><th>创建时间</th><th style="width:15em">操作</th></tr></thead>
      <tbody id="alist"><tr><td colspan="3" class="empty">加载中…</td></tr></tbody>
    </table></div>
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

/* ---------- 视图切换（当前板块记在 location.hash：刷新/前进后退不丢） ---------- */
var VIEWS = ['msg', 'visit', 'merch', 'acct'];
var suppressHash = false;
function showView(v, skipHash) {
  if (VIEWS.indexOf(v) === -1) v = 'msg';
  currentView = v;
  el('view-msg').style.display = v === 'msg' ? '' : 'none';
  el('view-visit').style.display = v === 'visit' ? '' : 'none';
  el('view-merch').style.display = v === 'merch' ? '' : 'none';
  el('view-acct').style.display = v === 'acct' ? '' : 'none';
  el('vtab-msg').classList.toggle('active', v === 'msg');
  el('vtab-visit').classList.toggle('active', v === 'visit');
  el('vtab-merch').classList.toggle('active', v === 'merch');
  el('vtab-acct').classList.toggle('active', v === 'acct');
  if (v === 'msg') load(true);
  if (v === 'visit') { loadStats(); loadVisitors(true); }
  if (v === 'merch') loadMerchants(true);
  if (v === 'acct') loadAccounts();
  if (!skipHash && '#/' + v !== location.hash) {
    suppressHash = true;
    location.hash = '/' + v;
  }
}
window.addEventListener('hashchange', function () {
  if (suppressHash) { suppressHash = false; return; }
  showView(hashView(), true);
});
// 注意：APP_HTML 是模板字符串，内嵌脚本里写不了 /\/?/ 正则（\ 会被外层吃掉），用字符串替换解析 hash
function hashView() {
  return (location.hash || '').replace('#/', '').replace('#', '');
}
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
var includeBots = false;
var autoRefresh = true;

function loadStats() {
  el('updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  api('/api/stats?days=' + visitDays + (includeBots ? '&bots=1' : '')).then(function (d) {
    el('c-pv').textContent = d.cards.pv;
    el('c-uv').textContent = d.cards.uv;
    el('c-sessions').textContent = d.cards.sessions;
    el('c-bounce').textContent = d.cards.bounce + '%';
    el('c-avg').textContent = fmtDur(d.cards.avg_time_s);
    el('c-new').textContent = d.cards.uv ? Math.round((d.cards.new_uv / d.cards.uv) * 100) + '%' : '0%';
    el('c-pps').textContent = d.cards.pages_per_session;
    var dl = d.cards.delta_pv;
    el('c-delta').textContent = dl === null ? '—' : (dl >= 0 ? '▲ ' : '▼ ') + Math.abs(dl) + '%';
    el('c-delta').style.color = dl === null ? '#6e6e73' : (dl >= 0 ? '#1a7f37' : '#d64524');
    el('c-live').textContent = d.live5;
    drawChart(d.daily || []);
    fillTable('top-pages', d.top_pages, function (p) {
      return '<tr><td>' + esc(p.path) + '</td><td>' + p.pv + '</td><td>' + p.uv + '</td><td>' + fmtDur(p.avg_s) + '</td></tr>';
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
    fillBars('entries', (d.entries || []).map(function (x) { return { label: x.path, uv: x.n, pv: x.n }; }), true);
    var dp = d.depth || {};
    fillBars('depth', [
      { label: '只看 1 页', uv: dp.d1, pv: dp.d1 },
      { label: '2-3 页', uv: dp.d23, pv: dp.d23 },
      { label: '4 页以上', uv: dp.d4p, pv: dp.d4p },
    ], true);
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
  // 行回调须返回 <tr>…</tr>；漏写时兜底补上 —— 否则全部单元格并入一行，
  // fixed 布局下多出的列宽为 0，路径文字会 1 字/行竖排（热门页面表格曾踩此坑）
  el(id).innerHTML = (rows && rows.length)
    ? rows.map(function (x) { var r = fn(x); return /^<tr[\s>]/.test(r) ? r : '<tr>' + r + '</tr>'; }).join('')
    : '<tr><td class="empty">暂无数据</td></tr>';
}

function fillBars(id, rows, single) {
  var max = 0;
  (rows || []).forEach(function (r) { if (r.pv > max) max = r.pv; });
  el(id).innerHTML = (rows && rows.length)
    ? rows.map(function (r) {
        var w = max ? Math.round((r.pv / max) * 100) : 0;
        return '<div class="bar-row"><span class="label" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
          '<b>' + (single ? r.pv : r.uv + ' 访客 · ' + r.pv + ' 浏览') + '</b></div>';
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
    '<polyline points="' + pts('new_uv') + '" fill="none" stroke="#f2a03d" stroke-width="2" stroke-linejoin="round" stroke-dasharray="6 4"/>' +
    daily.map(function (d, i) {
      return '<circle cx="' + (PAD + i * step).toFixed(1) + '" cy="' + y(d.pv).toFixed(1) + '" r="3" fill="#d64524"/>' +
        '<circle cx="' + (PAD + i * step).toFixed(1) + '" cy="' + y(d.uv).toFixed(1) + '" r="3" fill="#8ab4ff"/>';
    }).join('') + xLabels;
}

var vOffset = 0;
function loadVisitors(reset) {
  if (reset) { vOffset = 0; el('vlist').innerHTML = '<tr><td colspan="7" class="empty">加载中…</td></tr>'; }
  api('/api/visitors?offset=' + vOffset + (includeBots ? '&bots=1' : '')).then(function (d) {
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
    api('/api/visitors/' + encodeURIComponent(v.gid) + (includeBots ? '&bots=1' : '')).then(function (d) {
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
el('include-bots').addEventListener('change', function (e) { includeBots = e.target.checked; loadStats(); loadVisitors(true); });
el('auto-refresh').addEventListener('change', function (e) { autoRefresh = e.target.checked; });
setInterval(function () {
  if (currentView === 'visit' && autoRefresh && document.visibilityState === 'visible') { loadStats(); loadVisitors(false); }
}, 30000);
document.querySelectorAll('#view-visit .panel').forEach(function (p) {
  p.classList.add('collapsible');
  p.querySelector('h3').addEventListener('click', function () { p.classList.toggle('collapsed'); });
});
el('refresh').addEventListener('click', function () {
  if (currentView === 'visit') { loadStats(); loadVisitors(true); }
  else if (currentView === 'merch') { loadMerchants(true); }
  else if (currentView === 'acct') { loadAccounts(); }
  else { load(true); }
});
el('more').addEventListener('click', function () { state.offset += ${PAGE_SIZE}; load(false); });
el('vmore').addEventListener('click', function () { vOffset += ${PAGE_SIZE}; loadVisitors(false); });

/* ---------- 商户管理 ---------- */
var mState = { status: '', offset: 0 };
var editingId = null;
var M_CAT = { food: '美食', stay: '住宿', specialty: '特产', fireworks: '花炮', other: '其他' };
var M_STATUS = { pending: '待审核', approved: '已上线', rejected: '已驳回', expired: '已过期' };
var M_TIER = { free: '基础', verified: '认证', featured: '置顶' };

document.querySelectorAll('#view-merch .range [data-mst]').forEach(function (b) {
  b.addEventListener('click', function () {
    mState.status = b.getAttribute('data-mst');
    document.querySelectorAll('#view-merch .range [data-mst]').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    loadMerchants(true);
  });
});

function loadMerchants(reset) {
  if (reset) mState.offset = 0;
  var q = '?offset=' + mState.offset + (mState.status ? '&status=' + mState.status : '');
  api('/api/merchants' + q).then(function (d) {
    var list = d.merchants || [];
    var counts = d.byStatus || {};
    el('mstats').textContent = '共 ' + d.total + ' 家 · 待审核 ' + (counts.pending || 0) + ' · 已上线 ' + (counts.approved || 0);
    var box = el('mlist');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">还没有商户，点右上「新增商户」录入第一家。</p>';
    } else {
      list.forEach(function (x) { box.appendChild(renderMerchant(x)); });
    }
    el('mmore').style.display = (mState.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('mlist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderMerchant(x) {
  var div = document.createElement('div');
  div.className = 'msg' + (x.status !== 'pending' ? ' read' : '');
  var meta = [];
  if (x.address) meta.push(x.address);
  if (x.phone) meta.push('☎ ' + x.phone);
  if (x.contact_name) meta.push('联系人 ' + x.contact_name + (x.contact_phone ? ' ' + x.contact_phone : ''));
  if (x.paid_until) {
    var overdue = x.paid_until < new Date().toISOString().slice(0, 10);
    meta.push((overdue ? '⚠️已到期 ' : '付费到期 ') + x.paid_until);
  }
  var redeemBadge = x.tier_request
    ? '<div class="mrow-pay">💰 待核销：申请「' + esc(M_TIER[x.tier_request] || x.tier_request) + '」' +
      (x.paid_requested_at ? '（' + esc(x.paid_requested_at) + ' 提交）' : '') + '</div>'
    : '';
  div.innerHTML =
    '<div class="row1"><span class="name">' + esc(x.name) + '</span>' +
    '<span class="k-badge">' + esc(M_CAT[x.category] || x.category) + '</span>' +
    '<span class="k-badge">' + esc(M_TIER[x.tier] || x.tier) + '</span>' +
    '<span class="mst mst-' + esc(x.status) + '">' + esc(M_STATUS[x.status] || x.status) + '</span>' +
    (x.slug && x.status === 'approved'
      ? '<a class="mslug" href="https://whizzzest.com/merchants/' + esc(x.slug) + '/" target="_blank" rel="noopener">查看页面 ↗</a>'
      : '') +
    '</div>' +
    (x.intro ? '<div class="time">' + esc(x.intro) + '</div>' : '') +
    (x.reject_reason ? '<div class="meta">驳回原因：' + esc(x.reject_reason) + '</div>' : '') +
    redeemBadge +
    (meta.length ? '<div class="meta">' + esc(meta.join(' · ')) + '</div>' : '') +
    '<div class="ops">' +
    (x.status === 'pending'
      ? '<button type="button" data-act="ok" class="primary">通过上线</button><button type="button" data-act="rej">驳回</button>' : '') +
    (x.tier_request
      ? '<button type="button" data-act="redeem" class="primary">确认收款 · 开通' + esc(M_TIER[x.tier_request] || x.tier_request) + '</button>' : '') +
    (x.status === 'approved' && !x.tier_request ? '<button type="button" data-act="off">下线</button>' : '') +
    '<button type="button" data-act="edit">编辑</button>' +
    '<button type="button" data-act="del">删除</button></div>';
  div.querySelector('.ops').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'ok') {
      api('/api/merchants/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved' })
      }).then(function () { loadMerchants(true); });
    } else if (act === 'rej') {
      var reason = prompt('驳回原因（会展示给商户）：');
      if (reason === null) return;
      api('/api/merchants/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', reject_reason: reason || '资料待完善' })
      }).then(function () { loadMerchants(true); });
    } else if (act === 'off') {
      api('/api/merchants/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'expired' })
      }).then(function () { loadMerchants(true); });
    } else if (act === 'redeem') {
      if (!confirm('确认已收到「' + x.name + '」的' + (M_TIER[x.tier_request] || x.tier_request) + '年费？将开通一年并清除待核销。')) return;
      api('/api/merchants/' + x.id + '/redeem', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier: x.tier_request })
      }).then(function () { loadMerchants(true); });
    } else if (act === 'edit') {
      openForm(x);
    } else if (act === 'del') {
      if (!confirm('确定删除「' + x.name + '」？不可恢复。')) return;
      api('/api/merchants/' + x.id, { method: 'DELETE' }).then(function () { loadMerchants(true); });
    }
  });
  return div;
}

function val(id) { return el(id).value.trim(); }

function openForm(x) {
  editingId = x ? x.id : null;
  el('mform-title').textContent = x ? '编辑商户 #' + x.id : '新增商户';
  el('f-name').value = x ? x.name || '' : '';
  el('f-cat').value = x ? x.category || 'food' : 'food';
  el('f-tier').value = x ? x.tier || 'free' : 'free';
  el('f-status').value = x ? x.status || 'pending' : 'pending';
  el('f-slug').value = x ? x.slug || '' : '';
  el('f-paid').value = x ? x.paid_until || '' : '';
  el('f-weight').value = x ? x.sort_weight || 0 : 0;
  el('f-cover').value = x ? x.cover || '' : '';
  el('f-intro').value = x ? x.intro || '' : '';
  el('f-detail').value = x ? x.detail || '' : '';
  el('f-address').value = x ? x.address || '' : '';
  el('f-phone').value = x ? x.phone || '' : '';
  el('f-wechat').value = x ? x.wechat || '' : '';
  el('f-hours').value = x ? x.hours || '' : '';
  el('f-cname').value = x ? x.contact_name || '' : '';
  el('f-cphone').value = x ? x.contact_phone || '' : '';
  el('mform').style.display = '';
  el('mform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() { el('mform').style.display = 'none'; editingId = null; }

el('madd').addEventListener('click', function () { openForm(null); });
el('fcancel').addEventListener('click', closeForm);
el('fsave').addEventListener('click', function () {
  var payload = {
    name: val('f-name'), category: val('f-cat'), tier: val('f-tier'), status: val('f-status'),
    slug: val('f-slug'), paid_until: val('f-paid'), sort_weight: Number(val('f-weight') || 0),
    cover: val('f-cover'), intro: val('f-intro'), detail: val('f-detail'),
    address: val('f-address'), phone: val('f-phone'), wechat: val('f-wechat'), hours: val('f-hours'),
    contact_name: val('f-cname'), contact_phone: val('f-cphone')
  };
  if (!payload.name) { alert('请填写商户名称'); return; }
  api(editingId ? '/api/merchants/' + editingId : '/api/merchants', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function () { closeForm(); loadMerchants(true); })
    .catch(function (e) { if (e.message !== 'unauthorized') alert('保存失败：' + e.message); });
});
el('mmore').addEventListener('click', function () { mState.offset += ${PAGE_SIZE}; loadMerchants(false); });

/* ---------- 账号管理（运营账号，权限与主账号相同） ---------- */
var me = '';
function setAccountUI(name) {
  me = name || '';
  el('acct-name').textContent = me || '…';
  el('acct-now').textContent = me ? '当前账号：' + me : '';
}
api('/api/me').then(function (d) { setAccountUI(d.user); }).catch(function () {});

function loadAccounts() {
  api('/api/accounts').then(function (d) {
    var rows = (d.accounts || []).map(function (a) {
      return '<tr><td>' + esc(a.username) + '</td><td>' + esc(fmtTime(a.created_at)) + '</td>' +
        '<td><div class="ops" style="margin-top:0"><button type="button" data-switch="' + esc(a.username) + '">切换到此账号</button>' +
        '<button type="button" data-del="' + a.id + '">删除</button></div></td></tr>';
    }).join('');
    el('alist').innerHTML = rows || '<tr><td colspan="3" class="empty">还没有运营账号，用上方表单添加。</td></tr>';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('alist').innerHTML = '<tr><td colspan="3" class="empty">加载失败：' + esc(e.message) + '</td></tr>';
  });
}
el('a-add').addEventListener('click', function () {
  var u = el('a-user').value.trim(), p = el('a-pass').value;
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(u)) { alert('用户名需 2-20 位字母/数字/下划线/连字符'); return; }
  if (p.length < 8) { alert('密码至少 8 位'); return; }
  api('/api/accounts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  }).then(function () { el('a-user').value = ''; el('a-pass').value = ''; loadAccounts(); })
    .catch(function (e) {
      if (e.message === 'unauthorized') return;
      alert(({
        bad_username: '用户名格式不正确', bad_password: '密码至少 8 位',
        dup_username: '用户名已存在', too_many: '账号数量已达上限（10 个）'
      })[e.message] || '添加失败：' + e.message);
    });
});
el('alist').addEventListener('click', function (e) {
  var sw = e.target.getAttribute('data-switch');
  var del = e.target.getAttribute('data-del');
  if (sw !== null) {
    api('/api/logout', { method: 'POST' }).then(function () { location.href = '/login?u=' + encodeURIComponent(sw); });
  } else if (del) {
    if (!confirm('确定删除该账号？其登录将立即失效。')) return;
    api('/api/accounts/' + del, { method: 'DELETE' }).then(loadAccounts);
  }
});

/* ---------- 右上角账号菜单：切换 / 添加 / 退出 ---------- */
var drop = el('acct-drop');
el('acct-chip').addEventListener('click', function () {
  if (drop.hidden) { renderDrop(); drop.hidden = false; }
  else drop.hidden = true;
});
document.addEventListener('click', function (e) {
  if (!el('acct-box').contains(e.target)) drop.hidden = true;
});
function renderDrop() {
  api('/api/accounts').then(function (d) {
    var html = '<div class="acct-cur">当前账号：<b>' + esc(me || '站长') + '</b></div><div class="acct-sep"></div>';
    if (me && me !== '站长') html += '<button type="button" data-switch="">切换到 站长</button>';
    (d.accounts || []).forEach(function (a) {
      if (a.username !== me) html += '<button type="button" data-switch="' + esc(a.username) + '">切换到 ' + esc(a.username) + '</button>';
    });
    html += '<div class="acct-sep"></div>' +
      '<button type="button" data-act="add">添加账号…</button>' +
      '<button type="button" data-act="logout">退出登录</button>';
    drop.innerHTML = html;
  }).catch(function () { drop.innerHTML = '<button type="button" data-act="logout">退出登录</button>'; });
}
drop.addEventListener('click', function (e) {
  var act = e.target.getAttribute('data-act');
  var sw = e.target.getAttribute('data-switch');
  if (sw !== null) {
    api('/api/logout', { method: 'POST' }).then(function () { location.href = sw ? '/login?u=' + encodeURIComponent(sw) : '/login'; });
  } else if (act === 'add') {
    drop.hidden = true;
    showView('acct');
  } else if (act === 'logout') {
    api('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
  }
});

/* ---------- 移动端抽屉 ---------- */
var burger = el('burger'), drawer = el('anav-drawer');
burger.addEventListener('click', function () {
  var open = drawer.classList.toggle('open');
  burger.setAttribute('aria-expanded', open ? 'true' : 'false');
});
drawer.addEventListener('click', function (e) {
  if (e.target.closest('a')) {
    drawer.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  }
});
el('logout-m').addEventListener('click', function (e) {
  e.preventDefault();
  api('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
});

/* 初始视图：从 location.hash 恢复（如 #/visit），无 hash 回留言 */
showView(hashView() || 'msg', true);
</script>
</body>
</html>`;
