/**
 * 焰境密语 — 会话 API（M2：1v1 dm；M3：群组，方案 §3.2/§6/§11）
 * dm 幂等：dm_key='dm:min:max' 唯一键；信封随建会话提交（方案 §3.2），后到者经 /keys 拉先到者的；
 * 半写自愈：并发/中断后成员与信封可幂等补齐。
 * 群组：建群/拉人（信封随请求提交，服务器仍只见盲信封）；成员变动即重钥（群主出全套新信封，
 * 版本必须 = 当前最大 + 1）；system 消息由服务器生成明文（sender_id=0，成员可见事件通知）。
 * 重钥分工：拉人/踢人 = 信封随请求原子提交；退群 = 退群者无法持有新钥，由群主在线时经 /rekey 补钥
 * （群主不在线的缺口 v1 接受——退群者非对抗场景，且退群后已无成员资格拉不到新消息，方案文档 v1.3 交底）。
 */

import { ENVELOPE_MAX, GROUP_ADD_MAX, GROUP_MAX, GROUP_NAME_MAX, GROUP_RATE } from '../config.js';
import { isB64, json, limited, readJson } from '../util.js';

async function memberRow(env, convId, uid) {
  return env.DB.prepare('SELECT user_id, role, last_read_seq, min_seq FROM im_members WHERE conversation_id = ?1 AND user_id = ?2')
    .bind(convId, uid).first();
}

function parseEnvelopes(list, max) {
  if (!Array.isArray(list) || !list.length || list.length > max) return null;
  const out = [];
  const seen = new Set();
  for (const e of list) {
    const uid = Number(e && e.uid);
    const envelope = String((e && e.envelope) || '');
    if (!Number.isInteger(uid) || uid <= 0 || seen.has(uid)) return null;
    if (!envelope || envelope.length > ENVELOPE_MAX || !isB64(envelope)) return null;
    seen.add(uid);
    out.push({ uid, envelope });
  }
  return out;
}

/* ---------------- 建会话（dm 幂等） ---------------- */

export async function dmCreate(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const peerId = Number(body.peer_uid);
  if (!Number.isInteger(peerId) || peerId <= 0 || peerId === user.uid) return json({ ok: false, error: 'peer' }, 400);
  const keyVersion = Number(body.key_version || 1);
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 255) return json({ ok: false, error: 'keys' }, 400);
  const envelopes = parseEnvelopes(body.envelopes, 2);
  if (!envelopes) return json({ ok: false, error: 'keys' }, 400);

  const friend = await env.DB.prepare('SELECT 1 FROM im_friendships WHERE user_id = ?1 AND friend_id = ?2').bind(user.uid, peerId).first();
  if (!friend) return json({ ok: false, error: 'not_friends' }, 403);
  const blocked = await env.DB.prepare(
    'SELECT 1 FROM im_blocks WHERE (user_id = ?1 AND blocked_uid = ?2) OR (user_id = ?2 AND blocked_uid = ?1) LIMIT 1'
  ).bind(user.uid, peerId).first();
  if (blocked) return json({ ok: false, error: 'blocked' }, 403);

  const min = Math.min(user.uid, peerId);
  const max = Math.max(user.uid, peerId);
  const dmKey = `dm:${min}:${max}`;

  const getConv = () => env.DB.prepare(
    "SELECT id, type, dm_key, name, owner_id, created_at FROM im_conversations WHERE dm_key = ?1"
  ).bind(dmKey).first();

  let conv = await getConv();
  if (!conv) {
    try {
      const r = await env.DB.prepare("INSERT INTO im_conversations (type, dm_key) VALUES ('dm', ?1)").bind(dmKey).run();
      conv = { id: r.meta.last_row_id, type: 'dm', dm_key: dmKey, name: '', owner_id: null, created_at: null };
    } catch (err) {
      conv = await getConv(); // 并发建会话撞 UNIQUE(dm_key) → 取先到者
      if (!conv) throw err;
    }
  }

  // 成员幂等补齐（半写自愈）
  const mem = await memberRow(env, conv.id, user.uid);
  if (!mem) {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO im_members (conversation_id, user_id, role) VALUES (?1, ?2, 'member')").bind(conv.id, user.uid),
      env.DB.prepare("INSERT OR IGNORE INTO im_members (conversation_id, user_id, role) VALUES (?1, ?2, 'member')").bind(conv.id, peerId),
    ]);
  }

  // 信封先到先得：本版本一枚都没有时才写入（后建方经 /keys 拉先建方的）
  const haveKeys = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM im_conv_keys WHERE conversation_id = ?1 AND key_version = ?2'
  ).bind(conv.id, keyVersion).first();
  if (!haveKeys.n) {
    const want = new Set([user.uid, peerId]);
    const got = new Set(envelopes.map((e) => e.uid));
    if (got.size !== want.size || [...want].some((u) => !got.has(u))) return json({ ok: false, error: 'keys' }, 400);
    await env.DB.batch(envelopes.map((e) =>
      env.DB.prepare('INSERT OR IGNORE INTO im_conv_keys (conversation_id, key_version, uid, envelope) VALUES (?1, ?2, ?3, ?4)')
        .bind(conv.id, keyVersion, e.uid, e.envelope)
    ));
  }

  const peer = await env.DB.prepare('SELECT id, display_name, avatar_color FROM im_users WHERE id = ?1').bind(peerId).first();
  return json({
    ok: true,
    conv: { id: conv.id, type: 'dm', peer: { uid: peer.id, display_name: peer.display_name, avatar_color: peer.avatar_color } },
  });
}

/* ---------------- 会话列表（末条概要 + 未读数） ---------------- */

export async function convsList(env, user) {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.type, c.name, c.created_at,
            m.last_read_seq,
            (SELECT m2.last_read_seq FROM im_members m2 WHERE m2.conversation_id = c.id AND m2.user_id != ?1 LIMIT 1) AS peer_last_read,
            (SELECT COALESCE(MAX(seq), 0) FROM im_messages WHERE conversation_id = c.id) AS last_seq,
            (SELECT COUNT(*) FROM im_messages WHERE conversation_id = c.id
              AND seq > m.last_read_seq AND sender_id != ?1) AS unread,
            lm.body AS last_body, lm.sender_id AS last_sender, lm.type AS last_type, lm.created_at AS last_at
     FROM im_members m
     JOIN im_conversations c ON c.id = m.conversation_id
     LEFT JOIN im_messages lm
       ON lm.conversation_id = c.id
      AND lm.seq = (SELECT MAX(seq) FROM im_messages WHERE conversation_id = c.id)
     WHERE m.user_id = ?1
     ORDER BY last_seq DESC, c.id DESC`
  ).bind(user.uid).all();

  // dm 会话补对方信息（显示名/头像色/公钥——公钥供聊天窗指纹核验与 M3 群信封）
  const dmIds = rows.results.filter((r) => r.type === 'dm').map((r) => r.id);
  const peers = new Map();
  if (dmIds.length) {
    const ph = dmIds.map(() => '?').join(',');
    const pr = await env.DB.prepare(
      `SELECT m2.conversation_id AS conv, m2.user_id AS uid, u.display_name, u.avatar_color, u.pub_key
       FROM im_members m2 JOIN im_users u ON u.id = m2.user_id
       WHERE m2.conversation_id IN (${ph}) AND m2.user_id != ?`
    ).bind(...dmIds, user.uid).all();
    for (const p of pr.results) {
      peers.set(p.conv, { uid: p.uid, display_name: p.display_name, avatar_color: p.avatar_color, pub_key: p.pub_key });
    }
  }

  return json({
    ok: true,
    convs: rows.results.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name || '',
      peer: peers.get(r.id) || null,
      created_at: r.created_at,
      last_seq: r.last_seq,
      last_read_seq: r.last_read_seq,
      // 已读回执（UI v2）：仅 1v1 回对方已读位，群聊不做回执（对齐 WhatsApp）
      peer_last_read: r.type === 'dm' ? (r.peer_last_read || 0) : undefined,
      unread: r.unread,
      last_msg: r.last_body == null ? null : {
        seq: r.last_seq, sender_id: r.last_sender, type: r.last_type, body: r.last_body, created_at: r.last_at,
      },
    })),
  });
}

/* ---------------- 信封拉取（解出会话密钥 K） ---------------- */

export async function convKeys(env, user, convId, url) {
  if (!(await memberRow(env, convId, user.uid))) return json({ ok: false, error: 'forbidden' }, 403);
  const v = url.searchParams.get('version');
  let rows;
  if (v === null) {
    rows = await env.DB.prepare(
      'SELECT key_version, envelope FROM im_conv_keys WHERE conversation_id = ?1 AND uid = ?2 ORDER BY key_version'
    ).bind(convId, user.uid).all();
  } else {
    const version = Number(v);
    if (!Number.isInteger(version) || version < 1 || version > 255) return json({ ok: false, error: 'version' }, 400);
    rows = await env.DB.prepare(
      'SELECT key_version, envelope FROM im_conv_keys WHERE conversation_id = ?1 AND uid = ?2 AND key_version = ?3'
    ).bind(convId, user.uid, version).all();
  }
  return json({ ok: true, keys: rows.results });
}

/* ---------------- 历史分页（按 (conv, seq)） ---------------- */

export async function convMessages(env, user, convId, url) {
  const m = await memberRow(env, convId, user.uid);
  if (!m) return json({ ok: false, error: 'forbidden' }, 403);
  const q = url.searchParams;
  const after = q.get('after_seq') === null ? null : Number(q.get('after_seq'));
  const before = q.get('before_seq') === null ? null : Number(q.get('before_seq'));
  let limit = Number(q.get('limit') || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = 50;

  // min_seq=入群时点隔离（dm 恒 0；群 M3 生效）：入群时置当时 MAX(seq)，此后可见「seq > min_seq」
  // （v1.3 修正边界——原 `>=` 会把入群前最后一条也放给新成员）
  const floor = Math.max(0, Number(m.min_seq) || 0);
  let sql = 'SELECT seq, sender_id, type, body, created_at FROM im_messages WHERE conversation_id = ?1 AND seq > ?2';
  const binds = [convId, floor];
  let n = binds.length;
  if (after !== null) {
    if (!Number.isInteger(after) || after < 0) return json({ ok: false, error: 'seq' }, 400);
    sql += ` AND seq > ?${++n} ORDER BY seq ASC LIMIT ?${++n}`;
    binds.push(after, limit);
  } else if (before !== null) {
    if (!Number.isInteger(before) || before < 0) return json({ ok: false, error: 'seq' }, 400);
    sql += ` AND seq < ?${++n} ORDER BY seq DESC LIMIT ?${++n}`;
    binds.push(before, limit);
  } else {
    sql += ` ORDER BY seq DESC LIMIT ?${++n}`;
    binds.push(limit);
  }
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  const last = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM im_messages WHERE conversation_id = ?1').bind(convId).first();
  return json({ ok: true, last_seq: last.s, messages: rows.results.sort((a, b) => a.seq - b.seq) });
}

/* ---------------- 已读上报（未读基准 last_read_seq） ---------------- */

export async function convRead(request, env, user, convId) {
  const m = await memberRow(env, convId, user.uid);
  if (!m) return json({ ok: false, error: 'forbidden' }, 403);
  const body = await readJson(request);
  const seq = Number(body && body.seq);
  if (!Number.isInteger(seq) || seq < 0) return json({ ok: false, error: 'seq' }, 400);
  if (seq > (m.last_read_seq || 0)) {
    await env.DB.prepare(
      'UPDATE im_members SET last_read_seq = MAX(last_read_seq, ?2) WHERE conversation_id = ?1 AND user_id = ?3'
    ).bind(convId, seq, user.uid).run();
    // 已读回执（UI v2，改版方案 §4）：seq 真推进才经 /sys 广播 read 帧（对端 1v1 据此翻 ✓✓）
    await notifyRoom(env, convId, [], { t: 'read', uid: user.uid, seq });
  }
  return json({ ok: true });
}

/* ==================================================================
 * 群组（M3，方案 §3.2/§6/§11：群主直接拉好友制、上限 100 人、成员变动即重钥）
 * ================================================================== */

/* ---------------- 内部小件 ---------------- */

async function convRow(env, convId) {
  return env.DB.prepare('SELECT id, type, name, owner_id FROM im_conversations WHERE id = ?1').bind(convId).first();
}

async function memberIds(env, convId) {
  const r = await env.DB.prepare('SELECT user_id FROM im_members WHERE conversation_id = ?1').bind(convId).all();
  return r.results.map((x) => x.user_id);
}

async function maxKeyVersion(env, convId) {
  const r = await env.DB.prepare('SELECT COALESCE(MAX(key_version), 0) AS v FROM im_conv_keys WHERE conversation_id = ?1').bind(convId).first();
  return r.v;
}

/** 群操作合并限流（建/拉/踢/退/散/名/重钥，低频操作防刷即可） */
function groupOpLimited(uid) {
  return limited('grpop:' + uid, GROUP_RATE.windowMs, GROUP_RATE.max);
}

function cleanGroupName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > GROUP_NAME_MAX) return null;
  return s;
}

function parseUidList(list, max) {
  if (!Array.isArray(list) || !list.length || list.length > max) return null;
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const uid = Number(v);
    if (!Number.isInteger(uid) || uid <= 0 || seen.has(uid)) return null;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

/** 信封必须精确覆盖 expected 全集（缺人=有人解不开新钥；多人=给非成员发钥，均拒绝） */
function envelopeSetOk(envelopes, expectedUids) {
  const want = new Set(expectedUids);
  const got = new Set(envelopes.map((e) => e.uid));
  if (envelopes.length !== want.size || got.size !== want.size) return false;
  for (const u of want) if (!got.has(u)) return false;
  return true;
}

function writeEnvelopeBinds(env, convId, keyVersion, envelopes) {
  return envelopes.map((e) =>
    env.DB.prepare('INSERT OR IGNORE INTO im_conv_keys (conversation_id, key_version, uid, envelope) VALUES (?1, ?2, ?3, ?4)')
      .bind(convId, keyVersion, e.uid, e.envelope));
}

/** 系统消息：seq 用「单语句 MAX(seq)+1 标量子查询」分配（D1 单语句原子；与 DO 发消息共用分配器，v1.3） */
function sysMsg(env, convId, body) {
  return env.DB.prepare(
    `INSERT INTO im_messages (conversation_id, seq, sender_id, type, body)
     VALUES (?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM im_messages WHERE conversation_id = ?1), 0, 'system', ?2)`
  ).bind(convId, body);
}

/** 成员变更通知 DO：kick 名单先收 kicked 帧并断开（close 4003），frame 广播给余下在线成员 */
function notifyRoom(env, convId, kick, frame) {
  return env.ROOM.get(env.ROOM.idFromName('c' + convId))
    .fetch('https://do/sys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kick, frame }),
    })
    .catch((err) => console.error('im room notify:', err));
}

async function namesOf(env, uids) {
  const ph = uids.map(() => '?').join(',');
  const r = await env.DB.prepare(`SELECT id, display_name FROM im_users WHERE id IN (${ph})`).bind(...uids).all();
  const m = {};
  for (const row of r.results) m[row.id] = row.display_name || ('UID' + row.id);
  return m;
}

/** uids 必须全是 ownerUid 的好友，且与 ownerUid 无拉黑（任一方向）——群成员一律经群主好友圈入群（§11.1） */
async function friendsAndNotBlocked(env, ownerUid, uids) {
  // D1 单查询绑定参数上限 100（IN 出现两次的拉黑查询绑定 = 2k+2）：按 40 一块分查
  for (let i = 0; i < uids.length; i += 40) {
    const chunk = uids.slice(i, i + 40);
    const ph = chunk.map(() => '?').join(',');
    const fr = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM im_friendships WHERE user_id = ? AND friend_id IN (${ph})`
    ).bind(ownerUid, ...chunk).first();
    if (fr.n !== chunk.length) return false;
    const bl = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM im_blocks WHERE (user_id = ? AND blocked_uid IN (${ph})) OR (user_id IN (${ph}) AND blocked_uid = ?)`
    ).bind(ownerUid, ...chunk, ...chunk, ownerUid).first();
    if (bl.n) return false;
  }
  return true;
}

async function groupGuard(env, user, convId) {
  const conv = await convRow(env, convId);
  if (!conv || conv.type !== 'group') return { error: json({ ok: false, error: 'not_found' }, 404) };
  if (!(await memberRow(env, convId, user.uid))) return { error: json({ ok: false, error: 'forbidden' }, 403) };
  return { conv };
}

/* ---------------- 建群（信封随建提交，方案 §6） ---------------- */

export async function groupCreate(request, env, user) {
  if (groupOpLimited(user.uid)) return json({ ok: false, error: 'rate' }, 429);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const name = cleanGroupName(body.name);
  if (!name) return json({ ok: false, error: 'name' }, 400);
  if (Number(body.key_version) !== 1) return json({ ok: false, error: 'keys' }, 400);
  const uids = parseUidList(body.member_uids, GROUP_MAX - 1);
  if (!uids) return json({ ok: false, error: 'members' }, 400);
  const envelopes = parseEnvelopes(body.envelopes, GROUP_MAX);
  if (!envelopes) return json({ ok: false, error: 'keys' }, 400);
  if (!(await friendsAndNotBlocked(env, user.uid, uids))) return json({ ok: false, error: 'not_friends' }, 403);
  if (!envelopeSetOk(envelopes, [user.uid, ...uids])) return json({ ok: false, error: 'keys' }, 400);

  let convId;
  try {
    const r = await env.DB.prepare("INSERT INTO im_conversations (type, name, owner_id) VALUES ('group', ?1, ?2)").bind(name, user.uid).run();
    convId = r.meta.last_row_id;
  } catch (err) {
    console.error('im group create conv failed:', err);
    return json({ ok: false, error: 'retry' }, 500);
  }
  try {
    await env.DB.batch([
      ...[user.uid, ...uids].map((uid) =>
        env.DB.prepare('INSERT OR IGNORE INTO im_members (conversation_id, user_id, role) VALUES (?1, ?2, ?3)')
          .bind(convId, uid, uid === user.uid ? 'owner' : 'member')),
      ...writeEnvelopeBinds(env, convId, 1, envelopes),
      sysMsg(env, convId, `群聊「${name}」已创建`),
    ]);
  } catch (err) {
    console.error('im group create members failed:', err);
    return json({ ok: false, error: 'retry' }, 500); // 半写自愈：成员/信封可重交（本接口幂等键未做，v1 重试即重发）
  }
  return json({ ok: true, conv: { id: convId, type: 'group', name } });
}

/* ---------------- 成员列表（群聊渲染发送者名 / 群主拉人取公钥） ---------------- */

export async function membersList(env, user, convId) {
  const g = await groupGuard(env, user, convId);
  if (g.error) return g.error;
  const rows = await env.DB.prepare(
    `SELECT m.user_id AS uid, m.role, u.display_name, u.avatar_color, u.pub_key
     FROM im_members m JOIN im_users u ON u.id = m.user_id
     WHERE m.conversation_id = ?1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.joined_at, m.user_id`
  ).bind(convId).all();
  return json({
    ok: true,
    name: g.conv.name,
    owner_id: g.conv.owner_id,
    my_role: (await memberRow(env, convId, user.uid)).role,
    members: rows.results,
  });
}

/* ---------------- 拉人（群主；信封随请求对全员重钥，原子提交） ---------------- */

export async function membersAdd(request, env, user, convId) {
  if (groupOpLimited(user.uid)) return json({ ok: false, error: 'rate' }, 429);
  const g = await groupGuard(env, user, convId);
  if (g.error) return g.error;
  if (g.conv.owner_id !== user.uid) return json({ ok: false, error: 'forbidden' }, 403);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const uids = parseUidList(body.uids, GROUP_ADD_MAX);
  if (!uids) return json({ ok: false, error: 'members' }, 400);
  const keyVersion = Number(body.key_version || 0);
  const envelopes = parseEnvelopes(body.envelopes, GROUP_MAX);
  if (!envelopes) return json({ ok: false, error: 'keys' }, 400);

  const cur = await memberIds(env, convId);
  if (cur.length + uids.length > GROUP_MAX) return json({ ok: false, error: 'full' }, 400);
  const curSet = new Set(cur);
  if (uids.some((u) => curSet.has(u))) return json({ ok: false, error: 'members' }, 400);
  if (!(await friendsAndNotBlocked(env, user.uid, uids))) return json({ ok: false, error: 'not_friends' }, 403);

  const maxV = await maxKeyVersion(env, convId);
  if (keyVersion !== maxV + 1) return json({ ok: false, error: 'keys' }, 400);
  if (!envelopeSetOk(envelopes, [...cur, ...uids])) return json({ ok: false, error: 'keys' }, 400);

  // 新成员 min_seq=入群时点（不回看入群前历史，§4）
  const floor = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM im_messages WHERE conversation_id = ?1').bind(convId).first();
  const names = await namesOf(env, uids);
  await env.DB.batch([
    ...uids.map((uid) =>
      env.DB.prepare('INSERT OR IGNORE INTO im_members (conversation_id, user_id, role, min_seq) VALUES (?1, ?2, ?3, ?4)')
        .bind(convId, uid, 'member', floor.s)),
    ...writeEnvelopeBinds(env, convId, keyVersion, envelopes),
    sysMsg(env, convId, `${user.display_name} 邀请 ${uids.map((u) => names[u]).join('、')} 加入了群聊`),
  ]);
  await notifyRoom(env, convId, [], { t: 'members', add: uids, remove: [], version: keyVersion });
  return json({ ok: true });
}

/* ---------------- 踢人（群主；信封随请求对余员重钥，原子提交——对抗场景无缺口） ---------------- */

export async function memberKick(request, env, user, convId, targetId) {
  if (groupOpLimited(user.uid)) return json({ ok: false, error: 'rate' }, 429);
  const g = await groupGuard(env, user, convId);
  if (g.error) return g.error;
  if (g.conv.owner_id !== user.uid) return json({ ok: false, error: 'forbidden' }, 403);
  if (targetId === user.uid) return json({ ok: false, error: 'self' }, 400);

  const body = await readJson(request);
  const keyVersion = Number(body && body.key_version || 0);
  const envelopes = parseEnvelopes(body && body.envelopes, GROUP_MAX);
  if (!envelopes) return json({ ok: false, error: 'keys' }, 400);

  const members = await memberIds(env, convId);
  if (!members.includes(targetId)) return json({ ok: false, error: 'not_found' }, 404);
  const maxV = await maxKeyVersion(env, convId);
  if (keyVersion !== maxV + 1) return json({ ok: false, error: 'keys' }, 400);
  if (!envelopeSetOk(envelopes, members.filter((u) => u !== targetId))) return json({ ok: false, error: 'keys' }, 400);

  const name = (await namesOf(env, [targetId]))[targetId];
  await env.DB.batch([
    env.DB.prepare('DELETE FROM im_members WHERE conversation_id = ?1 AND user_id = ?2').bind(convId, targetId),
    ...writeEnvelopeBinds(env, convId, keyVersion, envelopes),
    sysMsg(env, convId, `${user.display_name} 将 ${name} 移出了群聊`),
  ]);
  await notifyRoom(env, convId, [{ uid: targetId, why: 'kicked' }], { t: 'members', add: [], remove: [targetId], version: keyVersion });
  return json({ ok: true });
}

/* ---------------- 退群 / 解散（DELETE /api/convs/<id>；群主退出=解散） ---------------- */

export async function convLeave(env, user, convId) {
  if (groupOpLimited(user.uid)) return json({ ok: false, error: 'rate' }, 429);
  const g = await groupGuard(env, user, convId);
  if (g.error) return g.error;

  if (g.conv.owner_id === user.uid) {
    // 解散：清全部成员（会话行与历史保留，成员清空后无人可达）。重钥不再需要——群不复存在。
    const members = await memberIds(env, convId);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM im_members WHERE conversation_id = ?1').bind(convId),
      sysMsg(env, convId, `群聊「${g.conv.name}」已解散`), // 成员已不可见，仅留审计轨迹
    ]);
    await notifyRoom(env, convId, members.map((uid) => ({ uid, why: 'disbanded' })), null);
    return json({ ok: true, disbanded: true });
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM im_members WHERE conversation_id = ?1 AND user_id = ?2').bind(convId, user.uid),
    sysMsg(env, convId, `${user.display_name} 退出了群聊`),
  ]);
  await notifyRoom(env, convId, [{ uid: user.uid, why: 'left' }], { t: 'members', add: [], remove: [user.uid] });
  return json({ ok: true });
}

/* ---------------- 改名（群主） ---------------- */

export async function convRename(request, env, user, convId) {
  if (groupOpLimited(user.uid)) return json({ ok: false, error: 'rate' }, 429);
  const g = await groupGuard(env, user, convId);
  if (g.error) return g.error;
  if (g.conv.owner_id !== user.uid) return json({ ok: false, error: 'forbidden' }, 403);

  const body = await readJson(request);
  const name = cleanGroupName(body && body.name);
  if (!name) return json({ ok: false, error: 'name' }, 400);
  await env.DB.batch([
    env.DB.prepare('UPDATE im_conversations SET name = ?2 WHERE id = ?1').bind(convId, name),
    sysMsg(env, convId, `${user.display_name} 将群名改为「${name}」`),
  ]);
  await notifyRoom(env, convId, [], { t: 'rename', name });
  return json({ ok: true });
}

/* ---------------- 重钥（群主补钥：退群后的成员变动在此出全套新信封） ---------------- */

export async function convRekey(request, env, user, convId) {
  if (groupOpLimited(user.uid)) return json({ ok: false, error: 'rate' }, 429);
  const g = await groupGuard(env, user, convId);
  if (g.error) return g.error;
  if (g.conv.owner_id !== user.uid) return json({ ok: false, error: 'forbidden' }, 403);

  const body = await readJson(request);
  const keyVersion = Number(body && body.key_version || 0);
  const envelopes = parseEnvelopes(body && body.envelopes, GROUP_MAX);
  if (!envelopes) return json({ ok: false, error: 'keys' }, 400);

  const members = await memberIds(env, convId);
  const maxV = await maxKeyVersion(env, convId);
  if (keyVersion !== maxV + 1) return json({ ok: false, error: 'keys' }, 400);
  if (!envelopeSetOk(envelopes, members)) return json({ ok: false, error: 'keys' }, 400);

  await env.DB.batch(writeEnvelopeBinds(env, convId, keyVersion, envelopes));
  await notifyRoom(env, convId, [], { t: 'rekey', version: keyVersion });
  return json({ ok: true });
}
