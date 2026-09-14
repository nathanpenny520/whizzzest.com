/**
 * 焰境密语 — 认证页面板（shared authPage 壳）+ /app 壳
 * 结构与 shared loginPanel / writer 注册页同款（业主报修对齐，见看板 2026-09-13 UI 对齐行）：
 *  - 登录页：账密/验证码顶部双 Tab + 没有账号？注册焰境密语 + 新设备密码解密密钥备份（im-rec）
 *  - 注册页：账密/邮箱注册顶部双 Tab + 已有账号？直接登录 + 端到端加密警示
 * 面板内 JS 一律字符串拼接，不用模板字符串（内嵌脚本反斜杠/嵌套模板坑，见 admin 先例）
 */

import { ICO } from '../../../shared/portal-ui.js';
import { phoneCountryOptionsHtml } from '../../../shared/phone.js';
import { LOGO_URI } from '../config.js';

const IM_PANEL_CSS = `
  <style>
    .im-note { font-size: 12.5px; color: #8a5a2b; background: #fdf6ec; border: 1px solid #f0e0c0; border-radius: 10px; padding: 10px 12px; line-height: 1.7; margin: 0; }
    .im-rec { border: 1px solid #f0d8c8; background: #fffaf6; border-radius: 12px; padding: 14px; margin-top: 4px; }
    .im-rec-tip { font-size: 12.5px; color: #8a5a3b; line-height: 1.7; margin: 0 0 10px; }
  </style>`;

const IM_NOTE_HTML = `<p class="im-note">端到端加密：注册时本机自动生成你的专属密钥；私钥副本用<b>登录密码</b>加密后上传作备份。忘记密码且没有已登录的设备时，历史消息将不可恢复——请牢记密码。</p>`;

export function loginPanelHtml() {
  // 与 shared loginPanel 同构：账密/验证码顶部双 Tab + 「没有账号？」入口 + 发码提示。
  // 差异仅两点：无通行密钥 Tab（IM 未实装 WebAuthn）；新设备验证码登录需密码解密密钥备份（im-rec）。
  return `${IM_PANEL_CSS}
  <div class="auth-tabs" role="tablist">
    <button type="button" class="atab active" id="mt-phone">账密登录</button>
    <button type="button" class="atab" id="mt-email">验证码登录</button>
  </div>
  <form class="afcol" id="f">
    <label class="afield"><span class="aico">${ICO.phone}</span>
      <span class="acc-wrap">
        <span class="acc-label" id="lp-cc-label">+86</span>
        <select id="lp-cc" class="acc" aria-label="国家地区">${phoneCountryOptionsHtml()}</select>
      </span>
      <span class="adiv"></span>
      <input id="lp-phone" maxlength="15" inputmode="tel" autocomplete="username" placeholder="手机号"></label>
    <label class="afield"><span class="aico">${ICO.lock}</span>
      <input id="lp-pass" type="password" maxlength="64" autocomplete="current-password" placeholder="密码"></label>
    <button class="aprimary" id="go" type="submit">登 录</button>
    <p class="aerr" id="err-login" style="display:none"></p>
  </form>
  <form class="afcol" id="fe" hidden>
    <label class="afield"><span class="aico">${ICO.mail}</span>
      <input id="le-email" type="email" maxlength="100" autocomplete="email" placeholder="邮箱"></label>
    <div class="acode">
      <label class="afield"><span class="aico">${ICO.lock}</span>
        <input id="le-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"></label>
      <button class="abtn" id="le-send" type="button">发送验证码</button>
    </div>
    <button class="aprimary" id="goe" type="submit">登 录</button>
    <p class="aerr" id="err-login-e" style="display:none"></p>
  </form>
  <div class="im-rec" id="rec-box" hidden>
    <p class="im-rec-tip">首次在本设备用验证码登录：输入登录密码，解密你的端到端加密密钥（方案 docs/IM聊天方案.md §3.1）。</p>
    <label class="afield"><span class="aico">${ICO.lock}</span><input id="rec-pass" type="password" maxlength="64" placeholder="登录密码"></label>
    <button class="aprimary" type="button" id="rec-go">恢复密钥并进入</button>
    <p class="aerr" id="err-rec" style="display:none"></p>
  </div>
  <p class="aentry">没有账号？<a class="alink" href="/register">注册焰境密语</a></p>
  <p class="ahint" style="text-align:center">验证码由 notifications@whizzzest.com 发送。</p>`;
}

export function registerPanelHtml() {
  // 与 writer 注册页同构：账密/邮箱注册顶部双 Tab + 「已有账号？」入口；IM 增加昵称与端到端加密警示
  return `${IM_PANEL_CSS}
  <div class="auth-tabs" role="tablist">
    <button type="button" class="atab active" id="rt-phone">账密注册</button>
    <button type="button" class="atab" id="rt-email">邮箱注册</button>
  </div>
  <form class="afcol" id="fp">
    <label class="afield"><span class="aico">${ICO.key}</span><input id="rg-name" maxlength="20" placeholder="昵称（可留空，默认焰友+编号）"></label>
    <label class="afield"><span class="aico">${ICO.phone}</span>
      <span class="acc-wrap">
        <span class="acc-label" id="rg-cc-label">+86</span>
        <select id="rg-cc" class="acc" aria-label="国家地区">${phoneCountryOptionsHtml()}</select>
      </span>
      <span class="adiv"></span>
      <input id="rg-phone" maxlength="15" inputmode="tel" autocomplete="username" placeholder="手机号"></label>
    <label class="afield"><span class="aico">${ICO.lock}</span>
      <input id="rg-pass" type="password" minlength="8" maxlength="64" autocomplete="new-password" placeholder="设置密码（至少 8 位）"></label>
    <p class="ahint">手机号仅作登录账号使用，不发送短信。</p>
    ${IM_NOTE_HTML}
    <input type="text" name="website" value="" hidden aria-hidden="true" tabindex="-1" autocomplete="off">
    <button class="aprimary" id="go" type="submit">注册并生成密钥</button>
    <p class="aerr" id="err-reg" style="display:none"></p>
  </form>
  <form class="afcol" id="fe2" hidden>
    <label class="afield"><span class="aico">${ICO.key}</span><input id="re-name" maxlength="20" placeholder="昵称（可留空，默认焰友+编号）"></label>
    <label class="afield"><span class="aico">${ICO.mail}</span>
      <input id="re-email" type="email" maxlength="100" autocomplete="email" placeholder="邮箱"></label>
    <div class="acode">
      <label class="afield"><span class="aico">${ICO.lock}</span>
        <input id="re-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"></label>
      <button class="abtn" id="re-send" type="button">发送验证码</button>
    </div>
    <label class="afield"><span class="aico">${ICO.lock}</span>
      <input id="re-pass" type="password" minlength="8" maxlength="64" autocomplete="new-password" placeholder="设置密码（至少 8 位）"></label>
    ${IM_NOTE_HTML}
    <input type="text" name="website" value="" hidden aria-hidden="true" tabindex="-1" autocomplete="off">
    <button class="aprimary" id="goe" type="submit">注册并生成密钥</button>
    <p class="aerr" id="err-reg-e" style="display:none"></p>
  </form>
  <p class="aentry">已有账号？<a class="alink" href="/">直接登录</a></p>`;
}

export const LOGIN_PAGE_JS = `
(function () {
  var ERR = { phone: '手机号格式不正确', email: '邮箱格式不正确', bad: '账号或验证码不正确', expired: '验证码已过期，请重新发送', rate: '操作太频繁，稍后再试', too_fast: '发送太频繁，60 秒后再试', send_failed: '验证码发送失败，请稍后再试', disabled: '账号已被停用', format: '输入格式不正确', keys: '密钥恢复失败，请重试', rec_bad: '密码不正确，无法解密密钥备份', ok_sent: '✅ 若该邮箱已绑定账号，验证码已发送（10 分钟内有效）' };
  function $(id) { return document.getElementById(id); }
  function showErr(id, code) { var el = $(id); el.textContent = ERR[code] || ('出错了（' + code + '）'); el.style.display = 'block'; }
  function clearErr(id) { var el = $(id); el.textContent = ''; el.style.display = 'none'; }
  // 双方式 Tab（shared loginPanel 同款切换）
  var MODES = ['f', 'fe'], TABS = ['mt-phone', 'mt-email'];
  function switchMode(i) {
    MODES.forEach(function (id, j) { $(id).hidden = j !== i; });
    TABS.forEach(function (id, j) { $(id).classList.toggle('active', j === i); });
  }
  TABS.forEach(function (id, i) { $(id).addEventListener('click', function () { switchMode(i); }); });
  // 区号选择器（shared loginPanel 同款）：闭合态区号短标签 + localStorage 记忆；option value 为 ISO 码，
  // 直传 normalizePhone（旧版传 '86' 非法 ISO，海外号码被误回退 CN）
  var cc = $('lp-cc'), ccLabel = $('lp-cc-label');
  function ccSync() { ccLabel.textContent = cc.options[cc.selectedIndex].getAttribute('data-dial'); }
  try { var savedCc = localStorage.getItem('wxz_phone_country'); if (savedCc) cc.value = savedCc; } catch (e) {}
  ccSync();
  cc.addEventListener('change', function () {
    ccSync();
    try { localStorage.setItem('wxz_phone_country', cc.value); } catch (e) {}
  });
  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  }
  // 验证码发送（60s 冷却仅成功后启动；报错写回验证码登录面板）
  $('le-send').addEventListener('click', function () {
    var btn = $('le-send');
    if (btn.disabled) return;
    var email = $('le-email').value.trim();
    if (!email) { showErr('err-login-e', 'format'); return; }
    btn.disabled = true; btn.textContent = '发送中…';
    post('/api/email-code', { email: email, purpose: 'login' }).then(function (r) {
      if (!r.j.ok) { showErr('err-login-e', r.j.error); btn.disabled = false; btn.textContent = '发送验证码'; return; }
      showErr('err-login-e', 'ok_sent');
      var left = 60;
      btn.textContent = left + 's 后重发';
      var t = setInterval(function () {
        left--;
        if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '发送验证码'; return; }
        btn.textContent = left + 's 后重发';
      }, 1000);
    }).catch(function () { btn.disabled = false; btn.textContent = '发送验证码'; });
  });
  // ---- E2EE 密钥（/assets/js/im-crypto.js 动态加载） ----
  var imc = null;
  function cryptoMod() { if (!imc) imc = import('/assets/js/im-crypto.js'); return imc; }
  function localIdentity() { return cryptoMod().then(function (m) { return m.loadIdentity(); }); }
  function saveIdentity(id) { return cryptoMod().then(function (m) { return m.saveIdentity(id); }); }
  function recoverWith(keys, password, uid) {
    return cryptoMod().then(function (m) {
      return m.unwrapPrivateKey(keys.enc_priv_key, password, keys.kdf_salt, keys.kdf_iters).then(function (jwk) {
        return { pub_key: keys.pub_key, privateKeyJwk: jwk, kdfSalt: keys.kdf_salt, kdfIters: keys.kdf_iters, uid: uid };
      });
    });
  }
  function finishRecover(keys, password, uid) {
    return recoverWith(keys, password, uid).then(function (id) {
      return saveIdentity(id).then(function () { location.href = '/app'; });
    }).catch(function () {
      showErr('err-rec', 'rec_bad');
    });
  }
  // 登录成功：本机已有同账号密钥 → 直接进；否则用密码解包备份
  // （手机号路径有刚输的密码自动恢复；验证码路径展示 rec-box 再输一次。keys 恒存 dataset 供 rec-go 重试）
  function afterAuthed(d, password) {
    var box = $('rec-box');
    box.dataset.keys = JSON.stringify(d.keys || {});
    box.dataset.uid = d.uid;
    localIdentity().then(function (local) {
      if (local && local.uid === d.uid) { location.href = '/app'; return; }
      if (password) { finishRecover(d.keys, password, d.uid); return; }
      box.hidden = false;
    }).catch(function () { location.href = '/app'; });
  }
  // 账密登录
  $('f').addEventListener('submit', function (e) {
    e.preventDefault();
    clearErr('err-login');
    var btn = $('go');
    btn.disabled = true;
    post('/api/login/phone', { phone: $('lp-phone').value.trim(), country: $('lp-cc').value, password: $('lp-pass').value })
      .then(function (r) {
        if (!r.j.ok) { btn.disabled = false; showErr('err-login', r.j.error); return; }
        afterAuthed(r.j, $('lp-pass').value);
      })
      .catch(function () { btn.disabled = false; showErr('err-login', 'format'); });
  });
  // 验证码登录
  $('fe').addEventListener('submit', function (e) {
    e.preventDefault();
    clearErr('err-login-e');
    var btn = $('goe');
    btn.disabled = true;
    post('/api/login/email', { email: $('le-email').value.trim(), code: $('le-code').value.trim() })
      .then(function (r) {
        if (!r.j.ok) { btn.disabled = false; showErr('err-login-e', r.j.error); return; }
        afterAuthed(r.j, '');
      })
      .catch(function () { btn.disabled = false; showErr('err-login-e', 'format'); });
  });
  $('rec-go').addEventListener('click', function () {
    var keys = null, uid = 0;
    try { keys = JSON.parse($('rec-box').dataset.keys || 'null'); uid = Number($('rec-box').dataset.uid || 0); } catch (e) {}
    if (!keys || !uid) { location.href = '/app'; return; }
    finishRecover(keys, $('rec-pass').value, uid);
  });
})();
`;

export const REGISTER_PAGE_JS = `
(function () {
  var ERR = { phone: '手机号格式不正确', email: '邮箱格式不正确', password: '密码至少 8 位', keys: '密钥生成失败，请换现代浏览器重试', dup: '该手机号已注册，请直接登录', taken: '该邮箱已注册，请直接登录', bad: '验证码错误', expired: '验证码已过期，请重新发送', rate: '操作太频繁，稍后再试', too_fast: '发送太频繁，60 秒后再试', send_failed: '验证码发送失败，请稍后再试', format: '输入格式不正确', ok_sent: '✅ 验证码已发送，请查收邮箱（10 分钟内有效）' };
  function $(id) { return document.getElementById(id); }
  function showErr(id, code) { var el = $(id); el.textContent = ERR[code] || ('出错了（' + code + '）'); el.style.display = 'block'; }
  function clearErr(id) { var el = $(id); el.textContent = ''; el.style.display = 'none'; }
  var MODES = ['fp', 'fe2'], TABS = ['rt-phone', 'rt-email'];
  function switchMode(i) {
    MODES.forEach(function (id, j) { $(id).hidden = j !== i; });
    TABS.forEach(function (id, j) { $(id).classList.toggle('active', j === i); });
  }
  TABS.forEach(function (id, i) { $(id).addEventListener('click', function () { switchMode(i); }); });
  var cc = $('rg-cc'), ccLabel = $('rg-cc-label');
  function ccSync() { ccLabel.textContent = cc.options[cc.selectedIndex].getAttribute('data-dial'); }
  try { var savedCc = localStorage.getItem('wxz_phone_country'); if (savedCc) cc.value = savedCc; } catch (e) {}
  ccSync();
  cc.addEventListener('change', function () {
    ccSync();
    try { localStorage.setItem('wxz_phone_country', cc.value); } catch (e) {}
  });
  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  }
  $('re-send').addEventListener('click', function () {
    var btn = $('re-send');
    if (btn.disabled) return;
    var email = $('re-email').value.trim();
    if (!email) { showErr('err-reg-e', 'format'); return; }
    btn.disabled = true; btn.textContent = '发送中…';
    post('/api/email-code', { email: email, purpose: 'register' }).then(function (r) {
      if (!r.j.ok) { showErr('err-reg-e', r.j.error); btn.disabled = false; btn.textContent = '发送验证码'; return; }
      showErr('err-reg-e', 'ok_sent');
      var left = 60;
      btn.textContent = left + 's 后重发';
      var t = setInterval(function () {
        left--;
        if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '发送验证码'; return; }
        btn.textContent = left + 's 后重发';
      }, 1000);
    }).catch(function () { btn.disabled = false; btn.textContent = '发送验证码'; });
  });
  // 注册提交：本机生成密钥 → 密码包裹 → 上传 → 本机留存（E2EE，方案 §3.1）
  var imc = null;
  function cryptoMod() { if (!imc) imc = import('/assets/js/im-crypto.js'); return imc; }
  function saveIdentity(id) { return cryptoMod().then(function (m) { return m.saveIdentity(id); }); }
  function genAndWrap(password) {
    return cryptoMod().then(function (m) {
      return m.generateIdentity().then(function (id) {
        return m.wrapPrivateKey(id.privateKeyJwk, password, id.kdfSalt, id.kdfIters).then(function (enc) {
          return { pub_key: id.publicKeyB64, enc_priv_key: enc, kdf_salt: id.kdfSalt, kdf_iters: id.kdfIters, identity: id };
        });
      });
    });
  }
  function submitRegister(usePhone) {
    var errId = usePhone ? 'err-reg' : 'err-reg-e';
    var password = $(usePhone ? 'rg-pass' : 're-pass').value;
    if (password.length < 8) { showErr(errId, 'password'); return; }
    var btn = $(usePhone ? 'go' : 'goe');
    btn.disabled = true; btn.textContent = '正在生成端到端加密密钥…';
    genAndWrap(password).then(function (kg) {
      var base = { display_name: $(usePhone ? 'rg-name' : 're-name').value.trim(), password: password, website: '',
        pub_key: kg.pub_key, enc_priv_key: kg.enc_priv_key, kdf_salt: kg.kdf_salt, kdf_iters: kg.kdf_iters };
      var p = usePhone
        ? post('/api/register/phone', Object.assign({ phone: $('rg-phone').value.trim(), country: $('rg-cc').value }, base))
        : post('/api/register/email', Object.assign({ email: $('re-email').value.trim(), code: $('re-code').value.trim() }, base));
      return p.then(function (r) {
        if (!r.j.ok) {
          btn.disabled = false; btn.textContent = '注册并生成密钥';
          showErr(errId, r.j.error);
          return null;
        }
        kg.identity.uid = r.j.uid;
        return saveIdentity(kg.identity).then(function () { location.href = '/app'; });
      });
    }).catch(function () {
      btn.disabled = false; btn.textContent = '注册并生成密钥';
      showErr(errId, 'keys');
    });
  }
  $('fp').addEventListener('submit', function (e) { e.preventDefault(); clearErr('err-reg'); submitRegister(true); });
  $('fe2').addEventListener('submit', function (e) { e.preventDefault(); clearErr('err-reg-e'); submitRegister(false); });
})();
`;

/** /app 壳（UI v2 三栏：icon 栏 + 会话列表面板 + 聊天主区）；会话已由服务端校验；bootstrap 数据由 /api/me 拉取 */
export function appShellHtml() {
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="${LOGO_URI}">
<title>焰境密语 — 加密聊天</title>
<link rel="stylesheet" href="/assets/css/im.css">
</head>
<body class="im-app">
<div class="im-shell">
  <nav class="im-rail" id="im-rail">
    <div class="im-rail-top">
      <button class="im-rail-btn" id="rail-chats" title="聊天"></button>
      <button class="im-rail-btn" id="rail-contacts" title="联系人"></button>
      <button class="im-rail-btn" id="rail-settings" title="设置"></button>
    </div>
    <div class="im-rail-bottom">
      <button class="im-rail-btn" id="rail-me" title="我的资料"></button>
      <button class="im-rail-btn" id="rail-logout" title="退出登录"></button>
    </div>
  </nav>
  <aside class="im-side" id="im-side"></aside>
  <main class="im-main" id="im-main"></main>
</div>
<script type="module" src="/assets/js/app.js"></script>
</body>
</html>`;
}
