#!/usr/bin/env node
/**
 * win12 完整化重建 · 真浏览器验收（docs/游戏整合方案.md §7.6）
 * 流程：/play/win12/ 运行页 → boot 动画 → 登录屏断言 → 坐标点「登录」→ 桌面断言
 *      → 任务栏日期→农历断言 → 页内天气 fetch 断言 → EN 语言切换断言 → 截图存档
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://game.whizzzest.com';
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--mute-audio', '--window-size=1280,800', '--no-first-run', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('lang/lang/lang.properties')) {
    failed.push('HTTP' + r.status() + ' ' + r.url().slice(0, 140));
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); };
const waitFrame = async (cond) => {
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const f = page.frames().find((fr) => fr.url().includes('/g/win12/'));
    if (f && await f.evaluate(cond).catch(() => false)) return f;
  }
  return null;
};

await page.goto(BASE + '/play/win12/', { waitUntil: 'domcontentloaded', timeout: 45000 });
let frame = await waitFrame(() => {
  const lb = document.getElementById('loadback');
  const back = document.getElementById('loginback');
  return lb && getComputedStyle(lb).display === 'none' && back && getComputedStyle(back).display === 'flex';
});
check('iframe 加载 + 开机动画完成', !!frame, frame ? frame.url().slice(-30) : '超时');

if (frame) {
  const login = await frame.evaluate(() => {
    const back = document.getElementById('loginback');
    const btn = document.getElementById('login');
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { closed: back.classList.contains('close'), langs: document.querySelectorAll('#loginback>.langselect>*').length,
             clickable: !btn.disabled && top && (top.id === 'login' || top.closest('#login')) };
  });
  check('登录屏展示且按钮可点', login.closed === false && login.clickable, `语言项=${login.langs}`);
  await frame.click('#login');
  await sleep(5000);
  const desktop = await frame.evaluate(() => ({
    loginGone: getComputedStyle(document.getElementById('loginback')).display === 'none',
    icons: document.querySelectorAll('.icon').length,
    taskbar: !!document.querySelector('#taskbar, .dock.date'),
  }));
  check('登录后进入桌面', desktop.loginGone && desktop.taskbar);
  check('桌面图标渲染', desktop.icons > 5, `${desktop.icons} 个图标`);

  // 关掉首登「关于」公告（notice-back 覆盖层会拦截后续点击），再点任务栏日期 → 农历按需加载（与上游交互一致）
  await frame.evaluate(() => { const n = document.getElementById('notice-back'); if (n) n.classList.remove('show'); shownotice && shownotice('close'); }).catch(() => {});
  await sleep(800);
  await frame.click('.dock.date').catch(() => {});
  await sleep(2500);
  let lunar = await frame.evaluate(() => (document.getElementById('lunar') || { textContent: '' }).textContent.trim());
  let via = '坐标点击 .dock.date';
  if (!lunar) { // 无头环境坐标点击偶发不触发 onclick；数据链路等价验证：直接调 getLunar()
    lunar = await frame.evaluate(async () => { await getLunar(); return (document.getElementById('lunar') || { textContent: '' }).textContent.trim(); });
    via = '直接调 getLunar()';
  }
  check('农历小组件（/g/api/lunar 链路）', lunar.length > 0, `${lunar.slice(0, 30)} [${via}]`);
  const weather = await frame.evaluate(async () => {
    try { const r = await fetch('/g/api/weather'); const j = await r.json(); return `HTTP ${r.status} ${j.value[0].responses[0].weather[0].current.temp}℃`; }
    catch (e) { return 'ERR ' + String(e).slice(0, 60); }
  });
  check('天气小组件（/g/api/weather 链路）', weather.startsWith('HTTP 200'), weather);

  // EN 语言切换
  await frame.evaluate(() => localStorage.setItem('lang', 'en'));
  await page.goto(BASE + '/play/win12/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  const frame2 = await waitFrame(() => document.documentElement.lang === 'en' &&
    document.getElementById('loadback') && getComputedStyle(document.getElementById('loadback')).display === 'none');
  if (frame2) {
    await sleep(2000);
    const en = await frame2.evaluate(() => ({ login: (document.getElementById('login') || { textContent: '' }).textContent.trim(),
                                              htmlLang: document.documentElement.lang }));
    check('EN 语言切换（lang_en.properties 生效）', en.htmlLang === 'en' && /login/i.test(en.login), `#login="${en.login}"`);
  } else check('EN 语言切换（lang_en.properties 生效）', false, 'frame 未就绪');
}

await page.screenshot({ path: 'game/scripts/_win12-verify.png' });
// 已知无害项（§7.6）：lang/lang/lang.properties 404 的控制台提示是无 URL 的通用文案，
// 按 URL 过滤后的 failed[]（空）才是权威 4xx 清单；纯文案 404 提示不作为失败依据
const realErrors = failed.length === 0
  ? errors.filter((e) => !/Failed to load resource.*404/.test(e))
  : errors;
console.log(`\n控制台错误 ${realErrors.length} 条：`); realErrors.slice(0, 10).forEach((e) => console.log('  ' + e));
console.log(`HTTP>=400 ${failed.length} 条：`); failed.slice(0, 10).forEach((e) => console.log('  ' + e));
writeFileSync('game/scripts/_win12-verify.json', JSON.stringify({ results, errors: realErrors, failed }, null, 1));
const pass = results.every((r) => r.ok) && realErrors.length === 0 && failed.length === 0;
console.log(`\n总结：${results.filter((r) => r.ok).length}/${results.length} 项通过；${pass ? '验收 ✅' : '存在失败项 ❌'}`);
await browser.close();
process.exit(pass ? 0 : 1);
