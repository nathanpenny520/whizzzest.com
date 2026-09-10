#!/usr/bin/env node
/**
 * 焰境游戏 — 真浏览器加载验证：无头 Chrome 打开目标页（/g/ 入口或 /play/<id>/），
 * 收集控制台错误/页面异常/请求失败/HTTP>=400 + 截图 + 帧列表，结果落 _browser-last.json。
 * 用法：node game/scripts/browser-test.mjs <url> [观察秒数=25]
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, existsSync } from 'node:fs';

const url = process.argv[2];
const secs = +(process.argv[3] || 25);
if (!url) { console.error('用法: node browser-test.mjs <url> [秒数]'); process.exit(1); }
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--window-size=1280,800', '--no-first-run', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 220)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 220)));
page.on('requestfailed', (r) => {
  const f = r.failure() || {};
  if (!['BlockedByClient', 'ERR_ABORTED'].includes(f.errorText)) {
    failed.push('REQFAIL ' + r.url().slice(0, 160) + ' ' + (f.errorText || ''));
  }
});
page.on('response', (r) => { if (r.status() >= 400) failed.push('HTTP' + r.status() + ' ' + r.url().slice(0, 160)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, secs * 1000));
console.log(`== ${url}`);
console.log(`控制台错误 ${errors.length} 条：`); errors.slice(0, 12).forEach((e) => console.log('  ' + e));
console.log(`请求失败 ${failed.length} 条：`); failed.slice(0, 12).forEach((e) => console.log('  ' + e));
const frames = page.frames().map((f) => f.url().slice(0, 100));
console.log('frames:', JSON.stringify(frames, null, 1).slice(0, 400));
await page.screenshot({ path: '.build-tmp/game/_shot.png' });
writeFileSync('.build-tmp/game/_browser-last.json', JSON.stringify({ url, errors, failed, frames }, null, 1));
await browser.close();
