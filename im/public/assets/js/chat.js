/**
 * 焰境密语 — 聊天窗（M2：1v1；M3：群组）
 * 历史分页解密 → WS 实时收发（tag 确认/去重 + 缺口补拉）→ 已读上报 → typing/在线。
 * 群组（M3）：发送者名标注、系统消息居中条、成员面板（拉人/移出，members.js）、
 * 改名/退群/解散、成员变更/重钥/改名/被移出帧（members/rekey/rename/kicked）。
 * 明文一律 esc 渲染；发送前 UTF-8 字节预检（密文 b64 存库 ≤2000）。
 */

import { connectConv } from './ws.js';
import { GET, POST, PUT, DEL, PATCH } from './api.js';
import { esc, avatarHtml, fingerprint, safetyNumber, fmtTime, fmtDayLabel, utf8Len } from './ui.js';
import { renderMembersPanel } from './members.js';

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
  let peerTypingTimer = null;
  const typists = new Map();  // uid → 过期定时器（群组多人 typing）
  let lastTypingSent = 0;

  // 在线与成员（dm / 群组共用 onlineSet；群组另持成员表供发送者名与管理操作）
  const onlineSet = new Set();
  let onlineKnown = false;
  let members = new Map();
  let myRole = 'member';
  let membersPanel = false;
  let kickedDone = false;
  let rekeyBusy = false;
  let blocked = false;        // dm：是否已拉黑（M4 顺修：原未声明，严格模式下赋值抛 ReferenceError，菜单按钮渲染不出）

  bodyEl.innerHTML = `
    <div class="im-chat">
      <div class="im-chat-head">
        <button class="im-back" id="chat-back" title="返回">‹</button>
        ${avatarHtml(title, titleColor, 38)}
        <div class="im-chat-who">
          <b id="chat-title">${esc(title)}</b>
          <span class="im-online" id="chat-online"><i class="off"></i><em>连接中…</em></span>
        </div>
        <code class="im-fp" id="chat-fp"${isGroup ? ' hidden' : ''}></code>
        <button class="im-minibtn" id="chat-menu-btn">⋯</button>
        <div class="im-menu" id="chat-menu" hidden></div>
      </div>
      <div class="im-chat-body" id="chat-body"></div>
      <div class="im-members" id="chat-members" hidden></div>
      <div class="im-typing" id="chat-typing" hidden></div>
      <form class="im-chat-input" id="chat-form">
        <textarea id="chat-text" rows="1" placeholder="加载中…"></textarea>
        <button class="im-primary" id="chat-send" type="submit" disabled>发送</button>
      </form>
    </div>`;

  const listEl = bodyEl.querySelector('#chat-body');
  const panelBox = bodyEl.querySelector('#chat-members');
  const typingEl = bodyEl.querySelector('#chat-typing');
  const formEl = bodyEl.querySelector('#chat-form');
  const textEl = bodyEl.querySelector('#chat-text');
  const sendBtn = bodyEl.querySelector('#chat-send');
  const onlineEl = bodyEl.querySelector('#chat-online');
  const menuEl = bodyEl.querySelector('#chat-menu');

  /* ---------- 启动 ---------- */

  (async function boot() {
    if (!isGroup && peer.pub_key) {
      // 安全数字（M4）：双方公钥联合指纹，两端一致即可信（替代 M2 单侧指纹展示）
      safetyNumber(ctx.me.pub_key || '', peer.pub_key).then((sn) => {
        const el = bodyEl.querySelector('#chat-fp');
        el.textContent = sn;
        el.title = '安全数字：双方公钥的联合指纹。与对方当面/另行核对一致，即可确认没有中间人。';
      }).catch(() => {});
    }
    try { keyInfo = await ctx.ensureConvKeys(conv); } catch { keyInfo = null; }
    canCrypt = !!(keyInfo && ctx.identity);
    textEl.placeholder = canCrypt ? '输入消息（端到端加密）…' : '本机未解锁密钥，无法收发——退出后重新登录可恢复';
    textEl.disabled = !canCrypt;
    sendBtn.disabled = !canCrypt;

    if (isGroup) await loadMembers(); // 先取成员表：历史渲染需要发送者名
    await loadHistory();
    connect();
    buildMenu();
  })();

  async function loadHistory() {
    listEl.innerHTML = '<p class="im-empty">加载中…</p>';
    const j = await GET(`/api/convs/${conv.id}/messages?limit=50`);
    listEl.innerHTML = '';
    if (!j.ok) { listEl.innerHTML = '<p class="im-empty">历史加载失败</p>'; return; }
    lastSeq = j.last_seq || 0;
    for (const row of j.messages) await appendRow(row, { scroll: false });
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
    setOnlineUI(onlineKnown);
    ctx.renderSide();
  }

  function memberName(uid) {
    const m = members.get(uid);
    return m ? m.display_name : 'UID ' + uid;
  }

  /* ---------- WS ---------- */

  function connect() {
    wsHandle = connectConv(conv.id, {
      onOpen: () => { /* hello 帧带在线名单；离线缺口由 hello 前的 lastSeq 对齐 */ gapPull(); },
      onClose: () => setOnlineUI(false),
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
      setOnlineUI(true);
      return;
    }
    if (f.t === 'join') { onlineSet.add(f.uid); setOnlineUI(true); return; }
    if (f.t === 'leave') { onlineSet.delete(f.uid); setOnlineUI(true); return; }
    if (f.t === 'typing') {
      if (isGroup) markTypist(f.uid);
      else if (f.uid === peer.uid) showPeerTyping();
      return;
    }
    if (f.t === 'err') {
      const el = pending.get(f.tag);
      if (el) {
        pending.delete(f.tag);
        el.querySelector('.im-bubble').classList.add('fail');
        el.querySelector('.im-msgmeta').textContent = ({
          rate: '发送太快，稍后再试', blocked: '无法送达', too_long: '消息过长', retry: '发送失败',
        }[f.error] || '发送失败');
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
      if (membersPanel) renderMembersPanel(panelBox, panelCtl);
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
        el.querySelector('.im-msgmeta').textContent = fmtTime(f.at || new Date());
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
      listEl.insertAdjacentHTML('beforeend', `<div class="im-daysep">${esc(label)}</div>`);
    }
  }

  function bubbleHtml(row, text, state) {
    if (row.type === 'system') { // 系统事件：居中细字条（服务器生成的明文通知）
      return `<div class="im-sysrow"${row.seq ? ` data-seq="${row.seq}"` : ''}><span class="im-sys">${esc(text || '')}</span></div>`;
    }
    const mine = row.sender_id === ctx.me.uid;
    const inner = text === null ? '<span class="im-cant">[无法解密的消息]</span>' : esc(text).replace(/\n/g, '<br>');
    const senderLine = isGroup && !mine ? `<div class="im-sender">${esc(memberName(row.sender_id))}</div>` : '';
    const meta = state === 'sending' ? '发送中…' : fmtTime(row.created_at);
    return `<div class="im-msgrow ${mine ? 'mine' : 'theirs'}" ${row.tag ? `data-tag="${esc(row.tag)}"` : ''}${row.seq ? ` data-seq="${row.seq}"` : ''}>
      ${senderLine}
      <div class="im-bubble${state === 'failed' ? ' fail' : ''}">${inner}</div>
      <div class="im-msgmeta">${meta}</div>
    </div>`;
  }

  function scrollBottom() {
    listEl.scrollTop = listEl.scrollHeight;
  }

  function setOnlineUI(known) {
    onlineKnown = known;
    const dot = onlineEl.querySelector('i');
    const txt = onlineEl.querySelector('em');
    if (isGroup) {
      dot.className = 'on';
      txt.textContent = known ? `${members.size} 人 · ${onlineSet.size} 在线` : `${members.size || '…'} 人`;
      return;
    }
    const on = onlineSet.has(peer.uid);
    dot.className = !known ? 'off' : (on ? 'on' : 'off');
    txt.textContent = !known ? '重连中…' : (on ? '在线' : '离线');
  }

  function showPeerTyping() {
    typingEl.hidden = false;
    typingEl.textContent = `${peer.display_name} 正在输入…`;
    clearTimeout(peerTypingTimer);
    peerTypingTimer = setTimeout(() => { typingEl.hidden = true; }, 3000);
  }

  function markTypist(uid) {
    if (uid === ctx.me.uid) return;
    clearTimeout(typists.get(uid));
    typists.set(uid, setTimeout(() => { typists.delete(uid); renderTypists(); }, 3000));
    renderTypists();
  }

  function renderTypists() {
    const names = [...typists.keys()].map(memberName);
    typingEl.hidden = !names.length;
    typingEl.textContent = names.length ? `${names.join('、')} 正在输入…` : '';
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

  textEl.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTypingSent > 2000) { lastTypingSent = now; if (wsHandle) wsHandle.send({ t: 'typing' }); }
    textEl.style.height = 'auto';
    textEl.style.height = Math.min(96, textEl.scrollHeight) + 'px';
  });

  /* ---------- 群成员面板（members.js 渲染） ---------- */

  const panelCtl = {
    conv,
    ctx,
    members: () => members,
    myRole: () => myRole,
    onChanged: async () => { // 变更成功后双保险：帧也会推 members（幂等）
      await loadMembers();
      if (membersPanel) renderMembersPanel(panelBox, panelCtl);
      keyInfo = await ctx.ensureConvKeys(conv).catch(() => null);
      gapPull();
    },
  };

  function openPanel() {
    membersPanel = true;
    panelBox.hidden = false;
    listEl.style.display = 'none';
    formEl.style.display = 'none';
    typingEl.style.display = 'none';
    renderMembersPanel(panelBox, panelCtl);
  }

  function closePanel() {
    membersPanel = false;
    panelBox.hidden = true;
    listEl.style.display = '';
    formEl.style.display = '';
    typingEl.style.display = '';
  }

  /* ---------- 头部操作 ---------- */

  function buildMenu() {
    if (isGroup) {
      const owner = myRole === 'owner';
      menuEl.innerHTML = `
        <button data-act="members">群成员</button>
        ${owner ? '<button data-act="rename">修改群名</button>' : ''}
        <button data-act="report">举报</button>
        ${owner ? '<button data-act="disband" class="warn">解散群聊</button>' : '<button data-act="leave" class="warn">退出群聊</button>'}`;
      menuEl.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          menuEl.hidden = true;
          const act = b.dataset.act;
          if (act === 'members') openPanel();
          if (act === 'rename') renameGroup();
          if (act === 'disband') disbandGroup();
          if (act === 'leave') leaveGroup();
          if (act === 'report') reportConv();
        });
      });
      return;
    }
    // dm：拉黑/删除好友
    (async () => {
      const bj = await GET('/api/blocks').catch(() => ({ ok: false }));
      blocked = !!(bj.ok && (bj.blocks || []).includes(peer.uid));
      menuEl.innerHTML = `
        <button data-act="block">${blocked ? '取消拉黑' : '拉黑对方'}</button>
        <button data-act="report">举报</button>
        <button data-act="del" class="warn">删除好友</button>`;
      menuEl.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', async () => {
          menuEl.hidden = true;
          if (b.dataset.act === 'block') {
            if (!blocked) {
              if (!confirm(`拉黑「${peer.display_name}」？对方将无法给你发申请与消息。`)) return;
              await PUT(`/api/blocks/${peer.uid}`);
            } else {
              await DEL(`/api/blocks/${peer.uid}`);
            }
            buildMenu();
            return;
          }
          if (b.dataset.act === 'report') {
            reportConv();
            return;
          }
          if (b.dataset.act === 'del') {
            if (!confirm(`删除好友「${peer.display_name}」？会话与聊天记录保留。`)) return;
            const r = await DEL(`/api/friends/${peer.uid}`);
            if (r.ok) ctx.onFriendRemoved();
            else alert('操作失败（' + r.error + '）');
          }
        });
      });
    })();
  }

  /** 举报本会话（M4，方案 §6/§8）：整段 seq 区间 + 说明；明文不出端，站长只收说明（自愿附引用文 v1 未做） */
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

  bodyEl.querySelector('#chat-menu-btn').addEventListener('click', () => { menuEl.hidden = !menuEl.hidden; });
  bodyEl.querySelector('#chat-back').addEventListener('click', () => {
    if (membersPanel) closePanel();
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
      clearTimeout(peerTypingTimer);
      for (const t of typists.values()) clearTimeout(t);
      typists.clear();
      if (wsHandle) wsHandle.close();
    },
  };
}
