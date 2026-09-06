/**
 * 单入口 Worker：
 *  - www → 裸域 301（方案 §8.2）
 *  - POST /api/contact  联系表单：Honeypot → D1（权威记录）→ 企业邮通知（尽力而为，§7）
 *  - 其余请求交给静态资产（dist/）
 */
import { sendMail } from './smtp.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.whizzzest.com') {
      url.hostname = 'whizzzest.com';
      return Response.redirect(url, 301);
    }

    if (url.pathname === '/api/contact' && request.method === 'POST') {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

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
