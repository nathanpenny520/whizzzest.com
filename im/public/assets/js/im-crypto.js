/**
 * 焰境密语 — E2EE 加密模块（docs/IM聊天方案.md §3）
 * 全部原生 WebCrypto，零第三方依赖：ECDH P-256 身份密钥 + PBKDF2 包裹 + AES-256-GCM。
 * 服务器只见 pub_key / enc_priv_key（密码包裹备份）/ 信封 / 密文，永不持有可解密钥。
 *
 * M1 暴露：generateIdentity / wrapPrivateKey / unwrapPrivateKey / saveIdentity / loadIdentity
 * M2 增量：会话密钥信封（创建/解包）+ 消息加解密（方案 §3.2/§3.3）
 *
 * 信封（每成员一枚，存 im_conv_keys）：ECDH(临时 P-256 × 成员身份公钥) → HKDF-SHA256
 *   （salt=临时公钥 raw，info='wxz-im-convkey-v1'）→ AES-GCM 包裹会话密钥 K；
 *   blob = b64( iv 12B ‖ 临时公钥 raw 65B ‖ ct(K 32B+16B tag) )
 * 消息（AES-256-GCM(K)）：nonce=每消息随机 96bit（v1.2 修订，见方案 §3.3）；
 *   AAD 绑定 (conv_id, sender_uid, key_version)——防篡改/防跨会话重放；
 *   blob = b64( key_version 1B ‖ iv 12B ‖ ct )，seq 由服务器分配后随帧回传，不进 AAD
 */

const HKDF_INFO = new TextEncoder().encode('wxz-im-convkey-v1');
const MSG_AAD_PREFIX = 'wxz-im-msg-v1';

function randBytes(n) {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}

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

/* ---------- 会话密钥信封（方案 §3.2） ---------- */

async function importIdentityPrivate(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
}

/** 共享位 → HKDF(salt=临时公钥 raw, info 固定) → AES-GCM 包裹钥 */
async function hkdfWrapKey(sharedBits, ephPubRaw) {
  const hk = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephPubRaw, info: HKDF_INFO },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 建会话：生成随机会话密钥 K，并为每个成员出一枚信封（含自己，换设备后可自解）。
 * 共享秘密 = ECDH(本函数临时私钥 × 成员身份公钥)；收件方以 ECDH(身份私钥 × 信封内临时公钥) 还原同一位。
 * @param members [{uid, pub_key}]（pub_key 为 65B raw 的 base64）
 * @returns { keyVersion, rawKeyB64, envelopes: [{uid, envelope}] }——rawKeyB64 供发起方直接入缓存
 */
export async function createConvEnvelopes(members) {
  const raw = randBytes(32);
  const envelopes = [];
  for (const m of members) {
    const pub = await crypto.subtle.importKey('raw', b64ToBuf(m.pub_key), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
    const ephRaw = await crypto.subtle.exportKey('raw', eph.publicKey);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
    const wrapKey = await hkdfWrapKey(shared, ephRaw);
    const iv = randBytes(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw);
    const blob = new Uint8Array(iv.length + ephRaw.byteLength + ct.byteLength);
    blob.set(iv, 0);
    blob.set(new Uint8Array(ephRaw), iv.length);
    blob.set(new Uint8Array(ct), iv.length + ephRaw.byteLength);
    envelopes.push({ uid: m.uid, envelope: bufToB64(blob.buffer) });
  }
  return { keyVersion: 1, rawKeyB64: bufToB64(raw.buffer), envelopes };
}

/** 解信封 → 会话密钥 raw（base64），用本机身份私钥 */
export async function unwrapEnvelope(envelopeB64, privateKeyJwk) {
  const all = new Uint8Array(b64ToBuf(envelopeB64));
  if (all.length <= 12 + 65 + 16) throw new Error('bad envelope');
  const iv = all.slice(0, 12);
  const ephRaw = all.slice(12, 12 + 65);
  const ct = all.slice(12 + 65);
  const priv = await importIdentityPrivate(privateKeyJwk);
  const ephPub = await crypto.subtle.importKey('raw', ephRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephPub }, priv, 256);
  const wrapKey = await hkdfWrapKey(shared, ephRaw);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
  return bufToB64(raw);
}

/** 会话密钥 raw(base64) → 可用 CryptoKey（AES-256-GCM） */
export async function importConvKey(rawKeyB64) {
  return crypto.subtle.importKey('raw', b64ToBuf(rawKeyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ---------- 消息加解密（方案 §3.3） ---------- */

function msgAad(convId, senderUid, keyVersion) {
  return new TextEncoder().encode(`${MSG_AAD_PREFIX}|${convId}|${senderUid}|${keyVersion}`);
}

/** 加密一条消息 → 存库密文 b64(key_version ‖ iv ‖ ct) */
export async function encryptMessage(convKey, { convId, senderUid, keyVersion, text }) {
  const iv = randBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: msgAad(convId, senderUid, keyVersion) },
    convKey,
    new TextEncoder().encode(text)
  );
  const blob = new Uint8Array(1 + iv.length + ct.byteLength);
  blob[0] = keyVersion;
  blob.set(iv, 1);
  blob.set(new Uint8Array(ct), 1 + iv.length);
  return bufToB64(blob.buffer);
}

/** 解密一条消息 → { text, keyVersion }；AAD/密钥不符时 reject */
export async function decryptMessage(convKey, { convId, senderUid, bodyB64 }) {
  const u = new Uint8Array(b64ToBuf(bodyB64));
  if (u.length < 1 + 12 + 16) throw new Error('bad message blob');
  const keyVersion = u[0];
  const iv = u.slice(1, 13);
  const ct = u.slice(13);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: msgAad(convId, senderUid, keyVersion) },
    convKey,
    ct
  );
  return { text: new TextDecoder().decode(pt), keyVersion };
}
