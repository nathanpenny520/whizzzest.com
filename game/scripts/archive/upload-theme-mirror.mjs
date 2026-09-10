#!/usr/bin/env node
/**
 * 焰境游戏 — win12 主题库镜像上传（docs/游戏整合方案.md §7 win12 功能恢复）
 *
 * 把主题镜像（ASCII slug 目录，含 bg/view/theme.json）与本站烘焙的 API 同构清单
 * （game/r2-assets/g/win12-theme/meta/*.json）上传到 R2 桶 whizzzest-game：
 *   R2 键 win12-theme/<slug>/<file>   ⇔  https://game.whizzzest.com/g/win12-theme/<slug>/<file>
 *   R2 键 win12-theme/meta/*.json     ⇔  https://game.whizzzest.com/g/win12-theme/meta/*.json
 *
 * 镜像源：社区主题仓库整库克隆（git clone --depth 1），目录名转 ASCII slug（界面显示名走 meta 的 label 字段），
 * 缺 view.jpg 的目录用 bg 图补，theme.json 的 bg 字段与实际文件不符的已修正。
 *
 * 用法（在仓库根目录）：node game/scripts/upload-theme-mirror.mjs
 * 前置：npx wrangler login + 桶已创建（见 upload-games.mjs 头注释）。
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const BUCKET = 'whizzzest-game';
// 本脚本位于 <repo>/game/scripts/ → 仓库根 = ../..，镜像在仓库根的上一级 games/（仓库外素材库，不入 git）
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..', '..', '..', 'games', 'win12-theme');
const META = join(SCRIPT_DIR, '..', 'r2-assets', 'g', 'win12-theme', 'meta');

const MIME = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

if (!existsSync(ROOT)) { console.error('镜像不存在：' + ROOT + '（先克隆主题仓库并按 §7 slug 化）'); process.exit(1); }

const jobs = []; // [key, file]
const walk = (p) =>
  readdirSync(p, { withFileTypes: true }).flatMap((e) => {
    const full = join(p, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
for (const file of walk(ROOT)) {
  jobs.push([relative(ROOT, file).split(sep).join('/'), file]);
}
for (const file of walk(META)) {
  jobs.push(['meta/' + relative(META, file).split(sep).join('/'), file]);
}

console.log(`共 ${jobs.length} 个对象`);
let ok = 0;
let fail = 0;
for (const [key, file] of jobs) {
  const ext = (key.split('.').pop() || '').toLowerCase();
  const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/win12-theme/${key}`, '--file', file, '--remote'];
  if (MIME[ext]) args.push('--content-type', MIME[ext]);
  // shell:true 兼容 Windows npx.cmd；key 已 ASCII slug 化，无空格/中文
  const r = spawnSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  if (r.status === 0) { ok++; console.log(`  OK ${key}`); }
  else { fail++; console.error(`  FAIL ${key}\n${String(r.stderr)}`); }
}
console.log(`\n完成：成功 ${ok}，失败 ${fail}。`);
process.exit(fail ? 1 : 0);
