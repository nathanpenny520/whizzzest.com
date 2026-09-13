/**
 * 焰境密语 — 会话 API（M2：1v1 dm；群组 M3 复用本模块）
 * dm 幂等：dm_key='dm:min:max' 唯一键；信封随建会话提交（方案 §3.2），后到者经 /keys 拉先到者的；
 * 半写自愈：并发/中断后成员与信封可幂等补齐。
 */

import { ENVELOPE_MAX } from '../config.js';
import { isB64, json, readJson } from '../util.js';

async function memberRow(env, convId, uid) {
  return env.DB.prepare('SELECT user_id, last_read_seq, min_seq FROM im_members WHERE conversation_id = ?1 AND user_id = ?2')
    .bind(convId, uid).first();
}

function parseEnvelopes(list) {
  if (!Array.isArray(list) || !list.length || list.length > 2) return null;
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
  const envelopes = parseEnvelopes(body.envelopes);
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

  // min_seq=入群时点隔离（dm 恒 0；群 M3 生效）
  const floor = Math.max(0, Number(m.min_seq) || 0);
  let sql = 'SELECT seq, sender_id, type, body, created_at FROM im_messages WHERE conversation_id = ?1 AND seq >= ?2';
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
  await env.DB.prepare(
    'UPDATE im_members SET last_read_seq = MAX(last_read_seq, ?2) WHERE conversation_id = ?1 AND user_id = ?3'
  ).bind(convId, seq, user.uid).run();
  return json({ ok: true });
}
