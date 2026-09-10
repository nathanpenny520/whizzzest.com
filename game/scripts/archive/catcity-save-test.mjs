#!/usr/bin/env node
// CatCity 存档镜像补丁验证：登录 → 等待落档 → 检查 iframe localStorage 固定键
import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync } from 'node:fs';

const url = 'http://127.0.0.1:8797/play/cat-city/';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--window-size=1280,800', '--no-first-run', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 8000));

// 在 iframe 里填用户名并登录
const frame = page.frames().find((f) => f.url().includes('/g/cat-city/'));
await frame.type('#usernameInput', 'TestCat', { delay: 20 });
await frame.click('#loginForm button[type=submit]');
await new Promise((r) => setTimeout(r, 6000));
// 循环关闭所有引导弹窗（教程/指南等）
for (let i = 0; i < 12; i++) {
  const clicked = await frame.evaluate(() => {
    const pat = /закрыть|понятно|далее|в путь|назад/i;
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const box = b.getBoundingClientRect();
      return pat.test(b.textContent) && box.width > 80 && box.height > 24;
    });
    if (btn) { btn.click(); return btn.textContent.trim().slice(0, 30); }
    return null;
  });
  if (!clicked) break;
  console.log('dismissed:', clicked);
  await new Promise((r) => setTimeout(r, 1200));
}
await new Promise((r) => setTimeout(r, 2000));
console.log('walking for autosave...');
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 5000));
await page.keyboard.up('KeyW');
await new Promise((r) => setTimeout(r, 5000));
const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('catCity')));
const mirror = await page.evaluate(() => {
  const raw = localStorage.getItem('catCity.saveLatest');
  if (!raw) return null;
  try { const d = JSON.parse(raw); return { username: d.username, locationId: d.locationId, hasPlayer: !!d.player }; } catch { return 'unparsable'; }
});
console.log('catCity keys:', JSON.stringify(keys));
console.log('saveLatest payload:', JSON.stringify(mirror));
console.log('pageerrors:', errors.length ? errors : 0);
await page.screenshot({ path: 'e:/Projects/website-group/whizzzest/.build-tmp/catcity-ingame.png' });
writeFileSync('e:/Projects/website-group/whizzzest/.build-tmp/catcity-save.json', JSON.stringify({ keys, mirror }, null, 1));
await browser.close();
