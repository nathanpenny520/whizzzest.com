/**
 * 焰境密语 — 群信息抽屉（M3 成员管理迁入 UI v2 抽屉，方案 §6/§11）
 * 渲染 = 群头（头像/群名/人数/加密说明）+ 成员列表（指纹/移出）+ 群操作（改名/举报/退群/解散）。
 * 密钥信封生成与 REST 提交一律走 ctl.ctx（app 层集中持有）；群操作按钮调 ctl.actions（chat 层同一批函数）。
 * 明文一律 esc 渲染。
 */

import { GET } from './api.js';
import { esc, avatarHtml, fingerprint } from './ui.js';
import { icon } from './icons.js';

const GROUP_MAX = 100;
const ADD_PER_CALL = 20;

/**
 * 重绘群信息抽屉
 * @param host 抽屉容器（.im-info）
 * @param ctl { conv, ctx, members: () => Map, myRole: () => 'owner'|'member',
 *              onChanged(), actions: { rename, leave, disband, report }, }
 *          onChanged：变更成功后由 chat 层重取成员/刷新密钥/重拉系统消息（幂等，双保险）
 */
export function renderGroupInfo(host, ctl) {
  const members = ctl.members();
  const isOwner = ctl.myRole() === 'owner';
  const conv = ctl.conv;
  const gcolor = conv.id % 8;
  const rows = [...members.values()].map((m) => `
    <div class="im-member" data-uid="${m.uid}">
      ${avatarHtml(m.display_name, m.avatar_color, 38)}
      <div class="im-member-txt">
        <b>${esc(m.display_name)}${m.uid === ctl.ctx.me.uid ? '<i class="im-roletag me">我</i>' : ''}${m.role === 'owner' ? '<i class="im-roletag">群主</i>' : ''}</b>
        <span class="im-fp">${m.pub_key ? '指纹…' : ''}</span>
      </div>
      ${isOwner && m.role !== 'owner' ? `<button class="im-minibtn warn" data-kick="${m.uid}">移出</button>` : ''}
    </div>`).join('');

  host.innerHTML = `
    <div class="im-info-top">群信息
      <button class="im-ibtn im-info-close" id="info-close" title="关闭">${icon('x', 20)}</button>
    </div>
    <div class="im-info-head">
      ${avatarHtml(conv.name || '群', gcolor, 96)}
      <h3>${esc(conv.name || '群聊')}</h3>
      <p>${members.size}/${GROUP_MAX} 人 · 群聊消息对全体成员端到端加密</p>
    </div>
    <div class="im-info-sec">
      <div class="im-sec-t" style="display:flex;align-items:center;justify-content:space-between">
        <span>成员</span>
        ${isOwner ? `<button class="im-minibtn" id="m-add">${icon('userplus', 13)} 拉人</button>` : ''}
      </div>
      <div class="im-members-list">${rows}</div>
    </div>
    <div class="im-info-acts">
      ${isOwner ? `<button class="im-act" data-act="rename">${icon('edit', 18)} 修改群名</button>` : ''}
      <button class="im-act warn" data-act="report">${icon('flag', 18)} 举报</button>
      ${isOwner
        ? `<button class="im-act warn" data-act="disband">${icon('trash', 18)} 解散群聊</button>`
        : `<button class="im-act warn" data-act="leave">${icon('logout', 18)} 退出群聊</button>`}
    </div>`;

  host.querySelector('#info-close').addEventListener('click', () => ctl.actions.close());
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
  host.querySelectorAll('.im-info-acts .im-act').forEach((b) => {
    b.addEventListener('click', () => ctl.actions[b.dataset.act]());
  });
  host.querySelector('#m-add')?.addEventListener('click', () => renderAddView(host, ctl));
}

/* ---------------- 拉人：好友多选（≤20 人/次，信封随请求提交） ---------------- */

async function renderAddView(host, ctl) {
  const fj = await GET('/api/friends');
  if (!fj.ok) { host.innerHTML = '<p class="im-empty">好友列表加载失败</p>'; return; }
  const inGroup = new Set(ctl.members().keys());
  const cands = fj.friends.filter((f) => !inGroup.has(f.uid));
  const backBtn = '<button class="im-minibtn" id="m-back" style="margin:0 18px 16px">‹ 返回群信息</button>';
  if (!cands.length) {
    host.innerHTML = `
      <div class="im-info-top">拉人
        <button class="im-ibtn im-info-close" id="info-close" title="关闭">${icon('x', 20)}</button>
      </div>
      <p class="im-hint">所有好友都已在群里。</p>${backBtn}`;
    host.querySelector('#info-close').addEventListener('click', () => ctl.actions.close());
    host.querySelector('#m-back').addEventListener('click', () => renderGroupInfo(host, ctl));
    return;
  }
  host.innerHTML = `
    <div class="im-info-top">选择要拉入的好友（≤${ADD_PER_CALL} 人/次）
      <button class="im-ibtn im-info-close" id="info-close" title="关闭">${icon('x', 20)}</button>
    </div>
    <div class="im-pick-list" style="padding:0 14px">${cands.map((f) => `
      <label class="im-member im-pick">
        <input type="checkbox" value="${f.uid}">
        ${avatarHtml(f.display_name, f.avatar_color, 34)}
        <div class="im-member-txt">
          <b>${esc(f.display_name)}</b>
          <span>${esc(f.bio || '')}</span>
        </div>
      </label>`).join('')}</div>
    <div style="padding:0 18px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="im-primary" id="m-add-go">拉入群聊</button>
      <button class="im-minibtn" id="m-back">‹ 返回群信息</button>
    </div>`;
  host.querySelector('#info-close').addEventListener('click', () => ctl.actions.close());
  host.querySelector('#m-back').addEventListener('click', () => renderGroupInfo(host, ctl));
  host.querySelector('#m-add-go').addEventListener('click', async () => {
    const checked = [...host.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
    const sel = cands.filter((f) => checked.includes(f.uid));
    if (!sel.length) return;
    if (sel.length > ADD_PER_CALL) { alert(`一次最多拉 ${ADD_PER_CALL} 人`); return; }
    if (await ctl.ctx.addMembers(ctl.conv, sel)) ctl.onChanged();
  });
}
