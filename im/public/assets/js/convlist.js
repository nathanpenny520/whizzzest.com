/**
 * 焰境密语 — 列表面板（UI v2）：聊天态（会话列表）| 联系人态（委托 contacts.js）。
 * 行内明文预览由 app 层解密后传入；搜索/筛选均为本地过滤。
 */

import { esc, avatarHtml, fmtListTime } from './ui.js';
import { icon } from './icons.js';
import { renderContactsPanel } from './contacts.js';

/** side 容器入口：按侧栏两态分派 */
export function renderSide(sideEl, ctx) {
  if (ctx.panel === 'contacts') return renderContactsPanel(sideEl, ctx);
  renderChatsPanel(sideEl, ctx);
}

/* ---------------- 聊天态：会话列表 ---------------- */

function renderChatsPanel(sideEl, ctx) {
  sideEl.innerHTML = `
    <div class="im-p-head">
      <h1>焰境密语</h1>
      <div class="im-p-acts">
        <button class="im-ibtn" id="p-newchat" title="发起新聊天">${icon('newchat', 19)}</button>
        <button class="im-ibtn" id="p-menu-btn" data-menu-btn title="菜单">${icon('dots', 19)}</button>
      </div>
      <div class="im-menu" id="p-menu" hidden></div>
    </div>
    <div class="im-search">${icon('search', 17)}<input id="p-search" placeholder="搜索或开始新聊天" value="${esc(ctx.searchQ)}"></div>
    <div class="im-chips">
      <button class="im-chip${ctx.filter === 'all' ? ' on' : ''}" data-f="all">全部</button>
      <button class="im-chip${ctx.filter === 'unread' ? ' on' : ''}" data-f="unread">未读</button>
      <button class="im-chip${ctx.filter === 'groups' ? ' on' : ''}" data-f="groups">群组</button>
    </div>
    ${ctx.pendingIn > 0 ? `
      <button class="im-banner" id="p-banner">
        ${icon('userplus', 18)}
        <span>${ctx.pendingIn} 条好友申请待处理</span>
        <b>查看</b>
      </button>` : ''}
    <div class="im-rows" id="p-rows"></div>`;

  const rowsEl = sideEl.querySelector('#p-rows');
  const renderRows = () => {
    const q = ctx.searchQ.trim().toLowerCase();
    const list = ctx.convs.filter((c) => {
      if (ctx.filter === 'unread' && !(c.unread > 0)) return false;
      if (ctx.filter === 'groups' && c.type !== 'group') return false;
      if (q) {
        const name = c.type === 'dm' && c.peer ? c.peer.display_name : (c.name || '群聊');
        if (!name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    if (!list.length) {
      rowsEl.innerHTML = `<div class="im-empty">${ctx.searchQ || ctx.filter !== 'all' ? '没有匹配的会话' : '还没有会话<br><small>点右上 ✎ 或到「联系人」找人开聊</small>'}</div>`;
      return;
    }
    rowsEl.innerHTML = list.map((c) => {
      const isDm = c.type === 'dm' && c.peer;
      const name = isDm ? c.peer.display_name : (c.name || '群聊');
      const color = isDm ? c.peer.avatar_color : (c.id % 8);
      const active = c.id === ctx.activeConvId ? ' on' : '';
      const unread = c.unread > 0;
      const badge = unread ? `<span class="im-unread">${c.unread > 99 ? '99+' : c.unread}</span>` : '';
      return `
        <div class="im-row${active}${unread ? ' unread' : ''}" data-id="${c.id}">
          ${avatarHtml(name, color, 49)}
          <div class="im-row-t">
            <div class="im-row-top"><b>${esc(name)}</b><span>${c.last_msg ? fmtListTime(c.last_msg.created_at) : ''}</span></div>
            <div class="im-row-prev">${esc(ctx.previewFor(c))}</div>
          </div>
          ${badge}
        </div>`;
    }).join('');
    rowsEl.querySelectorAll('.im-row').forEach((el) => {
      el.addEventListener('click', () => ctx.openConv(Number(el.dataset.id)));
    });
  };
  renderRows();

  sideEl.querySelector('#p-search').addEventListener('input', (e) => {
    ctx.searchQ = e.target.value;
    renderRows(); // 只重绘行，保输入框焦点
  });
  sideEl.querySelectorAll('.im-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      ctx.filter = chip.dataset.f;
      sideEl.querySelectorAll('.im-chip').forEach((x) => x.classList.toggle('on', x === chip));
      renderRows();
    });
  });
  sideEl.querySelector('#p-newchat').addEventListener('click', () => ctx.setPanel('contacts'));
  sideEl.querySelector('#p-banner')?.addEventListener('click', () => ctx.openContactsTab('requests'));

  const menuBtn = sideEl.querySelector('#p-menu-btn');
  const menu = sideEl.querySelector('#p-menu');
  menu.innerHTML = `
    <button data-act="settings">${icon('gear', 16)} 设置</button>
    <button data-act="logout" class="warn">${icon('logout', 16)} 退出登录</button>`;
  menu.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      menu.hidden = true;
      if (b.dataset.act === 'settings') ctx.openSettings();
      if (b.dataset.act === 'logout') logout(ctx);
    });
  });
  menuBtn.addEventListener('click', () => { menu.hidden = !menu.hidden; });
}

async function logout(ctx) {
  await fetch('/api/logout', { method: 'POST' });
  const cm = await import('/assets/js/im-crypto.js');
  await cm.clearIdentity().catch(() => {});
  location.href = '/';
}
