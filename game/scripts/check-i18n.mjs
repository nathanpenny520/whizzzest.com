/**
 * i18n 欠账检查（docs/游戏英文版方案.md §6.3/§8.7，决策③配套）：只报告、不拦截（漂移检查除外）。
 *
 *  1) 元数据覆盖：games.json 每个游戏 / 平台在 games.en.json 是否有覆盖表，
 *     并列出缺的展示字段（EN 列表页会以中文兜底显示这些字段）；
 *  2) 字典欠账：模板 {{t.key}} 占位符与 JS t('key') 调用引用的键是否都在字典里——
 *     模板键须 zh/en 双字典齐备（两边都要烘），JS 键须 en 字典齐备（zh 兜底在代码调用点）；
 *  3) 孤儿键：en 字典里从未被引用的键（多为调用点改名后的遗留，宜清理）；
 *  4) 产物漂移：模板/字典改了但没跑 build-game.mjs → 报错退出（此项拦截，防部署过期产物）。
 *
 * 运行：node game/scripts/check-i18n.mjs   （无依赖，仅 Node 内置模块）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.join(here, '..');
const pub = path.join(gameDir, 'public');

const DISPLAY_FIELDS = ['title', 'tagline', 'genre', 'duration', 'controls', 'deviceNote', 'badge'];
const PLATFORM_FIELDS = ['title', 'tagline', 'note'];

let problems = 0;

/* ---------- 1) 元数据覆盖 ---------- */
const zhGames = JSON.parse(fs.readFileSync(path.join(pub, 'games.json'), 'utf8'));
let enGames = null;
try {
  enGames = JSON.parse(fs.readFileSync(path.join(pub, 'games.en.json'), 'utf8'));
} catch {
  console.error('✗ games.en.json 无法读取（EN 全量中文兜底）');
  problems++;
}

console.log('== 元数据覆盖（games.en.json）==');
if (enGames) {
  for (const g of zhGames.games || []) {
    const ov = (enGames.games || {})[g.id];
    if (!ov) {
      console.log(`○ ${g.id}：无覆盖表（EN 显示中文卡）`);
      continue;
    }
    const missing = DISPLAY_FIELDS.filter((f) => g[f] != null && ov[f] == null);
    console.log(missing.length ? `△ ${g.id}：缺 ${missing.join(', ')}` : `✓ ${g.id}`);
  }
  for (const p of zhGames.platforms || []) {
    const ov = (enGames.platforms || {})[p.id];
    if (!ov) {
      console.log(`○ ${p.id}：无覆盖表`);
      continue;
    }
    const missing = PLATFORM_FIELDS.filter((f) => p[f] != null && ov[f] == null);
    console.log(missing.length ? `△ ${p.id}：缺 ${missing.join(', ')}` : `✓ ${p.id}`);
  }
  // 机制字段混入覆盖表 → 数据分叉风险（方案 §3.2 字段边界）
  const MECH = ['mode', 'entry', 'saveMode', 'saveKeys', 'keyboardOnly', 'gamepad', 'gamepadLayout', 'gamepadKeymap', 'orientation', 'version', 'tier'];
  for (const [id, ov] of Object.entries(enGames.games || {})) {
    const bad = MECH.filter((f) => f in ov);
    if (bad.length) {
      console.error(`✗ ${id}：覆盖表混入机制字段 ${bad.join(', ')}（违反字段边界，会覆盖母本行为）`);
      problems++;
    }
  }
}

/* ---------- 2) 字典欠账（模板 {{t.key}} + JS t() 调用） ---------- */
const dictZh = JSON.parse(fs.readFileSync(path.join(gameDir, 'strings', 'strings.zh.json'), 'utf8'));
const dictEn = JSON.parse(fs.readFileSync(path.join(gameDir, 'strings', 'strings.en.json'), 'utf8'));

// 模板里的静态键：{{t.key}} 占位符；模板内联脚本里的动态键：t('key') 调用
const TEMPLATES = ['index.html', 'app.html', '404.html'];
const JS_SOURCES = ['assets/js/game-shell.js', 'assets/js/game-save.js', 'assets/js/games/huapao2048.js', 'assets/js/games/catch-fireworks.js'];

const templateKeys = new Set();
const used = new Set();
const dynPrefixes = new Set(); // 动态拼接键：t('g.t' + v, ...) —— 基前缀之下的字典键视为已引用

console.log('\n== 字典欠账（引用了但字典没有的键）==');
for (const rel of TEMPLATES) {
  const text = fs.readFileSync(path.join(gameDir, 'templates', rel), 'utf8');
  for (const m of text.matchAll(/\{\{t\.([\w.]+)\}\}/g)) templateKeys.add(m[1]);
  for (const m of text.matchAll(/\bt\(\s*'([^']*)'\s*([,)+])/g)) {
    if (m[2] === '+') dynPrefixes.add(m[1]);
    else used.add(m[1]);
  }
}
for (const rel of JS_SOURCES) {
  const text = fs.readFileSync(path.join(pub, rel), 'utf8');
  for (const m of text.matchAll(/\bt\(\s*'([^']*)'\s*([,)+])/g)) {
    if (m[2] === '+') dynPrefixes.add(m[1]);
    else used.add(m[1]);
  }
}
for (const p of dynPrefixes) {
  for (const k of Object.keys(dictEn)) if (k.startsWith(p)) used.add(k);
  console.log(`ℹ 动态键前缀「${p}」：字典中 ${Object.keys(dictEn).filter((k) => k.startsWith(p)).length} 个键视为已引用`);
}

const missingEn = [...new Set([...templateKeys, ...used])].filter((k) => dictEn[k] == null);
const missingZhTpl = [...templateKeys].filter((k) => dictZh[k] == null);
if (missingEn.length) {
  for (const k of missingEn) console.error(`✗ en 字典缺键：${k}`);
  problems += missingEn.length;
}
if (missingZhTpl.length) {
  for (const k of missingZhTpl) console.error(`✗ zh 字典缺模板键：${k}（zh 产物烘不出）`);
  problems += missingZhTpl.length;
}
if (!missingEn.length && !missingZhTpl.length) {
  console.log(`✓ 无——模板键 ${templateKeys.size} 个（双语齐备）+ JS 键（en 齐备）全部覆盖`);
}

/* ---------- 3) 孤儿键 ---------- */
console.log('\n== 孤儿键（en 字典里没人引用）==');
const orphans = Object.keys(dictEn).filter((k) => k !== '_note' && !templateKeys.has(k) && !used.has(k));
if (orphans.length) {
  for (const k of orphans) console.log(`△ ${k}`);
} else {
  console.log('✓ 无');
}

/* ---------- 4) 产物漂移（拦截项） ---------- */
console.log('\n== 产物漂移（--check）==');
try {
  const out = execFileSync(process.execPath, [path.join(gameDir, 'scripts', 'build-game.mjs'), '--check'], { encoding: 'utf8' });
  console.log(out.trim());
} catch (e) {
  console.error(e.stdout ? e.stdout.trim() : e.message);
  problems++;
}

console.log(`\n欠账检查完成：${problems ? `${problems} 项待处理` : '全部干净'}`);
process.exit(0);
