/**
 * 焰境密语 — /app SPA 控制器（M2 + M3 群组）
 * 状态中枢：me/identity/convs + 会话密钥缓存；视图 = 会话列表（侧栏）× {欢迎资料 | 好友 | 聊天}（主区）。
 * 模块拆分（业主 2026-09-13 拍板「文件分块」）：api/ui/ws/profile/convlist/contacts/chat 各管一摊。
 * 群组（M3）：会话密钥按版本缓存（重钥后多版并存）；建群/拉人/重钥的信封生成集中在本文件。
 */

import { GET, POST } from './api.js';
import * as ui from './ui.js';
import * as crypto from '/assets/js/im-crypto.js';
import { renderSide } from './convlist.js';
import { renderProfile } from './profile.js';
import { renderContacts } from './contacts.js';
import { openChat } from './chat.js';

const PREVIEW_PLAIN_MAX = 40;

let me = null;
let identity = null;          // { uid, publicKeyB64, privateKeyJwk } | null
let convs = [];
let activeConvId = 0;
let contactsOpen = false;
let pendingIn = 0;
let currentChat = null;       // { close() }
const convKeyCache = new Map(); // convId → Promise<{ byVersion: Map<版本, CryptoKey>, latest: 版本 }>
const previews = new Map();     // convId → { seq, text }

const sideEl = document.getElementById('im-side');
const mainEl = document.getElementById('im-main');

/* ---------------- 上下文（视图模块回调） ---------------- */

const ctx = {
  get me() { return me; },
  get identity() { return identity; },
  get convs() { return convs; },
  get activeConvId() { return activeConvId; },
  get contactsOpen() { return contactsOpen; },
  get pendingIn() { return pendingIn; },
  set pendingIn(v) { pendingIn = v; },
  crypto,
  ui,
  renderSide: () => renderSide(sideEl, ctx),
  previewFor,
  ensureConvKeys,
  clearConvKeys,
  decryptRow,
  openConv,
  openDm,
  createGroup,
  addMembers,
  kickMember,
  rekeyGroup,
  showHome,
  toggleContacts,
  refreshConvs,
  onConvRead,
  onConvActivity,
  onFriendRemoved,
  reloadMe,
};

async function boot() {
  const r = await GET('/api/me');
  if (!r.ok) { location.href = '/'; return; }
  me = r;
  identity = await crypto.loadIdentity().catch(() => null);
  ctx.renderSide();
  await refreshConvs();
  showHome();
  // 其他会话的未读/末条靠轻轮询（本会话实时走 WS；推送 v1 不做，方案 §5）
  setInterval(() => { if (document.visibilityState === 'visible') refreshConvs(); }, 20000);
}

/* ---------------- 数据 ---------------- */

async function reloadMe() {
  const r = await GET('/api/me');
  if (r.ok) me = r;
}

async function refreshConvs() {
  const j = await GET('/api/convs');
  if (!j.ok) return;
  convs = j.convs;
  previews.clear();
  ctx.renderSide(); // 预览由 previewFor 同步占位 + 异步解密回填
}

/** 会话行预览（同步）：缓存命中直接给文本；否则占位并触发异步解密回填 */
function previewFor(conv) {
  if (!conv.last_msg) return '打个招呼吧';
  if (conv.last_msg.type !== 'text') return conv.last_msg.type === 'system' ? conv.last_msg.body : '新消息';
  const cached = previews.get(conv.id);
  if (cached && cached.seq === conv.last_msg.seq) return cached.text;
  decryptPreview(conv);
  return '…';
}

const decrypting = new Set();
async function decryptPreview(conv) {
  if (decrypting.has(conv.id)) return;
  decrypting.add(conv.id);
  let text = '[未能解密]';
  try {
    const r = await decryptRow(conv, conv.last_msg.sender_id, conv.last_msg.body);
    text = r.text.length > PREVIEW_PLAIN_MAX ? r.text.slice(0, PREVIEW_PLAIN_MAX) + '…' : r.text;
  } catch { /* 保持占位 */ }
  decrypting.delete(conv.id);
  previews.set(conv.id, { seq: conv.last_msg.seq, text });
  ctx.renderSide();
}

/** 会话密钥缓存（全版本：群组重钥后新旧版并存，按消息 blob 标的版本取钥；Promise 共享防并发重复解包） */
function ensureConvKeys(conv) {
  if (!identity) return Promise.reject(new Error('no identity'));
  if (!convKeyCache.has(conv.id)) {
    convKeyCache.set(conv.id, (async () => {
      const j = await GET(`/api/convs/${conv.id}/keys`);
      if (!j.ok || !j.keys.length) throw new Error('no keys');
      const byVersion = new Map();
      let latest = 0;
      for (const k of j.keys) {
        const raw = await crypto.unwrapEnvelope(k.envelope, identity.privateKeyJwk);
        byVersion.set(k.key_version, await crypto.importConvKey(raw));
        if (k.key_version > latest) latest = k.key_version;
      }
      return { byVersion, latest };
    })().catch((err) => { convKeyCache.delete(conv.id); throw err; }));
  }
  return convKeyCache.get(conv.id);
}

/** 重钥帧后弃缓存（下一条消息的发送/解密将重新拉信封） */
function clearConvKeys(convId) {
  convKeyCache.delete(convId);
}

/** 解密一条消息：按 blob 标的 key_version 取钥；未命中（如刚重钥）刷新信封重试一次 */
async function decryptRow(conv, senderUid, bodyB64) {
  let want = 0;
  try { want = crypto.peekKeyVersion(bodyB64); } catch { /* 坏 blob 走解密报错 */ }
  const pick = (ki) => ki.byVersion.get(want) || ki.byVersion.get(ki.latest);
  try {
    const ki = await ensureConvKeys(conv);
    return await crypto.decryptMessage(pick(ki), { convId: conv.id, senderUid, bodyB64 });
  } catch (err) {
    convKeyCache.delete(conv.id);
    const ki = await ensureConvKeys(conv);
    return await crypto.decryptMessage(pick(ki), { convId: conv.id, senderUid, bodyB64 });
  }
}

/* ---------------- 视图切换 ---------------- */

function closeChat() {
  if (currentChat) { currentChat.close(); currentChat = null; }
}

function showHome() {
  activeConvId = 0;
  contactsOpen = false;
  closeChat();
  ctx.renderSide();
  renderProfile(mainEl, ctx);
}

function toggleContacts() {
  if (contactsOpen) return showHome();
  contactsOpen = true;
  activeConvId = 0;
  closeChat();
  ctx.renderSide();
  renderContacts(mainEl, ctx).then(() => refreshPendingIn());
}

async function refreshPendingIn() {
  const j = await GET('/api/friends/requests?box=in').catch(() => null);
  pendingIn = j && j.ok ? j.requests.length : 0;
  ctx.renderSide();
}

async function openConv(id) {
  const conv = convs.find((c) => c.id === id);
  if (!conv) return;
  contactsOpen = false;
  activeConvId = id;
  closeChat();
  ctx.renderSide();
  currentChat = openChat(mainEl, ctx, conv);
}

/** 好友视图「私聊」：dm 幂等建会话（发起方生成 K + 双方信封随建提交，方案 §3.2） */
async function openDm(friend) {
  if (!identity) { alert('本机未解锁密钥，请退出后重新登录恢复'); return; }
  let conv = convs.find((c) => c.type === 'dm' && c.peer && c.peer.uid === friend.uid);
  if (!conv) {
    const kit = await crypto.createConvEnvelopes([
      { uid: me.uid, pub_key: me.pub_key },
      { uid: friend.uid, pub_key: friend.pub_key },
    ]);
    const j = await POST('/api/convs/dm', {
      peer_uid: friend.uid,
      key_version: kit.keyVersion,
      envelopes: kit.envelopes,
    });
    if (!j.ok) {
      alert({ not_friends: '对方已不是好友', blocked: '存在拉黑关系，无法发起会话', keys: '密钥材料无效' }[j.error] || '建会话失败（' + j.error + '）');
      return;
    }
    cacheKit(j.conv.id, kit);
    await refreshConvs();
    conv = convs.find((c) => c.id === j.conv.id);
  }
  if (conv) openConv(conv.id);
}

/** 发起方自己生成 K 时直接入缓存（免再拉信封解包） */
function cacheKit(convId, kit) {
  const keyP = crypto.importConvKey(kit.rawKeyB64);
  convKeyCache.set(convId, keyP.then((key) => ({ byVersion: new Map([[kit.keyVersion, key]]), latest: kit.keyVersion })));
}

/** 建群（M3，方案 §6/§11）：对全员出 v1 信封随建提交；friends 为选中的好友数组 [{uid, pub_key, ...}] */
async function createGroup(name, friends) {
  if (!identity) { alert('本机未解锁密钥，请退出后重新登录恢复'); return; }
  const members = [{ uid: me.uid, pub_key: me.pub_key }, ...friends.map((f) => ({ uid: f.uid, pub_key: f.pub_key }))];
  const kit = await crypto.createConvEnvelopes(members, 1);
  const j = await POST('/api/convs/group', {
    name,
    member_uids: friends.map((f) => f.uid),
    key_version: kit.keyVersion,
    envelopes: kit.envelopes,
  });
  if (!j.ok) {
    alert({ name: '群名需 1-30 字', members: '成员名单无效', not_friends: '仅能拉自己的好友入群', blocked: '与所选成员存在拉黑关系', keys: '密钥材料无效', rate: '操作太频繁，稍后再试' }[j.error] || '建群失败（' + j.error + '）');
    return;
  }
  cacheKit(j.conv.id, kit);
  await refreshConvs();
  openConv(j.conv.id);
}

/** 群主拉人（M3）：新 K_{v+1} 对「现有成员 ∪ 新成员」全套信封随请求提交（原子重钥） */
async function addMembers(conv, friends) {
  if (!identity) { alert('本机未解锁密钥，请退出后重新登录恢复'); return false; }
  const mj = await GET(`/api/convs/${conv.id}/members`);
  if (!mj.ok) { alert('成员信息加载失败'); return false; }
  const pubs = new Map(mj.members.map((m) => [m.uid, m.pub_key]));
  for (const f of friends) pubs.set(f.uid, f.pub_key);
  const cur = await ensureConvKeys(conv);
  const kit = await crypto.createConvEnvelopes(
    [...pubs.entries()].map(([uid, pub_key]) => ({ uid, pub_key })),
    cur.latest + 1
  );
  const j = await POST(`/api/convs/${conv.id}/members`, {
    uids: friends.map((f) => f.uid),
    key_version: kit.keyVersion,
    envelopes: kit.envelopes,
  });
  if (!j.ok) {
    if (j.error === 'keys') clearConvKeys(conv.id); // 版本落后（并发重钥）→ 刷新后可重试
    alert({ forbidden: '仅群主可以拉人', full: '群已满 100 人', not_friends: '仅能拉自己的好友入群', members: '所选成员无效或已在群里', keys: '密钥版本已更新，请重试', rate: '操作太频繁，稍后再试' }[j.error] || '拉人失败（' + j.error + '）');
    return false;
  }
  cacheKit(conv.id, kit);
  await refreshConvs();
  return true;
}

/** 群主移出成员（M3）：新 K 对余员信封随 DELETE 提交——踢人=原子重钥，对抗场景无缺口 */
async function kickMember(conv, uid) {
  if (!identity) { alert('本机未解锁密钥，请退出后重新登录恢复'); return false; }
  const mj = await GET(`/api/convs/${conv.id}/members`);
  if (!mj.ok) { alert('成员信息加载失败'); return false; }
  const rest = mj.members.filter((m) => m.uid !== uid);
  const cur = await ensureConvKeys(conv);
  const kit = await crypto.createConvEnvelopes(
    rest.map((m) => ({ uid: m.uid, pub_key: m.pub_key })),
    cur.latest + 1
  );
  const j = await DEL(`/api/convs/${conv.id}/members/${uid}`, { key_version: kit.keyVersion, envelopes: kit.envelopes });
  if (!j.ok) {
    if (j.error === 'keys') clearConvKeys(conv.id);
    alert({ forbidden: '仅群主可以移出成员', self: '不能移出自己（群主可解散群聊）', not_found: '对方已不在群里', keys: '密钥版本已更新，请重试', rate: '操作太频繁，稍后再试' }[j.error] || '移出失败（' + j.error + '）');
    return false;
  }
  cacheKit(conv.id, kit);
  await refreshConvs();
  return true;
}

/** 群主重钥（M3）：他人退群后的补钥（退群者带不走新钥）；版本必须 = 当前最大 + 1 */
async function rekeyGroup(conv) {
  if (!identity) return;
  const mj = await GET(`/api/convs/${conv.id}/members`);
  if (!mj.ok) return;
  const cur = await ensureConvKeys(conv);
  const kit = await crypto.createConvEnvelopes(
    mj.members.map((m) => ({ uid: m.uid, pub_key: m.pub_key })),
    cur.latest + 1
  );
  const j = await POST(`/api/convs/${conv.id}/rekey`, { key_version: kit.keyVersion, envelopes: kit.envelopes });
  if (j.ok) cacheKit(conv.id, kit);
  else if (j.error === 'keys') clearConvKeys(conv.id); // 已有他人/其他设备重过钥——静默
}

/* ---------------- 侧栏联动 ---------------- */

/** 收到/发出消息：更新左侧列表（末条预览异步解密回填；置顶由服务端排序承担） */
async function onConvActivity(convId, lastMsg) {
  const conv = convs.find((c) => c.id === convId);
  if (!conv) return refreshConvs();
  conv.last_msg = lastMsg;
  conv.last_seq = Math.max(conv.last_seq || 0, lastMsg.seq);
  previews.delete(convId);
  ctx.renderSide(); // previewFor 触发异步解密，回填后自行重绘
}

async function onConvRead(convId, seq) {
  const conv = convs.find((c) => c.id === convId);
  if (!conv) return;
  conv.last_read_seq = Math.max(conv.last_read_seq || 0, seq);
  if (conv.last_seq <= seq) conv.unread = 0; // 精确计数随下次轮询校正
  ctx.renderSide();
}

function onFriendRemoved() {
  convKeyCache.clear();
  refreshConvs();
  showHome();
}

boot().catch((e) => console.error('im app boot:', e));
