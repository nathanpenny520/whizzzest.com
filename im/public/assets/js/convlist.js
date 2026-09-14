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
  sideEl.classList.toggle('im-selmode', !!ctx.selMode);
  sideEl.innerHTML = `
    <div class="im-p-head">
      <h1>焰境密语</h1>
      <div class="im-p-acts">
        ${ctx.selMode
          ? `<button class="im-ibtn" id="p-sel-x" title="取消选择">${icon('x', 19)}</button>`
          : `<button class="im-ibtn" id="p-newchat" title="发起新聊天">${icon('newchat', 19)}</button>
             <button class="im-ibtn" id="p-menu-btn" title="批量选择会话">${icon('dots', 19)}</button>`}
      </div>
    </div>
    ${ctx.selMode ? `
      <div class="im-selhead">
        <span>已选 <b>${ctx.selSet.size}</b> 个会话</span>
        <button id="p-selall">全选</button>
      </div>` : `
      <div class="im-search">${icon('search', 17)}<input id="p-search" placeholder="搜索或开始新聊天" value="${esc(ctx.searchQ)}"></div>
      <div class="im-chips">
        <button class="im-chip${ctx.filter === 'all' ? ' on' : ''}" data-f="all">全部</button>
        <button class="im-chip${ctx.filter === 'unread' ? ' on' : ''}" data-f="unread">未读</button>
        <button class="im-chip${ctx.filter === 'groups' ? ' on' : ''}" data-f="groups">群组</button>
      </div>`}
    ${ctx.pendingIn > 0 && !ctx.selMode ? `
      <button class="im-banner" id="p-banner">
        ${icon('userplus', 18)}
        <span>${ctx.pendingIn} 条好友申请待处理</span>
        <b>查看</b>
      </button>` : ''}
    <div class="im-rows" id="p-rows"></div>
    ${ctx.selMode ? `
      <div class="im-selbar">
        <button id="sb-read">${icon('checks', 17)}<span>已读</span></button>
        <button id="sb-pin">${icon('pin', 17)}<span>置顶</span></button>
        <button id="sb-mute">${icon('bellOff', 17)}<span>免打扰</span></button>
        <button id="sb-del" class="warn">${icon('trash', 17)}<span>删除</span></button>
      </div>` : ''}`;

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
      const picked = ctx.selMode && ctx.selSet.has(c.id);
      // 免打扰会话不显示红色未读徽标（行内免打扰角标替代），选择态勾选圆钮
      const badge = unread && !c.muted ? `<span class="im-unread">${c.unread > 99 ? '99+' : c.unread}</span>` : '';
      const selck = ctx.selMode ? `<span class="im-selck${picked ? ' on' : ''}">${picked ? icon('check', 13) : ''}</span>` : '';
      const mute = c.muted ? `<span class="im-mutic" title="免打扰">${icon('bellOff', 13)}</span>` : '';
      return `
        <div class="im-row${active}${unread ? ' unread' : ''}${picked ? ' picked' : ''}" data-id="${c.id}">
          ${selck}${avatarHtml(name, color, 49)}
          <div class="im-row-t">
            <div class="im-row-top"><b>${esc(name)}</b><span>${c.last_msg ? fmtListTime(c.last_msg.created_at) : ''}${mute}</span></div>
            <div class="im-row-prev">${esc(ctx.previewFor(c))}</div>
          </div>
          ${badge}
        </div>`;
    }).join('');
    rowsEl.querySelectorAll('.im-row').forEach((el) => {
      el.addEventListener('click', () => {
        const id = Number(el.dataset.id);
        if (ctx.selMode) {
          if (ctx.selSet.has(id)) ctx.selSet.delete(id); else ctx.selSet.add(id);
          renderRows();
          syncSelUI();
        } else {
          ctx.openConv(id);
        }
      });
    });
  };
  renderRows();

  /** 选择态小件就地同步（计数/全选文案/操作钮可用态与动态文案），不整面板重绘保滚动位 */
  function syncSelUI() {
    const n = ctx.selSet.size;
    const cnt = sideEl.querySelector('.im-selhead b');
    if (cnt) cnt.textContent = n;
    const all = sideEl.querySelector('#p-selall');
    if (all) all.textContent = n && n === ctx.convs.length ? '全不选' : '全选';
    const picked = ctx.convs.filter((c) => ctx.selSet.has(c.id));
    const setBtn = (id, on, label) => {
      const b = sideEl.querySelector(id);
      if (!b) return;
      b.disabled = !on;
      if (label) b.querySelector('span').textContent = label;
    };
    setBtn('#sb-read', picked.some((c) => c.unread > 0));
    setBtn('#sb-pin', picked.length > 0, picked.every((c) => c.pinned) ? '取消置顶' : '置顶');
    setBtn('#sb-mute', picked.length > 0, picked.every((c) => c.muted) ? '取消免打扰' : '免打扰');
    setBtn('#sb-del', picked.length > 0);
  }
  syncSelUI();

  // —— 普通态事件 ——
  const searchEl = sideEl.querySelector('#p-search');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
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
    // ⋮ = 进入批量选择（业主拍板：原「设置/退出登录」下拉与 ⚙ 设置入口重复，撤）
    sideEl.querySelector('#p-menu-btn').addEventListener('click', () => {
      ctx.selMode = true;
      ctx.renderSide();
    });
  }

  // —— 选择态事件 ——
  if (ctx.selMode) {
    sideEl.querySelector('#p-sel-x').addEventListener('click', () => {
      ctx.selMode = false;
      ctx.renderSide();
    });
    sideEl.querySelector('#p-selall').addEventListener('click', () => {
      const wasAll = ctx.selSet.size && ctx.selSet.size === ctx.convs.length;
      ctx.selSet.clear();
      if (!wasAll) ctx.convs.forEach((c) => ctx.selSet.add(c.id));
      renderRows();
      syncSelUI();
    });
    sideEl.querySelector('#sb-read').addEventListener('click', async () => {
      await ctx.batchMarkRead([...ctx.selSet]);
      syncSelUI();
    });
    sideEl.querySelector('#sb-pin').addEventListener('click', async () => {
      const picked = ctx.convs.filter((c) => ctx.selSet.has(c.id));
      const target = !(picked.length && picked.every((c) => c.pinned));
      await ctx.batchSetState([...ctx.selSet], { pinned: target });
      syncSelUI();
    });
    sideEl.querySelector('#sb-mute').addEventListener('click', async () => {
      const picked = ctx.convs.filter((c) => ctx.selSet.has(c.id));
      const target = !(picked.length && picked.every((c) => c.muted));
      await ctx.batchSetState([...ctx.selSet], { muted: target });
      syncSelUI();
    });
    sideEl.querySelector('#sb-del').addEventListener('click', async (e) => {
      const delIds = [...ctx.selSet];
      const nGroup = ctx.convs.filter((c) => ctx.selSet.has(c.id) && c.type === 'group').length;
      const tip = nGroup
        ? `删除选中的 ${delIds.length} 个会话？其中 ${nGroup} 个群聊将退出（你是群主的会解散，不可恢复）`
        : `删除选中的 ${delIds.length} 个会话？私聊将隐藏，对方来新消息会重新出现`;
      if (!confirm(tip)) return;
      e.currentTarget.disabled = true;
      await ctx.batchDelete(delIds);
      ctx.renderSide(); // batchDelete 已置回普通态，整面板还原（兜底网络失败时也还原）
    });
  }
}
