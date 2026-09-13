/** 焰境密语 — 主区「资料/设置」视图（M1 欢迎卡片迁入；账号 + 加密身份 + 编辑资料） */

import { POST, PATCH } from './api.js';
import { esc, avatarHtml, fingerprint } from './ui.js';

export async function renderProfile(root, ctx) {
  const me = ctx.me;
  const localId = ctx.identity;
  const fp = await fingerprint(me.pub_key);
  const keyState = localId && localId.uid === me.uid
    ? '<span class="im-badge ok">端到端加密已就绪（本机密钥已解锁）</span>'
    : '<span class="im-badge warn">本机未解锁密钥：退出后重新登录并输入密码以恢复（消息暂不可读/不可发）</span>';

  root.innerHTML = `
    <div class="im-welcome">
      <h1>焰境密语</h1>
      <p class="im-sub">端到端加密的站内聊天 · 服务器只递信，不看信</p>
      ${keyState}
      <div class="im-cards">
        <section class="im-card">
          <h2>我的账号</h2>
          <dl class="im-kv">
            <dt>UID</dt><dd>${me.uid}</dd>
            <dt>手机号</dt><dd>${esc(me.login_phone || '未绑定')}</dd>
            <dt>邮箱</dt><dd>${esc(me.login_email || '未绑定')}</dd>
            <dt>注册时间</dt><dd>${esc(String(me.created_at || '').replace('T', ' ').slice(0, 16))} UTC</dd>
          </dl>
        </section>
        <section class="im-card">
          <h2>加密身份</h2>
          <dl class="im-kv">
            <dt>算法</dt><dd>ECDH P-256 + AES-256-GCM</dd>
            <dt>公钥指纹</dt><dd><code>${fp}</code></dd>
            <dt>密码备份</dt><dd>${me.has_backup ? '已开启（换设备可恢复）' : '未开启'}</dd>
          </dl>
        </section>
        <section class="im-card">
          <h2>编辑资料</h2>
          <label class="im-f"><span>昵称</span><input id="pf-name" maxlength="20" value="${esc(me.display_name)}"></label>
          <label class="im-f"><span>简介</span><input id="pf-bio" maxlength="100" value="${esc(me.bio || '')}" placeholder="一句话介绍（可选）"></label>
          <div class="im-f"><span>头像色</span><div class="im-swatches" id="pf-colors"></div></div>
          <button class="im-primary" id="pf-save">保存</button>
          <p class="im-msg" id="pf-msg"></p>
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
    const r2 = await PATCH('/api/me', {
      display_name: root.querySelector('#pf-name').value,
      bio: root.querySelector('#pf-bio').value,
      avatar_color: Number(colorBox.dataset.val || 0),
    });
    msg.textContent = r2.j.ok
      ? '已保存'
      : ({ display_name: '昵称 1-20 字', bio: '简介最长 100 字', avatar_color: '头像色无效' }[r2.j.error] || '保存失败');
    msg.className = 'im-msg ' + (r2.j.ok ? 'ok' : 'err');
    if (r2.j.ok) {
      await ctx.reloadMe();
      ctx.renderSide();
    }
  });
}
