/**
 * 焰境游戏 — 运行时 i18n（docs/游戏英文版方案.md §3.2/§3.3，Whizzzest Arcade）
 *
 * 设计（零构建子站的轻量双语）：
 *  - locale 由 URL 路径前缀判定（/en、/en/* → en，其余 zh），不产出任何英文页面副本；
 *  - zh 文案留在调用点（HTML 原文 / t() 第二参兜底），EN 译文集中在本文件字典；
 *  - en 缺条目自动落回 zh（决策③「英文优先、中文温和兜底」），任何语言 UI 永远完整；
 *  - 静态页标记：data-i18n（textContent）/ data-i18n-html（innerHTML，<br><em> 等富文本）/
 *    data-i18n-aria（aria-label）/ data-i18n-content（content 属性，meta description 用）/
 *    data-i18n-href（链接目标，跨站语言连续性：EN 回主站 / 各页返回键落对应语言版）；
 *  - EN 404：worker 把 /en/* miss 重写到 /404.html，浏览器地址仍是 /en/...，
 *    pathname 前缀判定天然成立，无需语言标记参数；
 *  - 顶层不碰浏览器 API —— Node import 冒烟测试安全（game-save 依赖）。
 */

/* ================= EN 字典（欠账检查：game/scripts/check-i18n.mjs 按键扫描） ================= */

const EN_STRINGS = {
  /* 列表页 index.html */
  'home.title': 'Whizzzest Arcade — short, finishable browser games',
  'home.metaDesc': 'Whizzzest Arcade — a browser game platform: short games you can finish, play instantly, no downloads, reliable local saves, works offline.',
  'home.brand': 'Whizzzest Arcade',
  'home.brandHref': '/en/',
  'home.mainSite': '← Whizzzest main site',
  'home.mainSiteHref': 'https://whizzzest.com/en/',
  'home.kicker': 'Short & finishable',
  'home.heroTitle': 'Quality games you can <em>finish</em><br>in a class break or a bus ride',
  'home.heroDesc': 'Runs entirely in your browser — play instantly, no downloads, works offline. Every game is 20–90 minutes, has an ending and can be finished in one sitting. Saves are triple-protected: browser persistence + one-click .wsave export + cloud backup (coming soon).',
  'home.loading': 'Loading games…',
  'home.moreTitle': 'More games coming soon',
  'home.moreSub': 'Puzzle · narrative · rhythm · original local themes (phase two)',
  'home.loadFail': 'Failed to load the game library',
  'home.loadFailHint': 'Please refresh and try again',
  'home.footBrand': 'Whizzzest Arcade',
  'home.footMain': 'Whizzzest — visitor guide to Wanzai, home of Chinese fireworks',
  'home.footMainHref': 'https://whizzzest.com/en/',
  'home.footPrivacy': 'All games run locally in your browser, with no server involved; progress stays on your device and can be exported as a .wsave file for backup or sharing.',

  /* 云端畅玩（决策②：EN 保留分区，标注面向中国大陆） */
  'cloud.title': 'Cloud gaming',
  'cloud.sub': 'Want bigger titles? These official cloud gaming platforms run right in the browser — no download.',
  'cloud.note': 'The platforms above are third-party cloud gaming services serving mainland China and are unrelated to this site; they require sign-in, and some content is time-limited or paid.',
  'chip.thirdParty': 'Third-party platform',
  'cloud.visit': 'Visit platform ↗',

  /* 游戏卡与渲染脚本 */
  'chip.game': 'Game',
  'card.play': 'Play',
  'card.short': 'Short session',
  'card.controlsDefault': 'Touch / keyboard',

  /* 运行页壳 app.html */
  'play.title': 'Whizzzest Arcade',
  'play.back': 'Back to the game library',
  'play.backHref': '/en/',
  'play.tbTitle': 'Whizzzest Arcade',
  'play.pad': 'Pad',
  'play.saves': 'Saves',
  'play.fullscreen': 'Fullscreen',
  'play.exitFullscreen': 'Exit fullscreen',
  'play.persistBanner': 'The browser has not granted persistent storage: local saves may be cleared when space runs tight. Back up with "Export all (.wsave)" now and then.',
  'play.closeHint': 'Dismiss',
  'play.orient': 'Landscape recommended<br>(you get the full view and controls in landscape)',
  'play.saveDrawer': 'Saves <small>Local IndexedDB · works offline · cloud backup coming soon</small>',
  'play.exportAll': 'Export all (.wsave)',
  'play.import': 'Import .wsave',
  'play.cancel': 'Cancel',
  'play.ok': 'OK',

  /* 存档面板 / 导入导出（game-shell.js） */
  's.exported': 'Exported {name}',
  's.exportEmpty': 'No saves to export yet',
  's.exportFail': 'Export failed: {msg}',
  's.imported': 'Imported {n} slot(s)',
  's.importedBad': ' ({n} skipped: checksum mismatch)',
  's.wrongGameTitle': 'Save file from another game',
  's.wrongGameBody': 'This .wsave comes from "{name}" and does not match the current game. Force-import anyway?',
  's.forceImport': 'Force import',
  's.forcedImported': 'Force-imported {n} slot(s) (from {name})',
  's.importFail': 'Import failed: {msg}',

  /* 存储持久化说明行 */
  'persist.unsupported': 'Persistent storage is not supported in this browser — export saves as backup regularly.',
  'persist.granted': 'Persistent storage granted: clearing site data will not remove your saves.',
  'persist.denied': 'Persistent storage not granted: the browser may clear saves when space runs low.',
  'persist.quota': ' Used {used} of a {quota} quota.',

  /* boot 覆盖层（加载/未找到/失败） */
  'b.noGameTitle': 'No game selected',
  'b.noGameDesc': 'Pick a game from the library to start playing.',
  'b.back': 'Back to the library',
  'b.loading': 'Loading…',
  'b.loadingDesc': 'Starting the game engine (everything runs locally — no server involved).',
  'b.notFoundTitle': 'Game not found',
  'b.notFoundDesc': 'Game id "{id}" is not in the library (removed, or the link is wrong).',
  'b.loadFailTitle': 'Failed to load the game',
  'b.loadFailDesc': 'Download interrupted, or the browser lacks a required capability — you can retry.',
  'b.reload': 'Reload',
  'b.incompleteTitle': 'Incomplete game module',
  'b.incompleteDesc': 'This game does not implement the save adapter (serialize/deserialize) required by the platform spec, and cannot be listed.',
  'b.mountFailTitle': 'Game failed to start',
  'ui.brandSuffix': 'Whizzzest Arcade',

  /* 虚拟手柄 */
  'pad.on': 'Virtual gamepad on',
  'pad.off': 'Virtual gamepad off',

  /* 存档槽位面板 */
  'sl.auto': 'Autosave',
  'sl.slot': 'Slot {n}',
  'sl.empty': 'Empty',
  'sl.load': 'Load',
  'sl.save': 'Save',
  'sl.del': 'Delete',
  'sl.saved': 'Saved to slot {n}',
  'sl.saveFail': 'Save failed: {msg}',
  'sl.loadFail': 'Load failed: {msg}',
  'sl.emptySlot': 'No save in this slot yet',
  'sl.newerTitle': 'Save from a newer version',
  'sl.newerBody': 'Save version v{save} is newer than the current game v{cur}; loading may misbehave. Load anyway?',
  'sl.loadAnyway': 'Load anyway',
  'sl.migrateFailTitle': 'Old save migration failed',
  'sl.migrateFailBody': 'Save is v{v} but automatic migration failed: {reason}. Load it in the old format anyway?',
  'sl.noMigrate': 'the game provides no migration function',
  'sl.loadedMigrated': 'Loaded and migrated to v{v}',
  'sl.loaded': 'Loaded',
  'sl.loadedOld': 'Loaded in old format',
  'sl.applyFail': 'Load failed (save data could not be applied): {msg}',
  'sl.delTitle': 'Delete save',
  'sl.delBody': 'Delete the save in slot {slot}? This cannot be undone.',
  'sl.autoSlot': '1 (autosave)',
  'sl.deleted': 'Deleted',
  'sl.cStorage': 'This game manages its own storage in the browser — progress stays on your device.',

  /* 存档层错误消息（game-save.js，经 toast 透出） */
  'e.noIdb': 'IndexedDB is not available in this environment',
  'e.idbOpen': 'Failed to open IndexedDB',
  'e.tx': 'Save transaction failed',
  'e.txAbort': 'Save transaction aborted',
  'e.badSlot': 'Invalid slot {n}',
  'e.exportEmpty': 'No saves to export',
  'e.badJson': 'Not a valid .wsave file (JSON parsing failed)',
  'e.badMagic': 'Not a valid .wsave file (magic/format mismatch)',
  'e.wrongGame': 'This save comes from "{name}"',
  'e.noSlots': 'The save file contains no slot data',

  /* 自研游戏 · 花炮合合（huapao2048.js） */
  'g.t2': 'Paper Fuse',
  'g.t4': 'Gunpowder',
  'g.t8': 'Firecracker',
  'g.t16': 'Dadihong',
  'g.t32': 'Double Bang',
  'g.t64': 'Bottle Rocket',
  'g.t128': 'Gatling Barrage',
  'g.t256': 'Peacock Fan',
  'g.t512': 'Brocade Crown',
  'g.t1024': 'Thousand Wheels',
  'g.t2048': 'Kiss of Flames',
  'g.t4096': 'Kiss of Flames+',
  'g.t8192': 'Kiss of Flames++',
  'g.legendary': 'Legendary',
  'g.title': 'Firecracker Merge',
  'g.best': 'Best',
  'g.score': 'Score',
  'g.hint': 'Swipe the whole board — all tiles move together, and equal tiles merge on contact.',
  'g.howToast': 'Swipe / arrow keys / on-screen D-pad (top-bar Pad): merge equal tiles and build the Kiss of Flames (2048)',
  'g.wonToast': 'Kiss of Flames! Keep merging for more 🔥',
  'g.overTitle': 'The powder got damp — game over',
  'g.overStats': 'Score {s} · Best {b}',
  'g.again': 'New batch',
  'g.newBatch': 'A fresh batch — merge away!',
  'g.badGrid': 'Save board size mismatch',

  /* 自研游戏 · 接烟花（catch-fireworks.js，canvas 文字） */
  'c.how': 'Arrows / drag to move · Space to start',
  'c.score': 'Score {s}  Best {b}',
  'c.idle1': 'The night sky is dropping fireworks',
  'c.idle2': 'Catch them! Drop three and the show ends',
  'c.start': 'Click / tap, or press Space to start',
  'c.over': "Show's over!",
  'c.result': 'This run {s} · Best {b}',
  'c.again': 'Click / tap, or press Space to go again',

  /* 404 页 */
  'nf.title': '404 — Whizzzest Arcade',
  'nf.h': 'This page never caught fire',
  'nf.p': "The page you're looking for doesn't exist or has been removed.",
  'nf.back': 'Back to the game library',
  'nf.backHref': '/en/',
};

/* ================= 引擎 ================= */

/** 当前语言：URL 路径前缀判定（Node 冒烟环境无 location，按 zh） */
export const LANG = (() => {
  if (typeof location === 'undefined') return 'zh';
  const p = location.pathname;
  return p === '/en' || p.startsWith('/en/') ? 'en' : 'zh';
})();

/**
 * 取串：en 优先查字典，缺失落回 zh 兜底（决策③）。
 * 字典值与兜底串都支持 {name} 占位符（params 提供）。
 */
export function t(key, zhFallback, params) {
  let s = LANG === 'en' && EN_STRINGS[key] != null ? EN_STRINGS[key] : zhFallback;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  return s;
}

/** 静态页扫描替换（页面加载时调用一次；zh 无需动 DOM） */
export function applyStatic(root = document) {
  if (LANG !== 'en') return;
  document.documentElement.lang = 'en';
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const v = EN_STRINGS[el.dataset.i18n];
    if (v != null) el.textContent = v;
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const v = EN_STRINGS[el.dataset.i18nHtml];
    if (v != null) el.innerHTML = v;
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    const v = EN_STRINGS[el.dataset.i18nAria];
    if (v != null) el.setAttribute('aria-label', v);
  }
  for (const el of root.querySelectorAll('[data-i18n-content]')) {
    const v = EN_STRINGS[el.dataset.i18nContent];
    if (v != null) el.setAttribute('content', v);
  }
  // 跨页/跨站链接的语言连续性（2026-09-09 上线后修订）：EN 模式改写 href，
  // 让「返回游戏库」「回主站」等导航落在对应语言版本，而不是把英文用户送回中文页
  for (const el of root.querySelectorAll('[data-i18n-href]')) {
    const v = EN_STRINGS[el.dataset.i18nHref];
    if (v != null) el.setAttribute('href', v);
  }
}

/* 欠账检查用（game/scripts/check-i18n.mjs 引入，不参与运行时） */
export { EN_STRINGS };
