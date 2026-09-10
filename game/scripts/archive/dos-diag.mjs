#!/usr/bin/env node
// DOS 专区深度诊断 v2：直开玩家页，抓 console + 按钮 + 点击后 canvas 状态
import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8797/g/dos/dos-simcity2000/index.html';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--window-size=1280,800', '--no-first-run', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 300)));
page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url().slice(0, 150) + ' ' + (r.failure() || {}).errorText));
page.on('response', (r) => { if (r.status() >= 400) logs.push('[HTTP' + r.status() + '] ' + r.url().slice(0, 150)); });
const reqlog = [];
page.on('request', (r) => reqlog.push('REQ ' + r.url().slice(0, 140)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 25000));
let state = await page.evaluate(() => ({
  buttons: [...document.querySelectorAll('button, [role=button], .btn')].map((b) => b.textContent.trim().slice(0, 40)),
  rootHtml: document.getElementById('root').innerHTML.slice(0, 800),
  canvases: [...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height),
}));
console.log('== BEFORE ==\n' + JSON.stringify(state, null, 1));
await page.evaluate(() => {
  const el = document.querySelector('.play-button') || document.querySelector('.pre-run-window .cursor-pointer');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
});
await new Promise((r) => setTimeout(r, 25000));
state = await page.evaluate(() => ({
  canvases: [...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height),
  rootHtml: document.getElementById('root').innerHTML.slice(0, 400),
  windowTitle: document.querySelector('.window') ? document.querySelector('.window').textContent.trim().slice(0, 120) : '',
}));
console.log('== AFTER CLICK ==\n' + JSON.stringify(state, null, 1));
console.log('== REQS (' + reqlog.length + ') ==');
reqlog.forEach((l) => console.log('  ' + l));
console.log('== LOGS (' + logs.length + ') ==');
logs.slice(0, 25).forEach((l) => console.log('  ' + l));
await page.screenshot({ path: 'e:/Projects/website-group/whizzzest/.build-tmp/dos-diag.png' });
writeFileSync('e:/Projects/website-group/whizzzest/.build-tmp/dos-diag.json', JSON.stringify({ state, logs }, null, 1));
await browser.close();
