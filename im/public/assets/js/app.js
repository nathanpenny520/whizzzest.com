/**
 * 焰境密语 — /app SPA（M1 骨架：资料面板 + E2EE 状态 + 退出）
 * 会话列表/聊天窗随 M2 上线（docs/IM聊天方案.md §5/§9）；本文件只做骨架与账号管理。
 */

const $ = (sel) => document.querySelector(sel);
const AVATAR_HUES = [14, 32, 88, 150, 200, 250, 290, 330]; // avatar_color 0-7 → 焰色系色相

let me = null;

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}));
  const j = await res.json().catch(() => ({ ok: false, error: 'bad_json' }));
  if (res.status === 401) { location.href = '/'; throw new Error('auth'); }
  return { status: res.status, j };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarHtml(name, color, size) {
  const hue = AVATAR_HUES[color % 8] ?? 14;
  const ch = esc((name || '焰').trim().charAt(0) || '焰');
  return `<span class="im-avatar" style="width:${size}px;height:${size}px;background:hsl(${hue} 62% 46%);font-size:${Math.round(size * 0.42)}px">${ch}</span>`;
}

/** 公钥指纹（SHA-256 前 8 字节，4×4 数字组）——M4 换安全数字核验，现在仅作展示 */
async function fingerprint(pubKeyB64) {
  const bin = atob(pubKeyB64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', u);
  const hex = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.replace(/(..)(..)(..)(..)/, '$1 $2 $3 $4').toUpperCase();
}

async function render() {
  const r = await api('/api/me');
  if (!r.j.ok) { location.href = '/'; return; }
  me = r.j;

  const localId = await import('/assets/js/im-crypto.js').then((m) => m.loadIdentity()).catch(() => null);
  const fp = await fingerprint(me.pub_key);
  const keyState = localId && localId.uid === me.uid
    ? '<span class="im-badge ok">端到端加密已就绪（本机密钥已解锁）</span>'
    : '<span class="im-badge warn">本机未解锁密钥：重新登录并输入密码以恢复（历史消息暂不可读）</span>';

  $('#im-side').innerHTML = `
    <div class="im-side-head">
      ${avatarHtml(me.display_name, me.avatar_color, 40)}
      <div class="im-side-who">
        <b>${esc(me.display_name)}</b>
        <span>${esc(me.login_phone || me.login_email || '')}</span>
      </div>
    </div>
    <div class="im-conv-list">
      <div class="im-empty">会话列表随 M2 上线<br><small>好友 · 私聊 · 群聊（docs/IM聊天方案.md §9）</small></div>
    </div>
    <button class="im-ghost" id="btn-logout">退出登录</button>`;

  $('#im-main').innerHTML = `
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
  const colorBox = $('#pf-colors');
  AVATAR_HUES.forEach((hue, i) => {
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

  $('#pf-save').addEventListener('click', async () => {
    const msg = $('#pf-msg');
    const r2 = await api('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: $('#pf-name').value,
        bio: $('#pf-bio').value,
        avatar_color: Number(colorBox.dataset.val || 0),
      }),
    });
    msg.textContent = r2.j.ok ? '已保存' : ({ display_name: '昵称 1-20 字', bio: '简介最长 100 字', avatar_color: '头像色无效' }[r2.j.error] || '保存失败');
    msg.className = 'im-msg ' + (r2.j.ok ? 'ok' : 'err');
    if (r2.j.ok) render();
  });

  $('#btn-logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    await import('/assets/js/im-crypto.js').then((m) => m.clearIdentity()).catch(() => {});
    location.href = '/';
  });
}

render().catch((e) => console.error('im app boot:', e));
