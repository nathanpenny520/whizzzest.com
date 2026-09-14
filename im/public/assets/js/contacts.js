/**
 * 焰境密语 — 好友视图（M2：列表/申请/添加；M3 增建群 Tab）
 * 好友行点击 = 开私聊（dm 幂等建会话 + 信封随建提交）；建群 = 好友多选 + 群名（信封随建提交，app 层生成）。
 */

import { GET, POST, DEL, PUT } from './api.js';
import { esc, avatarHtml, fingerprint } from './ui.js';

export async function renderContacts(root, ctx) {
  root.innerHTML = `
    <div class="im-contacts">
      <div class="im-tabs">
        <button class="im-tab on" data-tab="friends">好友</button>
        <button class="im-tab" data-tab="requests">申请</button>
        <button class="im-tab" data-tab="add">添加</button>
        <button class="im-tab" data-tab="group">建群</button>
      </div>
      <div class="im-tab-body" id="tab-body"></div>
    </div>`;

  const body = root.querySelector('#tab-body');
  const show = {
    friends: () => renderFriends(body, ctx),
    requests: () => renderRequests(body, ctx),
    add: () => renderAdd(body, ctx),
    group: () => renderGroupBuild(body, ctx),
  };
  root.querySelectorAll('.im-tab').forEach((t) => {
    t.addEventListener('click', () => {
      root.querySelectorAll('.im-tab').forEach((x) => x.classList.toggle('on', x === t));
      show[t.dataset.tab]();
    });
  });
  await show.friends();
}

/* ---------------- 好友列表 ---------------- */

async function renderFriends(body, ctx) {
  const j = await GET('/api/friends');
  if (!j.ok) { body.innerHTML = '<p class="im-empty">加载失败</p>'; return; }
  const blocks = (await GET('/api/blocks')).blocks || [];
  if (!j.friends.length) {
    body.innerHTML = '<p class="im-empty">还没有好友<br><small>用「添加」按邮箱或手机号搜索</small></p>';
    return;
  }
  body.innerHTML = j.friends.map((f) => `
    <div class="im-friend" data-uid="${f.uid}">
      ${avatarHtml(f.display_name, f.avatar_color, 40)}
      <div class="im-friend-txt">
        <b>${esc(f.display_name)}</b>
        <span>${esc(f.bio || 'UID ' + f.uid)}</span>
      </div>
      <span class="im-fp" data-pub="${esc(f.pub_key)}">指纹…</span>
      <button class="im-minibtn" data-act="chat">私聊</button>
      <button class="im-minibtn warn" data-act="${blocks.includes(f.uid) ? 'unblock' : 'block'}">${blocks.includes(f.uid) ? '取消拉黑' : '拉黑'}</button>
      <button class="im-minibtn warn" data-act="del">删除</button>
    </div>`).join('');

  body.querySelectorAll('.im-friend').forEach((row) => {
    const uid = Number(row.dataset.uid);
    const friend = j.friends.find((f) => f.uid === uid);
    fingerprint(friend.pub_key).then((fp) => { row.querySelector('.im-fp').textContent = fp; });
    row.querySelectorAll('.im-minibtn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'chat') return ctx.openDm(friend);
        if (act === 'del') {
          if (!confirm(`删除好友「${friend.display_name}」？聊天记录保留。`)) return;
          const r = await DEL(`/api/friends/${uid}`);
          alert(r.ok ? '已删除' : '删除失败（' + r.error + '）');
          if (r.ok) renderFriends(body, ctx);
          return;
        }
        if (act === 'block') {
          if (!confirm(`拉黑「${friend.display_name}」？对方将无法给你发申请与消息。`)) return;
          await PUT(`/api/blocks/${uid}`);
          renderFriends(body, ctx);
          return;
        }
        if (act === 'unblock') {
          await DEL(`/api/blocks/${uid}`);
          renderFriends(body, ctx);
        }
      });
    });
  });
}

/* ---------------- 好友申请 ---------------- */

async function renderRequests(body, ctx) {
  const [tin, tout] = await Promise.all([GET('/api/friends/requests?box=in'), GET('/api/friends/requests?box=out')]);
  ctx.pendingIn = tin.requests.length;
  ctx.renderSide();
  const item = (r, actions) => `
    <div class="im-friend">
      ${avatarHtml(r.user.display_name, r.user.avatar_color, 40)}
      <div class="im-friend-txt">
        <b>${esc(r.user.display_name)}</b>
        <span>${esc(r.message || r.user.bio || 'UID ' + r.user.uid)}</span>
      </div>
      ${actions}
    </div>`;
  const inHtml = tin.requests.length
    ? tin.requests.map((r) => item(r, `
        <button class="im-minibtn" data-in-accept="${r.id}">同意</button>
        <button class="im-minibtn warn" data-in-reject="${r.id}">拒绝</button>`)).join('')
    : '<p class="im-hint">没有待处理的申请</p>';
  const outHtml = tout.requests.length
    ? tout.requests.map((r) => item(r, `<button class="im-minibtn warn" data-out-cancel="${r.id}">撤回</button>`)).join('')
    : '<p class="im-hint">没有发出的申请</p>';
  body.innerHTML = `
    <h3 class="im-sec">收到的申请</h3>${inHtml}
    <h3 class="im-sec">发出的申请</h3>${outHtml}`;

  body.querySelectorAll('[data-in-accept]').forEach((b) => b.addEventListener('click', async () => {
    const r = await POST(`/api/friends/requests/${b.dataset.inAccept}/accept`);
    if (!r.ok) alert('操作失败（' + r.error + '）');
    renderRequests(body, ctx);
  }));
  body.querySelectorAll('[data-in-reject]').forEach((b) => b.addEventListener('click', async () => {
    await POST(`/api/friends/requests/${b.dataset.inReject}/reject`);
    renderRequests(body, ctx);
  }));
  body.querySelectorAll('[data-out-cancel]').forEach((b) => b.addEventListener('click', async () => {
    await DEL(`/api/friends/requests/${b.dataset.outCancel}`);
    renderRequests(body, ctx);
  }));
}

/* ---------------- 添加好友（精确搜索） ---------------- */

async function renderAdd(body, ctx) {
  body.innerHTML = `
    <div class="im-add">
      <label class="im-f"><span>对方邮箱或手机号（含区号，如 +8613800000000）</span>
        <input id="add-q" maxlength="120" placeholder="name@example.com 或 +86…">
      </label>
      <button class="im-primary" id="add-go">搜索</button>
      <p class="im-msg" id="add-msg"></p>
      <div id="add-result"></div>
    </div>`;
  const doSearch = async () => {
    const q = body.querySelector('#add-q').value.trim();
    const msg = body.querySelector('#add-msg');
    const box = body.querySelector('#add-result');
    box.innerHTML = '';
    if (!q) { msg.textContent = '请输入邮箱或手机号'; msg.className = 'im-msg err'; return; }
    msg.textContent = '搜索中…'; msg.className = 'im-msg';
    const j = await GET('/api/users/search?q=' + encodeURIComponent(q));
    if (!j.ok) { msg.textContent = '搜索失败（' + (j.error === 'rate' ? '太频繁，1 小时后再试' : j.error) + '）'; msg.className = 'im-msg err'; return; }
    msg.textContent = '';
    if (!j.user) { box.innerHTML = '<p class="im-hint">没有找到该用户——请确认邮箱/手机号与对方注册时完全一致。</p>'; return; }
    const u = j.user;
    box.innerHTML = `
      <div class="im-friend found">
        ${avatarHtml(u.display_name, u.avatar_color, 44)}
        <div class="im-friend-txt">
          <b>${esc(u.display_name)}</b>
          <span>${esc(u.bio || 'UID ' + u.id)}</span>
        </div>
        <code class="im-fp" id="add-fp"></code>
      </div>
      <label class="im-f"><span>附言（可选，≤100 字）</span><input id="add-note" maxlength="100" placeholder="我是…"></label>
      <button class="im-primary" id="add-send">发送好友申请</button>
      <p class="im-msg" id="add-send-msg"></p>`;
    fingerprint(u.pub_key).then((fp) => { body.querySelector('#add-fp').textContent = fp; });
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

/* ---------------- 建群（M3，方案 §11.1：群主从好友直接拉入，上限 100 人） ---------------- */

async function renderGroupBuild(body, ctx) {
  const j = await GET('/api/friends');
  if (!j.ok) { body.innerHTML = '<p class="im-empty">好友列表加载失败</p>'; return; }
  if (!j.friends.length) {
    body.innerHTML = '<p class="im-empty">还没有好友，先去「添加」找到人，再回来建群。</p>';
    return;
  }
  body.innerHTML = `
    <div class="im-add">
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
            <span>${esc(f.bio || 'UID ' + f.uid)}</span>
          </div>
        </label>`).join('')}</div>
      <button class="im-primary" id="grp-go">创建群聊</button>
      <p class="im-msg" id="grp-msg"></p>
    </div>`;

  body.querySelector('#grp-go').addEventListener('click', () => {
    const msg = body.querySelector('#grp-msg');
    const name = body.querySelector('#grp-name').value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 30) { msg.textContent = '群名需 1-30 字'; msg.className = 'im-msg err'; return; }
    const checked = [...body.querySelectorAll('#grp-list input:checked')].map((c) => Number(c.value));
    const sel = j.friends.filter((f) => checked.includes(f.uid));
    if (!sel.length) { msg.textContent = '至少勾选 1 位好友'; msg.className = 'im-msg err'; return; }
    if (sel.length > 99) { msg.textContent = '一次最多拉 99 位好友（群上限 100 人）'; msg.className = 'im-msg err'; return; }
    msg.textContent = '正在生成密钥信封…'; msg.className = 'im-msg';
    ctx.createGroup(name, sel);
  });
}
