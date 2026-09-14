/**
 * 焰境密语 — 展示工具（/app 用）
 * 铁律：任何解密出的明文/用户输入渲染必须走 esc()，不得 innerHTML 裸插（方案 §7）。
 */

export const AVATAR_HUES = [14, 32, 88, 150, 200, 250, 290, 330]; // avatar_color 0-7 → 焰色系色相

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function avatarHtml(name, color, size) {
  const hue = AVATAR_HUES[(Number(color) || 0) % 8] ?? 14;
  const ch = esc((name || '焰').trim().charAt(0) || '焰');
  return `<span class="im-avatar" style="width:${size}px;height:${size}px;background:hsl(${hue} 62% 46%);font-size:${Math.round(size * 0.42)}px">${ch}</span>`;
}

/** 群发送者名颜色（UI v2）：按 avatar_color 色相取亮档，暗底可读 */
export function senderColor(color) {
  const hue = AVATAR_HUES[(Number(color) || 0) % 8] ?? 14;
  return `hsl(${hue} 58% 68%)`;
}

/** 公钥指纹（SHA-256 前 8 字节，4×4 十六进制组）——群成员面板逐员展示用 */
export async function fingerprint(pubKeyB64) {
  const bin = atob(pubKeyB64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', u);
  const hex = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.replace(/(..)(..)(..)(..)/, '$1 $2 $3 $4').toUpperCase();
}

/**
 * 安全数字（M4，1v1 核验）：双方公钥按字节序拼接后的 SHA-256，取 30 位十六进制分 6 组。
 * 两端各自算出同一串 ⇒ 目录里对方公钥未被中间替换（对齐 §3.4「服务器作恶换公钥」的可用核验）；
 * 定长 b64 的字典序 = 字节序，直接比较串即可。
 */
export async function safetyNumber(pubA, pubB) {
  const raw = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const [a, b] = pubA < pubB ? [raw(pubA), raw(pubB)] : [raw(pubB), raw(pubA)];
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  const digest = await crypto.subtle.digest('SHA-256', joined);
  const hex = [...new Uint8Array(digest)].slice(0, 15).map((x) => x.toString(16).padStart(2, '0')).join('');
  return hex.replace(/(.{5})(.{5})(.{5})(.{5})(.{5})(.{5})/, '$1 $2 $3 $4 $5 $6').toUpperCase();
}

/** D1 时间戳（'YYYY-MM-DD HH:MM:SS' UTC）或 Date → Date（本地时区展示） */
export function parseDbTime(s) {
  if (s instanceof Date) return s;
  return new Date(String(s).replace(' ', 'T') + 'Z');
}

export function fmtTime(s) {
  const d = parseDbTime(s);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 会话行右侧时间：今天=HH:MM，昨天/更早=M/D */
export function fmtListTime(s) {
  const d = parseDbTime(s);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 消息流日期分隔标签：今天/昨天/M月D日 */
export function fmtDayLabel(s) {
  const d = parseDbTime(s);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** UTF-8 字节数（发送前预检，密文 b64 须 ≤2000，方案 §3.3/§8） */
export function utf8Len(s) {
  return new TextEncoder().encode(s).length;
}
