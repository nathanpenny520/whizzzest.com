#!/usr/bin/env node
/** 交互式诊断：载入游戏 → 截图 → 网格点击 → 再截图/收集404。
 *  用法: node game/scripts/interact-diag.mjs <url> <截图名前缀> [秒=40] */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const [url, tag, secsArg] = process.argv.slice(2);
const secs = +(secsArg || 40);
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--window-size=1280,800', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const bad = new Set();
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().includes('/g/')) bad.add(r.status() + ' ' + r.url().slice(-90));
});
page.on('pageerror', (e) => bad.add('PAGEERROR ' + String(e).slice(0, 120)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 12000));
await page.screenshot({ path: `.build-tmp/game/_diag_${tag}_0_载入.png` });
const pts = [[640, 500], [640, 600], [640, 680], [640, 740], [500, 620], [780, 620], [640, 560]];
for (let i = 0; i < pts.length; i++) {
  await page.mouse.click(pts[i][0], pts[i][1]).catch(() => {});
  await new Promise((r) => setTimeout(r, 3500));
  if (i === 2 || i === pts.length - 1) await page.screenshot({ path: `.build-tmp/game/_diag_${tag}_${i + 1}_点击.png` });
}
await new Promise((r) => setTimeout(r, 5000));
await page.screenshot({ path: `.build-tmp/game/_diag_${tag}_final.png` });
console.log('404/异常:', [...bad].slice(0, 10));
await browser.close();
