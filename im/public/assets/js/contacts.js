/**
 * 焰境密语 — 联系人面板（UI v2，WhatsApp「新聊天」面板式）
 * 顶层 = 入口行（新群聊/添加好友/好友申请）+ 好友列表（行点击=开私聊）；
 * 申请/添加/建群为面板内子页（←返回），请求逻辑沿用 M2/M3。
 * 好友行点击 = dm 幂等建会话 + 信封随建提交（app 层）；明文一律 esc 渲染。
 */

import { GET, POST, DEL, PUT } from './api.js';
import { esc, avatarHtml } from './ui.js';
import { icon } from './icons.js';

/** 联系人态入口：按子页分派（子页状态存 ctx.contactsSub） */
export function renderContactsPanel(sideEl, ctx) {
  const sub = ctx.contactsSub || 'list';
  if (sub === 'requests') return renderRequestsPage(sideEl, ctx);
  if (sub === 'add') return renderAddPage(sideEl, ctx);
  if (sub === 'group') return renderGroupPage(sideEl, ctx);
  renderListPage(sideEl, ctx);
}

/** 面板子页骨架：← 返回 + 标题 + 内容（backTo=null 时返回键由调用方自绑） */
function scaffold(sideEl, title, ctx, bodyHtml, backTo = 'list') {
  sideEl.innerHTML = `
    <div class="im-c-head">
      <button class="im-ibtn" id="c-back" title="返回">${icon('back', 20)}</button>
      <b>${esc(title)}</b>
    </div>
    ${bodyHtml}`;
  if (backTo) sideEl.querySelector('#c-back').addEventListener('click', () => ctx.setPanel('contacts', backTo));
}

/* ---------------- 顶层：入口 + 好友列表 ---------------- */

async function renderListPage(sideEl, ctx) {
  scaffold(sideEl, '新聊天', ctx, `
    <div class="im-rows" id="c-rows">
      <button class="im-entry" data-e="group">
        <span class="im-entry-ic">${icon('users', 22)}</span><span>发起群聊</span>
      </button>
      <button class="im-entry" data-e="add">
        <span class="im-entry-ic">${icon('userplus', 22)}</span><span>添加好友</span>
      </button>
      <button class="im-entry" data-e="requests">
        <span class="im-entry-ic">${icon('flag', 22)}</span><span>好友申请</span>
        ${ctx.pendingIn > 0 ? `<span class="im-unread">${ctx.pendingIn}</span>` : ''}
      </button>
      <div class="im-sec-label" id="c-friends-label">好友</div>
      <div id="c-friends"></div>
    </div>`, null);
  sideEl.querySelector('#c-back').addEventListener('click', () => ctx.setPanel('chats'));

  sideEl.querySelectorAll('.im-entry').forEach((b) => {
    b.addEventListener('click', () => ctx.setPanel('contacts', b.dataset.e));
  });
  await renderFriends(sideEl, ctx);
}

async function renderFriends(sideEl, ctx) {
  const box = sideEl.querySelector('#c-friends');
  if (!box) return;
  const j = await GET('/api/friends');
  if (!j.ok) { box.innerHTML = '<p class="im-empty">加载失败</p>'; return; }
  const blocks = (await GET('/api/blocks')).blocks || [];
  const label = sideEl.querySelector('#c-friends-label');
  if (label) label.textContent = `好友（${j.friends.length}）`;
  if (!j.friends.length) {
    box.innerHTML = '<p class="im-empty">还没有好友<br><small>用「添加好友」按邮箱或手机号搜索</small></p>';
    return;
  }
  box.innerHTML = j.friends.map((f) => `
    <div class="im-friend" data-uid="${f.uid}">
      ${avatarHtml(f.display_name, f.avatar_color, 49)}
      <div class="im-friend-txt">
        <b>${esc(f.display_name)}</b>
        <span>${esc(f.bio || '')}</span>
      </div>
      <button class="im-fact" data-act="${blocks.includes(f.uid) ? 'unblock' : 'block'}" title="${blocks.includes(f.uid) ? '取消拉黑' : '拉黑'}">${icon('ban', 17)}</button>
      <button class="im-fact" data-act="del" title="删除好友">${icon('trash', 17)}</button>
    </div>`).join('');

  box.querySelectorAll('.im-friend').forEach((row) => {
    const uid = Number(row.dataset.uid);
    const friend = j.friends.find((f) => f.uid === uid);
    row.addEventListener('click', () => ctx.openDm(friend));
    row.querySelectorAll('.im-fact').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'del') {
          if (!confirm(`删除好友「${friend.display_name}」？聊天记录保留。`)) return;
          const r = await DEL(`/api/friends/${uid}`);
          alert(r.ok ? '已删除' : '删除失败（' + r.error + '）');
          if (r.ok) renderListPage(sideEl, ctx);
          return;
        }
        if (act === 'block') {
          if (!confirm(`拉黑「${friend.display_name}」？对方将无法给你发申请与消息。`)) return;
          await PUT(`/api/blocks/${uid}`);
          renderFriends(sideEl, ctx);
          return;
        }
        if (act === 'unblock') {
          await DEL(`/api/blocks/${uid}`);
          renderFriends(sideEl, ctx);
        }
      });
    });
  });
}

/* ---------------- 子页：好友申请 ---------------- */

async function renderRequestsPage(sideEl, ctx) {
  scaffold(sideEl, '好友申请', ctx, '<div class="im-rows" id="c-req"></div>');
  const body = sideEl.querySelector('#c-req');
  const [tin, tout] = await Promise.all([GET('/api/friends/requests?box=in'), GET('/api/friends/requests?box=out')]);
  ctx.pendingIn = tin.requests.length; // 返回顶层/回聊天列表随下次 renderAll 生效（此处重渲染会死循环）
  let inList = tin.requests;
  let outList = tout.requests;
  // 兜底文案不带 UID（业主反馈：UID 仅内部用，不外显）
  const item = (r, actions, fallback) => `
    <div class="im-friend" style="cursor:default">
      ${avatarHtml(r.user.display_name, r.user.avatar_color, 42)}
      <div class="im-friend-txt">
        <b>${esc(r.user.display_name)}</b>
        <span>${esc(r.message || r.user.bio || fallback)}</span>
      </div>
      ${actions}
    </div>`;
  // 就地重绘（无网络等待）：原整页 re-fetch 期间标题与列表一起消失，业主报「收到的申请」字样闪没
  const paint = () => {
    const inHtml = inList.length
      ? inList.map((r) => item(r, `
          <button class="im-minibtn" data-in-accept="${r.id}">同意</button>
          <button class="im-minibtn warn" data-in-reject="${r.id}">拒绝</button>`, '想加你为好友')).join('')
      : '<p class="im-hint">没有待处理的申请</p>';
    const outHtml = outList.length
      ? outList.map((r) => item(r, `<button class="im-minibtn warn" data-out-cancel="${r.id}">撤回</button>`, '等待对方处理')).join('')
      : '<p class="im-hint">没有发出的申请</p>';
    body.innerHTML = `
      <div class="im-sec-label">收到的申请</div>${inHtml}
      <div class="im-sec-label">发出的申请</div>${outHtml}`;
    bind();
  };
  const bind = () => {
    body.querySelectorAll('[data-in-accept]').forEach((b) => b.addEventListener('click', async () => {
      const r = await POST(`/api/friends/requests/${b.dataset.inAccept}/accept`);
      if (!r.ok) { alert('操作失败（' + r.error + '）'); return; }
      inList = inList.filter((x) => String(x.id) !== b.dataset.inAccept);
      ctx.pendingIn = inList.length;
      paint();
    }));
    body.querySelectorAll('[data-in-reject]').forEach((b) => b.addEventListener('click', async () => {
      const r = await POST(`/api/friends/requests/${b.dataset.inReject}/reject`);
      if (!r.ok) { alert('操作失败（' + r.error + '）'); return; }
      inList = inList.filter((x) => String(x.id) !== b.dataset.inReject);
      ctx.pendingIn = inList.length;
      paint();
    }));
    body.querySelectorAll('[data-out-cancel]').forEach((b) => b.addEventListener('click', async () => {
      const r = await DEL(`/api/friends/requests/${b.dataset.outCancel}`);
      if (!r.ok) { alert('操作失败（' + r.error + '）'); return; }
      outList = outList.filter((x) => String(x.id) !== b.dataset.outCancel);
      paint();
    }));
  };
  paint();
}

/* ---------------- 子页：添加好友（精确搜索） ---------------- */

async function renderAddPage(sideEl, ctx) {
  scaffold(sideEl, '添加好友', ctx, `
    <div class="im-add">
      <div class="im-f"><input id="add-q" maxlength="120" placeholder="对方邮箱或带区号手机号"></div>
      <button class="im-primary" id="add-go">搜索</button>
      <p class="im-msg" id="add-msg"></p>
      <div id="add-result"></div>
    </div>`);
  const body = sideEl.querySelector('.im-add');
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  const isPhone = (s) => /^\+\d{5,20}$/.test(s);
  const doSearch = async () => {
    const q = body.querySelector('#add-q').value.trim();
    const msg = body.querySelector('#add-msg');
    const box = body.querySelector('#add-result');
    box.innerHTML = '';
    if (!isEmail(q) && !isPhone(q)) {
      msg.textContent = q ? '格式不对：请输入邮箱，或带区号的手机号（如 +8613800000000）' : '请输入对方的邮箱或带区号手机号';
      msg.className = 'im-msg err';
      return;
    }
    msg.textContent = '搜索中…'; msg.className = 'im-msg';
    const j = await GET('/api/users/search?q=' + encodeURIComponent(q));
    if (!j.ok) { msg.textContent = '搜索失败（' + (j.error === 'rate' ? '太频繁，1 小时后再试' : j.error) + '）'; msg.className = 'im-msg err'; return; }
    if (!j.user) {
      msg.textContent = '没有找到该用户——请确认对方已注册焰境密语，且输入与注册时完全一致';
      msg.className = 'im-msg err';
      return;
    }
    msg.textContent = ''; msg.className = 'im-msg';
    const u = j.user;
    box.innerHTML = `
      <div class="im-friend found" style="cursor:default">
        ${avatarHtml(u.display_name, u.avatar_color, 44)}
        <div class="im-friend-txt">
          <b>${esc(u.display_name)}</b>
          <span>${esc(u.bio || '')}</span>
        </div>
      </div>
      <label class="im-f im-f-note"><span>附言（可选，≤100 字）</span><textarea id="add-note" maxlength="100" rows="2" placeholder="介绍自己，让对方知道你是谁…"></textarea></label>
      <button class="im-primary" id="add-send">发送好友申请</button>
      <p class="im-msg" id="add-send-msg"></p>`;
    body.querySelector('#add-send').addEventListener('click', async () => {
      const sm = body.querySelector('#add-send-msg');
      const r = await POST('/api/friends/requests', { uid: u.id, message: body.querySelector('#add-note').value.trim() });
      if (r.ok) { sm.textContent = '✅ 申请已发送'; sm.className = 'im-msg ok'; body.querySelector('#add-send').disabled = true; }
      else {
        sm.textContent = ({ dup: '已发送过申请，等待对方处理', friends: '你们已经是好友了', blocked: '你已拉黑该用户，请先取消拉黑', rate: '今天申请次数已达上限', inbox_full: '对方待处理申请太多，稍后再试', no_user: '用户不存在' }[r.error] || '发送失败（' + r.error + '）');
        sm.className = 'im-msg err';
      }
    });
  };
  body.querySelector('#add-go').addEventListener('click', doSearch);
  body.querySelector('#add-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

/* ---------------- 子页：建群（方案 §11.1：群主从好友直接拉入，上限 100 人） ---------------- */

async function renderGroupPage(sideEl, ctx) {
  scaffold(sideEl, '发起群聊', ctx, '<div class="im-add" id="grp-box"></div>');
  const box = sideEl.querySelector('#grp-box');
  const j = await GET('/api/friends');
  if (!j.ok) { box.innerHTML = '<p class="im-empty">好友列表加载失败</p>'; return; }
  if (!j.friends.length) {
    box.innerHTML = '<p class="im-empty">还没有好友，先去「添加好友」找到人，再回来建群。</p>';
    return;
  }
  box.innerHTML = `
    <label class="im-f"><span>群名（1-30 字）</span>
      <input id="grp-name" maxlength="30" placeholder="比如：周末爬山小队">
    </label>
    <p class="im-hint">勾选要拉入的好友（≤99 人，群成员上限 100）：</p>
    <div class="im-pick-list" id="grp-list">${j.friends.map((f) => `
      <label class="im-member im-pick">
        <input type="checkbox" value="${f.uid}">
        ${avatarHtml(f.display_name, f.avatar_color, 34)}
        <div class="im-member-txt">
          <b>${esc(f.display_name)}</b>
          <span>${esc(f.bio || '')}</span>
        </div>
      </label>`).join('')}</div>
    <button class="im-primary" id="grp-go">创建群聊</button>
    <p class="im-msg" id="grp-msg"></p>`;

  box.querySelector('#grp-go').addEventListener('click', () => {
    const msg = box.querySelector('#grp-msg');
    const name = box.querySelector('#grp-name').value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 30) { msg.textContent = '群名需 1-30 字'; msg.className = 'im-msg err'; return; }
    const checked = [...box.querySelectorAll('#grp-list input:checked')].map((c) => Number(c.value));
    const sel = j.friends.filter((f) => checked.includes(f.uid));
    if (!sel.length) { msg.textContent = '至少勾选 1 位好友'; msg.className = 'im-msg err'; return; }
    if (sel.length > 99) { msg.textContent = '一次最多拉 99 位好友（群上限 100 人）'; msg.className = 'im-msg err'; return; }
    msg.textContent = '正在生成密钥信封…'; msg.className = 'im-msg';
    ctx.createGroup(name, sel);
  });
}
