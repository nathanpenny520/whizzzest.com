/**
 * 焰境密语 — 通用工具（照 writer 门户惯例）
 * 只放无业务语义的小件：响应构造、编码、哈希、内存限流桶、脱敏。
 */

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { location } });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/* ---------------- 编码 ---------------- */

export function isB64(s) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

export function b64ToBuf(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- 哈希 / 签名 ---------------- */

export async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return toHex(digest);
}

export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return toHex(sig);
}

/** 认证密码哈希：PBKDF2-SHA256 10 万次（照 writer，与 E2EE 包裹 KDF 完全独立） */
export async function pbkdf2Hex(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt }, key, 256);
  return toHex(bits);
}

export function timingSafeEqual(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/* ---------------- 展示辅助 ---------------- */

export function maskEmail(email) {
  const i = email.indexOf('@');
  if (i <= 0) return '***';
  const name = email.slice(0, i);
  const head = name.slice(0, Math.min(2, name.length));
  return head + '***' + email.slice(i);
}

export function cleanDisplayName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (s.length > 20) return null;
  return s;
}

/* ---------------- 内存限流桶（单隔离岛内有效，够用；DO 全局限流见 do/rate-limiter.js） ---------------- */

const buckets = new Map();
export function limited(key, windowMs, max) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return hits.length > max;
}

/** D1 TEXT 时间戳（'YYYY-MM-DD HH:MM:SS' UTC）→ 毫秒 */
export function dbTimeMs(s) {
  return new Date(String(s).replace(' ', 'T') + 'Z').getTime();
}
