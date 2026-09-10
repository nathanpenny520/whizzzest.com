#!/usr/bin/env node
/** 全屏 + 存档垫片双向验证：node fs-save-test.mjs <play或entry url> */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const url = process.argv[2];
const exe = ['C:\Program Files\Google\Chrome\Application\chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--mute-audio', '--window-size=1280,800'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 6000));
await p.click('#btnFullscreen').catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const fs = await p.evaluate(() => {
  const el = document.fullscreenElement;
  const hit = document.elementFromPoint(innerWidth / 2, 8);
  return { fsTarget: el ? (el.className || el.tagName) : null,
           topbarAtTop: hit && hit.closest && hit.closest('.topbar') ? 'topbar仍在' : '顶栏已让位' };
});
console.log('全屏:', JSON.stringify(fs));
await p.evaluate(() => document.exitFullscreen()).catch(() => {});
await new Promise((r) => setTimeout(r, 800));
const frame = p.frames().find((f) => f.url().includes('/g/4399-')) || p.mainFrame();
const save = await frame.evaluate(() => {
  const out = {};
  try { Save4399('{"level":9,"coins":123}'); out.saved = localStorage.getItem('h5api_cloud_save'); }
  catch (e) { out.saved = 'CRASH ' + e.message; }
  return new Promise((done) => {
    window.h5api.save({ type: 'read', callback: (r) => {
      out.readBack = typeof r.data === 'string' ? r.data : JSON.stringify(r.data); out.code = r.code; done(out);
    } });
  });
});
console.log('存档回环:', JSON.stringify(save));
await b.close();
