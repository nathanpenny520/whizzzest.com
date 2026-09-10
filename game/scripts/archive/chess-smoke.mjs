#!/usr/bin/env node
/**
 * 焰境游戏 — 中国象棋（chinese-chess）逐款交互冒烟
 *
 * 真浏览器实测：选难度 → 点子 → 落子 → 等 AI 回应 → 校验着法记录，
 * 桌面（1280）与小屏（320，画布 CSS 缩放 + 点击映射补丁路径）各跑一轮。
 * 用法：node game/scripts/chess-smoke.mjs [baseUrl=http://127.0.0.1:8931/]
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

/* 截图/记录落 .build-tmp/（gitignored，诊断产物不入 game/scripts） */
const OUT = '.build-tmp';
mkdirSync(OUT, { recursive: true });

const base = process.argv[2] || 'http://127.0.0.1:8931/';
const ORIGIN = new URL(base).origin;
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!exe) { console.error('未找到 Chrome/Edge'); process.exit(1); }

// 棋盘坐标 → 页面点击坐标（与 play.getClickPoint 同构的逆变换）
const CELL = { sx: 35, sy: 36, px: 25, py: 39 }; // pointStart(5,19)+20
async function clickBoard(page, bx, by) {
  const r = await page.evaluate(() => {
    const c = document.getElementById('chess');
    const rect = c.getBoundingClientRect();
    return { l: rect.left, t: rect.top, scale: rect.width / c.width };
  });
  const x = r.l + (CELL.px + CELL.sx * bx) * r.scale;
  const y = r.t + (CELL.py + CELL.sy * by) * r.scale;
  await page.mouse.click(x, y);
}

async function round(browser, label, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [], failed = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('requestfailed', (r) => {
    const f = r.failure() || {};
    if (!['BlockedByClient', 'ERR_ABORTED'].includes(f.errorText)) failed.push(r.url().slice(0, 120) + ' ' + (f.errorText || ''));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push('HTTP' + r.status() + ' ' + r.url().slice(0, 120));
    const u = r.url();
    if (u.includes('cloudflareinsights.com')) return; // CF Web Analytics 平台级注入，非游戏包依赖
    if (!u.startsWith(ORIGIN) && !u.startsWith('data:')) external.push(u.slice(0, 120));
  });
  page.on('dialog', (d) => d.accept());

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('bnBox').style.display === 'block', { timeout: 10000 });
  await page.click('#tyroPlay'); // 新手水平（confirm 自动接受）
  await new Promise((r) => setTimeout(r, 400));

  const state0 = await page.evaluate(() => ({ play: typeof play !== 'undefined', depth: play.depth }));
  // 红炮 p0 (1,7) → (1,6) 進炮
  await clickBoard(page, 1, 7);
  await new Promise((r) => setTimeout(r, 200));
  const selected = await page.evaluate(() => play.nowManKey);
  await clickBoard(page, 1, 6);
  await new Promise((r) => setTimeout(r, 200));
  // 等 AI 回应（着法记录 ≥2）
  let paceLen = 0, waited = 0;
  while (waited < 15000) {
    paceLen = await page.evaluate(() => play.pace.length);
    if (paceLen >= 2) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  const info = await page.evaluate(() => ({
    pace: play.pace.length,
    moveInfo: (document.getElementById('moveInfo').textContent || '').replace(/\s+/g, ' ').slice(0, 120),
  }));
  await page.screenshot({ path: `${OUT}/chess-smoke-${label}.png` });
  await page.close();
  const ok = state0.depth === 3 && selected === 'p0' && info.pace >= 2 && errors.length === 0 && failed.length === 0 && external.length === 0;
  console.log(`[${label}] ${ok ? 'PASS' : 'FAIL'} depth=${state0.depth} 选中=${selected} 着法=${info.pace} 外链=${external.length}`);
  console.log(`  moveInfo: ${info.moveInfo}`);
  if (errors.length) console.log('  errors:', JSON.stringify(errors, null, 1).slice(0, 600));
  if (failed.length) console.log('  failed:', JSON.stringify(failed, null, 1).slice(0, 600));
  if (external.length) console.log('  external:', JSON.stringify(external, null, 1).slice(0, 600));
  return ok;
}

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--no-first-run', '--disable-gpu'],
});
const a = await round(browser, 'desktop', { width: 1280, height: 800 });
const b = await round(browser, 'mobile320', { width: 320, height: 600 });
await browser.close();
writeFileSync(`${OUT}/chess-smoke-last.json`, JSON.stringify({ desktop: a, mobile320: b }, null, 1));
console.log(a && b ? '== 全部通过 ==' : '== 存在失败 ==');
process.exit(a && b ? 0 : 1);
