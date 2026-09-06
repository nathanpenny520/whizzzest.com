/**
 * 单入口 Worker：
 *  - www → 裸域 301（方案 §8.2）
 *  - POST /api/contact  联系表单：Honeypot → D1（权威记录）→ 企业邮通知（尽力而为，§7）
 *  - 文档导航请求 → 访客监控：第一方匿名 Cookie vid + D1 visits 表（ctx.waitUntil 不阻塞响应）
 *  - 其余请求交给静态资产（dist/）
 */
import { sendMail } from './smtp.js';

const BOT_RE = /bot|crawl|spider|slurp|preview|headless|monitor/i;
const VID_COOKIE = 'vid';
const VID_MAX_AGE = 365 * 24 * 60 * 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname === 'www.whizzzest.com') {
      url.hostname = 'whizzzest.com';
      return Response.redirect(url, 301);
    }

    if (url.pathname === '/api/contact' && request.method === 'POST') {
      return handleContact(request, env);
    }

    // 静态资产请求
    const res = await env.ASSETS.fetch(request);

    // 访客采集：仅针对「文档导航」（浏览器地址栏/链接访问），跳过脚本/样式/图片与爬虫
    if (request.method === 'GET' && url.pathname !== '/api/contact') {
      const dest = request.headers.get('sec-fetch-dest') || '';
      const accept = request.headers.get('accept') || '';
      const ua = request.headers.get('user-agent') || '';
      const isDoc = dest === 'document' || (!dest && accept.includes('text/html'));
      if (isDoc && !BOT_RE.test(ua)) {
        const setCookie = trackVisit(request, env, ctx, url, ua);
        if (setCookie) {
          // ASSETS 返回的 Response 头不可变，包一层再追加 Cookie
          const mutable = new Response(res.body, res);
          mutable.headers.append('set-cookie', setCookie);
          return mutable;
        }
      }
    }

    return res;
  },
};

/* ---------------- 访客采集 ---------------- */

/**
 * 记一次页面访问：读/发第一方匿名 Cookie（vid），D1 插入走 ctx.waitUntil 不阻塞。
 * 采集字段：匿名 ID、路径、来源站、国家（边缘地理）、设备类型、UA、IP。
 */
function trackVisit(request, env, ctx, url, ua) {
  try {
    const cookie = request.headers.get('cookie') || '';
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${VID_COOKIE}=([A-Za-z0-9-]{10,64})`));
    let vid = m ? m[1] : '';
    let setCookie = '';
    if (!vid) {
      vid = crypto.randomUUID();
      setCookie = `${VID_COOKIE}=${vid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VID_MAX_AGE}`;
    }

    const device = /Mobile|Android|iPhone/i.test(ua) ? 'mobile'
      : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop';
    const ref = request.headers.get('referer') || '';
    let refHost = '';
    if (ref) {
      try { refHost = new URL(ref).hostname; } catch { /* 非法 referer 留空 */ }
    }

    ctx.waitUntil(
      env.DB.prepare(
        'INSERT INTO visits (vid, path, referrer, country, device, ua, ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
      )
        .bind(
          vid,
          url.pathname,
          refHost,
          request.cf?.country || '',
          device,
          ua.slice(0, 250),
          request.headers.get('cf-connecting-ip') || ''
        )
        .run()
        .catch((err) => console.error('visit log failed:', err))
    );
    return setCookie;
  } catch (err) {
    console.error('trackVisit error:', err);
    return '';
  }
}

/* ---------------- 联系表单 ---------------- */

/** 同 IP 简易限流：每隔离实例内 10 分钟最多 5 条 */
const recent = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

function rateLimited(ip) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear(); // 防 Map 无限膨胀
  return hits.length > RATE_MAX;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

async function handleContact(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // Honeypot：机器人填了隐藏字段 → 假装成功（不写库）
  if (clean(body.website, 100) !== '') return json({ ok: true });

  const name = clean(body.name, 50);
  const email = clean(body.email, 100);
  const message = clean(body.message, 2000);
  if (!name || !message || (email && !EMAIL_RE.test(email))) {
    return json({ ok: false, error: 'invalid_fields' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && rateLimited(ip)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // 1) D1 权威记录（失败则明确报错）
  try {
    await env.DB.prepare(
      'INSERT INTO messages (name, email, message, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?5)'
    )
      .bind(name, email || null, message, ip, clean(request.headers.get('user-agent'), 300))
      .run();
  } catch (err) {
    console.error('D1 insert failed:', err);
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  // 2) 企业邮通知：尽力而为，失败不影响结果（凭据未配置时静默跳过）
  if (env.SMTP_USER && env.SMTP_PASS && env.NOTIFY_TO) {
    try {
      const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      await sendMail({
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        to: env.NOTIFY_TO,
        subject: `焰境·万载官网新留言 — ${name}`,
        html: [
          `<p><b>${esc(name)}</b>（${esc(email || '未留邮箱')}）通过官网联系表单留言：</p>`,
          `<blockquote style="border-left:3px solid #d64524;padding-left:12px;color:#333">${esc(message).replace(/\n/g, '<br>')}</blockquote>`,
          `<p style="color:#888;font-size:12px">${time} · IP ${esc(ip)}</p>`,
        ].join(''),
      });
    } catch (err) {
      console.error('SMTP notify failed (message kept in D1):', err);
    }
  }

  return json({ ok: true });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
