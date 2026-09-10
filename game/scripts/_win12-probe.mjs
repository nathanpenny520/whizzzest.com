#!/usr/bin/env node
// win12 页面内 fetch 链路探针（§7.6 临时脚本）：登录后直接验证 /g/api/lunar、getLunar()、/g/api/weather
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--window-size=1280,800', '--no-first-run', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('https://game.whizzzest.com/play/win12/', { waitUntil: 'domcontentloaded', timeout: 45000 });
let frame = null;
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  frame = page.frames().find((f) => f.url().includes('/g/win12/'));
  if (!frame) continue;
  const ready = await frame.evaluate(() => {
    const lb = document.getElementById('loadback');
    return lb && getComputedStyle(lb).display === 'none';
  }).catch(() => false);
  if (ready) break;
}
const r = await frame.evaluate(async () => {
  const out = {};
  out.dateBtn = !!document.querySelector('.dock.date');
  try {
    const resp = await fetch('/g/api/lunar');
    out.lunarFetchStatus = resp.status;
    const j = await resp.json();
    out.lunarField = (j && j['农历']) || 'missing';
  } catch (e) { out.lunarFetchErr = String(e).slice(0, 120); }
  try {
    await getLunar();
    out.lunarText = (document.getElementById('lunar') || { textContent: 'no-el' }).textContent;
  } catch (e) { out.getLunarErr = String(e).slice(0, 120); }
  try {
    const resp2 = await fetch('/g/api/weather');
    out.weatherStatus = resp2.status;
    const j2 = await resp2.json();
    out.weatherTemp = j2 && j2.value && j2.value[0].responses[0].weather[0].current.temp;
  } catch (e) { out.weatherErr = String(e).slice(0, 120); }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
