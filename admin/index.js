/**
 * 焰境·万载 — 管理后台 Worker（admin.whizzzest.com，整域即后台）
 *
 * 安全层次：Cloudflare Access（第一道门，dashboard 开通）→ 本应用账号登录（第二道门）
 *  - GET  /login                 登录页（用户名选填：留空 = 主账号「站长」ADMIN_PASSWORD）
 *  - GET  /                      管理页（留言 / 访客 / 商户 / 视频 / 文库 / 音乐 / 景点 / 账号；视图记忆在 location.hash，刷新不丢）
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
 * 万载TV 视频管理（docs/万载TV方案.md）：
 *  - GET/POST /api/tv             视频列表 / 新建（JSON 元数据）
 *  - POST /api/tv/:id             部分更新（发布/隐藏、焦点位；换文件/封面时级联删旧 R2 对象）
 *  - DELETE /api/tv/:id           删除（级联清理 R2 视频/封面）
 *  - PUT /api/tv/upload?ext=mp4   视频流式上传（File 直作 body → request.body 转发 R2，≤95MB）
 *  - PUT /api/tv/cover            封面上传（≤5MB，魔数校验 JPG/PNG/WebP）
 *
 * 访客分析（数据来自主站 Worker 写入的 visits 表）：
 *  - GET  /api/stats?days=7|30|90   概览卡片 + 每日趋势 + 页面/来源/设备/浏览器/OS/语言/地区 + 最近浏览
 *  - GET  /api/visitors             访客列表（?offset=0），按匿名 Cookie ID / IP 分组
 *  - GET  /api/visitors/:gid        单个访客的会话与页面轨迹
 *
 * 万载音乐管理（2026-09-06）：
 *  - GET/POST /api/music           曲目列表（?status=&offset=）/ 新建（JSON 元数据）
 *  - POST /api/music/:id           部分更新（上下线、排序；换音频/封面时级联删旧 R2 对象）
 *  - DELETE /api/music/:id         删除（级联清理 R2 音频/封面）
 *  - PUT /api/music/upload         MP3 流式上传（File 直作 body，魔数校验 ID3/MPEG，≤50MB）
 *  - PUT /api/music/cover          封面上传（≤5MB，魔数校验 JPG/PNG/WebP，music/c-* 前缀）
 *
 * 旅游景点管理（2026-09-06）：
 *  - GET/POST /api/attractions     景点列表（?status=&offset=）/ 新建（slug 唯一）
 *  - POST /api/attractions/:id     部分更新（上下线、排序；换封面时级联删旧 R2 对象）
 *  - DELETE /api/attractions/:id   删除（级联清理 R2 封面）
 *  - PUT /api/attractions/cover    封面上传（≤5MB，attra/c-* 前缀）
 *
 * AI 助手「花傩」管理（docs/AI助手方案.md）：
 *  - GET/POST /api/ai/settings     运行设置（enabled/model/system_prompt/greeting/quick_questions）
 *  - GET/POST /api/ai/knowledge    知识库列表（?status=&offset=）/ 新建
 *  - POST/DELETE /api/ai/knowledge/:id  编辑 / 删除
 *  - GET /api/ai/stats             用量统计（今日/7天/30天/累计 + 最近 20 条问答）
 *  - DELETE /api/ai/log            清空问答日志
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
        "img-src 'self' data: https://whizzzest.com", // 视频封面缩略图来自主站（/assets 或 /media 代理）
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

  // 商户管理（M1，docs/商户功能方案.md）；DELETE 级联删除门户账号 + R2 图片
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

  // 万载TV 视频管理（docs/万载TV方案.md）；DELETE 级联删除 R2 视频/封面
  if (path === '/api/tv' && method === 'GET') return listVideos(env, request);
  if (path === '/api/tv' && method === 'POST') return saveVideo(env, request);
  if ((m = path.match(/^\/api\/tv\/(\d+)$/)) && method === 'POST') {
    return saveVideo(env, request, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/tv\/(\d+)$/)) && method === 'DELETE') {
    return removeVideo(env, Number(m[1]));
  }
  // 流式上传：视频 File 直作 PUT body（Worker 转发 request.body → R2，不整读内存）；封面 ≤5MB
  if (path === '/api/tv/upload' && method === 'PUT') return uploadVideoFile(env, request);
  if (path === '/api/tv/cover' && method === 'PUT') return uploadVideoCover(env, request);
  // 从B站拉取信息：标题/简介/时长 + 封面转存 R2（B站图床有 Referer 防盗链，服务端抓回转存绕开）
  if (path === '/api/tv/fetch-bili' && method === 'POST') return fetchBili(env, request);

  // 文库管理（docs/文库方案.md）：作品审核 + 章节审核；DELETE 级联章节与 R2 图片
  if (path === '/api/books' && method === 'GET') return listBooks(env, request);
  if (path === '/api/books' && method === 'POST') return createBook(env, request);
  if ((m = path.match(/^\/api\/books\/(\d+)$/)) && method === 'POST') {
    return updateBook(env, Number(m[1]), request);
  }
  if ((m = path.match(/^\/api\/books\/(\d+)$/)) && method === 'DELETE') {
    return removeBook(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/books\/(\d+)\/chapters$/)) && method === 'GET') {
    return listBookChapters(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/books\/(\d+)\/chapters\/(\d+)$/)) && method === 'POST') {
    return reviewChapter(env, Number(m[1]), Number(m[2]), request);
  }
  if ((m = path.match(/^\/api\/books\/(\d+)\/chapters\/(\d+)$/)) && method === 'DELETE') {
    return removeChapter(env, Number(m[1]), Number(m[2]));
  }

  // 万载音乐管理（2026-09-06）：曲目 CRUD + MP3/封面上传；DELETE 级联清理 R2 音频/封面
  if (path === '/api/music' && method === 'GET') return listTracks(env, request);
  if (path === '/api/music' && method === 'POST') return saveTrack(env, request);
  if ((m = path.match(/^\/api\/music\/(\d+)$/)) && method === 'POST') {
    return saveTrack(env, request, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/music\/(\d+)$/)) && method === 'DELETE') {
    return removeTrack(env, Number(m[1]));
  }
  // 流式上传：MP3 File 直作 PUT body（request.body 探魔数后续流转发 R2，≤50MB）；封面 ≤5MB
  if (path === '/api/music/upload' && method === 'PUT') return uploadTrackFile(env, request);
  if (path === '/api/music/cover' && method === 'PUT') return uploadImageR2(env, request, 'music/c-');

  // 旅游景点管理（2026-09-06）：CRUD + 封面上传；DELETE 级联清理 R2 封面
  if (path === '/api/attractions' && method === 'GET') return listAttractions(env, request);
  if (path === '/api/attractions' && method === 'POST') return saveAttraction(env, request);
  if ((m = path.match(/^\/api\/attractions\/(\d+)$/)) && method === 'POST') {
    return saveAttraction(env, request, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/attractions\/(\d+)$/)) && method === 'DELETE') {
    return removeAttraction(env, Number(m[1]));
  }
  if (path === '/api/attractions/cover' && method === 'PUT') return uploadImageR2(env, request, 'attra/c-');

  // AI 助手「花傩」管理（docs/AI助手方案.md）：设置 / 知识库 / 用量
  if (path === '/api/ai/settings' && method === 'GET') return getAiSettings(env);
  if (path === '/api/ai/settings' && method === 'POST') return saveAiSettings(env, request);
  if (path === '/api/ai/knowledge' && method === 'GET') return listKnowledge(env, request);
  if (path === '/api/ai/knowledge' && method === 'POST') return saveKnowledge(env, request);
  if ((m = path.match(/^\/api\/ai\/knowledge\/(\d+)$/)) && method === 'POST') {
    return saveKnowledge(env, request, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/ai\/knowledge\/(\d+)$/)) && method === 'DELETE') {
    return removeKnowledge(env, Number(m[1]));
  }
  if (path === '/api/ai/stats' && method === 'GET') return aiStats(env);
  if (path === '/api/ai/log' && method === 'DELETE') return clearAiLog(env);

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
        `SELECT COALESCE(NULLIF(device,''),'—') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY device ORDER BY pv DESC`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(NULLIF(browser,''),'Other'),'Other') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY browser ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(NULLIF(os,''),'Other'),'Other') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
         FROM ${T} WHERE created_at >= ${SINCE} GROUP BY os ORDER BY pv DESC LIMIT 8`
      ).all(),
      db.prepare(
        `SELECT COALESCE(NULLIF(lang,''),'—') name, COUNT(DISTINCT ${GID}) uv, COUNT(*) pv
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

  // 级联清理 R2 图片：按 m<id>/ 前缀全删（覆盖换图留下的历史对象与文档页封面键；
  // admin 表单里的站内路径封面如 /assets/img/… 不在该前缀下，不受影响）。尽力而为，失败不回滚 D1
  if (env.IMG) {
    try {
      let cursor;
      do {
        const list = await env.IMG.list({ prefix: `m${id}/`, cursor });
        await Promise.all(list.objects.map((o) => env.IMG.delete(o.key)));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    } catch (err) {
      console.error(`R2 image cleanup failed for merchant ${id}:`, err);
    }
  }
  return json({ ok: true });
}

/* ---------------- 万载TV 视频管理（D1 videos，docs/万载TV方案.md） ---------------- */

const V_CATEGORIES = ['drama', 'fireworks', 'heritage', 'food', 'tourism', 'other'];
const V_SOURCES = ['bilibili', 'upload'];
const V_STATUSES = ['published', 'hidden'];
const BVID_RE = /^BV[0-9A-Za-z]{8,12}$/;
const MAX_VIDEO_BYTES = 95 * 1024 * 1024; // Cloudflare 免费版请求体上限 100MB，留余量
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm' };

async function listVideos(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const counts = await env.DB.prepare('SELECT status, COUNT(*) n FROM videos GROUP BY status').all();
  const byStatus = {};
  let total = 0;
  (counts.results || []).forEach((r) => { byStatus[r.status] = r.n; total += r.n; });

  const sql = V_STATUSES.includes(status)
    ? `SELECT * FROM videos WHERE status = ?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3`
    : `SELECT * FROM videos ORDER BY id DESC LIMIT ?1 OFFSET ?2`;
  const { results } = V_STATUSES.includes(status)
    ? await env.DB.prepare(sql).bind(status, PAGE_SIZE, offset).all()
    : await env.DB.prepare(sql).bind(PAGE_SIZE, offset).all();

  return json({ ok: true, total, byStatus, storage: await mediaUsage(env), videos: results || [] });
}

// R2 已用容量（媒体桶全量求和：tv/ 视频 + book/ 文库插图封面共用一桶；5 分钟缓存）
let vStorageCache = { at: 0, bytes: 0 };
async function mediaUsage(env) {
  if (!env.MEDIA) return null;
  if (Date.now() - vStorageCache.at < 5 * 60 * 1000) return vStorageCache.bytes;
  let bytes = 0;
  let cursor;
  try {
    do {
      const list = await env.MEDIA.list({ cursor });
      list.objects.forEach((o) => { bytes += o.size; });
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error('media usage failed:', err);
    return vStorageCache.at ? vStorageCache.bytes : null;
  }
  vStorageCache = { at: Date.now(), bytes };
  return bytes;
}

/** 新建（id 为空）或部分更新；换文件/封面时级联删旧 R2 对象 */
async function saveVideo(env, request, id) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);

  // 剧集总封面（video_series 表，剧名非空时生效；不进 videos 字段集）
  const seriesCover = String(body.series_cover ?? '').trim().slice(0, 300) || null;

  // 文本字段白名单（空串按 NULL 存）；数字字段单独整理
  const f = {};
  for (const [k, max] of Object.entries({
    title: 80, category: 20, source: 10, bvid: 20, file_key: 300,
    cover: 300, series: 60, intro: 600, status: 10,
  })) {
    if (!(k in body)) continue;
    const v = String(body[k] ?? '').trim().slice(0, max);
    f[k] = ['bvid', 'file_key', 'cover', 'series', 'intro'].includes(k) && v === '' ? null : v;
  }
  for (const k of ['duration', 'episode', 'featured']) {
    if (!(k in body)) continue;
    f[k] = Math.max(0, Math.min(k === 'duration' ? 86400 : 9999, Math.round(Number(body[k]) || 0)));
  }
  if (f.featured) f.featured = 1;
  if (f.episode === 0) f.episode = null; // 0 视为未填

  if ('title' in f && !f.title) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('category' in f && !V_CATEGORIES.includes(f.category)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('source' in f && !V_SOURCES.includes(f.source)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('status' in f && !V_STATUSES.includes(f.status)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('bvid' in f && f.bvid && !BVID_RE.test(f.bvid)) return json({ ok: false, error: 'bad_bvid' }, 400);

  // 新建：标题 + 来源数据齐备，B站 BV 号防重复
  if (!id) {
    if (!f.title || !V_SOURCES.includes(f.source)) return json({ ok: false, error: 'invalid_fields' }, 400);
    if (f.source === 'bilibili' && !f.bvid) return json({ ok: false, error: 'bvid_required' }, 400);
    if (f.source === 'upload' && !f.file_key) return json({ ok: false, error: 'file_required' }, 400);
    if (f.source === 'bilibili') {
      const dup = await env.DB.prepare('SELECT id FROM videos WHERE bvid = ?1').bind(f.bvid).first();
      if (dup) return json({ ok: false, error: 'dup_bvid' }, 409);
    }
    const r = await env.DB.prepare(
      `INSERT INTO videos (title, category, source, bvid, file_key, cover, duration, series, episode, intro, featured, status)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    )
      .bind(
        f.title, f.category || 'other', f.source, f.bvid || null, f.file_key || null, f.cover || null,
        f.duration || 0, f.series || null, f.episode || null, f.intro || null, f.featured || 0, f.status || 'published'
      )
      .run();
    await upsertSeriesCover(env, f.series, seriesCover);
    return json({ ok: true, id: r.meta.last_row_id });
  }

  // 编辑：部分更新
  const old = await env.DB.prepare('SELECT * FROM videos WHERE id = ?1').bind(id).first();
  if (!old) return json({ ok: false, error: 'not_found' }, 404);
  if ('source' in f && f.source === 'bilibili' && !(f.bvid ?? old.bvid)) {
    return json({ ok: false, error: 'bvid_required' }, 400);
  }
  if ('source' in f && f.source === 'upload' && !(f.file_key ?? old.file_key)) {
    return json({ ok: false, error: 'file_required' }, 400);
  }
  if ('bvid' in f && (f.bvid ?? old.bvid)) {
    const dup = await env.DB.prepare('SELECT id FROM videos WHERE bvid = ?1 AND id != ?2')
      .bind(f.bvid ?? old.bvid, id).first();
    if (dup) return json({ ok: false, error: 'dup_bvid' }, 409);
  }

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k} = ?${vals.length + 1}`);
    vals.push(v);
  }
  if (!sets.length) return json({ ok: false, error: 'no_fields' }, 400);
  sets.push(`updated_at = datetime('now')`);
  await env.DB.prepare(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?${vals.length + 1}`).bind(...vals, id).run();

  // R2 旧对象清理：仅在换 key 时删（/ 开头是站内路径，不归 R2 管）
  const r2Key = (k) => k && !k.startsWith('/');
  const newFile = 'file_key' in f ? f.file_key : old.file_key;
  if (r2Key(old.file_key) && old.file_key !== newFile) {
    try { await env.MEDIA.delete(old.file_key); } catch (err) { console.error('old video cleanup failed:', err); }
  }
  const newCover = 'cover' in f ? f.cover : old.cover;
  if (r2Key(old.cover) && old.cover !== newCover) {
    try { await env.MEDIA.delete(old.cover); } catch (err) { console.error('old cover cleanup failed:', err); }
  }
  if (seriesCover) await upsertSeriesCover(env, f.series ?? old.series, seriesCover);
  return json({ ok: true });
}

/** 剧集总封面 upsert（video_series.name 与 videos.series 对应） */
async function upsertSeriesCover(env, name, cover) {
  if (!name || !cover) return;
  await env.DB.prepare(
    `INSERT INTO video_series (name, cover) VALUES (?1, ?2)
     ON CONFLICT(name) DO UPDATE SET cover = ?2, updated_at = datetime('now')`
  ).bind(name, cover).run();
}

async function removeVideo(env, id) {
  const old = await env.DB.prepare('SELECT file_key, cover FROM videos WHERE id = ?1').bind(id).first();
  const { meta } = await env.DB.prepare('DELETE FROM videos WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  // 级联清理 R2 视频/封面：尽力而为，失败不回滚 D1
  if (env.MEDIA && old) {
    for (const k of [old.file_key, old.cover]) {
      if (k && !k.startsWith('/')) {
        try { await env.MEDIA.delete(k); } catch (err) { console.error(`R2 cleanup failed for ${k}:`, err); }
      }
    }
  }
  return json({ ok: true });
}

/** 视频流式上传：File 直作 PUT body（content-length 已知）→ request.body 流式转发 R2，不整读进内存 */
async function uploadVideoFile(env, request) {
  if (!env.MEDIA) return json({ ok: false, error: 'storage_missing' }, 500);
  const ext = (new URL(request.url).searchParams.get('ext') || '').toLowerCase();
  if (!VIDEO_TYPES[ext]) return json({ ok: false, error: 'bad_ext' }, 400);
  const len = Number(request.headers.get('content-length') || 0);
  if (!len) return json({ ok: false, error: 'empty_file' }, 400);
  if (len > MAX_VIDEO_BYTES) return json({ ok: false, error: 'too_large' }, 413);
  const key = `tv/v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: VIDEO_TYPES[ext] } });
  } catch (err) {
    console.error('video upload failed:', err);
    return json({ ok: false, error: 'upload_failed' }, 500);
  }
  return json({ ok: true, key });
}

/** 从B站拉取视频信息：view API 取标题/简介/时长，封面转存 R2（键 tv/c-bili-<bvid>.<ext>，重抓覆盖幂等） */
const BILI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchBili(env, request) {
  const body = await request.json().catch(() => null);
  const bvid = String(body?.bvid || '').trim();
  if (!BVID_RE.test(bvid)) return json({ ok: false, error: 'bad_bvid' }, 400); // BV 号大小写敏感，不归一化
  let data = null;
  try {
    const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, {
      headers: { 'user-agent': BILI_UA, referer: 'https://www.bilibili.com/' },
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.code === 0 && d.data) data = d.data;
  } catch { /* 网络/B站风控失败走下方统一报错 */ }
  if (!data) return json({ ok: false, error: 'bili_api_failed' }, 502);
  const { title, desc, duration, pic } = data;

  // 封面转存 R2（best-effort：失败不阻塞，返回项 cover 为 null 时前端提示手传）
  let cover = null;
  if (pic && env.MEDIA) {
    try {
      const img = await fetch(pic.replace(/^http:/, 'https:'), { headers: { 'user-agent': BILI_UA } });
      const buf = img.ok ? new Uint8Array(await img.arrayBuffer()) : null;
      if (buf && buf.length && buf.length <= 10 * 1024 * 1024) {
        const ct = (img.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        const key = `tv/c-bili-${bvid}.${ext}`;
        await env.MEDIA.put(key, buf, { httpMetadata: { contentType: ct } });
        cover = key;
      }
    } catch (err) {
      console.error('bili cover fetch failed:', err);
    }
  }
  return json({
    ok: true,
    title: String(title || '').slice(0, 80),
    intro: String(desc || '').slice(0, 600),
    duration: Math.max(0, Math.round(Number(duration) || 0)),
    cover,
  });
}

/** 封面上传：≤5MB，魔数校验 JPG/PNG/WebP（与商户门户 readImage 同款） */
async function uploadVideoCover(env, request) {
  if (!env.MEDIA) return json({ ok: false, error: 'storage_missing' }, 500);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > MAX_COVER_BYTES) return json({ ok: false, error: 'bad_cover' }, 400);
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : isWebp ? 'webp' : null;
  if (!ext) return json({ ok: false, error: 'bad_cover' }, 400);
  const key = `tv/c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` } });
  } catch (err) {
    console.error('cover upload failed:', err);
    return json({ ok: false, error: 'upload_failed' }, 500);
  }
  return json({ ok: true, key });
}

/* ---------------- 文库管理（D1 books/book_chapters，docs/文库方案.md） ---------------- */

const B_CATEGORIES = ['novel', 'story', 'essay', 'other'];
const B_STATUSES = ['pending', 'approved', 'rejected', 'hidden'];
const CH_STATUSES = ['pending', 'approved', 'rejected'];

async function listBooks(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const counts = await env.DB.prepare('SELECT status, COUNT(*) n FROM books GROUP BY status').all();
  const byStatus = {};
  let total = 0;
  (counts.results || []).forEach((r) => { byStatus[r.status] = r.n; total += r.n; });

  const sql = B_STATUSES.includes(status)
    ? `SELECT b.*, (SELECT COUNT(*) FROM book_chapters c WHERE c.book_id = b.id AND c.status = 'pending') AS pending_ch
       FROM books b WHERE b.status = ?1 ORDER BY b.id DESC LIMIT ?2 OFFSET ?3`
    : `SELECT b.*, (SELECT COUNT(*) FROM book_chapters c WHERE c.book_id = b.id AND c.status = 'pending') AS pending_ch
       FROM books b ORDER BY CASE b.status WHEN 'pending' THEN 0 ELSE 1 END, b.id DESC LIMIT ?1 OFFSET ?2`;
  const { results } = B_STATUSES.includes(status)
    ? await env.DB.prepare(sql).bind(status, PAGE_SIZE, offset).all()
    : await env.DB.prepare(sql).bind(PAGE_SIZE, offset).all();

  return json({ ok: true, total, byStatus, storage: await mediaUsage(env), books: results || [] });
}

/** admin 直建作品：默认 approved 免审（slug 自动生成）；封面可用站内路径或 R2 键后补 */
async function createBook(env, request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);
  const f = {
    title: String(body.title ?? '').trim().slice(0, 80),
    category: String(body.category ?? '').trim().slice(0, 20),
    author_name: String(body.author_name ?? '').trim().slice(0, 40) || null,
    intro: String(body.intro ?? '').trim().slice(0, 500),
    cover: String(body.cover ?? '').trim().slice(0, 300) || null,
    status: String(body.status ?? 'approved').trim(),
  };
  if (!f.title || !f.intro || !B_CATEGORIES.includes(f.category) || !B_STATUSES.includes(f.status)) {
    return json({ ok: false, error: 'invalid_fields' }, 400);
  }
  const r = await env.DB.prepare(
    `INSERT INTO books (title, category, intro, author_name, cover, status)
     VALUES (?1,?2,?3,?4,?5,?6)`
  ).bind(f.title, f.category, f.intro, f.author_name, f.cover, f.status).run();
  const id = r.meta.last_row_id;
  if (f.status === 'approved') {
    await env.DB.prepare('UPDATE books SET slug = ?1 WHERE id = ?2').bind('b' + id, id).run();
  }
  return json({ ok: true, id });
}

/** 部分更新：审核（status/reject_reason）与元数据（title/category/author_name/intro/sort_weight）共用 */
async function updateBook(env, id, request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);

  const f = {};
  for (const k of ['title', 'category', 'author_name', 'intro', 'status', 'reject_reason']) {
    if (!(k in body)) continue;
    f[k] = String(body[k] ?? '').trim().slice(0, k === 'intro' ? 500 : 200) || null;
  }
  if ('sort_weight' in body) f.sort_weight = Math.max(0, Math.min(999, Math.round(Number(body.sort_weight) || 0)));
  if ('title' in f && !f.title) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('category' in f && f.category && !B_CATEGORIES.includes(f.category)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('status' in f && f.status && !B_STATUSES.includes(f.status)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if (f.status === 'rejected' && !f.reject_reason) return json({ ok: false, error: 'reject_reason_required' }, 400);
  if (f.reject_reason === null) delete f.reject_reason; // 只传空串不清原因

  const old = await env.DB.prepare('SELECT id, slug FROM books WHERE id = ?1').bind(id).first();
  if (!old) return json({ ok: false, error: 'not_found' }, 404);

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k} = ?${vals.length + 1}`);
    vals.push(v);
  }
  if (!sets.length) return json({ ok: false, error: 'no_fields' }, 400);
  sets.push(`updated_at = datetime('now')`);
  await env.DB.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?${vals.length + 1}`).bind(...vals, id).run();

  // 上线且无 slug：补 b<id>（元数据重审通过后 slug 保留）
  if ((f.status === 'approved' || !('status' in f)) && !old.slug) {
    await env.DB.prepare('UPDATE books SET slug = ?1 WHERE id = ?2').bind('b' + id, id).run();
  }
  return json({ ok: true });
}

/** 删除作品：章节行 + 章节插图 + 封面级联；R2 清理尽力而为 */
async function removeBook(env, id) {
  const book = await env.DB.prepare('SELECT id, cover FROM books WHERE id = ?1').bind(id).first();
  const { meta } = await env.DB.prepare('DELETE FROM books WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  await env.DB.prepare('DELETE FROM book_chapters WHERE book_id = ?1').bind(id).run();

  if (env.MEDIA) {
    const keys = [];
    try {
      const rows = await env.DB.prepare('SELECT images FROM book_chapters WHERE book_id = ?1').bind(id).all();
      // 上面的 DELETE 已执行；此处查询仅为兼容旧数据兜底（正常返回空）
      for (const row of rows.results || []) keys.push(...safeImages2(row.images));
    } catch { /* 表已清空时忽略 */ }
    if (book?.cover && !book.cover.startsWith('/')) keys.push(book.cover);
    for (const k of keys) {
      try { await env.MEDIA.delete(k); } catch (err) { console.error(`R2 cleanup failed for ${k}:`, err); }
    }
    try {
      let cursor;
      do {
        const list = await env.MEDIA.list({ prefix: `book/b${id}/`, cursor });
        await Promise.all(list.objects.map((o) => env.MEDIA.delete(o.key)));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    } catch (err) {
      console.error(`R2 prefix cleanup failed for book ${id}:`, err);
    }
  }
  return json({ ok: true });
}

function safeImages2(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 章节列表（含正文，供后台「先读后审」） */
async function listBookChapters(env, bookId) {
  const { results } = await env.DB.prepare(
    'SELECT id, idx, title, body, images, status, reject_reason, word_count, updated_at FROM book_chapters WHERE book_id = ?1 ORDER BY idx'
  ).bind(bookId).all();
  return json({ ok: true, chapters: results || [] });
}

/** 章节审核：通过（读者可见）或驳回（原因回传作者作品台） */
async function reviewChapter(env, bookId, cid, request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);
  const status = String(body.status ?? '');
  if (!CH_STATUSES.includes(status)) return json({ ok: false, error: 'invalid_fields' }, 400);
  const reason = status === 'rejected'
    ? (String(body.reject_reason ?? '').trim().slice(0, 200) || null)
    : null;
  if (status === 'rejected' && !reason) return json({ ok: false, error: 'reject_reason_required' }, 400);

  const { meta } = await env.DB.prepare(
    `UPDATE book_chapters SET status = ?1, reject_reason = ?2, updated_at = datetime('now')
     WHERE id = ?3 AND book_id = ?4`
  ).bind(status, reason, cid, bookId).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  await env.DB.prepare(`UPDATE books SET updated_at = datetime('now') WHERE id = ?1`).bind(bookId).run();
  return json({ ok: true });
}

/** 删除章节（admin）：级联插图 + 重算作品计数 */
async function removeChapter(env, bookId, cid) {
  const ch = await env.DB.prepare('SELECT id, images FROM book_chapters WHERE id = ?1 AND book_id = ?2')
    .bind(cid, bookId).first();
  const { meta } = await env.DB.prepare('DELETE FROM book_chapters WHERE id = ?1 AND book_id = ?2')
    .bind(cid, bookId).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);

  if (env.MEDIA) {
    for (const k of safeImages2(ch?.images)) {
      try { await env.MEDIA.delete(k); } catch (err) { console.error(`R2 cleanup failed for ${k}:`, err); }
    }
  }
  await env.DB.prepare(
    `UPDATE books SET
       chapter_count = (SELECT COUNT(*) FROM book_chapters WHERE book_id = ?1),
       word_count = (SELECT COALESCE(SUM(word_count), 0) FROM book_chapters WHERE book_id = ?1),
       updated_at = datetime('now')
     WHERE id = ?1`
  ).bind(bookId).run();
  return json({ ok: true });
}

/* ---------------- 万载音乐管理（D1 music_tracks，2026-09-06） ---------------- */

const MU_STATUSES = ['published', 'hidden'];
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

async function listTracks(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const counts = await env.DB.prepare('SELECT status, COUNT(*) n FROM music_tracks GROUP BY status').all();
  const byStatus = {};
  let total = 0;
  (counts.results || []).forEach((r) => { byStatus[r.status] = r.n; total += r.n; });

  const sql = MU_STATUSES.includes(status)
    ? `SELECT * FROM music_tracks WHERE status = ?1 ORDER BY sort, id LIMIT ?2 OFFSET ?3`
    : `SELECT * FROM music_tracks ORDER BY sort, id LIMIT ?1 OFFSET ?2`;
  const { results } = MU_STATUSES.includes(status)
    ? await env.DB.prepare(sql).bind(status, PAGE_SIZE, offset).all()
    : await env.DB.prepare(sql).bind(PAGE_SIZE, offset).all();

  return json({ ok: true, total, byStatus, storage: await mediaUsage(env), tracks: results || [] });
}

/** 新建（id 为空）或部分更新；换音频/封面时级联删旧 R2 对象 */
async function saveTrack(env, request, id) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);

  const f = {};
  for (const [k, max] of Object.entries({
    title: 80, artist: 40, cover: 300, file_key: 300, status: 10,
  })) {
    if (!(k in body)) continue;
    const v = String(body[k] ?? '').trim().slice(0, max);
    f[k] = ['artist', 'cover', 'file_key'].includes(k) && v === '' ? null : v;
  }
  for (const k of ['duration', 'sort']) {
    if (!(k in body)) continue;
    f[k] = Math.max(0, Math.min(k === 'duration' ? 86400 : 999, Math.round(Number(body[k]) || 0)));
  }
  if ('title' in f && !f.title) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('status' in f && !MU_STATUSES.includes(f.status)) return json({ ok: false, error: 'invalid_fields' }, 400);

  // 新建：曲名 + 音频文件齐备
  if (!id) {
    if (!f.title || !f.file_key) return json({ ok: false, error: 'file_required' }, 400);
    const r = await env.DB.prepare(
      `INSERT INTO music_tracks (title, artist, cover, file_key, duration, sort, status)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`
    )
      .bind(f.title, f.artist || null, f.cover || null, f.file_key, f.duration || 0, f.sort || 0, f.status || 'published')
      .run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  // 编辑：部分更新
  const old = await env.DB.prepare('SELECT * FROM music_tracks WHERE id = ?1').bind(id).first();
  if (!old) return json({ ok: false, error: 'not_found' }, 404);
  if ('file_key' in f && !f.file_key) return json({ ok: false, error: 'file_required' }, 400);

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k} = ?${vals.length + 1}`);
    vals.push(v);
  }
  if (!sets.length) return json({ ok: false, error: 'no_fields' }, 400);
  sets.push(`updated_at = datetime('now')`);
  await env.DB.prepare(`UPDATE music_tracks SET ${sets.join(', ')} WHERE id = ?${vals.length + 1}`).bind(...vals, id).run();

  // R2 旧对象清理：仅在换 key 时删（/ 开头是站内路径，不归 R2 管）
  const r2Key = (k) => k && !k.startsWith('/');
  const newFile = 'file_key' in f ? f.file_key : old.file_key;
  if (r2Key(old.file_key) && old.file_key !== newFile) {
    try { await env.MEDIA.delete(old.file_key); } catch (err) { console.error('old audio cleanup failed:', err); }
  }
  const newCover = 'cover' in f ? f.cover : old.cover;
  if (r2Key(old.cover) && old.cover !== newCover) {
    try { await env.MEDIA.delete(old.cover); } catch (err) { console.error('old cover cleanup failed:', err); }
  }
  return json({ ok: true });
}

async function removeTrack(env, id) {
  const old = await env.DB.prepare('SELECT file_key, cover FROM music_tracks WHERE id = ?1').bind(id).first();
  const { meta } = await env.DB.prepare('DELETE FROM music_tracks WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  if (env.MEDIA && old) {
    for (const k of [old.file_key, old.cover]) {
      if (k && !k.startsWith('/')) {
        try { await env.MEDIA.delete(k); } catch (err) { console.error(`R2 cleanup failed for ${k}:`, err); }
      }
    }
  }
  return json({ ok: true });
}

/** MP3 流式上传：File 直作 PUT body → request.body 转发 R2（≤50MB，魔数校验 ID3/MPEG 帧头） */
async function uploadTrackFile(env, request) {
  if (!env.MEDIA) return json({ ok: false, error: 'storage_missing' }, 500);
  const len = Number(request.headers.get('content-length') || 0);
  if (!len) return json({ ok: false, error: 'empty_file' }, 400);
  if (len > MAX_AUDIO_BYTES) return json({ ok: false, error: 'too_large' }, 413);
  if (!request.body) return json({ ok: false, error: 'empty_file' }, 400);

  // 魔数校验只读首个 chunk，随后把已读部分接回流式转发（不整读内存）
  const reader = request.body.getReader();
  const first = await reader.read().catch(() => ({}));
  const head = first.value;
  const isId3 = head && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
  const isMpeg = head && head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  if (!isId3 && !isMpeg) {
    try { await reader.cancel(); } catch { /* 已结束则忽略 */ }
    return json({ ok: false, error: 'bad_audio' }, 400);
  }
  const body = new FixedLengthStream(len);
  const writer = body.writable.getWriter();
  (async () => {
    try {
      await writer.write(head);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch (err) {
      await writer.abort(err).catch(() => {});
    }
  })();

  const key = `music/a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.mp3`;
  try {
    await env.MEDIA.put(key, body.readable, { httpMetadata: { contentType: 'audio/mpeg' } });
  } catch (err) {
    console.error('audio upload failed:', err);
    return json({ ok: false, error: 'upload_failed' }, 500);
  }
  return json({ ok: true, key });
}

/** 图片上传（共用）：≤5MB，魔数校验 JPG/PNG/WebP，存入指定前缀（music/c-* / attra/c-*） */
async function uploadImageR2(env, request, prefix) {
  if (!env.MEDIA) return json({ ok: false, error: 'storage_missing' }, 500);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > MAX_COVER_BYTES) return json({ ok: false, error: 'bad_cover' }, 400);
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : isWebp ? 'webp' : null;
  if (!ext) return json({ ok: false, error: 'bad_cover' }, 400);
  const key = `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` } });
  } catch (err) {
    console.error('image upload failed:', err);
    return json({ ok: false, error: 'upload_failed' }, 500);
  }
  return json({ ok: true, key });
}

/* ---------------- 旅游景点管理（D1 attractions，2026-09-06） ---------------- */

const A_STATUSES = ['published', 'hidden'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

async function listAttractions(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const counts = await env.DB.prepare('SELECT status, COUNT(*) n FROM attractions GROUP BY status').all();
  const byStatus = {};
  let total = 0;
  (counts.results || []).forEach((r) => { byStatus[r.status] = r.n; total += r.n; });

  const sql = A_STATUSES.includes(status)
    ? `SELECT * FROM attractions WHERE status = ?1 ORDER BY sort, id DESC LIMIT ?2 OFFSET ?3`
    : `SELECT * FROM attractions ORDER BY sort, id DESC LIMIT ?1 OFFSET ?2`;
  const { results } = A_STATUSES.includes(status)
    ? await env.DB.prepare(sql).bind(status, PAGE_SIZE, offset).all()
    : await env.DB.prepare(sql).bind(PAGE_SIZE, offset).all();

  return json({ ok: true, total, byStatus, storage: await mediaUsage(env), attractions: results || [] });
}

/** 新建（id 为空）或部分更新；slug 唯一；换封面时级联删旧 R2 对象 */
async function saveAttraction(env, request, id) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);

  const f = {};
  for (const [k, max] of Object.entries({
    name: 60, slug: 60, summary: 200, tags: 60, cover: 300,
    body: 8000, address: 100, hours: 60, tickets: 60, transport: 100, status: 10,
  })) {
    if (!(k in body)) continue;
    const v = String(body[k] ?? '').trim().slice(0, max);
    f[k] = ['tags', 'cover', 'body', 'address', 'hours', 'tickets', 'transport'].includes(k) && v === '' ? null : v;
  }
  if ('sort' in body) f.sort = Math.max(0, Math.min(999, Math.round(Number(body.sort) || 0)));
  if ('name' in f && !f.name) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('summary' in f && !f.summary) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('status' in f && !A_STATUSES.includes(f.status)) return json({ ok: false, error: 'invalid_fields' }, 400);
  if ('slug' in f && f.slug && !SLUG_RE.test(f.slug)) return json({ ok: false, error: 'bad_slug' }, 400);

  if (!id) {
    if (!f.name || !f.summary) return json({ ok: false, error: 'invalid_fields' }, 400);
    if (!f.slug) return json({ ok: false, error: 'slug_required' }, 400);
    const dup = await env.DB.prepare('SELECT id FROM attractions WHERE slug = ?1').bind(f.slug).first();
    if (dup) return json({ ok: false, error: 'dup_slug' }, 409);
    const r = await env.DB.prepare(
      `INSERT INTO attractions (slug, name, summary, tags, cover, body, address, hours, tickets, transport, sort, status)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    )
      .bind(
        f.slug, f.name, f.summary, f.tags || null, f.cover || null, f.body || null,
        f.address || null, f.hours || null, f.tickets || null, f.transport || null,
        f.sort || 0, f.status || 'published'
      )
      .run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const old = await env.DB.prepare('SELECT * FROM attractions WHERE id = ?1').bind(id).first();
  if (!old) return json({ ok: false, error: 'not_found' }, 404);
  if ('slug' in f) {
    const slug = f.slug ?? old.slug;
    if (!slug || !SLUG_RE.test(slug)) return json({ ok: false, error: 'bad_slug' }, 400);
    const dup = await env.DB.prepare('SELECT id FROM attractions WHERE slug = ?1 AND id != ?2')
      .bind(slug, id).first();
    if (dup) return json({ ok: false, error: 'dup_slug' }, 409);
  }

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    sets.push(`${k} = ?${vals.length + 1}`);
    vals.push(v);
  }
  if (!sets.length) return json({ ok: false, error: 'no_fields' }, 400);
  sets.push(`updated_at = datetime('now')`);
  await env.DB.prepare(`UPDATE attractions SET ${sets.join(', ')} WHERE id = ?${vals.length + 1}`).bind(...vals, id).run();

  const newCover = 'cover' in f ? f.cover : old.cover;
  if (old.cover && !old.cover.startsWith('/') && old.cover !== newCover) {
    try { await env.MEDIA.delete(old.cover); } catch (err) { console.error('old cover cleanup failed:', err); }
  }
  return json({ ok: true });
}

async function removeAttraction(env, id) {
  const old = await env.DB.prepare('SELECT cover FROM attractions WHERE id = ?1').bind(id).first();
  const { meta } = await env.DB.prepare('DELETE FROM attractions WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  if (env.MEDIA && old?.cover && !old.cover.startsWith('/')) {
    try { await env.MEDIA.delete(old.cover); } catch (err) { console.error(`R2 cleanup failed for ${old.cover}:`, err); }
  }
  return json({ ok: true });
}

/* ---------------- AI 助手「花傩」管理（docs/AI助手方案.md） ---------------- */

// 与主站 worker/ai.js MODEL_ALLOW 对应的白名单（改这里需同步主站）
const AI_MODEL_OPTIONS = [
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'Qwen3-30B-A3B（默认 · 快/省）' },
  { id: '@cf/zai-org/glm-4.7-flash', label: 'GLM-4.7-Flash（轻量）' },
  { id: '@cf/deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek-V4-Flash（高质量）' },
  { id: '@cf/qwen/qwen3.8-27b', label: 'Qwen3.8-27B（旗舰）' },
];

async function getAiSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM ai_settings').all();
  const map = {};
  for (const r of results || []) map[r.key] = r.value;
  return json({ ok: true, settings: map, models: AI_MODEL_OPTIONS });
}

async function saveAiSettings(env, request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_json' }, 400);
  const patch = {
    enabled: body.enabled === '0' || body.enabled === false ? '0' : '1',
    model: AI_MODEL_OPTIONS.some((x) => x.id === body.model) ? body.model : AI_MODEL_OPTIONS[0].id,
    system_prompt: String(body.system_prompt ?? '').slice(0, 4000),
    greeting: String(body.greeting ?? '').trim().slice(0, 100),
    quick_questions: JSON.stringify(
      (Array.isArray(body.quick) ? body.quick : [])
        .map((q) => String(q).trim().slice(0, 60)).filter(Boolean).slice(0, 6)
    ),
  };
  for (const [key, value] of Object.entries(patch)) {
    await env.DB.prepare(
      `INSERT INTO ai_settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(key, value).run();
  }
  return json({ ok: true });
}

async function listKnowledge(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const where = status ? `WHERE status='${status === 'hidden' ? 'hidden' : 'published'}'` : '';
  const { results } = await env.DB.prepare(
    `SELECT id, category, content, keywords, sort, status, updated_at FROM ai_knowledge ${where}
     ORDER BY category, sort, id LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  ).all();
  const { total } = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ai_knowledge ${where}`).first();
  const byStatus = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM ai_knowledge GROUP BY status`
  ).all();
  const counts = {};
  for (const r of byStatus.results || []) counts[r.status] = r.n;
  return json({ ok: true, total, knowledge: results || [], byStatus: counts });
}

async function saveKnowledge(env, request, id = null) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'invalid_json' }, 400);

  // 部分更新语义：上下线切换只带 status，表单保存带全量
  const patch = {};
  if (body.category !== undefined) {
    patch.category = String(body.category).trim().slice(0, 30);
    if (!patch.category) return json({ ok: false, error: 'invalid_fields' }, 400);
  }
  if (body.content !== undefined) {
    patch.content = String(body.content).trim().slice(0, 2000);
    if (!patch.content) return json({ ok: false, error: 'invalid_fields' }, 400);
  }
  if (body.keywords !== undefined) patch.keywords = String(body.keywords).trim().slice(0, 200);
  if (body.sort !== undefined) patch.sort = Math.max(0, Math.min(9999, Number(body.sort) || 0));
  if (body.status !== undefined) patch.status = body.status === 'hidden' ? 'hidden' : 'published';

  if (id === null) {
    if (!patch.category || !patch.content) return json({ ok: false, error: 'invalid_fields' }, 400);
    await env.DB.prepare(
      'INSERT INTO ai_knowledge (category, content, keywords, sort, status) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(patch.category, patch.content, patch.keywords || '', patch.sort || 0, patch.status || 'published').run();
  } else {
    const keys = Object.keys(patch);
    if (!keys.length) return json({ ok: false, error: 'invalid_fields' }, 400);
    const sets = keys.map((k, i) => `${k} = ?${i + 1}`).join(', ');
    await env.DB.prepare(
      `UPDATE ai_knowledge SET ${sets}, updated_at = datetime('now') WHERE id = ?${keys.length + 1}`
    ).bind(...keys.map((k) => patch[k]), id).run();
  }
  return json({ ok: true });
}

async function removeKnowledge(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM ai_knowledge WHERE id = ?1').bind(id).run();
  if (!meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
}

async function aiStats(env) {
  const { today } = await env.DB.prepare(
    `SELECT COUNT(*) AS today FROM ai_chats WHERE created_at >= datetime('now', 'start of day')`
  ).first();
  const { d7 } = await env.DB.prepare(
    `SELECT COUNT(*) AS d7 FROM ai_chats WHERE created_at >= datetime('now', '-7 days')`
  ).first();
  const { d30 } = await env.DB.prepare(
    `SELECT COUNT(*) AS d30 FROM ai_chats WHERE created_at >= datetime('now', '-30 days')`
  ).first();
  const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM ai_chats').first();
  const { results } = await env.DB.prepare(
    `SELECT question, action, sources, duration_ms, created_at FROM ai_chats ORDER BY id DESC LIMIT 20`
  ).all();
  return json({ ok: true, today, d7, d30, total, recent: results || [] });
}

async function clearAiLog(env) {
  await env.DB.prepare('DELETE FROM ai_chats').run();
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
  .ops button.danger { background: #d64524; border-color: #d64524; color: #fff; }
  .ops button.danger:hover { background: #b5371a; color: #fff; }
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
  /* 万载TV 视频管理 */
  .vrow1 { display: flex; align-items: flex-start; gap: 12px; }
  .vthumb { width: 120px; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; background: #f0f0f2; flex: 0 0 auto; }
  /* 文库管理 */
  .bkthumb { width: 58px; height: 82px; object-fit: cover; border-radius: 6px; background: #f0f0f2; flex: 0 0 auto; }
  .chdetail { margin: -6px 0 14px; padding: 14px 16px; background: #fafafc; border-radius: 12px; border: 1px solid rgba(0,0,0,.05); }
  .chitem { border-top: 1px solid rgba(0,0,0,.06); padding: 12px 0; }
  .chitem:first-child { border-top: 0; padding-top: 4px; }
  .chbody { margin-top: 8px; padding: 10px 12px; background: #fff; border: 1px solid rgba(0,0,0,.05); border-radius: 10px; font-size: 13px; white-space: pre-wrap; word-break: break-word; color: #333; max-height: 280px; overflow-y: auto; line-height: 1.7; }
  .vprog { height: 6px; background: #f0f0f2; border-radius: 999px; margin-top: 14px; overflow: hidden; }
  .vprog div { height: 100%; width: 0; background: linear-gradient(90deg, #d64524, #f2a03d); transition: width .2s; }
  .vhint { color: #86868b; font-size: 12px; }
  .vfile { font-size: 13px; color: #6e6e73; margin-top: 6px; }
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
      <a class="anav-link" id="vtab-tv" href="#/tv">视频</a>
      <a class="anav-link" id="vtab-books" href="#/books">文库</a>
      <a class="anav-link" id="vtab-music" href="#/music">音乐</a>
      <a class="anav-link" id="vtab-attra" href="#/attra">景点</a>
      <a class="anav-link" id="vtab-ai" href="#/ai">AI 助手</a>
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
    <li class="anav-drawer-item"><a class="anav-link" href="#/tv">视频</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="#/books">文库</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="#/music">音乐</a></li>
    <li class="anav-drawer-item"><a class="anav-link" href="#/attra">景点</a></li>
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

<div id="view-tv" class="wrap" style="display:none">
  <div class="range">
    <button class="tab active" data-vst="" type="button">全部</button>
    <button class="tab" data-vst="published" type="button">已发布</button>
    <button class="tab" data-vst="hidden" type="button">已隐藏</button>
    <span class="updated" id="tstats"></span>
    <button id="tadd" type="button" class="primary">新增视频</button>
  </div>
  <div class="panel" id="tform" style="display:none">
    <h3 id="tform-title">新增视频</h3>
    <div class="mgrid">
      <label>标题 *<input id="t-title" maxlength="80"></label>
      <label>分类
        <select id="t-cat">
          <option value="drama">短剧</option><option value="fireworks">烟花</option>
          <option value="heritage">非遗</option><option value="food">美食</option>
          <option value="tourism">文旅</option><option value="other">其他</option>
        </select>
      </label>
      <label>状态
        <select id="t-status">
          <option value="published">发布</option>
          <option value="hidden">隐藏</option>
        </select>
      </label>
      <label>来源
        <select id="t-src">
          <option value="bilibili">B站嵌入</option>
          <option value="upload">直接上传（MP4/WebM，≤95MB）</option>
        </select>
      </label>
      <label id="row-bvid">B站 BV 号 *<input id="t-bvid" placeholder="BV1xx411c7mD">
        <button type="button" id="t-fetch" style="align-self:flex-start">从B站获取信息</button>
        <span class="vhint">自动填标题 / 简介 / 时长，封面转存到站点（绕开B站防盗链）</span>
      </label>
      <label id="row-file" style="display:none">视频文件（选文件自动读时长）<input id="t-file" type="file" accept="video/mp4,video/webm,.mp4,.m4v,.webm"><span class="vfile" id="t-fileinfo"></span></label>
      <label>剧名 / 合集（短剧用，可空）<input id="t-series" maxlength="60" placeholder="一朝相逢便是万载"></label>
      <label id="row-scover" style="display:none">剧集总封面（货架竖版海报，≤5MB）<input id="t-scover" type="file" accept="image/jpeg,image/png,image/webp"><span class="vfile" id="t-scoverinfo"></span></label>
      <label>集数（可空）<input id="t-ep" type="number" min="1" max="9999"></label>
      <label>焦点位（频道页大位）
        <select id="t-feat">
          <option value="0">否</option>
          <option value="1">是</option>
        </select>
      </label>
      <label>时长（秒）<input id="t-dur" type="number" min="0" max="86400"></label>
      <label class="wide">简介<input id="t-intro" maxlength="600"></label>
      <label class="wide">封面图（可选，≤5MB；B站封面有防盗链，建议传一张）<input id="t-cover" type="file" accept="image/jpeg,image/png,image/webp"><span class="vfile" id="t-coverinfo"></span></label>
    </div>
    <div class="vprog" id="t-prog" style="display:none"><div id="t-progbar"></div></div>
    <p class="vhint" id="t-hint" style="margin-top:8px;display:none"></p>
    <div class="ops" style="margin-top:12px"><button class="primary" id="tsave" type="button">保存</button><button id="tcancel" type="button">取消</button></div>
  </div>
  <div class="list" id="tlist"><p class="empty">加载中…</p></div>
  <button class="more" id="tmore" type="button" style="display:none">加载更多</button>
</div>

<div id="view-books" class="wrap" style="display:none">
  <div class="range">
    <button class="tab active" data-bst="" type="button">全部</button>
    <button class="tab" data-bst="pending" type="button">待审</button>
    <button class="tab" data-bst="approved" type="button">已上线</button>
    <button class="tab" data-bst="rejected" type="button">已驳回</button>
    <button class="tab" data-bst="hidden" type="button">已下线</button>
    <span class="updated" id="bstats"></span>
    <button id="badd" type="button" class="primary">新增作品</button>
  </div>
  <div class="panel" id="bform" style="display:none">
    <h3 id="bform-title">新增作品（免审直发）</h3>
    <div class="mgrid">
      <label>书名 *<input id="b-title" maxlength="80"></label>
      <label>分类
        <select id="b-cat">
          <option value="novel">小说</option><option value="story">故事</option>
          <option value="essay">随笔</option><option value="other">其他</option>
        </select>
      </label>
      <label>笔名<input id="b-author" maxlength="40"></label>
      <label>状态
        <select id="b-status">
          <option value="approved">已上线</option>
          <option value="pending">待审核</option>
          <option value="hidden">已下线</option>
        </select>
      </label>
      <label>置顶权重（大者靠前）<input id="b-weight" type="number" value="0"></label>
      <label class="wide">封面（R2 键 book/… 或站内路径 /assets/img/…，可空）<input id="b-cover"></label>
      <label class="wide">简介 *<textarea id="b-intro" rows="3"></textarea></label>
    </div>
    <div class="ops"><button class="primary" id="bsave" type="button">保存</button><button id="bcancel" type="button">取消</button></div>
    <p class="vhint" style="margin-top:10px">章节在作者门户（writer.whizzzest.com）写作；此处创建/编辑作品信息，章节审核点作品卡的「章节审核」。</p>
  </div>
  <div class="list" id="blist"><p class="empty">加载中…</p></div>
  <button class="more" id="bmore" type="button" style="display:none">加载更多</button>
</div>

<div id="view-music" class="wrap" style="display:none">
  <div class="range">
    <button class="tab active" data-must="" type="button">全部</button>
    <button class="tab" data-must="published" type="button">已上线</button>
    <button class="tab" data-must="hidden" type="button">已隐藏</button>
    <span class="updated" id="mustats"></span>
    <button id="muadd" type="button" class="primary">新增曲目</button>
  </div>
  <div class="panel" id="muform" style="display:none">
    <h3 id="muform-title">新增曲目</h3>
    <div class="mgrid">
      <label>曲名 *<input id="mu-title" maxlength="80"></label>
      <label>演唱 / 演奏<input id="mu-artist" maxlength="40" placeholder="佚名"></label>
      <label>状态
        <select id="mu-status">
          <option value="published">上线</option>
          <option value="hidden">隐藏</option>
        </select>
      </label>
      <label>曲序（小者靠前）<input id="mu-sort" type="number" value="0"></label>
      <label>时长（秒）<input id="mu-dur" type="number" min="0" max="86400"></label>
      <label class="wide">音频文件 MP3 *（≤50MB，选文件自动读时长）<input id="mu-file" type="file" accept="audio/mpeg,.mp3"><span class="vfile" id="mu-fileinfo"></span></label>
      <label class="wide">封面（可选 ≤5MB，方形最佳；不传前台用「焰」字占位）<input id="mu-cover" type="file" accept="image/jpeg,image/png,image/webp"><span class="vfile" id="mu-coverinfo"></span></label>
    </div>
    <div class="vprog" id="mu-prog" style="display:none"><div id="mu-progbar"></div></div>
    <p class="vhint" id="mu-hint" style="margin-top:8px;display:none"></p>
    <div class="ops" style="margin-top:12px"><button class="primary" id="musave" type="button">保存</button><button id="mucancel" type="button">取消</button></div>
  </div>
  <div class="list" id="mulist"><p class="empty">加载中…</p></div>
  <button class="more" id="mumore" type="button" style="display:none">加载更多</button>
</div>

<div id="view-attra" class="wrap" style="display:none">
  <div class="range">
    <button class="tab active" data-ast="" type="button">全部</button>
    <button class="tab" data-ast="published" type="button">已上线</button>
    <button class="tab" data-ast="hidden" type="button">已下线</button>
    <span class="updated" id="astats"></span>
    <button id="atadd" type="button" class="primary">新增景点</button>
  </div>
  <div class="panel" id="atform" style="display:none">
    <h3 id="atform-title">新增景点</h3>
    <div class="mgrid">
      <label>名称 *<input id="at-name" maxlength="60"></label>
      <label>Slug *（详情地址 /attractions/slug/，小写字母数字连字符）<input id="at-slug" placeholder="wanzai-gucheng"></label>
      <label>状态
        <select id="at-status">
          <option value="published">上线</option>
          <option value="hidden">下线</option>
        </select>
      </label>
      <label>排序（小者靠前）<input id="at-sort" type="number" value="0"></label>
      <label>标签（逗号分隔，最多 4 个）<input id="at-tags" maxlength="60" placeholder="古城,夜景"></label>
      <label class="wide">一句话简介 *（瀑布流卡片展示）<input id="at-summary" maxlength="200"></label>
      <label class="wide">正文（空行自动分段）<textarea id="at-body" rows="6"></textarea></label>
      <label>地址<input id="at-address" maxlength="100"></label>
      <label>开放时间<input id="at-hours" maxlength="60"></label>
      <label>门票<input id="at-tickets" maxlength="60"></label>
      <label>交通<input id="at-transport" maxlength="100"></label>
      <label class="wide">封面（可选 ≤5MB，竖图/横图均可，瀑布流原比例展示）<input id="at-cover" type="file" accept="image/jpeg,image/png,image/webp"><span class="vfile" id="at-coverinfo"></span></label>
    </div>
    <p class="vhint" id="at-hint" style="margin-top:8px;display:none"></p>
    <div class="ops" style="margin-top:12px"><button class="primary" id="atsave" type="button">保存</button><button id="atcancel" type="button">取消</button></div>
  </div>
  <div class="list" id="atlist"><p class="empty">加载中…</p></div>
  <button class="more" id="atmore" type="button" style="display:none">加载更多</button>
</div>

<div id="view-ai" class="wrap" style="display:none">
  <div class="range">
    <span class="updated" id="ai-stats-line">加载中…</span>
    <button id="ai-log-clear" type="button">清空问答日志</button>
    <button id="k-add" type="button" class="primary">新增知识</button>
  </div>
  <div class="panel">
    <h3>运行设置 <span style="font-weight:400;font-size:12px;color:#86868b">（保存后主站最迟 1 分钟生效）</span></h3>
    <div class="mgrid" style="grid-template-columns:1fr 2fr;max-width:720px">
      <label>助手开关
        <select id="ai-enabled">
          <option value="1">启用</option>
          <option value="0">停用（前台入口隐藏）</option>
        </select>
      </label>
      <label>模型<select id="ai-model"></select></label>
      <label class="wide">招呼气泡（留空 = 不弹；每个访客每会话最多一次）<input id="ai-greeting" maxlength="100"></label>
    </div>
    <label style="display:block;margin-top:10px">系统提示词（花傩人设、职责、回复格式；详见 docs/AI助手方案.md）<textarea id="ai-prompt" rows="9" style="width:100%"></textarea></label>
    <label style="display:block;margin-top:10px">欢迎页快捷问题（每行一条，最多 6 条，留空用内置默认）<textarea id="ai-quick" rows="4" style="width:100%"></textarea></label>
    <p class="vhint" id="ai-hint" style="margin-top:8px;display:none"></p>
    <div class="ops" style="margin-top:12px"><button class="primary" id="ai-savesettings" type="button">保存设置</button></div>
  </div>
  <div class="panel" id="kform" style="display:none">
    <h3 id="kform-title">新增知识</h3>
    <div class="mgrid" style="grid-template-columns:1fr 1fr;max-width:760px">
      <label>分类 *（如：烟花文化）<input id="k-category" maxlength="30"></label>
      <label>排序（小者靠前）<input id="k-sort" type="number" value="0"></label>
      <label>关键词 *（逗号分隔，用户问题含任一词即命中）<input id="k-keywords" maxlength="200" placeholder="烟花,花炮,历史"></label>
      <label>状态
        <select id="k-status">
          <option value="published">参与检索</option>
          <option value="hidden">停用</option>
        </select>
      </label>
      <label class="wide">内容 *<textarea id="k-content" rows="5"></textarea></label>
    </div>
    <p class="vhint" id="k-hint" style="margin-top:8px;display:none"></p>
    <div class="ops" style="margin-top:12px"><button class="primary" id="ksave" type="button">保存</button><button id="kcancel" type="button">取消</button></div>
  </div>
  <div class="list" id="klist"><p class="empty">加载中…</p></div>
  <button class="more" id="kmore" type="button" style="display:none">加载更多</button>
  <div class="panel" style="margin-top:18px">
    <h3>最近问答（20 条）<span class="updated" id="ai-usage" style="margin-left:10px"></span></h3>
    <div class="list" id="ai-log"><p class="empty">加载中…</p></div>
  </div>
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
// 设备/语言维度存的是采集端原始值（desktop、zh-CN…），展示前转中文；未收录的原样显示
var DEVICE_LABEL = { desktop: '桌面端', mobile: '移动端', tablet: '平板', '—': '未知' };
var LANG_LABEL = {
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'zh-HK': '繁體中文', zh: '中文',
  en: '英语', 'en-US': '英语', ja: '日语', 'ja-JP': '日语', ko: '韩语', '—': '未知',
};
function dimName(map, name) { return map[name] || name || '—'; }

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
var VIEWS = ['msg', 'visit', 'merch', 'tv', 'books', 'music', 'attra', 'ai', 'acct'];
var suppressHash = false;
function showView(v, skipHash) {
  if (VIEWS.indexOf(v) === -1) v = 'msg';
  currentView = v;
  el('view-msg').style.display = v === 'msg' ? '' : 'none';
  el('view-visit').style.display = v === 'visit' ? '' : 'none';
  el('view-merch').style.display = v === 'merch' ? '' : 'none';
  el('view-tv').style.display = v === 'tv' ? '' : 'none';
  el('view-books').style.display = v === 'books' ? '' : 'none';
  el('view-music').style.display = v === 'music' ? '' : 'none';
  el('view-attra').style.display = v === 'attra' ? '' : 'none';
  el('view-ai').style.display = v === 'ai' ? '' : 'none';
  el('view-acct').style.display = v === 'acct' ? '' : 'none';
  el('vtab-msg').classList.toggle('active', v === 'msg');
  el('vtab-visit').classList.toggle('active', v === 'visit');
  el('vtab-merch').classList.toggle('active', v === 'merch');
  el('vtab-tv').classList.toggle('active', v === 'tv');
  el('vtab-books').classList.toggle('active', v === 'books');
  el('vtab-music').classList.toggle('active', v === 'music');
  el('vtab-attra').classList.toggle('active', v === 'attra');
  el('vtab-ai').classList.toggle('active', v === 'ai');
  el('vtab-acct').classList.toggle('active', v === 'acct');
  if (v === 'msg') load(true);
  if (v === 'visit') { loadStats(); loadVisitors(true); }
  if (v === 'merch') loadMerchants(true);
  if (v === 'tv') loadTv(true);
  if (v === 'books') loadBooks(true);
  if (v === 'music') loadMusic(true);
  if (v === 'attra') loadAttra(true);
  if (v === 'ai') loadAi();
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
    fillBars('devices', (d.devices || []).map(function (x) { return { label: dimName(DEVICE_LABEL, x.name), uv: x.uv, pv: x.pv }; }));
    fillBars('browsers', (d.browsers || []).map(function (x) { return { label: x.name === 'Other' ? '其他' : (x.name || '—'), uv: x.uv, pv: x.pv }; }));
    fillBars('os', (d.os || []).map(function (x) { return { label: x.name === 'Other' ? '其他' : (x.name || '—'), uv: x.uv, pv: x.pv }; }));
    fillBars('langs', (d.langs || []).map(function (x) { return { label: dimName(LANG_LABEL, x.name), uv: x.uv, pv: x.pv }; }));
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
        (flag(r.country) || '') + ' ' + esc(dimName(DEVICE_LABEL, r.device)) + '</td><td>' + fmtDur(Math.round((r.engage_ms || 0) / 1000)) + '</td></tr>';
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
    '<td>' + esc(dimName(DEVICE_LABEL, v.device)) + '</td>' +
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
            (flag(w.country) || '') + ' ' + esc(w.country || '—') + '</td><td>' + esc(dimName(DEVICE_LABEL, w.device)) + '</td><td>' +
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
  else if (currentView === 'tv') { loadTv(true); }
  else if (currentView === 'books') { loadBooks(true); }
  else if (currentView === 'music') { loadMusic(true); }
  else if (currentView === 'attra') { loadAttra(true); }
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
      // 二次点击确认：首击变红待确认，4 秒未点自动复原；第二击才真正删除（含图片，不可恢复）
      var btn = e.target;
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.className = 'danger';
        btn.textContent = '确认删除（含图片）';
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed');
          btn.className = '';
          btn.textContent = '删除';
        }, 4000);
        return;
      }
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

/* ---------- 万载TV 视频管理（docs/万载TV方案.md） ---------- */
var tState = { status: '', offset: 0 };
var editingTvId = null;
var tFetchedCover = null; // 「从B站获取信息」抓到的封面键（用户本地上传封面时优先本地）
var V_CAT = { drama: '短剧', fireworks: '烟花', heritage: '非遗', food: '美食', tourism: '文旅', other: '其他' };
var SITE_HOME = 'https://whizzzest.com';

document.querySelectorAll('#view-tv .range [data-vst]').forEach(function (b) {
  b.addEventListener('click', function () {
    tState.status = b.getAttribute('data-vst');
    document.querySelectorAll('#view-tv .range [data-vst]').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    loadTv(true);
  });
});

// 封面展示地址：/ 开头 = 主站静态图，否则为 R2 键走 /media/ 代理
function coverUrl(c) {
  if (!c) return '';
  return SITE_HOME + (c.indexOf('/') === 0 ? c : '/media/' + c);
}

function vDur(sec) {
  sec = Number(sec) || 0;
  if (sec <= 0) return '';
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}

function loadTv(reset) {
  if (reset) tState.offset = 0;
  var q = '?offset=' + tState.offset + (tState.status ? '&status=' + tState.status : '');
  api('/api/tv' + q).then(function (d) {
    var list = d.videos || [];
    var counts = d.byStatus || {};
    var line = '共 ' + d.total + ' 条 · 已发布 ' + (counts.published || 0) + ' · 已隐藏 ' + (counts.hidden || 0);
    if (d.storage != null) line += ' · 已用存储 ' + (d.storage / 1048576).toFixed(1) + ' MB';
    el('tstats').textContent = line;
    var box = el('tlist');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">还没有视频，点右上「新增视频」录入第一条（B站 BV 号或直接上传）。</p>';
    } else {
      list.forEach(function (x) { box.appendChild(renderVideo(x)); });
    }
    el('tmore').style.display = (tState.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('tlist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderVideo(x) {
  var div = document.createElement('div');
  div.className = 'msg' + (x.status === 'published' ? '' : ' read');
  var thumb = coverUrl(x.cover)
    ? '<img class="vthumb" loading="lazy" alt="" src="' + esc(coverUrl(x.cover)) + '">'
    : '<div class="vthumb"></div>';
  var badges =
    '<span class="k-badge">' + esc(V_CAT[x.category] || x.category) + '</span>' +
    '<span class="k-badge">' + (x.source === 'bilibili' ? 'B站嵌入' : '上传') + '</span>' +
    (x.series ? '<span class="k-badge">' + esc(x.series) + (x.episode ? ' 第' + x.episode + '集' : '') + '</span>' : '') +
    (x.featured ? '<span class="k-badge">焦点位</span>' : '') +
    '<span class="mst ' + (x.status === 'published' ? 'mst-approved' : 'mst-rejected') + '">' + (x.status === 'published' ? '已发布' : '已隐藏') + '</span>';
  div.innerHTML =
    '<div class="vrow1">' + thumb +
    '<div style="min-width:0;flex:1">' +
      '<div class="row1"><span class="name">' + esc(x.title) + '</span>' + badges +
      (x.status === 'published' ? '<a class="mslug" href="' + SITE_HOME + '/tv/' + x.id + '/" target="_blank" rel="noopener">查看页面 ↗</a>' : '') +
      '</div>' +
      (x.intro ? '<div class="time">' + esc(x.intro) + '</div>' : '') +
      '<div class="meta">' + (vDur(x.duration) ? '时长 ' + vDur(x.duration) + ' · ' : '') + '播放 ' + (x.views || 0) + ' 次 · ' + esc(fmtTime(x.created_at)) + '</div>' +
    '</div></div>' +
    '<div class="ops">' +
    '<button type="button" data-act="toggle">' + (x.status === 'published' ? '隐藏' : '发布') + '</button>' +
    (x.featured ? '' : '<button type="button" data-act="feat">设为焦点位</button>') +
    '<button type="button" data-act="edit">编辑</button>' +
    '<button type="button" data-act="del">删除</button></div>';
  div.querySelector('.ops').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'toggle') {
      api('/api/tv/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: x.status === 'published' ? 'hidden' : 'published' })
      }).then(function () { loadTv(true); });
    } else if (act === 'feat') {
      api('/api/tv/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featured: 1 })
      }).then(function () { loadTv(true); });
    } else if (act === 'edit') {
      openTvForm(x);
    } else if (act === 'del') {
      // 二次点击确认（同商户删除）：首击变红待确认，4 秒未点自动复原；第二击才真正删除（含视频/封面，不可恢复）
      var btn = e.target;
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.className = 'danger';
        btn.textContent = '确认删除（含视频）';
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed');
          btn.className = '';
          btn.textContent = '删除';
        }, 4000);
        return;
      }
      api('/api/tv/' + x.id, { method: 'DELETE' }).then(function () { loadTv(true); });
    }
  });
  return div;
}

function openTvForm(x) {
  editingTvId = x ? x.id : null;
  tFetchedCover = null;
  el('tform-title').textContent = x ? '编辑视频 #' + x.id : '新增视频';
  el('t-title').value = x ? x.title || '' : '';
  el('t-cat').value = x ? x.category || 'drama' : 'drama';
  el('t-status').value = x ? x.status || 'published' : 'published';
  el('t-src').value = x ? x.source || 'bilibili' : 'bilibili';
  el('t-bvid').value = x ? x.bvid || '' : '';
  el('t-file').value = '';
  el('t-fileinfo').textContent = '';
  el('t-series').value = x ? x.series || '' : '';
  el('t-scover').value = '';
  el('t-scoverinfo').textContent = '';
  el('t-ep').value = x && x.episode ? x.episode : '';
  el('t-feat').value = x && x.featured ? '1' : '0';
  el('t-dur').value = x && x.duration ? x.duration : '';
  el('t-intro').value = x ? x.intro || '' : '';
  el('t-cover').value = '';
  el('t-coverinfo').textContent = x && x.cover ? '当前封面：' + x.cover : '';
  syncSrcRows();
  syncSeriesRow();
  hint(null);
  el('tform').style.display = '';
  el('tform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeTvForm() { el('tform').style.display = 'none'; editingTvId = null; progress(null); }

function syncSrcRows() {
  var up = el('t-src').value === 'upload';
  el('row-bvid').style.display = up ? 'none' : '';
  el('row-file').style.display = up ? '' : 'none';
}
el('t-src').addEventListener('change', syncSrcRows);

// 剧集总封面位：填了剧名才出现
function syncSeriesRow() {
  el('row-scover').style.display = val('t-series') ? '' : 'none';
}
el('t-series').addEventListener('input', syncSeriesRow);

// 从B站拉取信息：标题/简介/时长自动填 + 封面转存 R2（保存时随表单提交）
el('t-fetch').addEventListener('click', function () {
  var bvid = val('t-bvid');
  // 注意 BV 号大小写敏感（base58），不可做大小写归一化
  if (!/^BV[0-9A-Za-z]{8,12}$/.test(bvid)) { alert('请先填写正确的 BV 号'); return; }
  var btn = el('t-fetch');
  btn.disabled = true;
  btn.textContent = '获取中…';
  api('/api/tv/fetch-bili', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bvid: bvid })
  }).then(function (d) {
    if (d.title) el('t-title').value = d.title;
    if (d.intro) el('t-intro').value = d.intro;
    if (d.duration) el('t-dur').value = d.duration;
    if (d.cover) {
      tFetchedCover = d.cover;
      el('t-coverinfo').textContent = '封面已从B站获取（保存后生效）';
    } else {
      el('t-coverinfo').textContent = 'B站封面获取失败，可手动上传';
    }
  }).catch(function (e) {
    if (e.message !== 'unauthorized') alert('获取失败：' + e.message);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = '从B站获取信息';
  });
});

// 选文件即读元数据：时长自动带出 + 大小提示（95MB 上限，免费版请求体 100MB 留余量）
el('t-file').addEventListener('change', function () {
  var f = this.files && this.files[0];
  var info = el('t-fileinfo');
  if (!f) { info.textContent = ''; return; }
  info.textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' MB' + (f.size > 95 * 1048576 ? '（超 95MB，请先压缩）' : '');
  var v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = function () {
    if (v.duration && isFinite(v.duration)) el('t-dur').value = Math.round(v.duration);
    URL.revokeObjectURL(v.src);
  };
  v.src = URL.createObjectURL(f);
});

function progress(p) {
  var bar = el('t-prog');
  if (p == null) { bar.style.display = 'none'; el('t-progbar').style.width = '0'; return; }
  bar.style.display = '';
  el('t-progbar').style.width = Math.round(p * 100) + '%';
}
function hint(msg) {
  var h = el('t-hint');
  h.textContent = msg || '';
  h.style.display = msg ? '' : 'none';
}

/** File 直作 PUT body 上传（XHR 才有 upload 进度事件）；返回 {ok, key} */
function putFile(url, file, onP) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (onP) {
      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable) onP(e.loaded / e.total);
      });
    }
    xhr.onload = function () {
      var d = null;
      try { d = JSON.parse(xhr.responseText); } catch (err) { /* 非 JSON 视为失败 */ }
      if (xhr.status === 200 && d && d.ok) return resolve(d);
      reject(new Error((d && d.error) || ('HTTP ' + xhr.status)));
    };
    xhr.onerror = function () { reject(new Error('网络错误')); };
    xhr.send(file);
  });
}

el('tadd').addEventListener('click', function () { openTvForm(null); });
el('tcancel').addEventListener('click', closeTvForm);
el('tsave').addEventListener('click', function () {
  var payload = {
    title: val('t-title'), category: val('t-cat'), status: val('t-status'),
    source: val('t-src'), bvid: val('t-bvid'),
    series: val('t-series'), episode: el('t-ep').value ? Number(el('t-ep').value) : 0,
    featured: Number(val('t-feat') || 0),
    duration: el('t-dur').value ? Number(el('t-dur').value) : 0,
    intro: val('t-intro')
  };
  if (!payload.title) { alert('请填写标题'); return; }
  if (payload.source === 'bilibili' && !/^BV[0-9A-Za-z]{8,12}$/.test(payload.bvid)) {
    alert('BV 号格式不正确（形如 BV1xx411c7mD）'); return;
  }
  var file = el('t-file').files && el('t-file').files[0];
  var cover = el('t-cover').files && el('t-cover').files[0];
  var scover = el('row-scover').style.display !== 'none' ? (el('t-scover').files && el('t-scover').files[0]) : null;
  if (payload.source === 'upload' && !editingTvId && !file) { alert('请选择要上传的视频文件'); return; }
  if (file && file.size > 95 * 1048576) { alert('视频超过 95MB：请先压缩，或改用「B站嵌入」来源。'); return; }
  var ext = file ? (file.name.split('.').pop() || '').toLowerCase() : '';
  if (file && ['mp4', 'm4v', 'webm'].indexOf(ext) === -1) { alert('仅支持 MP4 / WebM 格式。'); return; }
  if (cover && cover.size > 5 * 1048576) { alert('封面图超过 5MB。'); return; }
  if (scover && scover.size > 5 * 1048576) { alert('剧集封面超过 5MB。'); return; }

  var btn = el('tsave');
  btn.disabled = true;
  var seq = Promise.resolve();
  if (file) {
    progress(0);
    hint('视频上传中，请勿关闭页面…');
    seq = seq.then(function () {
      return putFile('/api/tv/upload?ext=' + ext, file, function (p) { progress(p); });
    }).then(function (d) { payload.file_key = d.key; });
  }
  if (cover) {
    seq = seq.then(function () {
      hint('封面上传中…');
      return putFile('/api/tv/cover', cover);
    }).then(function (d) { payload.cover = d.key; });
  } else if (tFetchedCover) {
    // 没传本地图但用「从B站获取信息」抓到了封面 → 随保存提交
    payload.cover = tFetchedCover;
  }
  if (scover) {
    seq = seq.then(function () {
      hint('剧集封面上传中…');
      return putFile('/api/tv/cover', scover);
    }).then(function (d) { payload.series_cover = d.key; });
  }
  seq.then(function () {
    hint('保存中…');
    return api(editingTvId ? '/api/tv/' + editingTvId : '/api/tv', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }).then(function () {
    closeTvForm();
    loadTv(true);
  }).catch(function (e) {
    if (e.message !== 'unauthorized') alert('保存失败：' + e.message);
  }).then(function () {
    btn.disabled = false;
    progress(null);
    hint(null);
  });
});
el('tmore').addEventListener('click', function () { tState.offset += ${PAGE_SIZE}; loadTv(false); });

/* ---------- 文库管理（docs/文库方案.md） ---------- */
var bState = { status: '', offset: 0 };
var editingBookId = null;
var B_CAT = { novel: '小说', story: '故事', essay: '随笔', other: '其他' };
var B_ST = { pending: '待审核', approved: '已上线', rejected: '已驳回', hidden: '已下线' };

document.querySelectorAll('#view-books .range [data-bst]').forEach(function (b) {
  b.addEventListener('click', function () {
    bState.status = b.getAttribute('data-bst');
    document.querySelectorAll('#view-books .range [data-bst]').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    loadBooks(true);
  });
});

function loadBooks(reset) {
  if (reset) bState.offset = 0;
  var q = '?offset=' + bState.offset + (bState.status ? '&status=' + bState.status : '');
  api('/api/books' + q).then(function (d) {
    var list = d.books || [];
    var counts = d.byStatus || {};
    var line = '共 ' + d.total + ' 部 · 待审 ' + (counts.pending || 0) + ' · 已上线 ' + (counts.approved || 0);
    if (d.storage != null) line += ' · 媒体桶已用 ' + (d.storage / 1048576).toFixed(1) + ' MB';
    el('bstats').textContent = line;
    var box = el('blist');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">还没有作品。作者投稿会出现在这里，也可点右上「新增作品」直发。</p>';
    } else {
      list.forEach(function (x) { box.appendChild(renderBook(x)); });
    }
    el('bmore').style.display = (bState.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('blist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderBook(x) {
  var div = document.createElement('div');
  div.className = 'msg' + (x.status === 'pending' ? '' : ' read');
  var thumb = x.cover
    ? '<img class="bkthumb" loading="lazy" alt="" src="' + SITE_HOME + (x.cover.indexOf('/') === 0 ? '' : '/media/') + esc(x.cover) + '">'
    : '<div class="bkthumb"></div>';
  var pend = x.pending_ch > 0 ? '<span class="mst mst-pending">' + x.pending_ch + ' 章待审</span>' : '';
  div.innerHTML =
    '<div class="vrow1">' + thumb +
    '<div style="min-width:0;flex:1">' +
      '<div class="row1"><span class="name">' + esc(x.title) + '</span>' +
      '<span class="k-badge">' + esc(B_CAT[x.category] || x.category) + '</span>' +
      (x.author_name ? '<span class="k-badge">' + esc(x.author_name) + '</span>' : '') +
      '<span class="mst mst-' + esc(x.status) + '">' + esc(B_ST[x.status] || x.status) + '</span>' + pend +
      (x.slug && x.status === 'approved'
        ? '<a class="mslug" href="' + SITE_HOME + '/library/' + esc(x.slug) + '/" target="_blank" rel="noopener">查看页面 ↗</a>' : '') +
      '</div>' +
      '<div class="meta">' + (x.writer_id ? '作者投稿 · ' : '站长直发 · ') + (x.chapter_count || 0) + ' 章 · ' +
      ((x.word_count || 0).toLocaleString()) + ' 字 · 浏览 ' + (x.views || 0) + ' · ' + esc(fmtTime(x.updated_at)) + '</div>' +
      (x.status === 'rejected' && x.reject_reason ? '<div class="meta" style="color:#d64524">驳回原因：' + esc(x.reject_reason) + '</div>' : '') +
      (x.intro ? '<div class="time">' + esc(x.intro) + '</div>' : '') +
      '<div class="ops">' +
      (x.status === 'pending' ? '<button type="button" data-act="ok" class="primary">通过上线</button><button type="button" data-act="rej">驳回</button>' : '') +
      (x.status === 'approved' ? '<button type="button" data-act="off">下线</button>' : '') +
      (x.status === 'hidden' ? '<button type="button" data-act="ok2" class="primary">恢复上线</button>' : '') +
      '<button type="button" data-act="edit">编辑信息</button>' +
      '<button type="button" data-act="ch">章节审核</button>' +
      '<button type="button" data-act="del">删除</button></div>' +
    '</div></div>';
  div.querySelector('.ops').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'ok' || act === 'ok2') {
      api('/api/books/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved' })
      }).then(function () { loadBooks(true); });
    } else if (act === 'rej') {
      var reason = prompt('驳回原因（会展示给作者）：');
      if (reason === null) return;
      api('/api/books/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', reject_reason: reason || '内容待完善' })
      }).then(function () { loadBooks(true); });
    } else if (act === 'off') {
      api('/api/books/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'hidden' })
      }).then(function () { loadBooks(true); });
    } else if (act === 'edit') {
      openBookForm(x);
    } else if (act === 'ch') {
      toggleChapters(x, div);
    } else if (act === 'del') {
      // 二次点击确认（同商户/视频）：首击变红待确认，4 秒未点自动复原；第二击才真正删除（含章节与图片，不可恢复）
      var btn = e.target;
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.className = 'danger';
        btn.textContent = '确认删除（含章节）';
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed');
          btn.className = '';
          btn.textContent = '删除';
        }, 4000);
        return;
      }
      api('/api/books/' + x.id, { method: 'DELETE' }).then(function () { loadBooks(true); });
    }
  });
  return div;
}

/** 展开/收起某作品的章节审核面板（先读后审：正文全量展示） */
function toggleChapters(book, card) {
  var existing = card.nextElementSibling;
  if (existing && existing.className === 'chdetail') { existing.remove(); return; }
  var det = document.createElement('div');
  det.className = 'chdetail';
  det.innerHTML = '<p class="empty">章节加载中…</p>';
  card.after(det);
  api('/api/books/' + book.id + '/chapters').then(function (d) {
    var rows = (d.chapters || []).map(function (c) {
      var imgs = [];
      try { imgs = JSON.parse(c.images || '[]') || []; } catch (err) { imgs = []; }
      var imgHtml = imgs.length
        ? '<div class="thumbs" style="margin-top:8px">' + imgs.map(function (k) {
            return '<img class="land" loading="lazy" alt="" src="' + SITE_HOME + (k.indexOf('/') === 0 ? '' : '/media/') + esc(k) + '">';
          }).join('') + '</div>'
        : '';
      return '<div class="chitem">' +
        '<div class="row1"><span class="name" style="font-size:14px">第' + c.idx + '章 · ' + esc(c.title) + '</span>' +
        '<span class="mst ' + (c.status === 'approved' ? 'mst-approved' : c.status === 'rejected' ? 'mst-rejected' : 'mst-pending') + '">' +
        (c.status === 'approved' ? '已上线' : c.status === 'rejected' ? '已驳回' : '待审') + '</span>' +
        '<span class="vhint">' + (c.word_count || 0) + ' 字</span></div>' +
        (c.status === 'rejected' && c.reject_reason ? '<div class="vhint">驳回原因：' + esc(c.reject_reason) + '</div>' : '') +
        '<div class="chbody">' + esc(c.body) + '</div>' + imgHtml +
        '<div class="ops">' +
        (c.status !== 'approved' ? '<button type="button" data-chok="' + c.id + '">通过上线</button>' : '') +
        (c.status !== 'rejected' ? '<button type="button" data-chrej="' + c.id + '">驳回</button>' : '') +
        '<button type="button" data-chdel="' + c.id + '" class="danger">删除</button></div>' +
        '</div>';
    }).join('');
    det.innerHTML = rows || '<p class="empty">该作品还没有章节（作者尚未写作）。</p>';
    det.addEventListener('click', function (e) {
      var ok = e.target.getAttribute('data-chok');
      var rej = e.target.getAttribute('data-chrej');
      var del = e.target.getAttribute('data-chdel');
      if (ok) {
        api('/api/books/' + book.id + '/chapters/' + ok, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'approved' })
        }).then(function () { toggleChapters(book, card); loadBooks(false); });
      } else if (rej) {
        var reason = prompt('驳回原因（会展示给作者）：');
        if (reason === null) return;
        api('/api/books/' + book.id + '/chapters/' + rej, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'rejected', reject_reason: reason || '内容待完善' })
        }).then(function () { toggleChapters(book, card); loadBooks(false); });
      } else if (del) {
        if (!confirm('确定删除该章节？章节图片将一并删除，不可恢复。')) return;
        api('/api/books/' + book.id + '/chapters/' + del, { method: 'DELETE' })
          .then(function () { toggleChapters(book, card); loadBooks(false); });
      }
    });
  }).catch(function (e) {
    det.innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function openBookForm(x) {
  editingBookId = x ? x.id : null;
  el('bform-title').textContent = x ? '编辑作品 #' + x.id + '（' + esc(B_ST[x.status] || x.status) + '）' : '新增作品（免审直发）';
  el('b-title').value = x ? x.title || '' : '';
  el('b-cat').value = x ? x.category || 'novel' : 'novel';
  el('b-author').value = x ? x.author_name || '' : '';
  el('b-status').value = x ? x.status || 'approved' : 'approved';
  el('b-weight').value = x ? x.sort_weight || 0 : 0;
  el('b-cover').value = x ? x.cover || '' : '';
  el('b-intro').value = x ? x.intro || '' : '';
  el('bform').style.display = '';
  el('bform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeBookForm() { el('bform').style.display = 'none'; editingBookId = null; }

el('badd').addEventListener('click', function () { openBookForm(null); });
el('bcancel').addEventListener('click', closeBookForm);
el('bsave').addEventListener('click', function () {
  var payload = {
    title: val('b-title'), category: val('b-cat'), author_name: val('b-author'),
    status: val('b-status'), sort_weight: Number(val('b-weight') || 0),
    cover: val('b-cover'), intro: val('b-intro')
  };
  if (!payload.title || !payload.intro) { alert('请填写书名和简介'); return; }
  api(editingBookId ? '/api/books/' + editingBookId : '/api/books', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function () { closeBookForm(); loadBooks(true); })
    .catch(function (e) { if (e.message !== 'unauthorized') alert('保存失败：' + e.message); });
});
el('bmore').addEventListener('click', function () { bState.offset += ${PAGE_SIZE}; loadBooks(false); });

/* ---------- 万载音乐管理（2026-09-06） ---------- */
var muState = { status: '', offset: 0 };
var editingTrackId = null;
var M_ST = { published: '已上线', hidden: '已隐藏' };

document.querySelectorAll('#view-music .range [data-must]').forEach(function (b) {
  b.addEventListener('click', function () {
    muState.status = b.getAttribute('data-must');
    document.querySelectorAll('#view-music .range [data-must]').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    loadMusic(true);
  });
});

function loadMusic(reset) {
  if (reset) muState.offset = 0;
  var q = '?offset=' + muState.offset + (muState.status ? '&status=' + muState.status : '');
  api('/api/music' + q).then(function (d) {
    var list = d.tracks || [];
    var counts = d.byStatus || {};
    var line = '共 ' + d.total + ' 首 · 已上线 ' + (counts.published || 0) + ' · 已隐藏 ' + (counts.hidden || 0);
    if (d.storage != null) line += ' · 已用存储 ' + (d.storage / 1048576).toFixed(1) + ' MB';
    el('mustats').textContent = line;
    var box = el('mulist');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">还没有曲目，点右上「新增曲目」上传第一首 MP3。</p>';
    } else {
      list.forEach(function (x) { box.appendChild(renderTrack(x)); });
    }
    el('mumore').style.display = (muState.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('mulist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderTrack(x) {
  var div = document.createElement('div');
  div.className = 'msg' + (x.status === 'published' ? '' : ' read');
  var thumb = coverUrl(x.cover)
    ? '<img class="vthumb" loading="lazy" alt="" src="' + esc(coverUrl(x.cover)) + '">'
    : '<div class="vthumb"></div>';
  var badges =
    '<span class="k-badge">曲序 ' + (x.sort || 0) + '</span>' +
    '<span class="mst ' + (x.status === 'published' ? 'mst-approved' : 'mst-rejected') + '">' + (M_ST[x.status] || x.status) + '</span>';
  div.innerHTML =
    '<div class="vrow1">' + thumb +
    '<div style="min-width:0;flex:1">' +
      '<div class="row1"><span class="name">' + esc(x.title) + '</span>' + badges +
      (x.status === 'published' ? '<a class="mslug" href="' + SITE_HOME + '/music/" target="_blank" rel="noopener">前台收听 ↗</a>' : '') +
      '</div>' +
      '<div class="meta">' + (x.artist ? esc(x.artist) + ' · ' : '') + (vDur(x.duration) ? '时长 ' + vDur(x.duration) + ' · ' : '') + '播放 ' + (x.plays || 0) + ' 次 · ' + esc(fmtTime(x.created_at)) + '</div>' +
    '</div></div>' +
    '<div class="ops">' +
    '<button type="button" data-act="toggle">' + (x.status === 'published' ? '隐藏' : '上线') + '</button>' +
    '<button type="button" data-act="edit">编辑</button>' +
    '<button type="button" data-act="del">删除</button></div>';
  div.querySelector('.ops').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'toggle') {
      api('/api/music/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: x.status === 'published' ? 'hidden' : 'published' })
      }).then(function () { loadMusic(true); });
    } else if (act === 'edit') {
      openTrackForm(x);
    } else if (act === 'del') {
      // 二次点击确认（同视频删除）：首击变红待确认，4 秒未点自动复原；第二击删除（音频/封面一并清理，不可恢复）
      var btn = e.target;
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.className = 'danger';
        btn.textContent = '确认删除（含音频）';
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed');
          btn.className = '';
          btn.textContent = '删除';
        }, 4000);
        return;
      }
      api('/api/music/' + x.id, { method: 'DELETE' }).then(function () { loadMusic(true); });
    }
  });
  return div;
}

function openTrackForm(x) {
  editingTrackId = x ? x.id : null;
  el('muform-title').textContent = x ? '编辑曲目 #' + x.id : '新增曲目';
  el('mu-title').value = x ? x.title || '' : '';
  el('mu-artist').value = x ? x.artist || '' : '';
  el('mu-status').value = x ? x.status || 'published' : 'published';
  el('mu-sort').value = x ? x.sort || 0 : 0;
  el('mu-dur').value = x && x.duration ? x.duration : '';
  el('mu-file').value = '';
  el('mu-fileinfo').textContent = x && x.file_key ? '当前音频：' + x.file_key + '（不换文件则留空）' : '';
  el('mu-cover').value = '';
  el('mu-coverinfo').textContent = x && x.cover ? '当前封面：' + x.cover : '';
  muProgress(null); muHint(null);
  el('muform').style.display = '';
  el('muform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeTrackForm() { el('muform').style.display = 'none'; editingTrackId = null; muProgress(null); }

function muProgress(p) {
  var bar = el('mu-prog');
  if (p == null) { bar.style.display = 'none'; el('mu-progbar').style.width = '0'; return; }
  bar.style.display = '';
  el('mu-progbar').style.width = Math.round(p * 100) + '%';
}
function muHint(msg) {
  var h = el('mu-hint');
  h.textContent = msg || '';
  h.style.display = msg ? '' : 'none';
}

// 选文件即预读时长（Audio 元数据）+ 大小提示（50MB 上限）
el('mu-file').addEventListener('change', function () {
  var f = this.files && this.files[0];
  var info = el('mu-fileinfo');
  if (!f) { info.textContent = ''; return; }
  info.textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' MB' + (f.size > 50 * 1048576 ? '（超 50MB，请先压缩）' : '');
  var a = document.createElement('audio');
  a.preload = 'metadata';
  a.onloadedmetadata = function () {
    if (a.duration && isFinite(a.duration)) el('mu-dur').value = Math.round(a.duration);
    URL.revokeObjectURL(a.src);
  };
  a.src = URL.createObjectURL(f);
});

el('muadd').addEventListener('click', function () { openTrackForm(null); });
el('mucancel').addEventListener('click', closeTrackForm);
el('musave').addEventListener('click', function () {
  var payload = {
    title: val('mu-title'), artist: val('mu-artist'), status: val('mu-status'),
    sort: Number(val('mu-sort') || 0),
    duration: el('mu-dur').value ? Number(el('mu-dur').value) : 0
  };
  if (!payload.title) { alert('请填写曲名'); return; }
  var file = el('mu-file').files && el('mu-file').files[0];
  var cover = el('mu-cover').files && el('mu-cover').files[0];
  if (!editingTrackId && !file) { alert('请选择要上传的 MP3 文件'); return; }
  if (file) {
    if (file.size > 50 * 1048576) { alert('音频超过 50MB，请先压缩。'); return; }
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'mp3') { alert('仅支持 MP3 格式。'); return; }
  }
  if (cover && cover.size > 5 * 1048576) { alert('封面图超过 5MB。'); return; }

  var btn = el('musave');
  btn.disabled = true;
  var seq = Promise.resolve();
  if (file) {
    muProgress(0);
    muHint('音频上传中，请勿关闭页面…');
    seq = seq.then(function () {
      return putFile('/api/music/upload', file, function (p) { muProgress(p); });
    }).then(function (d) { payload.file_key = d.key; });
  }
  if (cover) {
    seq = seq.then(function () {
      muHint('封面上传中…');
      return putFile('/api/music/cover', cover);
    }).then(function (d) { payload.cover = d.key; });
  }
  seq.then(function () {
    muHint('保存中…');
    return api(editingTrackId ? '/api/music/' + editingTrackId : '/api/music', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }).then(function () {
    closeTrackForm();
    loadMusic(true);
  }).catch(function (e) {
    if (e.message !== 'unauthorized') alert('保存失败：' + e.message);
  }).then(function () {
    btn.disabled = false;
    muProgress(null);
    muHint(null);
  });
});
el('mumore').addEventListener('click', function () { muState.offset += ${PAGE_SIZE}; loadMusic(false); });

/* ---------- 旅游景点管理（2026-09-06） ---------- */
var aState = { status: '', offset: 0 };
var editingAttraId = null;
var A_ST = { published: '已上线', hidden: '已下线' };
var SLUG_RE_JS = /^[a-z0-9][a-z0-9-]{0,59}$/;

document.querySelectorAll('#view-attra .range [data-ast]').forEach(function (b) {
  b.addEventListener('click', function () {
    aState.status = b.getAttribute('data-ast');
    document.querySelectorAll('#view-attra .range [data-ast]').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    loadAttra(true);
  });
});

function loadAttra(reset) {
  if (reset) aState.offset = 0;
  var q = '?offset=' + aState.offset + (aState.status ? '&status=' + aState.status : '');
  api('/api/attractions' + q).then(function (d) {
    var list = d.attractions || [];
    var counts = d.byStatus || {};
    var line = '共 ' + d.total + ' 处 · 已上线 ' + (counts.published || 0) + ' · 已下线 ' + (counts.hidden || 0);
    if (d.storage != null) line += ' · 已用存储 ' + (d.storage / 1048576).toFixed(1) + ' MB';
    el('astats').textContent = line;
    var box = el('atlist');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">还没有景点，点右上「新增景点」创建第一处（上线后前台 /attractions/ 瀑布流展示）。</p>';
    } else {
      list.forEach(function (x) { box.appendChild(renderAttra(x)); });
    }
    el('atmore').style.display = (aState.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('atlist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderAttra(x) {
  var div = document.createElement('div');
  div.className = 'msg' + (x.status === 'published' ? '' : ' read');
  var thumb = coverUrl(x.cover)
    ? '<img class="vthumb" loading="lazy" alt="" src="' + esc(coverUrl(x.cover)) + '">'
    : '<div class="vthumb"></div>';
  var badges =
    '<span class="k-badge">' + esc(x.slug) + '</span>' +
    (x.tags ? '<span class="k-badge">' + esc(x.tags) + '</span>' : '') +
    '<span class="k-badge">排序 ' + (x.sort || 0) + '</span>' +
    '<span class="mst ' + (x.status === 'published' ? 'mst-approved' : 'mst-rejected') + '">' + (A_ST[x.status] || x.status) + '</span>';
  div.innerHTML =
    '<div class="vrow1">' + thumb +
    '<div style="min-width:0;flex:1">' +
      '<div class="row1"><span class="name">' + esc(x.name) + '</span>' + badges +
      (x.status === 'published' ? '<a class="mslug" href="' + SITE_HOME + '/attractions/' + esc(x.slug) + '/" target="_blank" rel="noopener">查看页面 ↗</a>' : '') +
      '</div>' +
      '<div class="time">' + esc(x.summary) + '</div>' +
      '<div class="meta">' + esc(fmtTime(x.updated_at)) + '</div>' +
    '</div></div>' +
    '<div class="ops">' +
    '<button type="button" data-act="toggle">' + (x.status === 'published' ? '下线' : '上线') + '</button>' +
    '<button type="button" data-act="edit">编辑</button>' +
    '<button type="button" data-act="del">删除</button></div>';
  div.querySelector('.ops').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'toggle') {
      api('/api/attractions/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: x.status === 'published' ? 'hidden' : 'published' })
      }).then(function () { loadAttra(true); });
    } else if (act === 'edit') {
      openAttraForm(x);
    } else if (act === 'del') {
      // 二次点击确认（同视频删除）：首击变红待确认，4 秒未点自动复原；第二击删除（封面一并清理，不可恢复）
      var btn = e.target;
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.className = 'danger';
        btn.textContent = '确认删除';
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed');
          btn.className = '';
          btn.textContent = '删除';
        }, 4000);
        return;
      }
      api('/api/attractions/' + x.id, { method: 'DELETE' }).then(function () { loadAttra(true); });
    }
  });
  return div;
}

function openAttraForm(x) {
  editingAttraId = x ? x.id : null;
  el('atform-title').textContent = x ? '编辑景点 #' + x.id : '新增景点';
  el('at-name').value = x ? x.name || '' : '';
  el('at-slug').value = x ? x.slug || '' : '';
  el('at-status').value = x ? x.status || 'published' : 'published';
  el('at-sort').value = x ? x.sort || 0 : 0;
  el('at-tags').value = x ? x.tags || '' : '';
  el('at-summary').value = x ? x.summary || '' : '';
  el('at-body').value = x ? x.body || '' : '';
  el('at-address').value = x ? x.address || '' : '';
  el('at-hours').value = x ? x.hours || '' : '';
  el('at-tickets').value = x ? x.tickets || '' : '';
  el('at-transport').value = x ? x.transport || '' : '';
  el('at-cover').value = '';
  el('at-coverinfo').textContent = x && x.cover ? '当前封面：' + x.cover : '';
  atHint(null);
  el('atform').style.display = '';
  el('atform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAttraForm() { el('atform').style.display = 'none'; editingAttraId = null; }

function atHint(msg) {
  var h = el('at-hint');
  h.textContent = msg || '';
  h.style.display = msg ? '' : 'none';
}

el('atadd').addEventListener('click', function () { openAttraForm(null); });
el('atcancel').addEventListener('click', closeAttraForm);
el('atsave').addEventListener('click', function () {
  var payload = {
    name: val('at-name'), slug: val('at-slug'), status: val('at-status'),
    sort: Number(val('at-sort') || 0), tags: val('at-tags'),
    summary: val('at-summary'), body: val('at-body'),
    address: val('at-address'), hours: val('at-hours'),
    tickets: val('at-tickets'), transport: val('at-transport')
  };
  if (!payload.name || !payload.summary) { alert('请填写名称和一句话简介'); return; }
  if (!editingAttraId && !payload.slug) { alert('请填写 Slug'); return; }
  if (payload.slug && !SLUG_RE_JS.test(payload.slug)) { alert('Slug 仅限小写字母、数字和连字符，且以字母或数字开头。'); return; }
  var cover = el('at-cover').files && el('at-cover').files[0];
  if (cover && cover.size > 5 * 1048576) { alert('封面图超过 5MB。'); return; }

  var btn = el('atsave');
  btn.disabled = true;
  var seq = Promise.resolve();
  if (cover) {
    seq = seq.then(function () {
      atHint('封面上传中…');
      return putFile('/api/attractions/cover', cover);
    }).then(function (d) { payload.cover = d.key; });
  }
  seq.then(function () {
    atHint('保存中…');
    return api(editingAttraId ? '/api/attractions/' + editingAttraId : '/api/attractions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }).then(function () {
    closeAttraForm();
    loadAttra(true);
  }).catch(function (e) {
    if (e.message !== 'unauthorized') alert('保存失败：' + e.message);
  }).then(function () {
    btn.disabled = false;
    atHint(null);
  });
});
el('atmore').addEventListener('click', function () { aState.offset += ${PAGE_SIZE}; loadAttra(false); });

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

/* ---------- AI 助手「花傩」（docs/AI助手方案.md） ---------- */
// 注意：APP_HTML 是模板字符串——内嵌脚本不写反斜杠与 \n 字面量，换行统一用 AI_NL
var AI_NL = String.fromCharCode(10);
var editingKId = null;
var kState = { offset: 0, status: '' };
var K_ST = { published: '参与检索', hidden: '已停用' };

function aiHint(msg) {
  var h = el('ai-hint');
  h.textContent = msg || '';
  h.style.display = msg ? '' : 'none';
}

function loadAi() { loadAiSettings(); loadKnowledge(true); loadAiStats(); }

function loadAiSettings() {
  api('/api/ai/settings').then(function (d) {
    var s = d.settings || {};
    el('ai-enabled').value = s.enabled === '0' ? '0' : '1';
    el('ai-greeting').value = s.greeting || '';
    el('ai-prompt').value = s.system_prompt || '';
    var quick = [];
    try { quick = JSON.parse(s.quick_questions || '[]'); } catch (e) { /* 后台配坏则留空 */ }
    el('ai-quick').value = (quick || []).join(AI_NL);
    var sel = el('ai-model');
    sel.innerHTML = '';
    (d.models || []).forEach(function (mo) {
      var o = document.createElement('option');
      o.value = mo.id;
      o.textContent = mo.label;
      sel.appendChild(o);
    });
    sel.value = s.model || '';
    if (!sel.value) sel.selectedIndex = 0;
  }).catch(function (e) {
    if (e.message !== 'unauthorized') aiHint('设置加载失败：' + e.message);
  });
}

el('ai-savesettings').addEventListener('click', function () {
  var quick = el('ai-quick').value.split(AI_NL).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6);
  aiHint('保存中…');
  api('/api/ai/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enabled: el('ai-enabled').value, model: el('ai-model').value,
      system_prompt: el('ai-prompt').value, greeting: el('ai-greeting').value, quick: quick
    })
  }).then(function () {
    aiHint('已保存，主站最迟 1 分钟生效');
    loadAiSettings();
  }).catch(function (e) { aiHint('保存失败：' + e.message); });
});

/* 知识库 */
function loadKnowledge(reset) {
  if (reset) kState.offset = 0;
  var q = '?offset=' + kState.offset + (kState.status ? '&status=' + kState.status : '');
  api('/api/ai/knowledge' + q).then(function (d) {
    var list = d.knowledge || [];
    var counts = d.byStatus || {};
    el('ai-stats-line').textContent = '知识 ' + d.total + ' 条 · 参与检索 ' + (counts.published || 0) + ' · 停用 ' + (counts.hidden || 0);
    var box = el('klist');
    if (reset) box.innerHTML = '';
    if (reset && list.length === 0) {
      box.innerHTML = '<p class="empty">知识库为空：先执行 scripts/ai-seed.sql 导入旧站 68 条，或点右上「新增知识」。</p>';
    } else {
      list.forEach(function (x) { box.appendChild(renderKnowledge(x)); });
    }
    el('kmore').style.display = (kState.offset + ${PAGE_SIZE} < d.total && list.length > 0) ? 'block' : 'none';
  }).catch(function (e) {
    if (e.message !== 'unauthorized') el('klist').innerHTML = '<p class="empty">加载失败：' + esc(e.message) + '</p>';
  });
}

function renderKnowledge(x) {
  var div = document.createElement('div');
  div.className = 'msg' + (x.status === 'published' ? '' : ' read');
  var badges =
    '<span class="k-badge">#' + x.id + '</span>' +
    '<span class="k-badge">排序 ' + (x.sort || 0) + '</span>' +
    '<span class="mst ' + (x.status === 'published' ? 'mst-approved' : 'mst-rejected') + '">' + (K_ST[x.status] || x.status) + '</span>';
  div.innerHTML =
    '<div class="row1"><span class="name">' + esc(x.category) + '</span>' + badges + '</div>' +
    '<div class="body">' + esc(x.content.length > 140 ? x.content.slice(0, 140) + '…' : x.content) + '</div>' +
    '<div class="time">关键词：' + esc(x.keywords) + '</div>' +
    '<div class="meta">' + esc(fmtTime(x.updated_at)) + '</div>' +
    '<div class="ops">' +
    '<button type="button" data-act="toggle">' + (x.status === 'published' ? '停用' : '启用') + '</button>' +
    '<button type="button" data-act="edit">编辑</button>' +
    '<button type="button" data-act="del">删除</button></div>';
  div.querySelector('.ops').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'toggle') {
      api('/api/ai/knowledge/' + x.id, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: x.status === 'published' ? 'hidden' : 'published' })
      }).then(function () { loadKnowledge(false); });
    } else if (act === 'edit') {
      openKnowledgeForm(x);
    } else if (act === 'del') {
      // 二次点击确认（同景点删除）：首击变红待确认，4 秒未点自动复原
      var btn = e.target;
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.className = 'danger';
        btn.textContent = '确认删除';
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed');
          btn.className = '';
          btn.textContent = '删除';
        }, 4000);
        return;
      }
      api('/api/ai/knowledge/' + x.id, { method: 'DELETE' }).then(function () { loadKnowledge(false); });
    }
  });
  return div;
}

function openKnowledgeForm(x) {
  editingKId = x ? x.id : null;
  el('kform-title').textContent = x ? '编辑知识 #' + x.id : '新增知识';
  el('k-category').value = x ? x.category || '' : '';
  el('k-content').value = x ? x.content || '' : '';
  el('k-keywords').value = x ? x.keywords || '' : '';
  el('k-sort').value = x ? x.sort || 0 : 0;
  el('k-status').value = x ? x.status || 'published' : 'published';
  kHint(null);
  el('kform').style.display = '';
  el('kform').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function kHint(msg) {
  var h = el('k-hint');
  h.textContent = msg || '';
  h.style.display = msg ? '' : 'none';
}

el('k-add').addEventListener('click', function () { openKnowledgeForm(null); });
el('kcancel').addEventListener('click', function () { el('kform').style.display = 'none'; editingKId = null; });
el('ksave').addEventListener('click', function () {
  var payload = {
    category: val('k-category'), content: val('k-content'), keywords: val('k-keywords'),
    sort: Number(val('k-sort') || 0), status: val('k-status')
  };
  if (!payload.category || !payload.content) { alert('请填写分类和内容'); return; }
  kHint('保存中…');
  api(editingKId ? '/api/ai/knowledge/' + editingKId : '/api/ai/knowledge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function () {
    el('kform').style.display = 'none';
    editingKId = null;
    loadKnowledge(true);
  }).catch(function (e) { kHint('保存失败：' + e.message); });
});
el('kmore').addEventListener('click', function () { kState.offset += ${PAGE_SIZE}; loadKnowledge(false); });

/* 用量统计 */
function loadAiStats() {
  api('/api/ai/stats').then(function (d) {
    el('ai-usage').textContent = '今日 ' + d.today + ' 问 · 7 天 ' + d.d7 + ' · 30 天 ' + d.d30 + ' · 累计 ' + d.total;
    var box = el('ai-log');
    var recent = d.recent || [];
    if (!recent.length) { box.innerHTML = '<p class="empty">暂无问答记录。</p>'; return; }
    box.innerHTML = '';
    recent.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'msg read';
      var src = '';
      if (r.sources) { try { src = JSON.parse(r.sources).join('、'); } catch (e) { src = r.sources; } }
      div.innerHTML =
        '<div class="row1"><span class="name">' + esc(r.question) + '</span>' +
        (r.action ? '<span class="k-badge">' + esc(r.action) + '</span>' : '') +
        (src ? '<span class="k-badge">来源 ' + esc(src) + '</span>' : '') +
        '<span class="k-badge">' + (r.duration_ms || 0) + 'ms</span></div>' +
        '<div class="time">' + esc(fmtTime(r.created_at)) + '</div>';
      box.appendChild(div);
    });
  }).catch(function () { el('ai-log').innerHTML = '<p class="empty">加载失败</p>'; });
}

(function () {
  var btn = el('ai-log-clear');
  btn.addEventListener('click', function () {
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      btn.className = 'danger';
      btn.textContent = '确认清空';
      setTimeout(function () {
        if (!btn.isConnected) return;
        btn.removeAttribute('data-armed');
        btn.className = '';
        btn.textContent = '清空问答日志';
      }, 4000);
      return;
    }
    api('/api/ai/log', { method: 'DELETE' }).then(function () { loadAiStats(); });
  });
})();

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
