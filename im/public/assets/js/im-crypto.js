/**
 * 焰境密语 — E2EE 加密模块（docs/IM聊天方案.md §3）
 * 全部原生 WebCrypto，零第三方依赖：ECDH P-256 身份密钥 + PBKDF2 包裹 + AES-256-GCM。
 * 服务器只见 pub_key / enc_priv_key（密码包裹备份）/ 信封 / 密文，永不持有可解密钥。
 *
 * M1 暴露：generateIdentity / wrapPrivateKey / unwrapPrivateKey / saveIdentity / loadIdentity
 * M2 增量：信封生成与解包（会话密钥分发）、消息加解密（AAD 绑定 conv/seq/sender/key_version）
 */

const KDF_ITERS = 310000;
const DB_NAME = 'im-identity';
const STORE = 'keys';
const KEY = 'identity';

/* ---------- base64 ---------- */

function bufToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

function b64ToBuf(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 身份密钥 ---------- */

/** 生成账号身份密钥对：ECDH P-256（可提取）。返回 { publicKeyB64, privateKeyJwk, kdfSalt, kdfIters } */
export async function generateIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  const rawPub = await crypto.subtle.exportKey('raw', pair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return {
    publicKeyB64: bufToB64(rawPub),          // 65B：0x04 || X || Y
    privateKeyJwk: privJwk,
    kdfSalt: toHex(salt),                     // 32B hex（与服务器 pass_salt 完全独立）
    kdfIters: KDF_ITERS,
  };
}

/** 用登录密码包裹私钥（AES-256-GCM）→ base64(iv||ct)，即上传服务器的 enc_priv_key */
export async function wrapPrivateKey(privJwk, password, kdfSaltHex, kdfIters) {
  const wrapKey = await deriveWrapKey(password, kdfSaltHex, kdfIters);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const pt = new TextEncoder().encode(JSON.stringify(privJwk));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pt);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return bufToB64(out.buffer);
}

/** 解包 enc_priv_key → 私钥 JWK 对象（校验可导入，防串改/坏数据） */
export async function unwrapPrivateKey(encB64, password, kdfSaltHex, kdfIters) {
  const all = new Uint8Array(b64ToBuf(encB64));
  if (all.length <= 12) throw new Error('bad blob');
  const iv = all.slice(0, 12);
  const ct = all.slice(12);
  const wrapKey = await deriveWrapKey(password, kdfSaltHex, kdfIters);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
  const jwk = JSON.parse(new TextDecoder().decode(pt));
  await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  return jwk;
}

async function deriveWrapKey(password, kdfSaltHex, kdfIters) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const salt = new Uint8Array(kdfSaltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: kdfIters, salt },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* ---------- 本机身份留存（IndexedDB） ---------- */

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const st = tx.objectStore(STORE);
      let req;
      try {
        req = fn(st);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => { resolve(req ? req.result : undefined); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    };
  });
}

export function saveIdentity(identity) {
  return withStore('readwrite', (st) => st.put(identity, KEY));
}

/** 返回本机留存身份 { uid, publicKeyB64, privateKeyJwk, kdfSalt, kdfIters } 或 null */
export function loadIdentity() {
  return withStore('readonly', (st) => st.get(KEY)).then((v) => v || null);
}

export function clearIdentity() {
  return withStore('readwrite', (st) => st.delete(KEY));
}
