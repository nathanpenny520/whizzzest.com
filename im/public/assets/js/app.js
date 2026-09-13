/**
 * 焰境密语 — /app SPA 控制器（M2）
 * 状态中枢：me/identity/convs + 会话密钥缓存；视图 = 会话列表（侧栏）× {欢迎资料 | 好友 | 聊天}（主区）。
 * 模块拆分（业主 2026-09-13 拍板「文件分块」）：api/ui/ws/profile/convlist/contacts/chat 各管一摊。
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
const convKeyCache = new Map(); // convId → Promise<{key, version}>
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
  ensureConvKey,
  decryptRow,
  openConv,
  openDm,
  showHome,
  toggleContacts,
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

/** 会话密钥缓存（Promise 共享防并发重复解包；失败即弃缓存下次重试） */
function ensureConvKey(conv) {
  if (!identity) return Promise.reject(new Error('no identity'));
  if (!convKeyCache.has(conv.id)) {
    convKeyCache.set(conv.id, (async () => {
      const j = await GET(`/api/convs/${conv.id}/keys`);
      if (!j.ok || !j.keys.length) throw new Error('no keys');
      const latest = j.keys[j.keys.length - 1];
      const raw = await crypto.unwrapEnvelope(latest.envelope, identity.privateKeyJwk);
      return { key: await crypto.importConvKey(raw), version: latest.key_version };
    })().catch((err) => { convKeyCache.delete(conv.id); throw err; }));
  }
  return convKeyCache.get(conv.id);
}

/** 解密一条消息；密钥版本不匹配时刷新信封重试一次 */
async function decryptRow(conv, senderUid, bodyB64) {
  try {
    const ki = await ensureConvKey(conv);
    return await crypto.decryptMessage(ki.key, { convId: conv.id, senderUid, bodyB64 });
  } catch (err) {
    convKeyCache.delete(conv.id);
    const ki = await ensureConvKey(conv);
    return await crypto.decryptMessage(ki.key, { convId: conv.id, senderUid, bodyB64 });
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
    convKeyCache.set(j.conv.id, crypto.importConvKey(kit.rawKeyB64).then((key) => ({ key, version: kit.keyVersion })));
    await refreshConvs();
    conv = convs.find((c) => c.id === j.conv.id);
  }
  if (conv) openConv(conv.id);
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
