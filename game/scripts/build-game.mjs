/**
 * 游戏子站构建 —— 源码级统一主站 i18n 架构（docs/游戏英文版方案.md §3.6/§8.7，2026-09-09 二次修订）
 *
 * 模板（game/templates/，{{t.key}} 占位符）+ 双语字符串字典（game/strings/strings.{zh,en}.json）
 * → 烘出 6 份静态页：
 *   zh → game/public/index.html、public/play/app.html、public/404.html（根路径，与主站同约定）
 *   en → game/public/en/ 同构三份（lang="en"，并内联注入 window.__I18N 供 JS 动态串取英文——
 *        与主站「build.js 按 locale 注入 window.__I18N，无注入走 zh 兜底」完全同构）
 *
 * 设计纪律：
 *  - 纯令牌替换，零 HTML 解析、零 npm 依赖——规避 win12 事故同族的「正则吃 HTML」风险；
 *  - 每一步断言：占位符漏填 / lang 替换点缺失 / 注入点缺失 → 构建失败（默认失败项，对齐主站 Phase 1）；
 *  - 产物提交进仓库（子站为手动部署，多端协作下不依赖部署机本地状态）；
 *  - 改了模板或字典忘跑构建 → 部署前用 --check 卡住。
 *
 * 运行：node game/scripts/build-game.mjs            （构建并写出）
 *       node game/scripts/build-game.mjs --check    （校验磁盘产物与重新构建结果一致，不一致退出码 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.join(here, '..');
const TPL_DIR = path.join(gameDir, 'templates');
const STR_DIR = path.join(gameDir, 'strings');
const PUB = path.join(gameDir, 'public');
const CHECK = process.argv.includes('--check');

/* [模板文件, 输出相对 public 的路径]（输出路径即 URL 路径，/en/ 前缀由输出目录表达） */
const PAGES = [
  ['index.html', 'index.html'],
  ['app.html', 'play/app.html'],
  ['404.html', '404.html'],
];

const zh = JSON.parse(fs.readFileSync(path.join(STR_DIR, 'strings.zh.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(STR_DIR, 'strings.en.json'), 'utf8'));

const PLACEHOLDER_RE = /\{\{t\.([\w.]+)\}\}/g;

/** 令牌填充：键缺失即抛错（构建失败）；填完断言无残留 */
function fill(template, dict, label) {
  const missing = [];
  const out = template.replace(PLACEHOLDER_RE, (m, key) => {
    if (dict[key] == null) missing.push(key);
    return dict[key] != null ? dict[key] : m;
  });
  if (missing.length) throw new Error(`[${label}] 字典缺键：${missing.join(', ')}`);
  if (PLACEHOLDER_RE.test(out)) throw new Error(`[${label}] 存在未识别的占位符残留（键名含非法字符？）`);
  return out;
}

/** 计数替换：命中次数 !== expect 即抛错（win12 事故教训：改前先断言命中） */
function replaceCounted(str, from, to, expect, label) {
  const parts = str.split(from);
  if (parts.length - 1 !== expect) throw new Error(`[${label}] 「${from.slice(0, 40)}…」命中 ${parts.length - 1} 次，期望 ${expect}`);
  return parts.join(to);
}

/** EN 页构建：填字典 → lang 切 en → head 内注入 window.__I18N（< 转义防 </script> 逃逸） */
function buildEn(template, label) {
  let html = fill(template, en, `${label}/en`);
  html = replaceCounted(html, 'lang="zh-CN"', 'lang="en"', 1, `${label}/en lang`);
  const payload = `<script>window.__I18N = ${JSON.stringify(en).replace(/</g, '\\u003c')};</script>\n`;
  html = replaceCounted(html, '</head>', `${payload}</head>`, 1, `${label}/en i18n 注入`);
  return html;
}

const built = new Map(); // 输出相对路径 → 内容
for (const [tplFile, outRel] of PAGES) {
  const template = fs.readFileSync(path.join(TPL_DIR, tplFile), 'utf8');
  built.set(outRel, fill(template, zh, outRel));
  built.set(path.join('en', outRel), buildEn(template, outRel));
}

if (CHECK) {
  const drift = [];
  for (const [rel, content] of built) {
    const disk = fs.readFileSync(path.join(PUB, rel), 'utf8');
    if (disk !== content) drift.push(rel);
  }
  if (drift.length) {
    console.error(`✗ 产物过期（模板/字典改了但没重新构建）：${drift.join(', ')}——请运行 node game/scripts/build-game.mjs`);
    process.exit(1);
  }
  console.log(`✓ 构建校验通过：${built.size} 份产物与磁盘一致（无过期）`);
  process.exit(0);
}

for (const [rel, content] of built) {
  const abs = path.join(PUB, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
console.log(`✓ 构建完成：${built.size} 份页面已写出（zh 3 + en 3）`);
