/**
 * 焰境游戏 — 本地存档适配层（docs/游戏方案.md §2，阶段一核心）
 *
 * 职责：为全平台游戏提供统一的本地存档 API —— 每款游戏只需实现 serialize/deserialize(+migrate)
 * 适配器，持久化、版本迁移、校验和、三槽位、.wsave 导入导出全部由本层承担。
 *
 * 设计要点（方案 §2 拍板）：
 *  - 存储介质 IndexedDB（库 whizzzest-game / store saves，键 `${gameId}::slot<n>`）；
 *  - 页面加载即申请 navigator.storage.persist()（「永久保存」依赖它，iOS Safari 约 7 天不访问可被清理）；
 *  - 载荷 = JSON 元数据（gameId/slot/version/savedAt/checksum/size）+ 游戏原始数据（结构化克隆兼容类型）；
 *  - 版本策略：旧档 → migrate() 尝试迁移并回写新版本；迁移失败 → 仍可强制载入（警告，禁止硬拒载）；
 *    存档比游戏还新 → 警告后可载入；
 *  - 导出文件 .wsave：单文件 JSON（magic=WSAVE, format=1），SHA-256 校验和（对 JSON.stringify(data) 规范化串）；
 *    校验不符 → 报给上层确认，不静默丢弃；
 *  - 本模块不碰 DOM（顶层无浏览器 API），可在 Node 里 import 做冒烟测试。
 *
 * 阶段三扩展点：save()/load() 挂云同步钩子（R2 备份），本层 API 不变。
 *
 * i18n（docs/游戏英文版方案.md §3.2）：本层错误消息会经运行页壳 toast 透出给玩家，
 * 统一走 i18n.js 取串（en 缺条目落回中文兜底）；顶层不碰浏览器 API 的纪律不变。
 */
import { t } from './i18n.js';

const DB_NAME = 'whizzzest-game';
const DB_VERSION = 1;
const STORE = 'saves';
const WSAVE_MAGIC = 'WSAVE';
const WSAVE_FORMAT = 1;

export class SaveError extends Error {
  /** @param {string} code 机器可读错误码（empty|db|checksum|migrate-failed|newer-version|bad-file|wrong-game） */
  constructor(code, message, info) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
    this.info = info || null;
  }
}

/* ---------------- IndexedDB 基础 ---------------- */

let dbPromise = null;

function openDb() {
  if (!globalThis.indexedDB) throw new SaveError('db', t('e.noIdb', '当前环境无 IndexedDB'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: 'key' });
          st.createIndex('byGame', 'gameId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new SaveError('db', t('e.idbOpen', 'IndexedDB 打开失败'), req.error));
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const st = t.objectStore(STORE);
        let result;
        try {
          result = fn(st); // 若是 IDBRequest，事务 complete 时其 .result 已就绪
        } catch (e) {
          reject(e instanceof SaveError ? e : new SaveError('db', t('e.tx', '存档事务失败'), e));
          return;
        }
        t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        t.onabort = () => reject(new SaveError('db', t('e.txAbort', '存档事务中止'), t.error));
        t.onerror = () => reject(new SaveError('db', t('e.tx', '存档事务失败'), t.error));
      })
  );
}

const slotKey = (gameId, slot) => `${gameId}::slot${slot}`;

/* ---------------- 校验和 ---------------- */

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {Object} SaveLayerConfig
 * @property {string} gameId          游戏唯一 id（games.json）
 * @property {string} gameTitle       展示名（导出文件/弹窗用）
 * @property {number} version         当前游戏存档版本号
 * @property {(data:any, fromVersion:number)=>any} [migrate] 旧档迁移函数；返回 null/抛错 = 迁移失败
 */

/**
 * @typedef {Object} LoadResult
 * @property {'empty'|'ok'|'migrated'|'migrate-failed'|'newer-version'} status
 * @property {any}  [data]    游戏存档数据（migrate-failed/newer-version 时也带出旧数据供强制载入）
 * @property {{slot:number,version:number,savedAt:string}} [meta]
 * @property {Error} [error]
 */

/**
 * 创建一款游戏的存档层实例。
 * 每款游戏一个实例（= 方案 §2 的「每游戏 adapter」），运行页壳负责串起 serialize/deserialize。
 */
export function createSaveLayer(config) {
  const cfg = config;
  const slotMeta = (rec) => ({ slot: rec.slot, version: rec.version, savedAt: rec.savedAt });

  async function writeRecord(slot, data) {
    const json = JSON.stringify(data);
    const rec = {
      key: slotKey(cfg.gameId, slot),
      gameId: cfg.gameId,
      slot,
      version: cfg.version,
      savedAt: new Date().toISOString(),
      checksum: await sha256Hex(json),
      size: json.length, // 字符数即体量近似（UTF-8 略大，够参考）
      data,
    };
    await tx('readwrite', (st) => {
      st.put(rec);
    });
    return slotMeta(rec);
  }

  return {
    /** 存：写入指定槽位（自动算校验和与时间戳），返回槽位元信息 */
    async save(slot, data) {
      if (!Number.isInteger(slot) || slot < 1) throw new SaveError('db', t('e.badSlot', '非法槽位 {n}', { n: slot }));
      return writeRecord(slot, data);
    },

    /**
     * 读：按版本策略路由（方案 §2 —— 警告+尝试迁移，禁止硬拒载）。
     * status='migrate-failed'/'newer-version' 时数据仍然带出，由 UI 提示后决定 force 载入或放弃。
     */
    async load(slot) {
      const rec = await tx('readonly', (st) => st.get(slotKey(cfg.gameId, slot)));
      if (!rec) return { status: 'empty' };
      const meta = slotMeta(rec);
      if (rec.version === cfg.version) return { status: 'ok', data: rec.data, meta };
      if (rec.version > cfg.version) {
        return { status: 'newer-version', data: rec.data, meta };
      }
      // 旧档：尝试迁移
      if (typeof cfg.migrate === 'function') {
        try {
          const migrated = cfg.migrate(structuredClone(rec.data), rec.version);
          if (migrated != null) {
            const m = await writeRecord(slot, migrated); // 迁移成功即回写新版本
            return { status: 'migrated', data: migrated, meta: m };
          }
        } catch (e) {
          return { status: 'migrate-failed', data: rec.data, meta, error: e };
        }
      }
      return { status: 'migrate-failed', data: rec.data, meta };
    },

    /** 列出前 maxSlots 个槽位的元信息（无档的槽返回 null） */
    async listSlots(maxSlots = 3) {
      const all = await tx('readonly', (st) => st.index('byGame').getAll(cfg.gameId));
      const map = new Map(all.map((r) => [r.slot, r]));
      return Array.from({ length: maxSlots }, (_, i) => {
        const rec = map.get(i + 1);
        return rec ? slotMeta(rec) : null;
      });
    },

    async remove(slot) {
      await tx('readwrite', (st) => {
        st.delete(slotKey(cfg.gameId, slot));
      });
    },

    /* ---------- .wsave 导入导出（三备份第 2 层：清缓存兜底） ---------- */

    /**
     * 导出：指定槽位数组；省略 slots = 导出全部已有槽位。
     * 返回 { blob, filename }，下载动作由 UI 层做（a[download]）。
     */
    async exportSlots(slots) {
      const all = await tx('readonly', (st) => st.index('byGame').getAll(cfg.gameId));
      const picked = slots && slots.length ? all.filter((r) => slots.includes(r.slot)) : all;
      if (!picked.length) throw new SaveError('empty', t('e.exportEmpty', '没有可导出的存档'));
      const payload = {
        magic: WSAVE_MAGIC,
        format: WSAVE_FORMAT,
        gameId: cfg.gameId,
        gameTitle: cfg.gameTitle,
        exportedAt: new Date().toISOString(),
        saves: [],
      };
      for (const rec of picked) {
        payload.saves.push({
          slot: rec.slot,
          version: rec.version,
          savedAt: rec.savedAt,
          checksum: rec.checksum,
          data: rec.data,
        });
      }
      const stamp = new Date().toISOString().slice(0, 10);
      return {
        blob: new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        filename: `${cfg.gameId}-${stamp}.wsave`,
      };
    },

    /**
     * 导入 .wsave 文件：逐槽校验和（不符不写库，返回 checksumBad 供 UI 确认）。
     * gameId 不一致 → 抛 wrong-game（UI 提示后可用 {allowForeign:true} 强制导入）。
     * @returns {Promise<{imported:number, checksumBad:number, fromGameTitle:string}>}
     */
    async importFile(file, { allowForeign = false } = {}) {
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new SaveError('bad-file', t('e.badJson', '不是有效的 .wsave 文件（JSON 解析失败）'));
      }
      if (!payload || payload.magic !== WSAVE_MAGIC || payload.format !== WSAVE_FORMAT) {
        throw new SaveError('bad-file', t('e.badMagic', '不是有效的 .wsave 文件（magic/format 不符）'));
      }
      if (payload.gameId !== cfg.gameId && !allowForeign) {
        throw new SaveError('wrong-game', t('e.wrongGame', '该存档来自「{name}」', { name: payload.gameTitle || payload.gameId }), {
          fromGameTitle: payload.gameTitle || payload.gameId,
        });
      }
      if (!Array.isArray(payload.saves) || !payload.saves.length) {
        throw new SaveError('bad-file', t('e.noSlots', '存档文件里没有槽位数据'));
      }
      let imported = 0;
      let checksumBad = 0;
      for (const s of payload.saves) {
        if (!Number.isInteger(s.slot) || s.slot < 1 || s.version == null) {
          checksumBad++;
          continue;
        }
        const json = JSON.stringify(s.data);
        if ((await sha256Hex(json)) !== s.checksum) {
          checksumBad++; // 校验不符：宁可漏进也不写坏档；由 UI 决定是否仍然导入
          continue;
        }
        await tx('readwrite', (st) => {
          st.put({
            key: slotKey(cfg.gameId, s.slot),
            gameId: cfg.gameId,
            slot: s.slot,
            version: s.version,
            savedAt: s.savedAt || new Date().toISOString(),
            checksum: s.checksum,
            size: json.length,
            data: s.data,
          });
        });
        imported++;
      }
      return { imported, checksumBad, fromGameTitle: payload.gameTitle || payload.gameId };
    },

    /* ---------- 持久化状态（三备份第 1 层的可靠性说明） ---------- */

    /** 申请持久化存储 + 读取用量。iOS Safari 约七天不访问即可能清理，未授予时 UI 须提示导出。 */
    async requestPersist() {
      const out = { persisted: false, usage: 0, quota: 0, supported: false };
      try {
        if (navigator.storage && navigator.storage.persist) {
          out.supported = true;
          out.persisted =
            (navigator.storage.persisted && (await navigator.storage.persisted())) ||
            (await navigator.storage.persist());
        }
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          out.usage = est.usage || 0;
          out.quota = est.quota || 0;
        }
      } catch {
        /* 能力检测失败不阻塞游戏 */
      }
      return out;
    },
  };
}
