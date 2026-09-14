/**
 * 焰境密语 — 聊天窗（M2：1v1；M3：群组；UI v2 改版）
 * 历史分页解密 → WS 实时收发（tag 确认/去重 + 缺口补拉）→ 已读上报 → typing/在线入头部副标。
 * UI v2：带尾气泡 + 时间内嵌 + 1v1 回执（✓ 发送确认 / ✓✓ 已读，read 帧驱动）+ 未读分割线 +
 *        群消息彩色发送者名/小头像 + 信息抽屉（dm 安全数字与操作；群信息/成员管理迁入）。
 * 明文一律 esc 渲染；发送前 UTF-8 字节预检（密文 b64 存库 ≤2000）。
 */

import { connectConv } from './ws.js';
import { GET, POST, PUT, DEL, PATCH } from './api.js';
import { esc, avatarHtml, senderColor, fmtTime, fmtDayLabel, utf8Len } from './ui.js';
import { icon } from './icons.js';
import { renderGroupInfo } from './members.js';

const PLAIN_MAX_BYTES = 1400;  // 密文 b64 ≤2000 的安全线（理论明文上限 1471B，方案 §3.3）
const NAME_MAX = 30;

export function openChat(root, ctx, conv) {
  const isGroup = conv.type === 'group';
  const peer = conv.peer || { uid: 0, display_name: conv.name || '会话', avatar_color: 0 };
  const title = isGroup ? (conv.name || '群聊') : (peer.display_name || '会话');
  const titleColor = isGroup ? (conv.id % 8) : peer.avatar_color;
  const bodyEl = root;
  let keyInfo = null;         // { byVersion: Map<版本, CryptoKey>, latest }
  let canCrypt = false;

  let wsHandle = null;
  let closed = false;
  let lastSeq = 0;
  let lastDayLabel = '';
  const seenSeq = new Set();
  const pending = new Map();  // tag → 待确认气泡
  let inbox = Promise.resolve();
  const typists = new Map();  // uid → 过期定时器（typing 入头部副标）
  let lastTypingSent = 0;

  // 在线与成员（dm / 群组共用 onlineSet；群组另持成员表供发送者名与管理操作）
  // onlineSet = 房间实时集（对方开着本会话）；presenceSet = 全局在线集（P1 登录即在线，30s 轮询校正）
  const onlineSet = new Set();
  const presenceSet = new Set();
  let onlineKnown = false;
  let presenceKnown = false;
  let presenceTimer = null;
  let members = new Map();
  let myRole = 'owner';
  let infoOpen = false;
  let kickedDone = false;
  let rekeyBusy = false;
  let blocked = false;        // dm：是否已拉黑
  let peerLastRead = Number(conv.peer_last_read || 0); // 1v1 回执基准（read 帧推进）

  bodyEl.innerHTML = `
    <div class="im-chat">
      <div class="im-chat-col">
        <div class="im-chat-head">
          <button class="im-back" id="chat-back" title="返回">${icon('back', 22)}</button>
          ${avatarHtml(title, titleColor, 40)}
          <div class="im-chat-who">
            <b id="chat-title">${esc(title)}</b>
            <span class="im-chat-sub" id="chat-sub">连接中…</span>
          </div>
          <button class="im-ibtn" id="chat-info-btn" title="信息">${icon('info', 20)}</button>
          <button class="im-ibtn" id="chat-menu-btn" data-menu-btn title="菜单">${icon('dots', 20)}</button>
          <div class="im-menu" id="chat-menu" hidden></div>
        </div>
        <div class="im-chat-body" id="chat-body"><div class="im-chat-inner" id="chat-list"></div></div>
        <form class="im-chat-input" id="chat-form">
          <textarea id="chat-text" rows="1" placeholder="加载中…"></textarea>
          <button class="im-send" id="chat-send" type="submit" title="发送" disabled>${icon('send', 19)}</button>
        </form>
      </div>
      <aside class="im-info" id="chat-info" hidden></aside>
    </div>`;

  const listEl = bodyEl.querySelector('#chat-list');
  const infoEl = bodyEl.querySelector('#chat-info');
  const formEl = bodyEl.querySelector('#chat-form');
  const textEl = bodyEl.querySelector('#chat-text');
  const sendBtn = bodyEl.querySelector('#chat-send');
  const subEl = bodyEl.querySelector('#chat-sub');
  const menuEl = bodyEl.querySelector('#chat-menu');

  /* ---------- 启动 ---------- */

  (async function boot() {
    try { keyInfo = await ctx.ensureConvKeys(conv); } catch { keyInfo = null; }
    canCrypt = !!(keyInfo && ctx.identity);
    textEl.placeholder = canCrypt ? '输入消息（端到端加密）…' : '本机未解锁密钥，无法收发——退出后重新登录可恢复';
    textEl.disabled = !canCrypt;
    sendBtn.disabled = !canCrypt;

    if (isGroup) await loadMembers(); // 先取成员表：历史渲染需要发送者名
    else await loadBlockState();      // dm：拉黑态供菜单/抽屉
    await loadHistory();
    connect();
    buildMenu();
    await loadPresence();
    presenceTimer = setInterval(loadPresence, 30000);
  })();

  async function loadHistory() {
    listEl.innerHTML = '<p class="im-empty">加载中…</p>';
    const j = await GET(`/api/convs/${conv.id}/messages?limit=50`);
    listEl.innerHTML = '';
    if (!j.ok) { listEl.innerHTML = '<p class="im-empty">历史加载失败</p>'; return; }
    lastSeq = j.last_seq || 0;
    // 未读分割线（UI v2）：首个「比我已读位新」的他人消息前插线
    const unreadFrom = conv.unread > 0 ? (conv.last_read_seq || 0) + 1 : null;
    let dividerPlaced = false;
    for (const row of j.messages) {
      if (unreadFrom !== null && !dividerPlaced && row.type !== 'system'
        && row.sender_id !== ctx.me.uid && row.seq >= unreadFrom) {
        listEl.insertAdjacentHTML('beforeend', '<div class="im-unreadline">未读消息</div>');
        dividerPlaced = true;
      }
      await appendRow(row, { scroll: false });
    }
    scrollBottom();
    markRead(lastSeq);
  }

  async function loadMembers() {
    const j = await GET(`/api/convs/${conv.id}/members`);
    if (!j.ok) return;
    members = new Map(j.members.map((m) => [m.uid, m]));
    myRole = j.my_role || 'member';
    if (j.name && conv.name !== j.name) {
      conv.name = j.name;
      bodyEl.querySelector('#chat-title').textContent = j.name;
    }
    renderSub();
    ctx.renderSide();
  }

  async function loadBlockState() {
    const bj = await GET('/api/blocks').catch(() => ({ ok: false }));
    blocked = !!(bj.ok && (bj.blocks || []).includes(peer.uid));
  }

  /** 全局在线（P1 登录即在线）：dm 查对方，群查全员；与房间 onlineSet 并集展示（服务端按好友/同会话过滤） */
  async function loadPresence() {
    const uids = isGroup ? [...members.keys()] : [peer.uid];
    if (!uids.length) return;
    const j = await GET('/api/presence?uids=' + uids.join(',')).catch(() => null);
    if (!j || !j.ok) return;
    presenceSet.clear();
    for (const u of Object.keys(j.online || {})) presenceSet.add(Number(u));
    presenceKnown = true;
    renderSub();
  }

  function memberName(uid) {
    if (uid === peer.uid) return peer.display_name;
    const m = members.get(uid);
    return m ? m.display_name : 'UID ' + uid;
  }

  function memberColor(uid) {
    if (uid === peer.uid) return peer.avatar_color;
    const m = members.get(uid);
    return (m && m.avatar_color) ?? (uid % 8);
  }

  /* ---------- WS ---------- */

  function connect() {
    wsHandle = connectConv(conv.id, {
      onOpen: () => { /* hello 帧带在线名单；离线缺口由 hello 前的 lastSeq 对齐 */ gapPull(); },
      onClose: () => { onlineKnown = false; renderSub(); },
      onFrame,
    });
  }

  function onFrame(f) {
    // 串行处理防乱序（解密 await 间可能插队）
    inbox = inbox.then(() => handleFrame(f)).catch((e) => console.error('im frame:', e));
  }

  async function handleFrame(f) {
    if (f.t === 'hello') {
      onlineSet.clear();
      (Array.isArray(f.online) ? f.online : []).forEach((u) => onlineSet.add(u));
      onlineKnown = true;
      renderSub();
      return;
    }
    if (f.t === 'join') { onlineSet.add(f.uid); onlineKnown = true; renderSub(); return; }
    if (f.t === 'leave') { onlineSet.delete(f.uid); renderSub(); return; }
    if (f.t === 'typing') { markTypist(f.uid); return; }
    if (f.t === 'read') { // 已读回执（UI v2）：对方读到了 → 己方气泡 ✓ 翻 ✓✓
      if (!isGroup && f.uid === peer.uid) {
        peerLastRead = Math.max(peerLastRead, Number(f.seq) || 0);
        updateTicks();
      }
      return;
    }
    if (f.t === 'err') {
      const el = pending.get(f.tag);
      if (el) {
        pending.delete(f.tag);
        el.querySelector('.im-bubble').classList.add('fail');
        el.querySelector('.im-meta').innerHTML = `<span>${esc({
          rate: '发送太快，稍后再试', blocked: '无法送达', too_long: '消息过长', retry: '发送失败',
        }[f.error] || '发送失败')}</span><span class="tick-err">${icon('x', 13)}</span>`;
      }
      return;
    }
    if (f.t === 'kicked') { // 被移出/退群/解散：DO 对本连接发 kicked 后 close(4003)（ws.js 不重连）
      if (kickedDone) return;
      kickedDone = true;
      alert(f.why === 'disbanded' ? '该群聊已解散' : '你已被移出群聊');
      ctx.refreshConvs();
      ctx.showHome();
      return;
    }
    if (f.t === 'rekey') { // 有人重钥：弃缓存换新信封（旧版消息仍按 blob 版本可解）
      ctx.clearConvKeys(conv.id);
      keyInfo = await ctx.ensureConvKeys(conv).catch(() => null);
      return;
    }
    if (f.t === 'rename') {
      conv.name = f.name;
      bodyEl.querySelector('#chat-title').textContent = f.name;
      ctx.renderSide();
      if (infoOpen) renderGroupInfo(infoEl, groupCtl);
      await gapPull(); // 改名系统消息入流
      return;
    }
    if (f.t === 'members') {
      await loadMembers();
      if (Array.isArray(f.remove) && f.remove.length && myRole === 'owner' && !rekeyBusy) {
        // 他人退群 → 群主自动补钥（退群者带不走新钥；v1.3 交底见方案文档）
        rekeyBusy = true;
        try {
          await ctx.rekeyGroup(conv);
          keyInfo = await ctx.ensureConvKeys(conv).catch(() => null);
        } finally { rekeyBusy = false; }
      }
      if (infoOpen) renderGroupInfo(infoEl, groupCtl);
      await gapPull(); // 成员变更系统消息入流
      return;
    }
    if (f.t === 'msg' && f.conv === conv.id) {
      const el = pending.get(f.tag);
      if (el) { // 发送确认（tag 回显）
        pending.delete(f.tag);
        seenSeq.add(f.seq);
        lastSeq = Math.max(lastSeq, f.seq);
        el.dataset.seq = f.seq;
        el.querySelector('.im-meta').innerHTML =
          `<span>${esc(fmtTime(f.at || new Date()))}</span>${tickHtml('ok', f.seq)}`;
        scrollBottom();
      } else if (!seenSeq.has(f.seq)) {
        if (f.seq > lastSeq + 1) await gapPull();          // 缺口 → 整段补拉（含本帧）
        else await appendRow({ seq: f.seq, sender_id: f.uid, type: 'text', body: f.body, created_at: f.at });
        if (f.uid !== ctx.me.uid) markRead(f.seq);
      }
      ctx.onConvActivity(conv.id, { seq: f.seq, body: f.body, sender_id: f.uid, created_at: f.at });
    }
  }

  /** 断线补拉：?after_seq=lastSeq 循环拉到追平（不丢不重靠 seq 去重，方案 §5/§9） */
  async function gapPull() {
    if (!lastSeq && seenSeq.size) return; // 尚无基准（历史未加载完）时不盲拉
    for (let guard = 0; guard < 20; guard++) {
      const j = await GET(`/api/convs/${conv.id}/messages?after_seq=${lastSeq}&limit=100`);
      if (!j.ok || !j.messages.length) break;
      for (const row of j.messages) await appendRow(row, { scroll: false });
      if (j.messages.length < 100) break;
    }
    scrollBottom();
  }

  /* ---------- 渲染 ---------- */

  async function appendRow(row, opts = {}) {
    if (seenSeq.has(row.seq)) return;
    seenSeq.add(row.seq);
    lastSeq = Math.max(lastSeq, row.seq);
    let text = row.body;
    if (row.type === 'text') {
      text = null;
      if (canCrypt) {
        try { text = (await ctx.decryptRow(conv, row.sender_id, row.body)).text; } catch { text = null; }
      }
    }
    ensureDay(row.created_at);
    listEl.insertAdjacentHTML('beforeend', bubbleHtml(row, text, 'ok'));
    if (opts.scroll !== false) scrollBottom();
  }

  function ensureDay(t) {
    const label = fmtDayLabel(t);
    if (label !== lastDayLabel) {
      lastDayLabel = label;
      listEl.insertAdjacentHTML('beforeend', `<div class="im-daysep"><span>${esc(label)}</span></div>`);
    }
  }

  /** 回执图标（UI v2）：发出中 🕐 / 失败 ✕ / 1v1 己方 ✓→✓✓（群聊不渲染回执） */
  function tickHtml(state, seq) {
    if (state === 'sending') return icon('clock', 13);
    if (state === 'fail') return `<span class="tick-err">${icon('x', 13)}</span>`;
    if (!isGroup && seq && seq <= peerLastRead) return `<span class="tick-read">${icon('checks', 14)}</span>`;
    return isGroup ? '' : icon('check', 13);
  }

  function bubbleHtml(row, text, state) {
    if (row.type === 'system') { // 系统事件：居中细字条（服务器生成的明文通知）
      return `<div class="im-sysrow"${row.seq ? ` data-seq="${row.seq}"` : ''}><span class="im-sys">${esc(text || '')}</span></div>`;
    }
    const mine = row.sender_id === ctx.me.uid;
    const inner = text === null ? '<span class="im-cant">[无法解密的消息]</span>' : esc(text).replace(/\n/g, '<br>');
    const timeText = state === 'sending' ? fmtTime(new Date()) : fmtTime(row.created_at);
    // 回执只在己方气泡上（收到的消息只显示时间）
    const meta = `<span class="im-meta"><span>${esc(timeText)}</span>${mine ? tickHtml(state, row.seq || 0) : ''}</span>`;
    const bubble = `<div class="im-bubble${state === 'failed' ? ' fail' : ''}">${inner}${meta}</div>`;
    const showAv = isGroup && !mine;
    const av = showAv ? `<span class="im-mav">${avatarHtml(memberName(row.sender_id), memberColor(row.sender_id), 26)}</span>` : '';
    const senderLine = showAv
      ? `<div class="im-sender" style="color:${senderColor(memberColor(row.sender_id))}">${esc(memberName(row.sender_id))}</div>` : '';
    const body = mine ? bubble : `<div class="im-bwrap">${senderLine}${bubble}</div>`;
    return `<div class="im-msgrow ${mine ? 'mine' : `theirs${isGroup ? ' grp' : ''}`}" ${row.tag ? `data-tag="${esc(row.tag)}"` : ''}${row.seq ? ` data-seq="${row.seq}"` : ''} data-time="${esc(timeText)}">
      ${av}${body}
    </div>`;
  }

  /** 对方已读位推进 → 重绘全部己方气泡回执 */
  function updateTicks() {
    if (isGroup) return;
    listEl.querySelectorAll('.im-msgrow.mine[data-seq]').forEach((el) => {
      const meta = el.querySelector('.im-meta');
      if (meta) meta.innerHTML = `<span>${esc(el.dataset.time || '')}</span>${tickHtml('ok', Number(el.dataset.seq))}`;
    });
  }

  function scrollBottom() {
    const body = listEl.parentElement;
    body.scrollTop = body.scrollHeight;
  }

  /** 头部副标：typing 优先，否则在线/离线/人数 */
  function renderSub() {
    const names = [...typists.keys()].map(memberName);
    if (names.length) {
      subEl.textContent = `${names.join('、')} 正在输入…`;
      subEl.classList.add('live');
      return;
    }
    subEl.classList.remove('live');
    if (isGroup) {
      const onlineN = new Set([...onlineSet, ...presenceSet]).size;
      subEl.textContent = (onlineKnown || presenceKnown)
        ? `${members.size || '…'} 人 · ${onlineN} 在线`
        : `${members.size || '…'} 人`;
      return;
    }
    const on = onlineSet.has(peer.uid) || presenceSet.has(peer.uid);
    subEl.textContent = (!onlineKnown && !presenceKnown) ? '重连中…' : (on ? '在线' : '离线');
  }

  function markTypist(uid) {
    if (uid === ctx.me.uid) return;
    clearTimeout(typists.get(uid));
    typists.set(uid, setTimeout(() => { typists.delete(uid); renderSub(); }, 3000));
    renderSub();
  }

  /* ---------- 发送 ---------- */

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textEl.value.replace(/\s+$/, '');
    if (!text || !canCrypt) return;
    if (utf8Len(text) > PLAIN_MAX_BYTES) { alert('消息过长（UTF-8 超 1400 字节）'); return; }
    sendText(text);
    textEl.value = '';
    textEl.style.height = 'auto';
    sendBtn.disabled = true;
  });

  async function sendText(text) {
    const tag = crypto.randomUUID();
    try {
      const body = await ctx.crypto.encryptMessage(keyInfo.byVersion.get(keyInfo.latest), {
        convId: conv.id, senderUid: ctx.me.uid, keyVersion: keyInfo.latest, text,
      });
      ensureDay(new Date());
      listEl.insertAdjacentHTML('beforeend', bubbleHtml(
        { seq: 0, sender_id: ctx.me.uid, type: 'text', body, created_at: new Date(), tag }, text, 'sending'));
      pending.set(tag, listEl.lastElementChild);
      scrollBottom();
      wsHandle.send({ t: 'msg', tag, body });
    } catch (err) {
      console.error('im encrypt failed:', err);
      alert('加密失败，请重试');
    }
  }

  // Enter 发送 / Shift+Enter 换行（业主反馈 2）
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  textEl.addEventListener('input', () => {
    sendBtn.disabled = !canCrypt || !textEl.value.trim();
    const now = Date.now();
    if (now - lastTypingSent > 2000) { lastTypingSent = now; if (wsHandle) wsHandle.send({ t: 'typing' }); }
    textEl.style.height = 'auto';
    textEl.style.height = Math.min(96, textEl.scrollHeight) + 'px';
  });

  /* ---------- 信息抽屉（dm 资料 / 群信息） ---------- */

  const groupCtl = {
    conv,
    ctx,
    members: () => members,
    myRole: () => myRole,
    onChanged: async () => { // 变更成功后双保险：帧也会推 members（幂等）
      await loadMembers();
      if (infoOpen) renderGroupInfo(infoEl, groupCtl);
      keyInfo = await ctx.ensureConvKeys(conv).catch(() => null);
      gapPull();
    },
    actions: {}, // boot 后填（rename/leave/disband/report 定义在下方）
  };

  function openInfo() {
    infoOpen = true;
    infoEl.hidden = false;
    if (isGroup) renderGroupInfo(infoEl, groupCtl);
    else renderDmInfo();
  }

  function closeInfo() {
    infoOpen = false;
    infoEl.hidden = true;
    infoEl.innerHTML = '';
  }

  async function renderDmInfo() {
    // 业主反馈 4/6：安全数字等底层细节不外显，用户只须知「端到端加密」；UID 无检索用途故隐藏
    infoEl.innerHTML = `
      <div class="im-info-top">联系信息
        <button class="im-ibtn im-info-close" id="info-close" title="关闭">${icon('x', 20)}</button>
      </div>
      <div class="im-info-head">
        ${avatarHtml(title, titleColor, 96)}
        <h3>${esc(title)}</h3>
        <p>${esc(peer.bio || '')}</p>
      </div>
      <div class="im-info-sec">${icon('shield', 16)}
        <span class="im-hint" style="display:inline;vertical-align:2px">此聊天中的消息经端到端加密，服务器只递信，不看信。</span>
      </div>
      <div class="im-info-acts">
        <button class="im-act" data-act="block">${icon('ban', 18)} ${blocked ? '取消拉黑' : '拉黑对方'}</button>
        <button class="im-act warn" data-act="del">${icon('trash', 18)} 删除好友</button>
        <button class="im-act warn" data-act="report">${icon('flag', 18)} 举报</button>
      </div>`;
    infoEl.querySelector('#info-close').addEventListener('click', closeInfo);
    infoEl.querySelectorAll('.im-act').forEach((b) => {
      b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'block') await toggleBlock();
        if (act === 'del') await deleteFriend();
        if (act === 'report') reportConv();
        if (infoOpen && act === 'block') renderDmInfo(); // 拉黑态变更后刷新抽屉文案
      });
    });
  }

  /* ---------- 头部菜单与动作（菜单/抽屉共用） ---------- */

  async function toggleBlock() {
    if (!blocked) {
      if (!confirm(`拉黑「${peer.display_name}」？对方将无法给你发申请与消息。`)) return;
      await PUT(`/api/blocks/${peer.uid}`);
    } else {
      await DEL(`/api/blocks/${peer.uid}`);
    }
    blocked = !blocked;
    buildMenu();
  }

  async function deleteFriend() {
    if (!confirm(`删除好友「${peer.display_name}」？会话与聊天记录保留。`)) return;
    const r = await DEL(`/api/friends/${peer.uid}`);
    if (r.ok) ctx.onFriendRemoved();
    else alert('操作失败（' + r.error + '）');
  }

  /** 举报本会话（M4，方案 §6/§8）：整段 seq 区间 + 说明；明文不出端，站长只收说明 */
  async function reportConv() {
    const reason = prompt('举报说明（1-200 字）。\n聊天内容端到端加密，站长无法查看——请尽量描述问题（骚扰、诈骗、违规内容等）。');
    if (reason === null) return;
    const r = await POST('/api/reports', { conversation_id: conv.id, seq_from: 0, seq_to: lastSeq, reason: reason.trim() });
    if (r.ok) { alert('已收到举报，感谢反馈。'); return; }
    alert({
      rate: '举报太频繁，请稍后再试',
      reason: '请填写 1-200 字的举报说明',
      not_found: '会话不存在或你已不在其中',
    }[r.error] || '举报失败（' + r.error + '）');
  }

  async function renameGroup() {
    const name = prompt('新的群名（1-30 字）', conv.name || '');
    if (name === null) return;
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || n.length > NAME_MAX) { alert('群名需 1-30 字'); return; }
    const r = await PATCH(`/api/convs/${conv.id}`, { name: n });
    if (!r.ok) {
      alert({ name: '群名需 1-30 字', forbidden: '仅群主可以修改群名', rate: '操作太频繁，稍后再试' }[r.error] || '修改失败（' + r.error + '）');
      return;
    }
    conv.name = n;
    bodyEl.querySelector('#chat-title').textContent = n;
    ctx.renderSide();
    if (infoOpen) renderGroupInfo(infoEl, groupCtl);
    gapPull(); // 改名系统消息入流（rename 帧也会补一次，幂等）
  }

  async function disbandGroup() {
    if (!confirm(`解散「${conv.name}」？全部成员将被移出，此操作不可恢复。`)) return;
    const r = await DEL(`/api/convs/${conv.id}`);
    if (!r.ok) { alert('操作失败（' + r.error + '）'); return; }
    kickedDone = true; // 服务端 kicked(disbanded) 帧随后到，吞掉防二次弹窗
    ctx.refreshConvs();
    ctx.showHome();
  }

  async function leaveGroup() {
    if (!confirm(`退出「${conv.name}」？退出后无法回看后续消息，需群主重新邀请才能回来。`)) return;
    const r = await DEL(`/api/convs/${conv.id}`);
    if (!r.ok) { alert('操作失败（' + r.error + '）'); return; }
    kickedDone = true; // 本地已收尾，吞掉自己的 kicked(left) 帧
    ctx.refreshConvs();
    ctx.showHome();
  }

  groupCtl.actions = { rename: renameGroup, leave: leaveGroup, disband: disbandGroup, report: reportConv, close: closeInfo };

  function buildMenu() {
    if (isGroup) {
      const owner = myRole === 'owner';
      menuEl.innerHTML = `
        <button data-act="info">${icon('info', 16)} 群信息</button>
        ${owner ? `<button data-act="rename">${icon('edit', 16)} 修改群名</button>` : ''}
        <button data-act="report">${icon('flag', 16)} 举报</button>
        ${owner
          ? `<button data-act="disband" class="warn">${icon('trash', 16)} 解散群聊</button>`
          : `<button data-act="leave" class="warn">${icon('logout', 16)} 退出群聊</button>`}`;
    } else {
      menuEl.innerHTML = `
        <button data-act="info">${icon('info', 16)} 联系信息</button>
        <button data-act="block">${icon('ban', 16)} ${blocked ? '取消拉黑' : '拉黑对方'}</button>
        <button data-act="report">${icon('flag', 16)} 举报</button>
        <button data-act="del" class="warn">${icon('trash', 16)} 删除好友</button>`;
    }
    menuEl.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', async () => {
        menuEl.hidden = true;
        const act = b.dataset.act;
        if (act === 'info') openInfo();
        if (act === 'rename') renameGroup();
        if (act === 'disband') disbandGroup();
        if (act === 'leave') leaveGroup();
        if (act === 'report') reportConv();
        if (act === 'block') { await toggleBlock(); if (infoOpen) renderDmInfo(); }
        if (act === 'del') deleteFriend();
      });
    });
  }

  bodyEl.querySelector('#chat-info-btn').addEventListener('click', () => { menuEl.hidden = true; infoOpen ? closeInfo() : openInfo(); });
  bodyEl.querySelector('#chat-menu-btn').addEventListener('click', () => { menuEl.hidden = !menuEl.hidden; });
  bodyEl.querySelector('#chat-back').addEventListener('click', () => {
    if (infoOpen) closeInfo();
    else ctx.showHome();
  });

  /* ---------- 已读 ---------- */

  async function markRead(seq) {
    if (!seq) return;
    POST(`/api/convs/${conv.id}/read`, { seq }).then(() => ctx.onConvRead(conv.id, seq)).catch(() => {});
  }

  /* ---------- 生命周期 ---------- */

  return {
    close() {
      closed = true;
      for (const t of typists.values()) clearTimeout(t);
      typists.clear();
      if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
      if (wsHandle) wsHandle.close();
    },
  };
}
