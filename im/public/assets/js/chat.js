/**
 * 焰境密语 — 聊天窗（M2：1v1）
 * 历史分页解密 → WS 实时收发（tag 确认/去重 + 缺口补拉）→ 已读上报 → typing/在线。
 * 明文一律 esc 渲染；发送前 UTF-8 字节预检（密文 b64 存库 ≤2000）。
 */

import { connectConv } from './ws.js';
import { GET, POST, PUT, DEL } from './api.js';
import { esc, avatarHtml, fingerprint, fmtTime, fmtDayLabel, utf8Len } from './ui.js';

const PLAIN_MAX_BYTES = 1400;  // 密文 b64 ≤2000 的安全线（理论明文上限 1471B，方案 §3.3）

export function openChat(root, ctx, conv) {
  const peer = conv.peer || { uid: 0, display_name: conv.name || '会话', avatar_color: 0 };
  const bodyEl = root;
  let keyInfo = null;
  let canCrypt = false;

  let wsHandle = null;
  let closed = false;
  let lastSeq = 0;
  let lastDayLabel = '';
  const seenSeq = new Set();
  const pending = new Map();  // tag → 待确认气泡
  let inbox = Promise.resolve();
  let peerTypingTimer = null;
  let lastTypingSent = 0;
  let blocked = false;

  bodyEl.innerHTML = `
    <div class="im-chat">
      <div class="im-chat-head">
        <button class="im-back" id="chat-back" title="返回">‹</button>
        ${avatarHtml(peer.display_name, peer.avatar_color, 38)}
        <div class="im-chat-who">
          <b>${esc(peer.display_name)}</b>
          <span class="im-online" id="chat-online"><i class="off"></i><em>连接中…</em></span>
        </div>
        <code class="im-fp" id="chat-fp"></code>
        <button class="im-minibtn" id="chat-menu-btn">⋯</button>
        <div class="im-menu" id="chat-menu" hidden></div>
      </div>
      <div class="im-chat-body" id="chat-body"></div>
      <div class="im-typing" id="chat-typing" hidden>${esc(peer.display_name)} 正在输入…</div>
      <form class="im-chat-input" id="chat-form">
        <textarea id="chat-text" rows="1" placeholder="加载中…"></textarea>
        <button class="im-primary" id="chat-send" type="submit" disabled>发送</button>
      </form>
    </div>`;

  const listEl = bodyEl.querySelector('#chat-body');
  const textEl = bodyEl.querySelector('#chat-text');
  const sendBtn = bodyEl.querySelector('#chat-send');
  const onlineEl = bodyEl.querySelector('#chat-online');
  const menuEl = bodyEl.querySelector('#chat-menu');

  /* ---------- 启动 ---------- */

  (async function boot() {
    fingerprint(peer.pub_key || '').then((fp) => {
      bodyEl.querySelector('#chat-fp').textContent = peer.pub_key ? fp : '';
    }).catch(() => {});

    try { keyInfo = await ctx.ensureConvKey(conv); } catch { keyInfo = null; }
    canCrypt = !!(keyInfo && ctx.identity);
    textEl.placeholder = canCrypt ? '输入消息（端到端加密）…' : '本机未解锁密钥，无法收发——退出后重新登录可恢复';
    textEl.disabled = !canCrypt;
    sendBtn.disabled = !canCrypt;

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

  /* ---------- WS ---------- */

  function connect() {
    wsHandle = connectConv(conv.id, {
      onOpen: () => { /* hello 帧带在线名单；离线缺口由 hello 前的 lastSeq 对齐 */ gapPull(); },
      onClose: () => setOnline(null),
      onFrame,
    });
  }

  function onFrame(f) {
    // 串行处理防乱序（解密 await 间可能插队）
    inbox = inbox.then(() => handleFrame(f)).catch((e) => console.error('im frame:', e));
  }

  async function handleFrame(f) {
    if (f.t === 'hello') { setOnline(Array.isArray(f.online) && f.online.includes(peer.uid)); return; }
    if (f.t === 'join') { if (f.uid === peer.uid) setOnline(true); return; }
    if (f.t === 'leave') { if (f.uid === peer.uid) setOnline(false); return; }
    if (f.t === 'typing') { if (f.uid === peer.uid) showPeerTyping(); return; }
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
    const mine = row.sender_id === ctx.me.uid;
    const inner = row.type === 'system'
      ? `<span class="im-sys">${esc(text || '')}</span>`
      : (text === null ? '<span class="im-cant">[无法解密的消息]</span>' : esc(text).replace(/\n/g, '<br>'));
    const meta = state === 'sending' ? '发送中…' : fmtTime(row.created_at);
    return `<div class="im-msgrow ${mine ? 'mine' : 'theirs'}" ${row.tag ? `data-tag="${esc(row.tag)}"` : ''}${row.seq ? ` data-seq="${row.seq}"` : ''}>
      <div class="im-bubble${state === 'failed' ? ' fail' : ''}">${inner}</div>
      <div class="im-msgmeta">${meta}</div>
    </div>`;
  }

  function scrollBottom() {
    listEl.scrollTop = listEl.scrollHeight;
  }

  function setOnline(state) { // true/false/null(未知-重连中)
    const dot = onlineEl.querySelector('i');
    const txt = onlineEl.querySelector('em');
    dot.className = state === null ? 'off' : (state ? 'on' : 'off');
    txt.textContent = state === null ? '重连中…' : (state ? '在线' : '离线');
  }

  function showPeerTyping() {
    const t = bodyEl.querySelector('#chat-typing');
    t.hidden = false;
    clearTimeout(peerTypingTimer);
    peerTypingTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  /* ---------- 发送 ---------- */

  bodyEl.querySelector('#chat-form').addEventListener('submit', (e) => {
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
      const body = await ctx.crypto.encryptMessage(keyInfo.key, {
        convId: conv.id, senderUid: ctx.me.uid, keyVersion: keyInfo.version, text,
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

  /* ---------- 头部操作（拉黑/删除好友） ---------- */

  async function buildMenu() {
    const bj = await GET('/api/blocks').catch(() => ({ ok: false }));
    blocked = !!(bj.ok && (bj.blocks || []).includes(peer.uid));
    menuEl.innerHTML = `
      <button data-act="block">${blocked ? '取消拉黑' : '拉黑对方'}</button>
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
        if (b.dataset.act === 'del') {
          if (!confirm(`删除好友「${peer.display_name}」？会话与聊天记录保留。`)) return;
          const r = await DEL(`/api/friends/${peer.uid}`);
          if (r.ok) ctx.onFriendRemoved();
          else alert('操作失败（' + r.error + '）');
        }
      });
    });
  }

  bodyEl.querySelector('#chat-menu-btn').addEventListener('click', () => { menuEl.hidden = !menuEl.hidden; });
  bodyEl.querySelector('#chat-back').addEventListener('click', () => ctx.showHome());

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
      if (wsHandle) wsHandle.close();
    },
  };
}
