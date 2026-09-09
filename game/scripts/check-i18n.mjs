/**
 * i18n 欠账检查（docs/游戏英文版方案.md §6.3，决策③配套）：只报告、不拦截。
 *
 *  1) 元数据覆盖：games.json 每个游戏 / 平台在 games.en.json 是否有覆盖表，
 *     并列出缺的展示字段（EN 列表页会以中文兜底显示这些字段）；
 *  2) 字典欠账：源码 t('key') 调用与 data-i18n* 标记引用的键是否都在 i18n.js 的
 *     EN 字典里（缺 → EN 界面该处静默显示中文）；
 *  3) 孤儿键：字典里从未被引用的键（多为调用点改名后的遗留，宜清理）。
 *
 * 运行：node game/scripts/check-i18n.mjs   （无依赖，仅 Node 内置模块）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');

const DISPLAY_FIELDS = ['title', 'tagline', 'genre', 'duration', 'controls', 'deviceNote', 'badge'];
const PLATFORM_FIELDS = ['title', 'tagline', 'note'];

let problems = 0;

/* ---------- 1) 元数据覆盖 ---------- */
const zh = JSON.parse(fs.readFileSync(path.join(pub, 'games.json'), 'utf8'));
let en = null;
try {
  en = JSON.parse(fs.readFileSync(path.join(pub, 'games.en.json'), 'utf8'));
} catch {
  console.error('✗ games.en.json 无法读取（EN 全量中文兜底）');
  problems++;
}

console.log('== 元数据覆盖（games.en.json）==');
if (en) {
  for (const g of zh.games || []) {
    const ov = (en.games || {})[g.id];
    if (!ov) {
      console.log(`○ ${g.id}：无覆盖表（EN 显示中文卡）`);
      continue;
    }
    const missing = DISPLAY_FIELDS.filter((f) => g[f] != null && ov[f] == null);
    console.log(missing.length ? `△ ${g.id}：缺 ${missing.join(', ')}` : `✓ ${g.id}`);
  }
  for (const p of zh.platforms || []) {
    const ov = (en.platforms || {})[p.id];
    if (!ov) {
      console.log(`○ ${p.id}：无覆盖表`);
      continue;
    }
    const missing = PLATFORM_FIELDS.filter((f) => p[f] != null && ov[f] == null);
    console.log(missing.length ? `△ ${p.id}：缺 ${missing.join(', ')}` : `✓ ${p.id}`);
  }
  // 机制字段混入覆盖表 → 数据分叉风险（方案 §3.2 字段边界）
  const MECH = ['mode', 'entry', 'saveMode', 'saveKeys', 'keyboardOnly', 'gamepad', 'gamepadLayout', 'gamepadKeymap', 'orientation', 'version', 'tier'];
  for (const [id, ov] of Object.entries(en.games || {})) {
    const bad = MECH.filter((f) => f in ov);
    if (bad.length) {
      console.error(`✗ ${id}：覆盖表混入机制字段 ${bad.join(', ')}（违反字段边界，会覆盖母本行为）`);
      problems++;
    }
  }
}

/* ---------- 2) 字典欠账（t() 调用 + data-i18n 标记） ---------- */
// i18n.js 是浏览器 ES module（仓库无 "type":"module"），Node 侧经 data: URL 导入
const i18nSrc = fs.readFileSync(path.join(pub, 'assets', 'js', 'i18n.js'), 'utf8');
const { EN_STRINGS } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(i18nSrc));
const dictKeys = new Set(Object.keys(EN_STRINGS));

const SOURCES = [
  'index.html',
  'play/app.html',
  '404.html',
  'assets/js/game-shell.js',
  'assets/js/game-save.js',
  'assets/js/games/huapao2048.js',
  'assets/js/games/catch-fireworks.js',
];

const used = new Set();
const dynPrefixes = new Set(); // 动态拼接键：t('g.t' + v, ...) —— 基前缀之下的字典键视为已引用
console.log('\n== 字典欠账（引用了但 EN 字典没有的键）==');
for (const rel of SOURCES) {
  const text = fs.readFileSync(path.join(pub, rel), 'utf8');
  for (const m of text.matchAll(/\bt\(\s*'([^']*)'\s*([,)+])/g)) {
    if (m[2] === '+') dynPrefixes.add(m[1]);
    else used.add(m[1]);
  }
  for (const m of text.matchAll(/data-i18n(?:-html|-aria|-content|-href)?="([^"]+)"/g)) used.add(m[1]);
}
for (const p of dynPrefixes) {
  for (const k of dictKeys) if (k.startsWith(p)) used.add(k);
  console.log(`ℹ 动态键前缀「${p}」：字典中 ${[...dictKeys].filter((k) => k.startsWith(p)).length} 个键视为已引用`);
}
const missingKeys = [...used].filter((k) => !dictKeys.has(k));
if (missingKeys.length) {
  for (const k of missingKeys) console.error(`✗ 缺字典键：${k}（EN 处将显示中文兜底）`);
  problems += missingKeys.length;
} else {
  console.log('✓ 无——所有引用键都有 EN 译文');
}

/* ---------- 3) 孤儿键 ---------- */
console.log('\n== 孤儿键（字典里没人引用）==');
const orphans = [...dictKeys].filter((k) => !used.has(k));
if (orphans.length) {
  for (const k of orphans) console.log(`△ ${k}`);
} else {
  console.log('✓ 无');
}

console.log(`\n欠账检查完成：${problems ? `${problems} 项待补（只提醒不拦截）` : '全部干净'}`);
process.exit(0);
