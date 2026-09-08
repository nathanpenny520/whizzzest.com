/**
 * 焰境·万载 — 门户认证页共享壳（docs/商户功能方案.md §门户 / docs/文库方案.md）
 *
 * merchant.whizzzest.com 与 writer.whizzzest.com 两个门户 Worker 复用同一套
 * 认证页视觉（暖色品牌渐变背景 + 左品牌栏/右表单分栏卡 + 精简页脚），
 * 消除此前两门户各自维护登录页导致的样式/文案漂移。
 *
 * 导出：
 *  - authPage(cfg, opts)        登录/注册页（分栏大卡）
 *  - widePage(cfg, opts)        宽卡页（商户入驻申请等表单页，可与门户 BASE_CSS 叠加）
 *  - loginPanel(opts)           标准登录面板（双方式 Tab + 通行密钥 Tab + 页内脚本）
 *  - passkeyRowHtml(keys)       看板「账号安全」通行密钥行
 *  - PASSKEY_DASH_JS            看板通行密钥添加/删除脚本（拼进看板 <script>）
 *
 * 约定：worker 传入 cfg.logoUri（与 <link rel=icon> 同源 data URI）；本模块不感知 D1/R2。
 */

const SITE = 'https://whizzzest.com';
const CONTACT_EMAIL = 'contact@whizzzest.com';
const ICP = '赣ICP备2026003337号-1';

/* ---------------- 品牌装饰 ---------------- */

/** 烟花射线图（纯 SVG，模块内生成，用于侧栏与页面背景点缀） */
function burstSvg(size, stroke, opacity, cls) {
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    const r2 = i % 2 ? 28 : 42;
    const x1 = (50 + Math.cos(a) * 13).toFixed(1);
    const y1 = (50 + Math.sin(a) * 13).toFixed(1);
    const x2 = (50 + Math.cos(a) * r2).toFixed(1);
    const y2 = (50 + Math.sin(a) * r2).toFixed(1);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    if (i % 3 === 0) {
      const cx = (50 + Math.cos(a) * 47).toFixed(1);
      const cy = (50 + Math.sin(a) * 47).toFixed(1);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="2.2" fill="${stroke}" stroke="none"/>`);
    }
  }
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" ` +
    `stroke="${stroke}" stroke-width="2" stroke-linecap="round" opacity="${opacity}" aria-hidden="true">${parts.join('')}</svg>`;
}

/* 表单内嵌小图标（线性，跟随 currentColor；注册页等自定义面板复用） */
export const ICO = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="7" y="2.5" width="10" height="19" rx="2.6"/><line x1="10.4" y1="18.4" x2="13.6" y2="18.4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.6"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14.5" rx="2.6"/><path d="m4.4 7.4 7.6 5.8 7.6-5.8"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.3"/><path d="M10.8 12.2 20 3m-3.4 1.4 3 3M13.4 7.6l2.2 2.2"/></svg>',
};

/* ---------------- 样式 ---------------- */

export const AUTH_CSS = `
  :root { --abrand:#d64524; --abrand-deep:#b5371a; --aink:#1d1d1f; --amut:#6e6e73; --afaint:#86868b; }
  * { box-sizing:border-box; margin:0; }
  html { min-height:100%; }
  body.auth {
    min-height:100vh; display:flex; flex-direction:column; color:var(--aink); padding:0;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;
    background:
      radial-gradient(1100px 540px at 10% -10%, rgba(232,114,44,.18), transparent 62%),
      radial-gradient(900px 500px at 92% -6%, rgba(214,69,36,.13), transparent 58%),
      radial-gradient(760px 460px at 80% 112%, rgba(245,227,40,.14), transparent 62%),
      linear-gradient(158deg,#fff8f2 0%,#fdf0e7 46%,#fbe9dc 100%);
  }
  a { color:inherit; text-decoration:none; }
  [hidden] { display:none !important; }  /* .afcol 的 display:flex 会盖过 UA 的 [hidden]，须显式压制 */
  .bg-fw { position:fixed; z-index:0; pointer-events:none; }
  .bg-fw.a { top:6vh; right:4vw; }
  .bg-fw.b { bottom:-60px; left:-40px; }
  /* 顶栏 */
  .auth-top { position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between;
    max-width:1020px; width:100%; margin:0 auto; padding:20px 24px 6px; }
  .auth-brand { display:flex; align-items:center; gap:10px; font-size:17px; font-weight:600; }
  .auth-brand img { width:27px; height:27px; display:block; }
  .auth-top-r { display:flex; gap:10px; }
  .auth-toplink { font-size:13px; color:var(--amut); padding:7px 15px; border:1px solid rgba(0,0,0,.1);
    border-radius:999px; background:rgba(255,255,255,.65); transition:color .2s,border-color .2s; }
  .auth-toplink:hover { color:var(--abrand); border-color:var(--abrand); }
  /* 主区 */
  .auth-main { position:relative; z-index:1; flex:1; width:100%; max-width:1020px; margin:0 auto; padding:20px 24px 36px; }
  .auth-h1 { text-align:center; font-size:30px; font-weight:700; letter-spacing:.01em; }
  .auth-sub { text-align:center; margin-top:9px; color:var(--amut); font-size:14px; }
  /* 分栏大卡 */
  .auth-card { display:flex; margin:24px auto 0; max-width:920px; background:#fff; border-radius:22px;
    box-shadow:0 20px 55px rgba(166,62,22,.12), 0 2px 10px rgba(0,0,0,.04); overflow:hidden; }
  .auth-side { flex:0 0 336px; padding:32px 28px 22px; color:#fff; position:relative; overflow:hidden;
    display:flex; flex-direction:column;
    background:linear-gradient(168deg,#e0512e 0%,#c93a1b 56%,#a92f14 100%); }
  .side-mark { display:flex; align-items:center; gap:10px; font-size:18px; font-weight:600; }
  .side-mark img { width:30px; height:30px; display:block; }
  .side-slogan { margin-top:14px; font-size:15px; line-height:1.75; color:rgba(255,255,255,.94); }
  .side-list { list-style:none; margin-top:22px; display:flex; flex-direction:column; gap:12px;
    font-size:13.5px; color:rgba(255,255,255,.9); position:relative; z-index:1; }
  .side-list .dot { margin-right:9px; opacity:.85; }
  .side-art { margin-top:auto; align-self:flex-end; margin-bottom:-6px; margin-right:-4px; }
  /* 表单列 */
  .auth-body-col { flex:1; min-width:0; padding:32px 42px 28px; }
  .auth-tabs { display:flex; gap:26px; border-bottom:1px solid rgba(0,0,0,.07); }
  button.atab { appearance:none; border:0; background:none; padding:0 2px 11px; font-size:15px;
    color:var(--amut); cursor:pointer; position:relative; font-family:inherit; }
  button.atab:hover { color:var(--aink); }
  button.atab.active { color:var(--abrand); font-weight:600; }
  button.atab.active::after { content:''; position:absolute; left:0; right:0; bottom:-1px; height:2.5px;
    border-radius:2px; background:var(--abrand); }
  .afcol { display:flex; flex-direction:column; gap:14px; margin-top:22px; }
  .afield { display:flex; align-items:center; height:49px; border:1px solid rgba(0,0,0,.13);
    border-radius:12px; background:#fff; transition:border-color .2s, box-shadow .2s; }
  .afield:focus-within { border-color:var(--abrand); box-shadow:0 0 0 3px rgba(214,69,36,.09); }
  .afield .aico { flex:0 0 42px; display:flex; justify-content:center; color:var(--afaint); }
  .afield .aico svg { width:17px; height:17px; }
  .afield input { flex:1; min-width:0; height:100%; border:0; outline:0; background:transparent;
    padding:0 14px 0 0; font-size:15px; color:var(--aink); font-family:inherit; }
  .afield input::placeholder { color:#abaab0; }
  .acode { display:flex; gap:10px; }
  .acode .afield { flex:1; }
  button.abtn { border:1px solid rgba(0,0,0,.13); background:#fff; border-radius:12px; padding:0 16px;
    font-size:13px; color:var(--aink); cursor:pointer; font-family:inherit; white-space:nowrap; transition:color .2s,border-color .2s; }
  button.abtn:hover { color:var(--abrand); border-color:var(--abrand); }
  button.abtn[disabled] { opacity:.55; cursor:default; }
  button.aprimary { border:0; border-radius:12px; background:linear-gradient(135deg,#e0512e,#c93a1b);
    color:#fff; font-size:15px; font-weight:600; padding:13px; cursor:pointer; font-family:inherit;
    transition:filter .2s, transform .05s; }
  button.aprimary:hover { filter:brightness(1.07); }
  button.aprimary:active { transform:translateY(1px); }
  button.aprimary[disabled] { opacity:.6; cursor:default; }
  .aerr { display:none; padding:10px 14px; background:#fdeee8; color:#c23a1c; border-radius:10px;
    font-size:13px; line-height:1.6; }
  .aok { padding:10px 14px; background:#e5f3e8; color:#1a7f37; border-radius:10px; font-size:13px; line-height:1.6; }
  .ahint { font-size:12px; color:var(--afaint); line-height:1.75; }
  .ahint b { color:var(--amut); font-weight:600; }
  .aentry { margin-top:18px; text-align:center; font-size:13px; color:var(--amut); }
  .alink { color:var(--abrand); }
  .alink:hover { text-decoration:underline; }
  /* 宽卡页（入驻申请等） */
  .wide-card { margin:28px auto 0; max-width:920px; background:#fff; border-radius:22px; padding:30px 36px 32px;
    box-shadow:0 20px 55px rgba(166,62,22,.12), 0 2px 10px rgba(0,0,0,.04); }
  .wide-card h2 { font-size:17px; font-weight:600; }
  /* 页脚 */
  .auth-foot { position:relative; z-index:1; padding:16px 24px 26px; text-align:center;
    font-size:12px; color:var(--afaint); line-height:2.1; }
  .auth-foot a { color:var(--afaint); }
  .auth-foot a:hover { color:var(--abrand); }
  .auth-foot .sep { margin:0 10px; color:rgba(0,0,0,.16); }
  .foot-copy { color:#a5a4aa; }
  @media (max-width:880px) {
    .auth-side { display:none; }
    .auth-card { max-width:540px; }
    .auth-h1 { font-size:24px; }
    .auth-body-col { padding:28px 24px 24px; }
    .wide-card { padding:24px 20px; }
  }
`;

/* ---------------- 页面骨架 ---------------- */

function topbarHtml(cfg, entry) {
  const entryLink = entry
    ? `<a class="auth-toplink" href="${entry.href}">${entry.label}</a>`
    : '';
  return `<div class="auth-top">
    <a class="auth-brand" href="${cfg.home}"><img src="${cfg.logoUri}" alt="">${cfg.brand}</a>
    <div class="auth-top-r">${entryLink}<a class="auth-toplink" href="${SITE}/">返回官网 ↗</a></div>
  </div>`;
}

function footerHtml(cfg) {
  const year = new Date().getFullYear();
  return `<footer class="auth-foot">
    <p>
      <a href="${SITE}/">官网首页</a><span class="sep">·</span>
      <a href="${SITE}/about/">关于本站</a><span class="sep">·</span>
      <a href="https://merchant.whizzzest.com">商户中心</a><span class="sep">·</span>
      <a href="https://writer.whizzzest.com">文库作者中心</a><span class="sep">·</span>
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
    </p>
    <p class="foot-copy">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${ICP}</a><span class="sep">·</span>© ${year} 焰境·万载
    </p>
  </footer>`;
}

function pageHead(cfg, titleTag, extraCss) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="${cfg.logoUri}">
<title>${titleTag} — 焰境·万载</title>
<style>${extraCss ? extraCss + '\n' : ''}${AUTH_CSS}</style>`;
}

/**
 * 登录/注册页（分栏大卡）。
 * opts: { titleTag, entry:{href,label}|null, panelHtml, script, noticeHtml }
 */
export function authPage(cfg, opts) {
  const highlights = (cfg.highlights || [])
    .map((h) => `<li><span class="dot">✦</span>${h}</li>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
${pageHead(cfg, opts.titleTag)}
</head>
<body class="auth">
${burstSvg(240, '#e0a07f', '.35', 'bg-fw a')}
${burstSvg(300, '#e8b48f', '.3', 'bg-fw b')}
${topbarHtml(cfg, opts.entry)}
<main class="auth-main">
  <h1 class="auth-h1">${cfg.brand} · ${cfg.area}</h1>
  <p class="auth-sub">${cfg.slogan}</p>
  <section class="auth-card">
    <aside class="auth-side">
      <div class="side-mark"><img src="${cfg.logoUri}" alt="">${cfg.brand}</div>
      <p class="side-slogan">${cfg.sideSlogan || cfg.slogan}</p>
      <ul class="side-list">${highlights}</ul>
      ${burstSvg(180, 'rgba(255,255,255,.55)', '.55', 'side-art')}
    </aside>
    <section class="auth-body-col">
      ${opts.noticeHtml || ''}
      ${opts.panelHtml}
    </section>
  </section>
</main>
${footerHtml(cfg)}
<script>
${opts.script || ''}
</script>
</body>
</html>`;
}

/**
 * 宽卡页（表单页复用：商户入驻申请等）。
 * opts: { titleTag, entry, title, sub, content, extraCss, script, noticeHtml }
 * extraCss：门户 BASE_CSS（宽卡内沿用 .panel/.fgrid/.tip 等既有组件类，避免第二套表单样式）。
 */
export function widePage(cfg, opts) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
${pageHead(cfg, opts.titleTag, opts.extraCss)}
</head>
<body class="auth">
${burstSvg(240, '#e0a07f', '.35', 'bg-fw a')}
${burstSvg(300, '#e8b48f', '.3', 'bg-fw b')}
${topbarHtml(cfg, opts.entry)}
<main class="auth-main">
  <h1 class="auth-h1">${opts.title || cfg.brand + ' · ' + cfg.area}</h1>
  ${opts.sub ? `<p class="auth-sub">${opts.sub}</p>` : ''}
  <div class="wide-card">
    ${opts.noticeHtml || ''}
    ${opts.content}
  </div>
</main>
${footerHtml(cfg)}
<script>
${opts.script || ''}
</script>
</body>
</html>`;
}

/* ---------------- 登录面板（双方式 + 通行密钥，两门户共用） ---------------- */

/** WebAuthn 浏览器侧编解码（base64url ↔ ArrayBuffer）；loginPanel 与 admin 登录页共用 */
export const WA_HELPERS = `
    function b64uToBuf(s) {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      var b = atob(s), u = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      return u.buffer;
    }
    function bufToB64u(buf) {
      var u = new Uint8Array(buf), s = '';
      for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
`;

/**
 * 标准登录面板。
 * opts: { pwPlaceholder, entryHref, entryLabel, entryNote? }
 */
export function loginPanel(opts) {
  return `
  <div class="auth-tabs" role="tablist">
    <button type="button" class="atab active" id="mt-phone">账密登录</button>
    <button type="button" class="atab" id="mt-email">验证码登录</button>
    <button type="button" class="atab" id="mt-pk">通行密钥</button>
  </div>
  <form class="afcol" id="f">
    <label class="afield"><span class="aico">${ICO.phone}</span>
      <input id="phone" maxlength="11" inputmode="numeric" autocomplete="username" placeholder="手机号"></label>
    <label class="afield"><span class="aico">${ICO.lock}</span>
      <input id="pw" type="password" autocomplete="current-password" placeholder="${opts.pwPlaceholder}"></label>
    <button class="aprimary" id="go" type="submit">登 录</button>
    <p class="aerr" id="err" style="display:none"></p>
  </form>
  <form class="afcol" id="fe" hidden>
    <label class="afield"><span class="aico">${ICO.mail}</span>
      <input id="email" type="email" autocomplete="email" placeholder="已绑定的邮箱"></label>
    <div class="acode">
      <label class="afield"><span class="aico">${ICO.lock}</span>
        <input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"></label>
      <button class="abtn" id="send" type="button">发送验证码</button>
    </div>
    <button class="aprimary" id="goe" type="submit">登 录</button>
    <p class="aerr" id="erre" style="display:none"></p>
  </form>
  <div class="afcol" id="fp" hidden>
    <p class="ahint">使用已在本站添加的通行密钥，通过指纹 / 面容 / 设备密码一键登录，无需输入账号密码。</p>
    <button class="aprimary" id="pk-go" type="button">${ICO.key.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-2.5px;margin-right:6px"')}使用通行密钥登录</button>
    <p class="aerr" id="errp" style="display:none"></p>
    <p class="ahint">还没有通行密钥？先用其他方式登录，到「账号安全 → 通行密钥」添加。</p>
  </div>
  <p class="aentry">没有账号？<a class="alink" href="${opts.entryHref}">${opts.entryLabel}</a></p>
  <p class="ahint" style="text-align:center">验证码由 notifications@whizzzest.com 发送；仅支持已在账号安全中绑定邮箱的账号。</p>
  <script>
  (function () {
    var PHONE_ERR = { bad: '手机号或密码不正确', rate: '尝试过于频繁，请 10 分钟后再试', format: '提交内容格式有误', config: '服务端未配置完成，请联系站长' };
    var EMAIL_ERR = { bad: '验证码错误或邮箱未绑定', expired: '验证码已过期，请重新发送', rate: '尝试过于频繁，请 10 分钟后再试', too_fast: '发送太频繁，请 1 分钟后再试', send_failed: '邮件发送失败，请稍后再试', format: '请输入邮箱和 6 位验证码', config: '邮件服务未配置，请联系站长' };
    function showErr(id, text) { var e = document.getElementById(id); e.textContent = text; e.style.display = text ? 'block' : 'none'; }
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
    var MODES = ['f', 'fe', 'fp'], TABS = ['mt-phone', 'mt-email', 'mt-pk'];
    function switchMode(i) {
      MODES.forEach(function (id, j) { document.getElementById(id).hidden = j !== i; });
      TABS.forEach(function (id, j) { document.getElementById(id).classList.toggle('active', j === i); });
    }
    TABS.forEach(function (id, i) { document.getElementById(id).addEventListener('click', function () { switchMode(i); }); });

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
            showErr('erre', '✅ 若该邮箱已绑定账号，验证码已发送（10 分钟内有效）');
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

    // 通行密钥登录
    ${WA_HELPERS}
    document.getElementById('pk-go').addEventListener('click', function () {
      var btn = this;
      if (btn.disabled) return;
      if (!window.PublicKeyCredential || !navigator.credentials) { showErr('errp', '当前浏览器不支持通行密钥'); return; }
      btn.disabled = true; showErr('errp', '');
      post('/api/webauthn/login-options', {})
        .then(function (r) {
          if (!(r.s === 200 && r.d.ok)) throw new Error('options');
          var o = r.d.options;
          o.challenge = b64uToBuf(o.challenge);
          if (o.allowCredentials) o.allowCredentials = o.allowCredentials.map(function (c) { c.id = b64uToBuf(c.id); return c; });
          return navigator.credentials.get({ publicKey: o });
        })
        .then(function (cred) {
          var res = cred.response;
          // 不经 post() 包装：登录成功时 302 会被 fetch 跟随到 /dashboard（HTML），
          // 必须先判 r.ok 再解析错误 JSON（与账密登录 submitPost 同理）
          return fetch('/api/webauthn/login-verify', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
              response: {
                clientDataJSON: bufToB64u(res.clientDataJSON),
                authenticatorData: bufToB64u(res.authenticatorData),
                signature: bufToB64u(res.signature),
                userHandle: res.userHandle ? bufToB64u(res.userHandle) : null,
              },
            }) });
        })
        .then(function (r) {
          if (r.ok) { location.href = '/dashboard'; return; }
          return r.json().catch(function () { return {}; }).then(function (d) {
            btn.disabled = false;
            showErr('errp', d && d.error === 'rate' ? '尝试过于频繁，请 10 分钟后再试' : '通行密钥验证未通过，请重试或改用其他方式');
          });
        })
        .catch(function () {
          btn.disabled = false;
          showErr('errp', '已取消，或本机没有已添加的通行密钥');
        });
    });
  })();
  </script>`;
}

/* ---------------- 看板「账号安全」通行密钥 ---------------- */

/** 通行密钥管理行。keys: [{id, device, created_at}]（worker 已 esc） */
export function passkeyRowHtml(keys) {
  const list = (keys || []).map((k) =>
    `<span class="pkitem">${k.device || '通行密钥'}（${(k.created_at || '').slice(0, 10)}）
      <button type="button" class="btn-text pk-del" data-id="${k.id}">删除</button></span>`
  ).join(' ');
  return `<tr><th>通行密钥</th><td>${list || '未添加'}
    <button type="button" class="btn-text" id="pk-add">${(keys || []).length ? '添加密钥' : '添加通行密钥'}</button>
    <span class="pk-saveline" id="pk-line" style="margin-left:8px"></span></td></tr>`;
}

/** 看板通行密钥脚本（拼进看板既有 <script> 内执行；依赖相对路径 fetch） */
export const PASSKEY_DASH_JS = `
  var pkLine = document.getElementById('pk-line');
  function pkMsg(t, bad) { if (!pkLine) return; pkLine.textContent = t || ''; pkLine.style.color = bad ? '#d64524' : '#1a7f37'; }
  function pkPrepare(o) {
    o.challenge = b64uToBuf(o.challenge);
    if (o.user && typeof o.user.id === 'string') o.user.id = b64uToBuf(o.user.id); // JSON 的 base64url → BufferSource
    if (o.excludeCredentials) o.excludeCredentials = o.excludeCredentials.map(function (c) { c.id = b64uToBuf(c.id); return c; });
    return o;
  }
  ${WA_HELPERS}
  var pkAdd = document.getElementById('pk-add');
  if (pkAdd) pkAdd.addEventListener('click', function () {
    if (!window.PublicKeyCredential || !navigator.credentials) { pkMsg('当前浏览器不支持通行密钥', true); return; }
    pkMsg('请在弹窗中完成验证…');
    fetch('/api/webauthn/reg-options', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error(d.error || 'options');
      return navigator.credentials.create({ publicKey: pkPrepare(d.options) });
    }).then(function (cred) {
      var res = cred.response, transports = [];
      try { transports = cred.response.getTransports ? cred.response.getTransports() : []; } catch (e) {}
      return fetch('/api/webauthn/reg-verify', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
          response: { clientDataJSON: bufToB64u(res.clientDataJSON), attestationObject: bufToB64u(res.attestationObject),
            transports: transports } }) });
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); }).then(function (r) {
      if (r.s === 200 && r.d.ok) { location.reload(); return; }
      pkMsg(r.d && r.d.error === 'exists' ? '这把密钥已添加过' : '添加未完成，请重试', true);
    }).catch(function (e) {
      pkMsg(e && e.name === 'InvalidStateError' ? '这把密钥已添加过' : '已取消或浏览器不支持', true);
    });
  });
  document.querySelectorAll('.pk-del').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!confirm('确定删除该通行密钥？删除后将无法用它登录。')) return;
      fetch('/api/webauthn/delete', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Number(btn.getAttribute('data-id')) }) }).then(function (r) {
        if (r.ok) location.reload(); else pkMsg('删除失败，请重试', true);
      });
    });
  });
`;
