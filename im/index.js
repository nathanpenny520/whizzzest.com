/**
 * 焰境密语 — IM Worker 薄入口（im.whizzzest.com，docs/IM聊天方案.md）
 *
 * 本文件只做三件事：路由分发、安全响应头、DO 类导出。业务一律在 src/ 各模块：
 *   src/config.js          常量与门户文案
 *   src/util.js            通用工具（响应/编码/哈希/限流桶）
 *   src/session.js         会话 Cookie（HMAC）
 *   src/mail.js            邮箱验证码（im_email_codes 独立表）
 *   src/api/auth.js        双方式注册/登录、资料、E2EE 密钥材料（M1）
 *   src/api/social.js      好友：搜索/申请/处理/删除/拉黑（M2）
 *   src/api/convs.js       会话：dm 幂等/列表/信封/历史/已读（M2）
 *   src/ws.js              /ws 升级（验会话+成员资格 → DO）
 *   src/do/room.js         DO IMRoom（每会话一实例，Hibernation）
 *   src/do/rate-limiter.js DO RateLimiter（每 IP，照 workers-chat-demo）
 *   src/pages/auth.js      认证页面板 + /app 壳
 *
 * E2EE（方案 §3）：服务器是「账号公钥目录 + 密文邮局」，永远不持有可解密钥。
 * 路由一览见 handlePage/handleApi 内注释（M1=账号/密钥目录；M2=好友/会话/实时）。
 */
import { html, json, redirect } from './src/util.js';
import { currentUser } from './src/session.js';
import { sendEmailCode } from './src/mail.js';
import * as authApi from './src/api/auth.js';
import { loginPanelHtml, registerPanelHtml, LOGIN_PAGE_JS, REGISTER_PAGE_JS, appShellHtml } from './src/pages/auth.js';
import { PORTAL_UI } from './src/config.js';
import { authPage } from '../shared/portal-ui.js';

/* ---------------- 入口：安全头统一包裹 ---------------- */

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

/* ---------------- 页面路由 ---------------- */

async function handlePage(request, env, path) {
  if (path !== '/' && path !== '/register' && path !== '/app') return new Response('Not found', { status: 404 });
  const user = await currentUser(request, env);
  if (path === '/app') {
    if (!user) return redirect('/');
    return html(appShellHtml());
  }
  if (user) return redirect('/app');
  if (path === '/register') {
    return html(authPage(PORTAL_UI, {
      titleTag: '注册',
      panelHtml: registerPanelHtml(),
      script: REGISTER_PAGE_JS,
    }));
  }
  return html(authPage(PORTAL_UI, {
    titleTag: '登录',
    panelHtml: loginPanelHtml(),
    script: LOGIN_PAGE_JS,
  }));
}

/* ---------------- API 路由（M1：账号/资料；M2 追加好友/会话/实时） ---------------- */

async function handleApi(request, env, path, url) {
  const method = request.method;

  if (path === '/api/email-code' && method === 'POST') return sendEmailCode(request, env);
  if (path === '/api/register/phone' && method === 'POST') return authApi.registerPhone(request, env);
  if (path === '/api/register/email' && method === 'POST') return authApi.registerEmail(request, env);
  if (path === '/api/login/phone' && method === 'POST') return authApi.loginPhone(request, env);
  if (path === '/api/login/email' && method === 'POST') return authApi.loginEmail(request, env);
  if (path === '/api/logout' && method === 'POST') return authApi.logout();

  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'auth' }, 401);
  if (user.status === 'disabled') return json({ ok: false, error: 'disabled' }, 403);

  if (path === '/api/me' && method === 'GET') return authApi.meGet(env, user);
  if (path === '/api/me' && method === 'PATCH') return authApi.mePatch(request, env, user);

  return json({ ok: false, error: 'not_found' }, 404);
}

function handleWs(request, env) {
  return json({ ok: false, error: 'not_yet', detail: 'WebSocket 实时通道随 M2 上线（docs/IM聊天方案.md §5）' }, 501);
}

/* ---------------- DO 导出 ---------------- */

export { IMRoom } from './src/do/room.js';
export { RateLimiter } from './src/do/rate-limiter.js';
