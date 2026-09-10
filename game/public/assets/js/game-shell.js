/**
 * 焰境之梦 — 统一运行页壳（docs/游戏方案.md §1/§2/§4，阶段一）
 *
 * 职责：/play/<gameId>/ 的运行容器 —— 加载 games.json 元信息 → 动态 import 游戏模块 →
 * 注入 ctx（存档层/自动档/toast/音频解锁/虚拟手柄）→ 承担存档面板、全屏、横竖屏提示、
 * 防误滚、前后台兜底等平台级体验。游戏本体只写玩法与 serialize/deserialize 适配器。
 *
 * 游戏模块契约（ES module 默认导出）：
 *   export default {
 *     version: 1,                                  // 存档版本号（升级时 +1）
 *     async mount(ctx) {},                         // 挂载玩法；ctx.stage 为容器
 *     serialize() { return {...} },                // 存档适配器：导出当前进度（结构化克隆兼容）
 *     deserialize(data, fromVersion) {},           // 存档适配器：载入进度（fromVersion=存档版本）
 *     migrate(data, fromVersion) { return newData } // 可选：旧档迁移；返回 null/抛错 = 迁移失败
 *   }
 *
 * iframe 运行模式（第三方游戏包，docs/游戏整合方案.md §1.3/§1.4）：games.json 里
 *   mode="iframe" + entry="/g/<id>/..." —— 壳不 import 模块，改由 createIframeGame 生成适配器：
 *   同源 iframe 装载游戏包；存档按 saveMode 三档（keys=B 档键快照 ｜ none=C 档不接管）。
 *
 * 本文件顶层只在浏览器环境执行 boot()（Node import 冒烟测试安全）。
 */
import { createSaveLayer, SaveError } from './game-save.js';
import { mountGamepad, FULL_LAYOUT } from './virtual-gamepad.js';
import { t, LANG } from './i18n.js';

const AUTO_SLOT = 1; // 槽位 1 = 自动档
const $ = (sel) => document.querySelector(sel);

/* ---------------- 小工具 ---------------- */

function toast(msg, kind = 'ok') {
  const box = $('#toastBox');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add('toast-out'), 2200);
  setTimeout(() => el.remove(), 2600);
}

/** Promise 化确认框（原生 <dialog>，Esc 取消 = false） */
function confirmDlg(title, body, okText = t('play.ok', '确定')) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDlg');
    $('#dlgTitle').textContent = title;
    $('#dlgBody').textContent = body;
    $('#dlgOk').textContent = okText;
    const done = (v) => {
      dlg.close();
      resolve(v);
    };
    $('#dlgOk').onclick = () => done(true);
    $('#dlgCancel').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtTime = (iso) => {
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 覆盖层（加载中/未找到/崩溃） */
function showBootState(kind, title, desc, actions) {
  const host = $('#bootState');
  host.innerHTML = '';
  host.hidden = false;
  host.className = `boot boot-${kind}`;
  const h = document.createElement('div');
  h.className = 'boot-card';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  h.appendChild(h2);
  if (desc) {
    const p = document.createElement('p');
    p.textContent = desc;
    h.appendChild(p);
  }
  for (const a of actions || []) {
    const b = document.createElement('a');
    b.className = 'btn btn-primary';
    b.href = a.href || '#';
    b.textContent = a.label;
    if (a.onclick) b.onclick = a.onclick;
    h.appendChild(b);
  }
  host.appendChild(h);
}

/* ---------------- iframe 游戏适配器（docs/游戏整合方案.md §1.3/§1.4） ---------------- */

/**
 * 第三方游戏以同源 iframe 运行（R2 反代 /g/*，与宿主同源 → 可直接读写游戏用的 localStorage，
 * 手柄合成键盘事件也能送进游戏文档内部）。存档三档：
 *  - keys（B 档）：saveKeys 登记的 localStorage 键做快照——进入时先回写自动档再开 iframe，
 *    玩耍中周期/切后台/关页时快照进自动档；「载入槽位」= 回写键值并重载 iframe。零改游戏代码。
 *  - none（C 档）：平台不接管，游戏自带浏览器存储（存档面板隐藏，进入时 toast 说明）。
 * 注意：不同收录游戏若用了同名通用键（如 hextris 的 highscores），快照模型下互不污染
 * （各游戏槽位各存各的、进入先回写），但同一浏览器同一时刻只应玩一款——这是 B 档的模型前提。
 */
function createIframeGame(meta) {
  const useKeys = meta.saveMode === 'keys' && Array.isArray(meta.saveKeys) && meta.saveKeys.length > 0;
  const SNAPSHOT_MS = 10000; // 周期快照节奏（游戏自身写档的时机无法感知，周期兜底）

  const snapshotKeys = () => {
    const keys = {};
    for (const k of meta.saveKeys) {
      try {
        const v = localStorage.getItem(k);
        if (v != null) keys[k] = v;
      } catch { /* 隐私模式等场景 localStorage 不可用，按无档处理 */ }
    }
    return { keys };
  };
  const writeKeys = (data) => {
    const map = (data && data.keys) || {};
    try {
      for (const k of meta.saveKeys) {
        if (k in map) localStorage.setItem(k, map[k]);
        else localStorage.removeItem(k);
      }
    } catch { /* 同上 */ }
  };

  let iframe = null;
  let snapTimer = 0;
  let ctxRef = null; // mount 时捕获（存档层在适配器创建之后才建好）
  const onLeave = () => {
    if (!useKeys || !iframe || !ctxRef) return;
    try { ctxRef.saves.save(AUTO_SLOT, snapshotKeys()).catch(() => {}); } catch { /* 不阻塞 */ }
  };

  return {
    version: meta.version || 1,
    async mount(ctx) {
      ctxRef = ctx;
      // 进入前先回写自动档（快照模型：先回写、再开游戏）
      if (useKeys) {
        try {
          const r = await ctx.saves.load(AUTO_SLOT);
          if (r.status !== 'empty') writeKeys(r.data);
        } catch { /* 无档或读失败：按新档开局 */ }
      }
      iframe = document.createElement('iframe');
      iframe.className = 'game-frame';
      // 收录游戏均经人工核对上架（同源可控）；sandbox 收掉 top-navigation/popups 防游戏包逃逸
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock');
      iframe.allow = 'fullscreen';
      iframe.setAttribute('allowfullscreen', '');
      iframe.src = meta.entry;
      ctx.stage.appendChild(iframe);

      // 虚拟手柄：合成键盘事件跨不进 iframe，转发派发到游戏文档内部（body 起冒泡，
      // body/document/window 三种监听位置全部可达；个别校验 isTrusted 的游戏不支持，逐款验收）
      if (ctx.gamepad) {
        ctx.gamepad.setDispatchTarget(() => {
          const d = iframe && iframe.contentDocument;
          return d ? d.body || d.documentElement : null;
        });
      }

      if (useKeys) {
        snapTimer = setInterval(() => ctx.autosave(snapshotKeys()), SNAPSHOT_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) onLeave();
        });
        addEventListener('pagehide', onLeave); // 直接关页时的最后快照（尽力而为）
      }
    },
    serialize() {
      return useKeys ? snapshotKeys() : null;
    },
    async deserialize(data) {
      if (!useKeys) return;
      writeKeys(data);
      if (iframe) iframe.src = meta.entry; // 重载 iframe，让游戏以存档状态重启
    },
  };
}

/* ---------------- 存档面板 ---------------- */

function wireDrawer(shell) {
  const drawer = $('#saveDrawer');
  $('#btnSaves').addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) shell.refreshSlots();
  });

  $('#btnExport').addEventListener('click', async () => {
    try {
      const out = await shell.saves.exportSlots(); // 全部已有槽位
      download(out.blob, out.filename);
      toast(t('s.exported', '已导出 {name}', { name: out.filename }));
    } catch (e) {
      toast(e.code === 'empty' ? t('s.exportEmpty', '还没有任何存档可导出') : t('s.exportFail', '导出失败：{msg}', { msg: e.message }), 'err');
    }
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await shell.saves.importFile(file);
      toast(t('s.imported', '已导入 {n} 个槽位', { n: r.imported }) + (r.checksumBad ? t('s.importedBad', '（{n} 个槽位校验不符被跳过）', { n: r.checksumBad }) : ''), r.checksumBad ? 'warn' : 'ok');
      shell.refreshSlots();
    } catch (err) {
      if (err.code === 'wrong-game') {
        const ok = await confirmDlg(t('s.wrongGameTitle', '存档来自其他游戏'), t('s.wrongGameBody', '该 .wsave 来自「{name}」，与当前游戏不符。仍要强行导入吗？', { name: err.info.fromGameTitle }), t('s.forceImport', '强行导入'));
        if (!ok) return;
        try {
          const r = await shell.saves.importFile(file, { allowForeign: true });
          toast(t('s.forcedImported', '已强行导入 {n} 个槽位（来源：{name}）', { n: r.imported, name: r.fromGameTitle }), 'warn');
          shell.refreshSlots();
        } catch (e2) {
          toast(t('s.importFail', '导入失败：{msg}', { msg: e2.message }), 'err');
        }
      } else {
        toast(t('s.importFail', '导入失败：{msg}', { msg: err.message }), 'err');
      }
    }
  });
}

function renderStorageLine(el, persist) {
  if (!el) return;
  if (!persist.supported) {
    el.textContent = t('persist.unsupported', '当前浏览器不支持存储持久化，建议勤用「导出存档」备份。');
    return;
  }
  el.textContent =
    (persist.persisted ? t('persist.granted', '已授予持久化存储，日常清缓存不会清掉游戏存档。') : t('persist.denied', '未授予持久化存储：浏览器空间紧张时可能清理存档。')) +
    (persist.quota ? t('persist.quota', ' 已用 {used} / 配额 {quota}。', { used: fmtBytes(persist.usage), quota: fmtBytes(persist.quota) }) : '');
  el.classList.toggle('warn', !persist.persisted);
}

/* ---------------- 壳主体 ---------------- */

async function boot() {
  const gameId = (location.pathname.match(/^\/(?:en\/)?play\/([\w.-]+)/) || [])[1] || null; // 与 worker PLAY_RE(_EN) 一致：允许 id 含点（minecraft-1.8），允许 /en 前缀
  const shell = { gameId, meta: null, saves: null, gamepad: null, game: null };

  /* 顶栏：全屏 + 手柄开关（有手柄配置的游戏才出现） */
  $('#btnFullscreen').addEventListener('click', async () => {
    const wrap = document.querySelector('.stage-wrap') || document.documentElement; // 只全屏游玩区：顶栏留在容器外，浏览器自动隐藏
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await wrap.requestFullscreen();
      else document.body.classList.toggle('pseudo-full'); // iOS Safari 无元素全屏：藏掉顶栏顶一格
    } catch {
      document.body.classList.toggle('pseudo-full');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    $('#btnFullscreen').textContent = document.fullscreenElement ? t('play.exitFullscreen', '退出全屏') : t('play.fullscreen', '全屏');
    // 焦点回笼：全屏切换后 iframe 键盘游戏会失焦（activeElement=BODY，体感=卡死），把焦点还给游戏
    const gf = document.querySelector('#stage > iframe.game-frame');
    if (gf) { try { gf.contentWindow.focus(); } catch { /* 跨域 iframe 忽略 */ } gf.focus?.(); }
  });

  /* 键盘防误滚（方向键/空格在游玩时不滚页面；游戏自己 preventDefault 的先行） */
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && e.target === document.body) {
      e.preventDefault();
    }
  });

  if (!gameId) {
    $('#btnSaves').disabled = true;
    $('#btnFullscreen').disabled = true;
    showBootState('err', t('b.noGameTitle', '没有指定游戏'), t('b.noGameDesc', '从游戏库选择一款游戏开始玩。'), [{ label: t('b.back', '返回游戏库'), href: '/' }]);
    return;
  }

  /* 元信息 + 游戏模块 */
  showBootState('loading', t('b.loading', '加载中…'), t('b.loadingDesc', '正在启动游戏引擎（全程本地运行，不依赖服务器）。'));
  let meta;
  try {
    const list = await (await fetch('/games.json', { cache: 'no-cache' })).json();
    // EN 路径：叠加 games.en.json 展示字段（缺省落回中文——决策③；机制字段以母本为准）
    let en = null;
    if (LANG === 'en') {
      try { en = await (await fetch('/games.en.json', { cache: 'no-cache' })).json(); } catch { /* 无覆盖表按 zh 兜底 */ }
    }
    meta = (list.games || []).find((g) => g.id === gameId);
    if (meta && en && en.games && en.games[meta.id]) meta = { ...meta, ...en.games[meta.id] };
  } catch {
    meta = null;
  }
  if (!meta) {
    showBootState('err', t('b.notFoundTitle', '没有找到这款游戏'), t('b.notFoundDesc', '游戏 id「{id}」不在游戏库里（可能已下架或链接有误）。', { id: gameId }), [{ label: t('b.back', '返回游戏库'), href: '/' }]);
    return;
  }
  shell.meta = meta;
  document.title = `${meta.title} — ${t('ui.brandSuffix', '焰境之梦')}`;
  $('#tbTitle').textContent = meta.title;
  // 存档三档（docs/游戏整合方案.md §1.4）：module 游戏=自研适配器；iframe 游戏=keys 键快照｜none 不接管
  shell.saveMode = meta.mode === 'iframe' ? (meta.saveMode === 'keys' ? 'keys' : 'none') : 'adapter';
  if (shell.saveMode === 'none') $('#btnSaves').hidden = true; // C 档：游戏自带浏览器存储，面板不适用

  let game;
  try {
    // iframe 模式（第三方游戏包）不走模块 import，由适配器装载（docs/游戏整合方案.md §1.3）
    game = meta.mode === 'iframe' ? createIframeGame(meta) : (await import(meta.entry)).default; // 动态 import 给的是命名空间，游戏本体在 .default
  } catch (e) {
    showBootState('err', t('b.loadFailTitle', '游戏加载失败'), t('b.loadFailDesc', '资源下载中断或浏览器不支持所需能力，可重试。'), [
      { label: t('b.reload', '重新加载'), onclick: () => location.reload() },
      { label: t('b.back', '返回游戏库'), href: '/' },
    ]);
    console.error('[game] import failed:', e);
    return;
  }
  if (!game || typeof game.mount !== 'function' || typeof game.serialize !== 'function' || typeof game.deserialize !== 'function') {
    showBootState('err', t('b.incompleteTitle', '游戏模块不完整'), t('b.incompleteDesc', '该游戏未实现平台要求的存档适配器（serialize/deserialize），按方案 §2 不得上架。'));
    return;
  }
  shell.game = game;

  /* 存档层（每游戏一个实例 = 方案 §2 的 adapter）+ 持久化申请 */
  shell.saves = createSaveLayer({
    gameId,
    gameTitle: meta.title,
    version: game.version || 1,
    migrate: game.migrate,
  });
  const persist = await shell.saves.requestPersist();
  if (persist.supported && !persist.persisted) {
    const banner = $('#persistBanner');
    banner.hidden = false;
    $('#persistClose').onclick = () => (banner.hidden = true);
  }

  /* 虚拟手柄：meta.gamepad 为 true 时装配（粗指针设备默认可见，细指针可从顶栏开） */
  if (meta.gamepad) {
    $('#btnPad').hidden = false;
    shell.gamepad = mountGamepad($('#padHost'), {
      layout: meta.gamepadLayout || FULL_LAYOUT,
      keymap: meta.gamepadKeymap, // 键盘向游戏键位不同的收录游戏（如坦克大战 P1=WASD+J）按 games.json 覆盖
    });
    if (matchMedia('(pointer: coarse)').matches) {
      $('#padHost').classList.add('pad-on');
    } else {
      $('#btnPad').addEventListener('click', () => {
        const on = $('#padHost').classList.toggle('pad-on');
        toast(on ? t('pad.on', '虚拟手柄已开启') : t('pad.off', '虚拟手柄已关闭'));
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) shell.gamepad.releaseAll(); // 防切后台键卡死
    });
  }

  /* 横竖屏提示 */
  const checkOrient = () => {
    const want = meta.orientation;
    const bad = want === 'landscape' && innerHeight > innerWidth;
    $('#orientHint').hidden = !bad;
  };
  addEventListener('resize', checkOrient);
  checkOrient();

  /* 存档面板 */
  const refreshSlots = async () => {
    shell.slotMetas = await shell.saves.listSlots(3);
    const grid = $('#slotGrid');
    grid.innerHTML = '';
    shell.slotMetas.forEach((m, i) => {
      const slot = i + 1;
      const card = document.createElement('div');
      card.className = 'slot-card' + (m ? '' : ' slot-empty');
      const head = document.createElement('div');
      head.className = 'slot-head';
      head.innerHTML = `<b>${slot === AUTO_SLOT ? t('sl.auto', '自动档') : t('sl.slot', '槽位 {n}', { n: slot })}</b><span>${m ? `v${m.version} · ${fmtTime(m.savedAt)}` : t('sl.empty', '空')}</span>`;
      card.appendChild(head);
      const row = document.createElement('div');
      row.className = 'slot-ops';
      const mk = (label, fn, cls = 'btn-mini') => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = fn;
        return b;
      };
      row.appendChild(mk(t('sl.load', '载入'), () => shell.loadSlot(slot)));
      if (slot !== AUTO_SLOT) row.appendChild(mk(t('sl.save', '保存'), () => shell.saveSlot(slot)));
      if (m) row.appendChild(mk(t('sl.del', '删除'), () => shell.removeSlot(slot), 'btn-mini btn-danger'));
      card.appendChild(row);
      grid.appendChild(card);
    });
    renderStorageLine($('#storageLine'), persist);
  };
  shell.refreshSlots = refreshSlots;
  wireDrawer(shell);

  /* 槽位操作（版本策略：警告+尝试迁移，禁止硬拒载 —— 方案 §2） */
  shell.saveSlot = async (slot) => {
    try {
      await shell.saves.save(slot, shell.game.serialize());
      toast(t('sl.saved', '已保存到槽位 {n}', { n: slot }));
      refreshSlots();
    } catch (e) {
      toast(t('sl.saveFail', '保存失败：{msg}', { msg: e.message }), 'err');
    }
  };
  shell.loadSlot = async (slot) => {
    let r;
    try {
      r = await shell.saves.load(slot);
    } catch (e) {
      toast(t('sl.loadFail', '读取失败：{msg}', { msg: e.message }), 'err');
      return;
    }
    if (r.status === 'empty') return toast(t('sl.emptySlot', '该槽位还没有存档'), 'warn');
    if (r.status === 'newer-version') {
      const ok = await confirmDlg(t('sl.newerTitle', '存档来自更新版本'), t('sl.newerBody', '该存档版本 v{save} 高于当前游戏 v{cur}，载入可能出现异常。仍要载入吗？', { save: r.meta.version, cur: shell.game.version }), t('sl.loadAnyway', '仍要载入'));
      if (!ok) return;
    }
    if (r.status === 'migrate-failed') {
      const ok = await confirmDlg(t('sl.migrateFailTitle', '旧版存档迁移失败'), t('sl.migrateFailBody', '存档是 v{v}，自动迁移失败：{reason}。仍要按旧格式载入吗？', { v: r.meta.version, reason: r.error ? r.error.message : t('sl.noMigrate', '游戏未提供迁移函数') }), t('sl.loadAnyway', '仍要载入'));
      if (!ok) return;
    }
    try {
      shell.game.deserialize(structuredClone(r.data), r.meta.version);
      toast(
        r.status === 'migrated' ? t('sl.loadedMigrated', '已载入并迁移到 v{v}', { v: shell.game.version })
        : r.status === 'ok' ? t('sl.loaded', '已载入')
        : t('sl.loadedOld', '已按旧格式载入'),
        r.status === 'ok' ? 'ok' : 'warn'
      );
      if (r.status === 'migrated') refreshSlots();
    } catch (e) {
      toast(t('sl.applyFail', '载入失败（存档数据无法应用）：{msg}', { msg: e.message }), 'err');
    }
  };
  shell.removeSlot = async (slot) => {
    const ok = await confirmDlg(t('sl.delTitle', '删除存档'), t('sl.delBody', '确定删除槽位 {slot} 的存档？此操作不可恢复。', { slot: slot === AUTO_SLOT ? t('sl.autoSlot', '1（自动档）') : slot }), t('sl.del', '删除'));
    if (!ok) return;
    await shell.saves.remove(slot);
    toast(t('sl.deleted', '已删除'));
    refreshSlots();
  };

  /* 注入游戏 ctx */
  const stage = $('#stage');
  let audioReady = false;
  const audioCbs = [];
  const unlockAudio = () => {
    if (audioReady) return;
    audioReady = true;
    for (const cb of audioCbs) { try { cb(); } catch { /* 游戏侧自兜 */ } }
  };
  addEventListener('pointerdown', unlockAudio, { once: true });
  addEventListener('keydown', unlockAudio, { once: true });

  let autosaveTimer = 0;
  const ctx = {
    meta,
    stage,
    saves: shell.saves,
    toast,
    /** 音频解锁（iOS 需用户手势后才能出声）：回调里创建/恢复 AudioContext */
    onFirstGesture(cb) {
      if (audioReady) cb();
      else audioCbs.push(cb);
    },
    /** 自动档：去抖写入槽位 1（游戏在关键节点调用，如每步/每关） */
    autosave(data) {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        shell.saves.save(AUTO_SLOT, data).catch(() => {});
      }, 600);
    },
    gamepad: shell.gamepad,
  };

  /* 前后台兜底：切后台把自动档落盘（C 档无平台存档，跳过） */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && shell.game && shell.saveMode !== 'none') {
      clearTimeout(autosaveTimer);
      try { shell.saves.save(AUTO_SLOT, shell.game.serialize()).catch(() => {}); } catch { /* 不阻塞 */ }
    }
  });

  /* 自动档回放（仅 module 游戏；iframe B 档在 createIframeGame.mount 内自行回写）：
     mount 建局后把槽位 1 的自动档回放进棋盘——此前壳对自动档只写不读，
     自研游戏刷新即丢进度（2026-09-09 i18n 验收发现的预存在缺口，顺手修复）。
     回放失败不硬拒载：按新档开局（对齐方案 §2 版本策略）。 */
  let autoRestore = null;
  if (shell.saveMode === 'adapter') {
    try {
      const r = await shell.saves.load(AUTO_SLOT);
      if (r.status !== 'empty' && r.data) autoRestore = r;
    } catch { /* 无档或读失败：按新档开局 */ }
  }

  try {
    await game.mount(ctx);
    if (autoRestore) {
      try {
        game.deserialize(structuredClone(autoRestore.data), autoRestore.meta.version);
        ctx.autosave(game.serialize()); // 回放后立即落盘，压掉 mount 时的新局去抖写（600ms 内生效）
      } catch (e) {
        console.warn('[game] autosave restore failed, starting fresh:', e);
      }
    }
    $('#bootState').hidden = true;
    if (meta.gamepad) $('#padHost').classList.add('ready');
    if (shell.saveMode === 'none') toast(t('sl.cStorage', '该游戏使用浏览器自带存储，进度保存在本机。'));
    // 纯键盘游戏提示（魔塔50层3D 等原版菜单不支持鼠标点选，2026-09-10 业主拍板）：
    // 进页即提示一次（快加载游戏可见）；首次点击游戏区再补一次——慢加载游戏进页那条早停了，恰好点菜单没反应时才最需要。
    // 注意 pointerdown 不跨 iframe 文档：iframe 游戏要挂进游戏文档内部（load 后取新 doc），module 游戏挂 stage 即可
    if (meta.keyboardOnly) {
      const kbHint = () => toast(t('play.kbOnly', '本游戏需键盘操作：方向键选择/移动，Enter 确认。'));
      setTimeout(kbHint, 600);
      const frame = document.querySelector('#stage > iframe.game-frame');
      if (frame) {
        frame.addEventListener('load', () => {
          try { frame.contentDocument.addEventListener('pointerdown', kbHint, { once: true }); } catch { /* 跨域兜底：进页那条已覆盖 */ }
        }, { once: true });
      } else {
        $('#stage').addEventListener('pointerdown', kbHint, { once: true });
      }
    }
  } catch (e) {
    console.error('[game] mount failed:', e);
    showBootState('err', t('b.mountFailTitle', '游戏启动失败'), String((e && e.message) || e), [
      { label: t('b.reload', '重新加载'), onclick: () => location.reload() },
      { label: t('b.back', '返回游戏库'), href: '/' },
    ]);
  }
}

if (typeof document !== 'undefined') {
  boot();
}
