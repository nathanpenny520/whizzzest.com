#!/usr/bin/env node
/** 全量请求捕获：node req-capture.mjs <url> [点击间隔秒=5] [轮数=8] */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const [url, ivArg, nArg] = process.argv.slice(2);
const iv = +(ivArg || 5), n = +(nArg || 8);
const exe = ['C:\Program Files\Google\Chrome\Application\chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--mute-audio'] });
const p = await b.newPage();
const reqs = [];
p.on('request', (r) => { const u = r.url(); if (!/cloudflareinsights|favicon/.test(u)) reqs.push(r.method() + ' ' + u.slice(-95)); });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
for (let i = 0; i < n; i++) { await p.mouse.click(640, 400).catch(() => {}); await new Promise((r) => setTimeout(r, iv * 1000)); }
console.log(`=== 共 ${reqs.length} 请求，尾部 45 条 ===`);
reqs.slice(-45).forEach((x) => console.log(x));
await b.close();
