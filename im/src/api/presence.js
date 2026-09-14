/**
 * 焰境密语 — 在线查询（P1 用户级在线，docs/IM在线与实时同步方案.md）
 * GET /api/presence?uids=1,2,3：仅返回「好友或同会话成员」中的在线者（隐私边界——
 * 陌生人查不到在场状态，防 uid 探测）。在线 = im_presence.last_ping 距今 < 90s（读时计算）。
 * D1 单查询绑定参数上限 100：uid 列表按 40 一块分查（同 convs.js friendsAndNotBlocked 先例）。
 */

import { PRESENCE_UIDS_MAX, PRESENCE_WINDOW_MS } from '../config.js';
import { json } from '../util.js';

export async function presenceGet(env, user, url) {
  const ids = (url.searchParams.get('uids') || '')
    .split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0 && n <= 2 ** 31);
  const uniq = [...new Set(ids)].slice(0, PRESENCE_UIDS_MAX);
  const online = {};
  if (!uniq.length) return json({ ok: true, online });

  const cutoff = Date.now() - PRESENCE_WINDOW_MS;
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const ph = chunk.map(() => '?').join(',');
    try {
      const rows = await env.DB.prepare(
        `SELECT p.uid FROM im_presence p
         WHERE p.uid IN (${ph}) AND p.last_ping > ?
           AND (EXISTS (SELECT 1 FROM im_friendships f
                  WHERE (f.user_id = ? AND f.friend_id = p.uid)
                     OR (f.user_id = p.uid AND f.friend_id = ?))
             OR EXISTS (SELECT 1 FROM im_members a JOIN im_members b ON b.conversation_id = a.conversation_id
                  WHERE a.user_id = p.uid AND b.user_id = ?))`
      ).bind(...chunk, cutoff, user.uid, user.uid, user.uid).all();
      for (const r of rows.results) online[r.uid] = true;
    } catch (err) {
      console.error('im presence query:', err);
      return json({ ok: false, error: 'retry' }, 500);
    }
  }
  return json({ ok: true, online });
}

/* ---------------- P2 枢纽投递（docs/IM在线与实时同步方案.md §5） ----------------
 * 向在线成员的存在性 DO 转发轻量帧（activity/contact）；离线者跳过（唤醒 DO 无意义）。
 * 在线判定复用 im_presence 90s 窗口（与 presenceGet 同口径）；投递失败只记日志不抛（尽力而为）。 */

export async function deliverIfOnline(env, uids, frame) {
  const ids = [...new Set((uids || []).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length || !env.PRESENCE) return;
  let online = [];
  try {
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const ph = chunk.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        'SELECT uid FROM im_presence WHERE uid IN (' + ph + ') AND last_ping > ?'
      ).bind(...chunk, Date.now() - PRESENCE_WINDOW_MS).all();
      online = online.concat(rows.results.map((r) => r.uid));
    }
  } catch (err) {
    console.error('im deliver lookup:', err);
    return;
  }
  await Promise.allSettled(online.map((uid) =>
    env.PRESENCE.get(env.PRESENCE.idFromName('u' + uid)).fetch('https://do/deliver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(frame),
    }).catch((err) => console.error('im presence deliver:', err))
  ));
}
