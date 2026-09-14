/** 焰境密语 — REST 客户端（401 统一跳登录页；业务层只看 j.ok/j.error） */

export async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}));
  const j = await res.json().catch(() => ({ ok: false, error: 'bad_json' }));
  if (res.status === 401) { location.href = '/'; throw new Error('auth'); }
  return { status: res.status, j };
}

export const GET = (p) => api(p).then((r) => r.j);
export const POST = (p, d) => api(p, { method: 'POST', body: JSON.stringify(d || {}) }).then((r) => r.j);
export const PATCH = (p, d) => api(p, { method: 'PATCH', body: JSON.stringify(d || {}) }).then((r) => r.j);
export const PUT = (p) => api(p, { method: 'PUT' }).then((r) => r.j);
export const DEL = (p, d) => api(p, { method: 'DELETE', body: d === undefined ? undefined : JSON.stringify(d) }).then((r) => r.j);
