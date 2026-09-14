/**
 * 焰境密语 — 邮箱验证码（im_email_codes 独立表，照 merchant M2.1 / writer 逻辑）
 * purpose：im-register ｜ im-login（与三门户的 email_login_codes 隔离，同邮箱互不覆盖）
 * 限流：IP 10 分钟 6 次；同邮箱 60s 间隔；登录用途恒成功防枚举（方案 §8）
 */

import { sendMail } from '../../worker/smtp.js';
import { EMAIL_RE, IM_HOME, SITE, CONTACT_EMAIL } from './config.js';
import { currentUser } from './session.js';
import { dbTimeMs, json, limited, readJson, sha256Hex, timingSafeEqual } from './util.js';

export async function sendEmailCode(request, env) {
  if (!env.SMTP_USER || !env.SMTP_PASS) return json({ ok: false, error: 'config' }, 500);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const p = String(body.purpose || '');
  const purpose = p === 'register' ? 'im-register' : p === 'bind' ? 'im-bind' : 'im-login';
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 100) return json({ ok: false, error: 'format' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip && limited('imcode:' + ip, 10 * 60 * 1000, 6)) return json({ ok: false, error: 'rate' }, 429);

  if (purpose === 'im-register') {
    const dup = await env.DB.prepare('SELECT id FROM im_users WHERE email = ?1').bind(email).first();
    if (dup) return json({ ok: false, error: 'taken' }, 400);
  } else if (purpose === 'im-bind') {
    // 绑定邮箱须登录态（未登录不给任意邮箱发码）
    const viewer = await currentUser(request, env);
    if (!viewer || viewer.status === 'disabled') return json({ ok: false, error: 'auth' }, 401);
    const dup = await env.DB.prepare('SELECT id FROM im_users WHERE email = ?1 AND id != ?2').bind(email, viewer.uid).first();
    if (dup) return json({ ok: false, error: 'taken' }, 400);
  } else {
    // 登录用途：邮箱未注册时不发码不落库，仍返回成功（防枚举）
    const known = await env.DB.prepare('SELECT id FROM im_users WHERE email = ?1').bind(email).first();
    if (!known) return json({ ok: true });
  }

  const last = await env.DB.prepare('SELECT created_at FROM im_email_codes WHERE email = ?1').bind(email).first();
  if (last) {
    const age = Date.now() - dbTimeMs(last.created_at);
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

/** 校验验证码：purpose/次数/过期逐项核；成功即焚。返回 null=通过，否则为错误码 */
export async function verifyEmailCode(env, email, purpose, code) {
  const row = await env.DB.prepare(
    'SELECT code_hash, purpose, expires_at, attempts FROM im_email_codes WHERE email = ?1'
  ).bind(email).first();
  if (!row || row.purpose !== purpose || row.attempts >= 5) return 'bad';
  if (dbTimeMs(row.expires_at) < Date.now()) return 'expired';
  if (!timingSafeEqual(await sha256Hex(code), row.code_hash)) {
    await env.DB.prepare('UPDATE im_email_codes SET attempts = attempts + 1 WHERE email = ?1').bind(email).run();
    return 'bad';
  }
  await env.DB.prepare('DELETE FROM im_email_codes WHERE email = ?1').bind(email).run();
  return null;
}

/* ---------------- 邮件模板（照三门户验证码邮件版式） ---------------- */

async function sendCodeEmail(env, email, code, purpose) {
  const action = purpose === 'im-register' ? '注册焰境密语' : purpose === 'im-bind' ? '绑定邮箱' : '登录焰境密语';
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
