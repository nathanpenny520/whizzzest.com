#!/usr/bin/env node
/** 画布父链尺寸审计：从 canvas 向上每一层的 tag/类/计算高度。node dom-walk.mjs <url> */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const url = process.argv[2];
const exe = ['C:\Program Files\Google\Chrome\Application\chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--mute-audio'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 18000));
const out = await p.evaluate(() => {
  const f = document.querySelector('iframe.game-frame');
  const doc = f.contentDocument;
  const c = doc.querySelector('canvas');
  const chain = [];
  let el = c;
  while (el && el.nodeType === 1) {
    const cs = f.contentWindow.getComputedStyle(el);
    chain.push({ tag: el.tagName + (el.id ? '#' + el.id : ''),
      rect: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      cssH: cs.height, pos: cs.position });
    el = el.parentElement;
  }
  return { chain };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
