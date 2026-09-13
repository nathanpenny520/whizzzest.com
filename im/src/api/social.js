/**
 * 焰境密语 — 好友 API（M2，方案 §6/§8）
 * 搜索：精确匹配邮箱/手机号，仅回 id/display_name/bio/avatar_color/pub_key（不暴露联系方式本身）；
 * 申请：每用户 20 条/天、对方待收箱 ≤50、同对 UNIQUE（拒绝/取消后可重发）；拉黑=申请静默拒、双向拦截。
 */

import { normalizePhone } from '../../../shared/phone.js';
import { EMAIL_RE, RATE_SEARCH, RATE_FRIEND_REQ, FRIEND_REQ_MSG_MAX } from '../config.js';
import { json, limited, readJson } from '../util.js';

const USER_CARD = 'id, display_name, bio, avatar_color, pub_key';

/* ---------------- 搜索 ---------------- */

export async function userSearch(request, env, user, url) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (limited('imsearch:u' + user.uid, RATE_SEARCH.windowMs, RATE_SEARCH.max) ||
      (ip && limited('imsearch:i' + ip, RATE_SEARCH.windowMs, RATE_SEARCH.max))) {
    return json({ ok: false, error: 'rate' }, 429);
  }
  const q = String(url.searchParams.get('q') || '').trim();
  let hit = null;
  if (q && q.length <= 120) {
    let row = null;
    if (q.includes('@')) {
      const email = q.toLowerCase();
      if (EMAIL_RE.test(email) && email.length <= 100) {
        row = await env.DB.prepare(`SELECT ${USER_CARD} FROM im_users WHERE email = ?1 AND status = 'normal'`).bind(email).first();
      }
    } else if (/^\+?[0-9][0-9\s\-]{4,19}$/.test(q)) {
      const phone = normalizePhone(q, '');
      if (phone.ok) {
        row = await env.DB.prepare(`SELECT ${USER_CARD} FROM im_users WHERE phone = ?1 AND status = 'normal'`).bind(phone.e164).first();
      }
    }
    if (row && row.id !== user.uid) hit = row;
  }
  return json({ ok: true, user: hit });
}

/* ---------------- 好友申请 ---------------- */

export async function requestCreate(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);
  const targetId = Number(body.uid);
  const message = String(body.message || '').trim();
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === user.uid) return json({ ok: false, error: 'uid' }, 400);
  if (message.length > FRIEND_REQ_MSG_MAX) return json({ ok: false, error: 'message' }, 400);

  const sent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM im_friend_requests WHERE from_uid = ?1 AND created_at > datetime('now', '-1 day')`
  ).bind(user.uid).first();
  if (sent.n >= RATE_FRIEND_REQ.dailyMax) return json({ ok: false, error: 'rate' }, 429);

  const target = await env.DB.prepare('SELECT id, status FROM im_users WHERE id = ?1').bind(targetId).first();
  if (!target || target.status !== 'normal') return json({ ok: false, error: 'no_user' }, 404);

  const myBlock = await env.DB.prepare('SELECT 1 FROM im_blocks WHERE user_id = ?1 AND blocked_uid = ?2').bind(user.uid, targetId).first();
  if (myBlock) return json({ ok: false, error: 'blocked' }, 403);
  // 对方拉黑我 → 静默成功不落库（申请静默拒，方案 §8）
  const theirBlock = await env.DB.prepare('SELECT 1 FROM im_blocks WHERE user_id = ?1 AND blocked_uid = ?2').bind(targetId, user.uid).first();
  if (theirBlock) return json({ ok: true });

  const friends = await env.DB.prepare('SELECT 1 FROM im_friendships WHERE user_id = ?1 AND friend_id = ?2').bind(user.uid, targetId).first();
  if (friends) return json({ ok: false, error: 'friends' }, 409);

  const inbox = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM im_friend_requests WHERE to_uid = ?1 AND status = 'pending'`
  ).bind(targetId).first();
  if (inbox.n >= RATE_FRIEND_REQ.inboxMax) return json({ ok: false, error: 'inbox_full' }, 429);

  // 同对 UNIQUE（方案 §4）：pending 重复 → dup；rejected/canceled → 重置重发
  const existing = await env.DB.prepare('SELECT id, status FROM im_friend_requests WHERE from_uid = ?1 AND to_uid = ?2').bind(user.uid, targetId).first();
  if (existing) {
    if (existing.status === 'pending') return json({ ok: false, error: 'dup' }, 409);
    await env.DB.prepare(
      `UPDATE im_friend_requests SET status = 'pending', message = ?3, created_at = datetime('now'), handled_at = NULL
       WHERE id = ?1 AND from_uid = ?2`
    ).bind(existing.id, user.uid, message).run();
    return json({ ok: true });
  }
  await env.DB.prepare('INSERT INTO im_friend_requests (from_uid, to_uid, message) VALUES (?1, ?2, ?3)').bind(user.uid, targetId, message).run();
  return json({ ok: true });
}

export async function requestsList(env, user, url) {
  const box = url.searchParams.get('box') === 'out' ? 'out' : 'in';
  const joinCol = box === 'in' ? 'r.from_uid' : 'r.to_uid';
  const rows = await env.DB.prepare(
    `SELECT r.id, r.message, r.created_at, u.id AS uid, u.display_name, u.bio, u.avatar_color
     FROM im_friend_requests r JOIN im_users u ON u.id = ${joinCol}
     WHERE ${box === 'in' ? 'r.to_uid' : 'r.from_uid'} = ?1 AND r.status = 'pending'
     ${box === 'in' ? 'AND NOT EXISTS (SELECT 1 FROM im_blocks b WHERE b.user_id = r.from_uid AND b.blocked_uid = ?1)' : ''}
     ORDER BY r.created_at DESC LIMIT 100`
  ).bind(user.uid).all();
  return json({
    ok: true,
    box,
    requests: rows.results.map((r) => ({
      id: r.id,
      message: r.message,
      created_at: r.created_at,
      user: { uid: r.uid, display_name: r.display_name, bio: r.bio, avatar_color: r.avatar_color },
    })),
  });
}

export async function requestHandle(request, env, user, reqId, action) {
  const row = await env.DB.prepare('SELECT id, from_uid, to_uid, status FROM im_friend_requests WHERE id = ?1').bind(reqId).first();
  if (!row) return json({ ok: false, error: 'not_found' }, 404);
  if (row.to_uid !== user.uid) return json({ ok: false, error: 'not_yours' }, 403);
  if (row.status !== 'pending') return json({ ok: false, error: 'handled' }, 409);

  if (action === 'reject') {
    await env.DB.prepare(`UPDATE im_friend_requests SET status = 'rejected', handled_at = datetime('now') WHERE id = ?1`).bind(reqId).run();
    return json({ ok: true });
  }
  // accept：关系双行 + 置状态，batch 原子
  await env.DB.batch([
    env.DB.prepare(`UPDATE im_friend_requests SET status = 'accepted', handled_at = datetime('now') WHERE id = ?1 AND status = 'pending'`).bind(reqId),
    env.DB.prepare('INSERT OR IGNORE INTO im_friendships (user_id, friend_id) VALUES (?1, ?2)').bind(user.uid, row.from_uid),
    env.DB.prepare('INSERT OR IGNORE INTO im_friendships (user_id, friend_id) VALUES (?1, ?2)').bind(row.from_uid, user.uid),
  ]);
  return json({ ok: true });
}

export async function requestCancel(env, user, reqId) {
  const r = await env.DB.prepare(
    `UPDATE im_friend_requests SET status = 'canceled', handled_at = datetime('now')
     WHERE id = ?1 AND from_uid = ?2 AND status = 'pending'`
  ).bind(reqId, user.uid).run();
  if (!r.meta.changes) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true });
}

/* ---------------- 好友列表 / 删除 ---------------- */

export async function friendsList(env, user) {
  const rows = await env.DB.prepare(
    `SELECT u.id AS uid, u.display_name, u.bio, u.avatar_color, u.pub_key, f.created_at AS since
     FROM im_friendships f JOIN im_users u ON u.id = f.friend_id
     WHERE f.user_id = ?1 AND u.status = 'normal'
     ORDER BY u.display_name COLLATE NOCASE`
  ).bind(user.uid).all();
  return json({ ok: true, friends: rows.results });
}

export async function friendDelete(env, user, friendId) {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM im_friendships WHERE user_id = ?1 AND friend_id = ?2').bind(user.uid, friendId),
    env.DB.prepare('DELETE FROM im_friendships WHERE user_id = ?1 AND friend_id = ?2').bind(friendId, user.uid),
  ]);
  if (!r[0].meta.changes) return json({ ok: false, error: 'not_friends' }, 404);
  return json({ ok: true });
}

/* ---------------- 拉黑（方案 §8：申请静默拒、消息拒收） ---------------- */

export async function blocksList(env, user) {
  const rows = await env.DB.prepare('SELECT blocked_uid AS uid FROM im_blocks WHERE user_id = ?1').bind(user.uid).all();
  return json({ ok: true, blocks: rows.results.map((r) => r.uid) });
}

export async function blockPut(env, user, targetId) {
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === user.uid) return json({ ok: false, error: 'uid' }, 400);
  const t = await env.DB.prepare('SELECT id FROM im_users WHERE id = ?1').bind(targetId).first();
  if (!t) return json({ ok: false, error: 'no_user' }, 404);
  await env.DB.prepare('INSERT OR IGNORE INTO im_blocks (user_id, blocked_uid) VALUES (?1, ?2)').bind(user.uid, targetId).run();
  return json({ ok: true });
}

export async function blockDelete(env, user, targetId) {
  await env.DB.prepare('DELETE FROM im_blocks WHERE user_id = ?1 AND blocked_uid = ?2').bind(user.uid, targetId).run();
  return json({ ok: true });
}
