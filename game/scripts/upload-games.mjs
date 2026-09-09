#!/usr/bin/env node
/**
 * 焰境游戏 — R2 游戏包上传脚本（docs/游戏整合方案.md §1.1/§1.7）
 *
 * 把 game/r2-assets/g/<gameId>/ 下的收录产物逐个上传到 R2 桶 whizzzest-game。
 * 键约定 = `<gameId>/<相对路径>`，与 worker/index.js 的 /g/* 反代一致：
 *   R2 键 hextris/index.html  ⇔  https://game.whizzzest.com/g/hextris/index.html
 *
 * 前置（一次性，nathanpenny@qq.com 账号）：
 *   npx wrangler login
 *   npx wrangler r2 bucket create whizzzest-game
 *
 * 用法（在仓库根目录）：
 *   node game/scripts/upload-games.mjs            # 上传全部
 *   node game/scripts/upload-games.mjs tetris     # 只传指定游戏（可多个）
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const BUCKET = 'whizzzest-game';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'r2-assets', 'g');

/* 与 worker/index.js 的 MIME 兜底表保持一致（上传时即写入正确的 Content-Type）。
 * 注意：值不能带空格（如 "; charset=utf-8"）——spawnSync(shell:true) 按空格拼接参数会截断，
 * HTML 用 <meta charset> 声明编码，无需依赖 Content-Type charset。 */
const MIME = {
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  txt: 'text/plain', xml: 'application/xml', md: 'text/plain',
};

/* --text-only：只传文本类（2026-09-09 首轮上传因 charset 参数截断，二进制已全部成功，此为补传） */
const TEXT_EXTS = new Set(['html', 'js', 'mjs', 'css', 'json', 'webmanifest', 'txt', 'xml', 'md']);
const TEXT_ONLY = process.argv.includes('--text-only');

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dirs = readdirSync(ROOT).filter(
  (d) => statSync(join(ROOT, d)).isDirectory() && (!wanted.length || wanted.includes(d))
);
if (!dirs.length) {
  console.error('没有匹配的游戏目录。可选：', readdirSync(ROOT).join(', '));
  process.exit(1);
}

let ok = 0;
let fail = 0;
for (const dir of dirs) {
  const walk = (p) =>
    readdirSync(p, { withFileTypes: true }).flatMap((e) => {
      const full = join(p, e.name);
      return e.isDirectory() ? walk(full) : [full];
    });
  console.log(`[${dir}] ${walk(join(ROOT, dir)).length} 个文件`);
  for (const file of walk(join(ROOT, dir))) {
    const key = relative(ROOT, file).split(sep).join('/');
    const ext = (key.split('.').pop() || '').toLowerCase();
    if (TEXT_ONLY && !TEXT_EXTS.has(ext)) continue;
    const args = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--remote'];
    if (MIME[ext]) args.push('--content-type', MIME[ext]);
    // shell:true 兼容 Windows 的 npx.cmd；仓库路径不含空格，无需引号包装
    const r = spawnSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    if (r.status === 0) {
      ok++;
      console.log(`  OK ${key}`);
    } else {
      fail++;
      console.error(`  FAIL ${key}\n${String(r.stderr)}`);
    }
  }
}
console.log(`\n完成：成功 ${ok}，失败 ${fail}。`);
process.exit(fail ? 1 : 0);
