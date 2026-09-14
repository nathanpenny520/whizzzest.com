/**
 * 焰境密语 — 群成员面板（M3）：成员列表 / 群主拉人（好友多选）/ 群主移出。
 * 所有密钥信封生成与 REST 提交一律走 ctx（app 层集中持有）；本模块只做面板 UI 与确认交互。
 * 明文一律 esc 渲染。
 */

import { GET } from './api.js';
import { esc, avatarHtml, fingerprint } from './ui.js';

const GROUP_MAX = 100;
const ADD_PER_CALL = 20;

/**
 * 重绘面板
 * @param host 面板容器（.im-members）
 * @param ctl { conv, ctx, members: () => Map, myRole: () => 'owner'|'member', onChanged() }
 *             onChanged：变更成功后由 chat 层重取成员/刷新密钥/重拉系统消息（幂等，双保险）
 */
export async function renderMembersPanel(host, ctl) {
  const members = ctl.members();
  const isOwner = ctl.myRole() === 'owner';
  const rows = [...members.values()].map((m) => `
    <div class="im-member" data-uid="${m.uid}">
      ${avatarHtml(m.display_name, m.avatar_color, 34)}
      <div class="im-member-txt">
        <b>${esc(m.display_name)}${m.uid === ctl.ctx.me.uid ? '<i class="im-roletag me">我</i>' : ''}${m.role === 'owner' ? '<i class="im-roletag">群主</i>' : ''}</b>
        <span class="im-fp">${m.pub_key ? '指纹…' : esc('UID ' + m.uid)}</span>
      </div>
      ${isOwner && m.role !== 'owner' ? `<button class="im-minibtn warn" data-kick="${m.uid}">移出</button>` : ''}
    </div>`).join('');

  host.innerHTML = `
    <div class="im-members-head">
      <b>群成员（${members.size}/${GROUP_MAX}）</b>
      ${isOwner ? '<button class="im-minibtn" id="m-add">＋ 拉人</button>' : ''}
    </div>
    <div class="im-members-list">${rows}</div>`;

  host.querySelectorAll('.im-member').forEach((row) => {
    const fpEl = row.querySelector('.im-fp');
    const m = members.get(Number(row.dataset.uid));
    if (m && m.pub_key) fingerprint(m.pub_key).then((fp) => { fpEl.textContent = fp; }).catch(() => { fpEl.textContent = ''; });
  });
  host.querySelectorAll('[data-kick]').forEach((b) => {
    b.addEventListener('click', async () => {
      const uid = Number(b.dataset.kick);
      const m = members.get(uid);
      if (!m) return;
      if (!confirm(`将「${m.display_name}」移出群聊？对方将收不到后续消息，且无法自行回来。`)) return;
      if (await ctl.ctx.kickMember(ctl.conv, uid)) ctl.onChanged();
    });
  });
  const addBtn = host.querySelector('#m-add');
  if (addBtn) addBtn.addEventListener('click', () => renderAddView(host, ctl));
}

/* ---------------- 拉人：好友多选 ---------------- */

async function renderAddView(host, ctl) {
  const fj = await GET('/api/friends');
  if (!fj.ok) { host.innerHTML = '<p class="im-empty">好友列表加载失败</p>'; return; }
  const inGroup = new Set(ctl.members().keys());
  const cands = fj.friends.filter((f) => !inGroup.has(f.uid));
  if (!cands.length) {
    host.innerHTML = `
      <div class="im-members-head"><b>选择要拉入的好友</b></div>
      <p class="im-hint">所有好友都已在群里。</p>
      <button class="im-minibtn" id="m-back">‹ 返回成员列表</button>`;
    host.querySelector('#m-back').addEventListener('click', () => renderMembersPanel(host, ctl));
    return;
  }
  host.innerHTML = `
    <div class="im-members-head"><b>选择要拉入的好友（≤${ADD_PER_CALL} 人/次）</b></div>
    <div class="im-members-list">${cands.map((f) => `
      <label class="im-member im-pick">
        <input type="checkbox" value="${f.uid}">
        ${avatarHtml(f.display_name, f.avatar_color, 34)}
        <div class="im-member-txt">
          <b>${esc(f.display_name)}</b>
          <span>${esc(f.bio || 'UID ' + f.uid)}</span>
        </div>
      </label>`).join('')}</div>
    <button class="im-primary" id="m-add-go">拉入群聊</button>
    <button class="im-minibtn" id="m-back">‹ 返回成员列表</button>`;

  host.querySelector('#m-back').addEventListener('click', () => renderMembersPanel(host, ctl));
  host.querySelector('#m-add-go').addEventListener('click', async () => {
    const checked = [...host.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
    const sel = cands.filter((f) => checked.includes(f.uid));
    if (!sel.length) return;
    if (sel.length > ADD_PER_CALL) { alert(`一次最多拉 ${ADD_PER_CALL} 人`); return; }
    if (await ctl.ctx.addMembers(ctl.conv, sel)) ctl.onChanged();
  });
}
