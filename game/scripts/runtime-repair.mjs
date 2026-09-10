#!/usr/bin/env node
/**
 * 焰境游戏 — 运行时自愈修复：无头浏览器实跑收集 404，按同路径回源站补抓。
 * 原理：静态嗅探对「引擎 settings 里的第三种资源根」/「运行时拼接文件名」无能为力；
 * 浏览器运行时的真实请求就是最准的探针——404 的 /g/<id>/<path> 对应源站 https://<path>，
 * 200 即补入镜像与 R2 暂存区，循环至零 404。交互（点击/按键）触发按需加载的懒资源。
 * 用法：node game/scripts/runtime-repair.mjs <gameId> <entry相对路径> [轮数=2] [秒/轮=30]
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [gid, entryRel, roundsArg, secsArg] = process.argv.slice(2);
if (!gid || !entryRel) {
  console.error('用法: node runtime-repair.mjs <gameId> <entry相对路径> [轮数=2] [秒/轮=30]');
  process.exit(1);
}
const ROUNDS = +(roundsArg || 2), SECS = +(secsArg || 30);
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const STAGE = join(ROOT, 'whizzzest.com', 'game', 'r2-assets', 'g', gid);
const MIRROR = join(ROOT, 'games', 'crawled', 'games', gid.replace('4399-', ''), 'host');
const LIVE = `https://game.whizzzest.com/g/${gid}/`;
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

async function collect404s() {
  const browser = await puppeteer.launch({
    executablePath: exe, headless: 'new',
    args: ['--mute-audio', '--window-size=1280,800', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const bad = new Set();
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && u.startsWith(LIVE)) bad.add(u.slice(LIVE.length).split('?')[0]);
  });
  await page.goto(LIVE + entryRel, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const t0 = Date.now();
  let i = 0;
  const spots = [[640, 400], [400, 400], [880, 400], [640, 250], [640, 550]];
  while (Date.now() - t0 < SECS * 1000) {
    await new Promise((r) => setTimeout(r, 2500));
    const [x, y] = spots[i++ % spots.length];
    await page.mouse.click(x, y).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
  }
  await browser.close();
  return [...bad];
}

async function salvage(path) {
  const src = 'https://' + path;
  const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.4399.com/' } });
  if (!r.ok) return false;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 3 || buf.slice(0, 2000).toString('latin1').toLowerCase().includes('page err')) return false;
  for (const base of [STAGE, MIRROR]) {
    const dest = join(base, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  return true;
}

let grandFixed = 0;
for (let round = 1; round <= ROUNDS; round++) {
  const bad = await collect404s();
  console.log(`[第${round}轮] 运行时 404：${bad.length} 个`);
  if (!bad.length) { console.log('✅ 零 404，自愈完成'); break; }
  let fixed = 0;
  for (const p of bad) {
    try { if (await salvage(p)) fixed++; } catch { /* 源站也没有，留着 */ }
  }
  grandFixed += fixed;
  console.log(`  回源补抓成功 ${fixed}/${bad.length}`);
  if (!fixed) { console.log('⚠️ 剩余 404 源站本身没有（死引用），无法修复'); break; }
}
writeFileSync(join(ROOT, '.build-tmp', 'game', `_repair-${gid}.json`),
  JSON.stringify({ gid, entryRel, rounds: ROUNDS, fixed: grandFixed, at: new Date().toISOString() }, null, 1));
console.log(`合计补入 ${grandFixed} 文件（${gid}）`);
