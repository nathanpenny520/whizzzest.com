#!/usr/bin/env node
/**
 * build.js — 焰境·万载 零依赖构建脚本
 *
 * 职责：
 *  1. 拼接公共片段（partials）+ 渲染模板变量 / #each 循环
 *  2. 每个页面读取 src/pages/<name>/index.html + src/data/<name>.json
 *  3. 生成 sitemap.xml / robots.txt（含 canonical 基准域名）
 *  4. 复制 public/ 与 src/assets/ → dist/
 *
 * 运行：node build.js  （无任何 npm 依赖，仅 Node 内置模块）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const PAGES_DIR = path.join(SRC, 'pages');
const PARTIALS_DIR = path.join(SRC, 'partials');
const DATA_DIR = path.join(SRC, 'data');
const DIST = path.join(ROOT, 'dist');

const SITE_URL = 'https://whizzzest.com';

/* ---------------- 小工具 ---------------- */

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

/** 递归复制目录（跳过 .DS_Store） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 按 a.b.c 路径取值；失败返回 undefined */
function resolvePath(ctx, expr) {
  return expr
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), ctx);
}

/** HTML 转义 */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- 模板引擎 ---------------- */

/**
 * 语法：
 *   {{> name}}              → 嵌入 src/partials/name.html（先展开，再渲染）
 *   {{#each expr as name}}…{{/each}}   循环（可嵌套，as name 命名循环变量，默认 item）
 *   {{@index}}              → 循环序号（从 1 起）
 *   {{{ expr }}}            → 原样输出（不转义）
 *   {{ expr }}              → HTML 转义输出
 * 所有取值均为点路径，从整页上下文解析；循环变量在每层框架中可遮蔽外层。
 */
function render(tpl, ctx) {
  // 1. 展开 {{> partial}}（仅一层，partials 内不再嵌套 include）
  tpl = tpl.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
    const p = path.join(PARTIALS_DIR, `${name}.html`);
    if (!exists(p)) throw new Error(`partial not found: ${name}`);
    return read(p);
  });

  // 2. 展开 {{#each expr [as name]}} … {{/each}}（深度计数找配对，支持嵌套）
  const openRe = /\{\{#each\s+([\w@][\w.@]*)(?:\s+as\s+(\w+))?\s*\}\}/;
  let m;
  while ((m = openRe.exec(tpl))) {
    const [open, expr, alias] = m;
    // 从 open 结尾开始扫描，找配对的 {{/each}}
    let depth = 1;
    const pairRe = /\{\{#each\s|(?<!\{)\{\{\/each\}\}/g;
    pairRe.lastIndex = m.index + open.length;
    let closeMatch;
    while ((closeMatch = pairRe.exec(tpl))) {
      depth += closeMatch[0].startsWith('{{#each') ? 1 : -1;
      if (depth === 0) break;
    }
    if (!closeMatch || depth !== 0) throw new Error(`{{#each}} 未闭合: ${expr}`);
    const body = tpl.slice(m.index + open.length, closeMatch.index);
    const full = tpl.slice(m.index, closeMatch.index + closeMatch[0].length);

    const v = resolvePath(ctx, expr);
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v).map(([key, val]) => ({ key, ...val })) : [];
    const name = alias || 'item';
    const out = list
      .map((item, i) => render(body, { ...ctx, [name]: item, item, '@index': i + 1 }))
      .join('');
    tpl = tpl.slice(0, m.index) + out + tpl.slice(closeMatch.index + closeMatch[0].length);
  }

  // 3. 条件块（放在 each 之后：each 体内经递归 render 时框架已带 @index）
  //    {{#if expr}} 真值渲染 ｜ {{#unless expr}} 假值渲染 ｜ {{#if_first}} @index===1 ｜ {{#if_odd}} 奇数
  tpl = tpl.replace(/\{\{#if\s+([\w@][\w.@]*)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, expr, b) => (resolvePath(ctx, expr) ? b : ''));
  tpl = tpl.replace(/\{\{#unless\s+([\w@][\w.@]*)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_, expr, b) => (resolvePath(ctx, expr) ? '' : b));
  tpl = tpl.replace(/\{\{#if_first\}\}([\s\S]*?)\{\{\/if_first\}\}/g, (_, b) => (ctx['@index'] === 1 ? b : ''));
  tpl = tpl.replace(/\{\{#if_odd\}\}([\s\S]*?)\{\{\/if_odd\}\}/g, (_, b) => ((ctx['@index'] ?? 0) % 2 === 1 ? b : ''));

  // 4. 渲染剩余 {{var}} / {{{var}}}
  return renderFragment(tpl, ctx);
}

function renderFragment(tpl, ctx) {
  return tpl
    .replace(/\{\{\{\s*([\w@][\w.@]*)\s*\}\}\}/g, (_, expr) => String(resolvePath(ctx, expr) ?? ''))
    .replace(/\{\{\s*([\w@][\w.@]*)\s*\}\}/g, (_, expr) => esc(resolvePath(ctx, expr)));
}

/* ---------------- 页面处理 ---------------- */

/** 页面首部 JSON 元信息注释：<!-- {"title":"…","description":"…"} --> */
function parseMeta(html) {
  const m = html.match(/^\s*<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) throw new Error('页面缺少 meta JSON 注释');
  return JSON.parse(m[1]);
}

function buildPage(dirName, site) {
  const pagePath = path.join(PAGES_DIR, dirName, 'index.html');
  let html = read(pagePath);
  const meta = parseMeta(html);
  html = html.replace(/^\s*<!--\s*\{[\s\S]*?\}\s*-->/, '');

  const dataFile = path.join(DATA_DIR, `${dirName}.json`);
  const data = exists(dataFile) ? JSON.parse(read(dataFile)) : {};

  const slug = dirName === 'index' ? '' : `${dirName}/`;
  const ctx = {
    site,
    data,
    page: {
      slug,
      url: `${SITE_URL}/${slug}`,
      title: meta.title,
      description: meta.description,
      ogType: dirName === 'index' ? 'website' : 'article',
      ogImage: meta.ogImage || '/assets/img/longhu_yanhuowanhui.jpeg',
    },
  };

  html = render(html, ctx);
  const is404 = dirName === '404';
  // 404 页输出为 dist/404.html（Workers not_found_handling: "404-page" 约定）；其余为 <name>/index.html
  const outDir = dirName === 'index' || is404 ? DIST : path.join(DIST, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, is404 ? '404.html' : 'index.html'), html);
  return { slug: is404 ? '/404/' : `/${slug}`, meta };
}

/* ---------------- 主流程 ---------------- */

function main() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });

  const site = JSON.parse(read(path.join(DATA_DIR, 'site.json')));

  const pageDirs = fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));

  const built = pageDirs.map((d) => buildPage(d, site));

  // sitemap.xml（404 不收录）
  const pages = built.filter((b) => b.slug !== '/404/');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${SITE_URL}${p.slug === '/' ? '/' : p.slug}</loc>
    <changefreq>monthly</changefreq>
  </url>`
  )
  .join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);

  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
  );

  // 静态资源
  copyDir(path.join(ROOT, 'public'), DIST);
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
  console.log(`✔ ${built.length} 页构建完成 → dist/（${Date.now() - t0}ms）`);
  for (const b of built) console.log(`  ${b.slug.padEnd(12)} ${b.meta.title}`);
  console.log(`  sitemap.xml + robots.txt 已生成；首页 HTML ${kb(path.join(DIST, 'index.html'))}KB`);
}

main();
