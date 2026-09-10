#!/usr/bin/env node
/** 跨刷新持久化端到端验证：写入存档 → 整页 reload → 重新引导后读回。 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const U = process.argv[2] || 'https://game.whizzzest.com/play/4399-230326/';
const exe = ['C:\Program Files\Google\Chrome\Application\chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--mute-audio'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
const frame = () => p.frames().find((f) => f.url().includes('/g/4399-')) || p.mainFrame();
await p.goto(U, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 15000));
const w = await frame().evaluate(() => {
  try { Save4399('{"chapter":1,"level":"教学关完成","coins":88}'); return localStorage.getItem('h5api_cloud_save'); }
  catch (e) { return 'CRASH ' + e.message; }
});
console.log('会话1 写入存档:', w);
await p.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 15000));
const r2 = await frame().evaluate(() => new Promise((done) => {
  try { window.h5api.save({ type: 'read', callback: (res) => done({ code: res.code, data: res.data }) }); }
  catch (e) { done({ code: 'CRASH', data: e.message }); }
}));
console.log('会话2（整页刷新后）读回:', JSON.stringify(r2));
console.log(r2.data && String(r2.data).includes('教学关完成') ? '✅ 进度跨刷新持久' : '❌ 丢失');
await b.close();
