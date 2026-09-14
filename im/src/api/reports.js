/**
 * 焰境密语 — 举报 API（M4，方案 §6/§8）
 * E2EE 下站长读不了聊天内容：举报人提交会话 + seq 区间 + 文字说明（可自愿附本地解密的引用文，
 * v1 仅收说明）；仅会话成员可举报；每 uid 20 条/小时。im_reports 照存，站长经 D1 处置。
 */

import { RATE_REPORT, REPORT_REASON_MAX } from '../config.js';
import { json, limited, readJson } from '../util.js';

export async function createReport(request, env, user) {
  if (limited('imreport:' + user.uid, RATE_REPORT.windowMs, RATE_REPORT.max)) {
    return json({ ok: false, error: 'rate' }, 429);
  }
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'format' }, 400);

  const convId = Number(body.conversation_id);
  const seqFrom = Number(body.seq_from || 0);
  const seqTo = Number(body.seq_to || 0);
  const reason = String(body.reason || '').trim();
  if (!Number.isInteger(convId) || convId <= 0) return json({ ok: false, error: 'conv' }, 400);
  if (!Number.isInteger(seqFrom) || seqFrom < 0 || !Number.isInteger(seqTo) || seqTo < seqFrom) {
    return json({ ok: false, error: 'seq' }, 400);
  }
  if (!reason || reason.length > REPORT_REASON_MAX) return json({ ok: false, error: 'reason' }, 400);

  // 仅会话成员可举报（防探测他人会话存在性——非成员与不存在同回 404）
  const member = await env.DB.prepare(
    'SELECT 1 FROM im_members WHERE conversation_id = ?1 AND user_id = ?2'
  ).bind(convId, user.uid).first();
  if (!member) return json({ ok: false, error: 'not_found' }, 404);

  await env.DB.prepare(
    'INSERT INTO im_reports (reporter_uid, conversation_id, seq_from, seq_to, reason) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(user.uid, convId, seqFrom, seqTo, reason).run();
  return json({ ok: true });
}
