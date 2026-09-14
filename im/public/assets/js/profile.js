/**
 * 焰境密语 — 主区「个人资料 / 设置」双视图（UI v2 业主反馈 10 拆分）
 *   renderProfile  头像入口：资料编辑（昵称/简介/头像色）+ 账号（手机号/邮箱绑定，验证码流）
 *   renderSettings ⚙ 入口：加密身份 + 关于 + 退出登录
 * 邮箱绑定（v2.1）：POST /api/email-code {purpose:'bind'} → POST /api/me/email {email, code}。
 */

import { POST, PATCH } from './api.js';
import { esc, avatarHtml } from './ui.js';
import { icon } from './icons.js';

/* ---------------- 个人资料（头像入口） ---------------- */

export async function renderProfile(root, ctx) {
  const me = ctx.me;
  root.innerHTML = `
    <div class="im-settings">
      <div class="im-set-box">
        <h2>个人资料</h2>
        <section class="im-set-card im-set-me">
          ${avatarHtml(me.display_name, me.avatar_color, 72).replace('<span class="im-avatar"', '<span class="im-avatar" id="pf-avatar"')}
          <div class="im-set-me-fields">
            <label class="im-f"><span>昵称</span><input id="pf-name" maxlength="20" value="${esc(me.display_name)}"></label>
            <label class="im-f"><span>简介</span><input id="pf-bio" maxlength="100" value="${esc(me.bio || '')}" placeholder="一句话介绍（可选）"></label>
            <div class="im-f"><span>头像色</span><div class="im-swatches" id="pf-colors"></div></div>
            <button class="im-primary" id="pf-save">保存</button>
            <p class="im-msg" id="pf-msg"></p>
          </div>
        </section>
        <section class="im-set-card">
          <h3>账号</h3>
          <dl class="im-kv">
            <dt>手机号</dt><dd>${esc(me.login_phone || '未绑定')}</dd>
            <dt>邮箱</dt><dd>${esc(me.login_email || '未绑定')}</dd>
          </dl>
          <div id="pf-email-box"></div>
        </section>
      </div>
    </div>`;

  // 头像色选择
  const colorBox = root.querySelector('#pf-colors');
  ctx.ui.AVATAR_HUES.forEach((hue, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'im-swatch' + (i === me.avatar_color ? ' on' : '');
    b.style.background = `hsl(${hue} 62% 46%)`;
    b.addEventListener('click', () => {
      colorBox.querySelectorAll('.im-swatch').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      colorBox.dataset.val = i;
    });
    colorBox.appendChild(b);
  });
  colorBox.dataset.val = me.avatar_color;

  root.querySelector('#pf-save').addEventListener('click', async () => {
    const msg = root.querySelector('#pf-msg');
    // api.js 的 PATCH 直接返回响应体（非 {status, j} 包装）——原 r2.j.ok 二次解包恒 undefined，
    // 保存虽入库但 UI 抛 TypeError 致「要刷新才显示」（M1 遗留，v2 顺修）
    const r2 = await PATCH('/api/me', {
      display_name: root.querySelector('#pf-name').value,
      bio: root.querySelector('#pf-bio').value,
      avatar_color: Number(colorBox.dataset.val || 0),
    });
    msg.textContent = r2.ok
      ? '已保存'
      : ({ display_name: '昵称需 1-20 字', bio: '简介最长 100 字', avatar_color: '头像色无效' }[r2.error] || '保存失败');
    msg.className = 'im-msg ' + (r2.ok ? 'ok' : 'err');
    if (r2.ok) {
      await ctx.reloadMe();
      ctx.renderSide(); // rail 头像/会话行同步新资料
      // 大头像就地刷新（业主反馈：保存头像色不该要刷新才变）
      const av = root.querySelector('#pf-avatar');
      if (av) av.outerHTML = avatarHtml(root.querySelector('#pf-name').value.trim(), Number(colorBox.dataset.val || 0), 72)
        .replace('<span class="im-avatar"', '<span class="im-avatar" id="pf-avatar"');
    }
  });

  renderEmailBox(root.querySelector('#pf-email-box'), ctx);
}

/** 邮箱绑定/换绑（验证码两步） */
function renderEmailBox(box, ctx) {
  const me = ctx.me;
  box.innerHTML = `
    <button class="im-minibtn" id="em-open" style="margin-top:10px">${me.login_email ? '换绑邮箱' : '绑定邮箱'}</button>
    <div id="em-form" hidden style="margin-top:12px">
      <label class="im-f"><span>新邮箱</span><input id="em-email" maxlength="100" placeholder="you@example.com" autocomplete="off"></label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="em-code" maxlength="6" placeholder="6 位验证码" style="flex:1;min-width:0" class="em-code-input">
        <button class="im-minibtn" id="em-send">发送验证码</button>
      </div>
      <button class="im-primary" id="em-go" style="margin-top:10px">确认绑定</button>
      <p class="im-msg" id="em-msg"></p>
    </div>`;

  box.querySelector('#em-open').addEventListener('click', () => {
    box.querySelector('#em-form').hidden = !box.querySelector('#em-form').hidden;
  });

  const msg = () => box.querySelector('#em-msg');
  const show = (text, ok) => { msg().textContent = text; msg().className = 'im-msg ' + (ok ? 'ok' : 'err'); };
  const emailInput = () => box.querySelector('#em-email');

  box.querySelector('#em-send').addEventListener('click', async () => {
    const email = emailInput().value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return show('请输入正确的邮箱地址', false);
    const btn = box.querySelector('#em-send');
    btn.disabled = true;
    const r = await POST('/api/email-code', { purpose: 'bind', email });
    if (r.ok) {
      show('验证码已发送到 ' + email + '（10 分钟内有效），请查收', true);
      let left = 60;
      const label = () => { btn.textContent = `${left}s 后可重发`; };
      label();
      const t = setInterval(() => {
        if (--left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = '发送验证码'; }
        else label();
      }, 1000);
    } else {
      btn.disabled = false;
      show({ taken: '该邮箱已被其他账号绑定', rate: '发送太频繁，请稍后再试', too_fast: '发送太频繁，请 1 分钟后再试', auth: '登录状态已失效，请刷新' }[r.error] || '发送失败（' + r.error + '）', false);
    }
  });

  box.querySelector('#em-go').addEventListener('click', async () => {
    const email = emailInput().value.trim().toLowerCase();
    const code = box.querySelector('#em-code').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return show('请输入正确的邮箱地址', false);
    if (!/^\d{6}$/.test(code)) return show('请输入 6 位验证码', false);
    const r = await POST('/api/me/email', { email, code });
    if (r.ok) {
      await ctx.reloadMe();
      // 账号卡「邮箱」行就地刷新（业主反馈：绑定成功不该要刷新才显示）
      const ddEmail = box.parentElement.querySelectorAll('.im-kv dd')[1];
      if (ddEmail) ddEmail.textContent = ctx.me.login_email || '已绑定';
      renderEmailBox(box, ctx); // 重挂为「换绑邮箱」并收起表单
      const fresh = box.querySelector('#em-msg');
      if (fresh) { fresh.textContent = '邮箱绑定成功'; fresh.className = 'im-msg ok'; }
    } else {
      show({ bad: '验证码不正确', expired: '验证码已过期，请重新发送', taken: '该邮箱已被其他账号绑定', code: '请输入 6 位验证码', email: '邮箱格式不正确' }[r.error] || '绑定失败（' + r.error + '）', false);
    }
  });
}

/* ---------------- 设置（⚙ 入口） ---------------- */

export async function renderSettings(root, ctx) {
  const me = ctx.me;
  const localId = ctx.identity;
  const keyState = localId && localId.uid === me.uid
    ? '<span class="im-badge ok">本机密钥已解锁，消息可正常收发</span>'
    : '<span class="im-badge warn">本机未解锁密钥：退出后重新登录并输入密码以恢复（消息暂不可读/不可发）</span>';

  root.innerHTML = `
    <div class="im-settings">
      <div class="im-set-box">
        <h2>设置</h2>
        <section class="im-set-card">
          <h3>加密</h3>
          <dl class="im-kv">
            <dt>方式</dt><dd>端到端加密</dd>
            <dt>密码备份</dt><dd>${me.has_backup ? '已开启（换设备可用密码恢复）' : '未开启'}</dd>
          </dl>
          <p class="im-msg" style="margin-top:12px">${keyState}</p>
        </section>
        <section class="im-set-card">
          <h3>关于</h3>
          <dl class="im-kv">
            <dt>注册时间</dt><dd>${esc(String(me.created_at || '').replace('T', ' ').slice(0, 16))} UTC</dd>
          </dl>
        </section>
        <button class="im-ghostbtn" id="pf-logout">${icon('logout', 16)} 退出登录</button>
      </div>
    </div>`;

  root.querySelector('#pf-logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    const cm = await import('/assets/js/im-crypto.js');
    await cm.clearIdentity().catch(() => {});
    location.href = '/';
  });
}
