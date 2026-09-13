/** 焰境密语 — 左侧栏（会话列表 + 好友入口 + 退出）；行内明文预览由 app 层解密后传入 */

import { esc, avatarHtml, fmtListTime } from './ui.js';

/** side 容器整体重绘：head（我的头像/昵称）+ 会话列表 + 底部按钮 */
export function renderSide(sideEl, ctx) {
  const me = ctx.me;
  const rows = ctx.convs.map((c) => {
    const name = c.type === 'dm' && c.peer ? c.peer.display_name : (c.name || '会话');
    const color = c.type === 'dm' && c.peer ? c.peer.avatar_color : 0;
    const active = c.id === ctx.activeConvId ? ' on' : '';
    const badge = c.unread > 0 ? `<span class="im-unread">${c.unread > 99 ? '99+' : c.unread}</span>` : '';
    return `
      <div class="im-conv${active}" data-id="${c.id}">
        ${avatarHtml(name, color, 42)}
        <div class="im-conv-txt">
          <div class="im-conv-top"><b>${esc(name)}</b><span>${c.last_msg ? fmtListTime(c.last_msg.created_at) : ''}</span></div>
          <div class="im-conv-prev">${esc(ctx.previewFor(c))}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');

  sideEl.innerHTML = `
    <div class="im-side-head">
      ${avatarHtml(me.display_name, me.avatar_color, 40)}
      <div class="im-side-who">
        <b>${esc(me.display_name)}</b>
        <span>${esc(me.login_phone || me.login_email || '')}</span>
      </div>
    </div>
    <button class="im-friends-btn" id="btn-contacts">${ctx.contactsOpen ? '返回会话' : '好友 · 添加'}${ctx.pendingIn > 0 ? `<span class="im-unread">${ctx.pendingIn}</span>` : ''}</button>
    <div class="im-conv-list">${rows || '<div class="im-empty">还没有会话<br><small>到「好友 · 添加」里找人开聊</small></div>'}</div>
    <button class="im-ghost" id="btn-logout">退出登录</button>`;

  sideEl.querySelector('#btn-contacts').addEventListener('click', () => ctx.toggleContacts());
  sideEl.querySelector('#btn-logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    const cm = await import('/assets/js/im-crypto.js');
    await cm.clearIdentity().catch(() => {});
    location.href = '/';
  });
  sideEl.querySelectorAll('.im-conv').forEach((el) => {
    el.addEventListener('click', () => ctx.openConv(Number(el.dataset.id)));
  });
}
