/**
 * 焰境密语 — /app SPA 控制器（UI v2 三栏：icon 栏 + 列表面板 + 主区，docs/IM-UI改版方案.md）
 * 状态中枢：me/identity/convs + 会话密钥缓存；主区视图 = 空态 | 聊天 | 设置；侧栏两态 = 聊天列表 | 联系人。
 * 模块拆分（业主 2026-09-13 拍板「文件分块」）：api/ui/ws/icons/profile/convlist/contacts/chat 各管一摊。
 * 群组（M3）：会话密钥按版本缓存（重钥后多版并存）；建群/拉人/重钥的信封生成集中在本文件。
 */

import { GET, POST, DEL } from './api.js';
import * as ui from './ui.js';
import * as crypto from '/assets/js/im-crypto.js';
import { icon } from './icons.js';
import { renderSide } from './convlist.js';
import { renderProfile, renderSettings } from './profile.js';
import { openChat } from './chat.js';
import { connectWs } from './ws.js';

const PREVIEW_PLAIN_MAX = 40;

let me = null;
let identity = null;          // { uid, publicKeyB64, privateKeyJwk } | null
let convs = [];
let activeConvId = 0;
let panel = 'chats';          // 侧栏两态：'chats' 会话列表 | 'contacts' 联系人面板
let contactsSub = 'list';     // 联系人面板子页：list | requests | add | group
let settingsOpen = false;     // 主区设置视图开关
let filter = 'all';           // 会话筛选：all | unread | groups
let searchQ = '';             // 会话搜索（本地过滤）
let pendingIn = 0;
let currentChat = null;       // { close() }
let selMode = false;          // 列表面板批量选择态（⋮ 进入；状态挂此以抗轮询重绘）
const selSet = new Set();     // 批量选择勾中的会话 id
const convKeyCache = new Map(); // convId → Promise<{ byVersion: Map<版本, CryptoKey>, latest: 版本 }>
const previews = new Map();     // convId → { seq, text }

const sideEl = document.getElementById('im-side');
const mainEl = document.getElementById('im-main');
const railEls = {
  chats: document.getElementById('rail-chats'),
  contacts: document.getElementById('rail-contacts'),
  settings: document.getElementById('rail-settings'),
  me: document.getElementById('rail-me'),
  logout: document.getElementById('rail-logout'),
};

/* ---------------- 上下文（视图模块回调） ---------------- */

const ctx = {
  get me() { return me; },
  get identity() { return identity; },
  get convs() { return convs; },
  get activeConvId() { return activeConvId; },
  get panel() { return panel; },
  get contactsSub() { return contactsSub; },
  get filter() { return filter; },
  set filter(v) { filter = v; },
  get searchQ() { return searchQ; },
  set searchQ(v) { searchQ = v; },
  get pendingIn() { return pendingIn; },
  set pendingIn(v) { pendingIn = v; },
  get selMode() { return selMode; },
  set selMode(v) { selMode = v; if (!v) selSet.clear(); },
  get selSet() { return selSet; },
  batchSetState,
  batchMarkRead,
  batchDelete,
  crypto,
  ui,
  renderSide: renderAll,
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
  setPanel,
  openSettings,
  openProfile,
  openContactsTab,
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
  wireRail();
  wireMenuOutsideClose();
  renderSideNow();
  await refreshConvs();
  showEmptyMain();
  await refreshPendingIn(); // 好友申请横幅
  // 会话列表兜底轮询（P2 后主路径=activity 推送：60s 校正未读精确计数等；仅可见时跑）
  setInterval(() => { if (document.visibilityState === 'visible') syncTick(); }, 60000);
  // P0 同步热修：切回标签页/窗口聚焦/网络恢复立即对齐，不等下一个 20s tick（业主报修「同步延迟大」）
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncTick(); });
  addEventListener('focus', syncTick);
  addEventListener('online', syncTick);
  openPresence(); // P1 登录即在线：常驻存在性 WS（docs/IM在线与实时同步方案.md）
}

/** 下拉菜单点空白即收起（业主反馈 1）：点在菜单外/菜单按钮上的交由各自逻辑 */
function wireMenuOutsideClose() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[data-menu-btn]') || t.closest('.im-menu')) return;
    document.querySelectorAll('.im-menu:not([hidden])').forEach((m) => { m.hidden = true; });
  });
}

/* ---------------- 三栏路由 ---------------- */

function renderSideNow() {
  renderSide(sideEl, ctx);
  syncRail();
}

/** 常规重绘：仅聊天态重绘侧栏（联系人面板可能正在填表单，轮询/回执不打断）；面板切换走 renderSideNow 强制 */
function renderAll() {
  if (panel === 'chats') renderSideNow();
  else syncRail();
}

function syncRail() {
  railEls.chats.classList.toggle('on', !settingsOpen && panel === 'chats');
  railEls.contacts.classList.toggle('on', !settingsOpen && panel === 'contacts');
  railEls.settings.classList.toggle('on', settingsOpen);
  if (me) railEls.me.innerHTML = ui.avatarHtml(me.display_name, me.avatar_color, 30);
}

/** 移动端（≤720px）：有聊天/设置占主区时主区覆盖列表 */
function syncMobile() {
  document.body.classList.toggle('im-mobile-chat', settingsOpen || activeConvId > 0);
}

function wireRail() {
  railEls.chats.innerHTML = icon('chats');
  railEls.contacts.innerHTML = icon('users');
  railEls.settings.innerHTML = icon('gear');
  railEls.logout.innerHTML = icon('logout');
  railEls.chats.addEventListener('click', () => {
    settingsOpen = false;
    if (activeConvId > 0) return openConv(activeConvId);
    panel = 'chats';
    showEmptyMain();
    renderAll();
  });
  railEls.contacts.addEventListener('click', () => {
    settingsOpen = false;
    setPanel('contacts');
  });
  railEls.settings.addEventListener('click', openSettings);
  railEls.me.addEventListener('click', openProfile);
  railEls.logout.addEventListener('click', logout);
}

/** 侧栏切到联系人面板（sub 可选：直接落子页，缺省回顶层）；主区保持现状（开着聊天不关） */
function setPanel(p, sub) {
  panel = p;
  contactsSub = p === 'contacts' ? (sub || 'list') : 'list';
  renderSideNow();
  syncMobile();
}

/** 横幅/快捷入口直达联系人面板子页 */
function openContactsTab(sub) {
  setPanel('contacts', sub);
}

function logout() {
  return (async () => {
    closePresence();
    await fetch('/api/logout', { method: 'POST' });
    await crypto.clearIdentity().catch(() => {});
    location.href = '/';
  })();
}

/** 主区空态（无聊天打开时的欢迎页） */
function showEmptyMain() {
  activeConvId = 0;
  closeChat();
  syncMobile();
  const keyOk = !!(identity && me && identity.uid === me.uid);
  mainEl.innerHTML = `
    <div class="im-empty-main">
      <div class="im-empty-art">${icon('flame')}</div>
      <h2>焰境密语</h2>
      <p>端到端加密的站内聊天 · 服务器只递信，不看信</p>
      <div class="im-empty-acts">
        <button class="im-ghostbtn" id="ea-chat">${icon('newchat', 16)} 找人开聊</button>
        <button class="im-ghostbtn" id="ea-group">${icon('users', 16)} 新建群聊</button>
        <button class="im-ghostbtn" id="ea-set">${icon('user', 16)} 个人资料</button>
      </div>
      ${keyOk
        ? '<span class="im-badge ok">端到端加密已就绪（本机密钥已解锁）</span>'
        : '<span class="im-badge warn">本机未解锁密钥：退出后重新登录并输入密码以恢复</span>'}
    </div>`;
  mainEl.querySelector('#ea-chat').addEventListener('click', () => setPanel('contacts'));
  mainEl.querySelector('#ea-group').addEventListener('click', () => setPanel('contacts', 'group'));
  mainEl.querySelector('#ea-set').addEventListener('click', openProfile);
}

/** 主区视图开关（设置与个人资料拆分，业主反馈 10）：头像入口=个人资料，⚙=其他设置 */
function openView(render) {
  settingsOpen = true;
  activeConvId = 0;
  closeChat();
  syncMobile();
  render(mainEl, ctx);
  syncRail();
}

function openSettings() {
  openView(renderSettings);
}

function openProfile() {
  openView(renderProfile);
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
  renderAll(); // 预览缓存按 seq 失效（previewFor）：未变的会话不再重复解密、无「…」闪烁（P0）
}

/* ---------------- 批量会话操作（业主拍板 ⋮ 改批量选择，2026-09-14） ---------------- */

/** 批量置顶/免打扰：patch = { pinned } / { muted }，布尔值全量统一（混选以「变更为目标态」语义） */
async function batchSetState(ids, patch) {
  await Promise.all(ids.map((id) => POST(`/api/convs/${id}/state`, patch).catch(() => null)));
  await refreshConvs();
}

/** 批量标为已读：仅对确有未读的会话上报其当前 last_seq */
async function batchMarkRead(ids) {
  await Promise.all(
    convs.filter((c) => ids.includes(c.id) && c.unread > 0)
      .map((c) => POST(`/api/convs/${c.id}/read`, { seq: c.last_seq }).catch(() => null))
  );
  await refreshConvs();
}

/** 批量删除：1v1 = 隐藏（min_seq 顶满，对方来新消息才重现）；群 = 退群/群主解散（服务端裁决）；完成即退出选择态 */
async function batchDelete(ids) {
  const byId = new Map(convs.map((c) => [c.id, c]));
  await Promise.all(ids.map(async (id) => {
    const c = byId.get(id);
    if (!c) return;
    if (c.type === 'group') await DEL(`/api/convs/${id}`).catch(() => null);
    else await POST(`/api/convs/${id}/state`, { hidden: true }).catch(() => null);
  }));
  selMode = false;
  selSet.clear();
  await refreshConvs();
}

let lastSyncTick = 0;
/** 立即对齐（20s 轮询/可见性/聚焦/联网共用）：2s 合并——visibilitychange 与 focus 常成对触发 */
function syncTick() {
  if (Date.now() - lastSyncTick < 2000) return;
  lastSyncTick = Date.now();
  refreshConvs();
  refreshPendingIn();
}

/* ---------------- 存在性连接（P1 登录即在线 + P2 枢纽推送，docs/IM在线与实时同步方案.md） ---------------- */

const PRESENCE_HEARTBEAT_MS = 25000; // 与服务端 90s 在线窗口配套（≥3 次心跳余量）
const PUSH_MERGE_MS = 2000;          // 推送回源节流：突发多条 activity/contact 合并成一次拉取

let presenceWs = null;
let presenceTimer = null;
let lastActivityPull = 0;
let lastContactPull = 0;

/** 常驻存在性 WS（登录后开一条）：心跳保 im_presence.last_ping 新鲜；断线由 connectWs 指数退避重连；
 * P2 起同链路收枢纽轻量帧（不含密文）：activity→回源刷会话列表，contact→回源刷好友申请/联系人 */
function openPresence() {
  if (presenceWs) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  presenceWs = connectWs(`${proto}//${location.host}/ws`, {
    onFrame(f) {
      if (!f) return;
      const now = Date.now();
      if (f.t === 'activity' && now - lastActivityPull >= PUSH_MERGE_MS) {
        lastActivityPull = now;
        refreshConvs();
      } else if (f.t === 'contact' && now - lastContactPull >= PUSH_MERGE_MS) {
        lastContactPull = now;
        refreshPendingIn();
        // 联系人面板仅在无输入态的列表页就地进行重绘（子页表单不打断，v2 交互铁律）
        if (panel === 'contacts' && contactsSub === 'list') renderSideNow();
      }
    },
  });
  presenceTimer = setInterval(() => { if (presenceWs) presenceWs.send({ t: 'ping' }); }, PRESENCE_HEARTBEAT_MS);
}

/** 登出时同步收掉存在性连接（服务器随即落离线） */
function closePresence() {
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  if (presenceWs) { presenceWs.close(); presenceWs = null; }
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
  renderAll();
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

/** 回列表（聊天窗返回/被移出/退群/解散/删好友统一收口）：主区落空态，侧栏回会话列表 */
function showHome() {
  settingsOpen = false;
  panel = 'chats';
  showEmptyMain();
  renderSideNow();
}

async function refreshPendingIn() {
  const j = await GET('/api/friends/requests?box=in').catch(() => null);
  pendingIn = j && j.ok ? j.requests.length : 0;
  renderAll();
}

async function openConv(id) {
  const conv = convs.find((c) => c.id === id);
  if (!conv) return;
  panel = 'chats';
  settingsOpen = false;
  activeConvId = id;
  closeChat();
  renderSideNow();
  syncMobile();
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
    // 服务端信封先到先得：仅当本方信封真写入时本地自造 K 才是会话真钥；
    // 落败（先到者已在/并发落败）时弃 K，openConv 经 /keys 信封解包取服务端真钥
    if (j.keys_written) cacheKit(j.conv.id, kit);
    else clearConvKeys(j.conv.id);
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
  renderAll(); // previewFor 触发异步解密，回填后自行重绘
}

async function onConvRead(convId, seq) {
  const conv = convs.find((c) => c.id === convId);
  if (!conv) return;
  conv.last_read_seq = Math.max(conv.last_read_seq || 0, seq);
  if (conv.last_seq <= seq) conv.unread = 0; // 精确计数随下次轮询校正
  renderAll();
}

function onFriendRemoved() {
  convKeyCache.clear();
  refreshConvs();
  showHome();
}

boot().catch((e) => console.error('im app boot:', e));
