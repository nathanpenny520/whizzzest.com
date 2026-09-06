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
const { createHash } = require('crypto');

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
  tpl = tpl.replace(/\{\{#if_not_first\}\}([\s\S]*?)\{\{\/if_not_first\}\}/g, (_, b) => (ctx['@index'] !== 1 ? b : ''));
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

/* ---------------- 图片优化（WebP 多宽度；未安装 sharp 时优雅降级为原图直出） ---------------- */

const IMG_WIDTHS = [480, 800, 1200, 1600];
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  /* devDependency 未安装（如临时环境）→ 跳过 WebP，站点仍可用原 JPEG 打开 */
}

/** 扫描 src/assets/img，产出 { '/assets/img/x.jpeg': { file, width, png } }；无 sharp 返回 {} */
async function scanImages() {
  if (!sharp) return {};
  const dir = path.join(SRC, 'assets', 'img');
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() || !/\.(jpe?g|png)$/i.test(entry.name)) continue;
    const meta = await sharp(path.join(dir, entry.name)).metadata();
    out[`/assets/img/${entry.name}`] = {
      file: entry.name,
      width: meta.width || 0,
      png: /\.png$/i.test(entry.name),
    };
  }
  return out;
}

/** 源图可用的变体宽度（不超过源宽；源图偏小则单给原生宽度一档） */
function variantWidths(info) {
  const ws = IMG_WIDTHS.filter((w) => w <= info.width);
  return ws.length ? ws : info.width ? [info.width] : [];
}

/** 生成 <name>-<w>.webp 到 dist/assets/img/（照片 q80，PNG/二维码类 q90 保清晰） */
async function generateWebp(images) {
  const dir = path.join(SRC, 'assets', 'img');
  const destDir = path.join(DIST, 'assets', 'img');
  let count = 0;
  for (const info of Object.values(images)) {
    for (const w of variantWidths(info)) {
      await sharp(path.join(dir, info.file))
        .resize({ width: w })
        .webp({ quality: info.png ? 90 : 80, effort: 6 })
        .toFile(path.join(destDir, info.file.replace(/\.[a-z]+$/i, `-${w}.webp`)));
      count++;
    }
  }
  return count;
}

/**
 * <img> 增强：/assets/img 源图包 <picture> 加 WebP srcset（原 JPEG 作回退）；
 * data-src 懒加载图（轮播）改补 data-srcset / data-sizes，由 main.js 激活时赋值。
 * sizes 取值：fetchpriority="high"（首屏 hero）→ 100vw；模板可写 data-sizes 覆盖；其余走卡片默认。
 */
function enhanceImages(html, images) {
  const preloads = [];
  html = html.replace(/<img\b[^>]*>/g, (tag) => {
    const m = tag.match(/\s(?:data-)?src="(\/assets\/img\/([^"]+))"/);
    const info = m && images[m[1]];
    if (!m || !info) return tag;
    const widths = variantWidths(info);
    if (!widths.length) return tag;
    const base = m[1].replace(/\.[a-z]+$/i, '');
    const srcset = widths.map((w) => `${base}-${w}.webp ${w}w`).join(', ');
    const isHero = /fetchpriority="high"/.test(tag);
    const sizes = isHero ? '100vw' : (tag.match(/data-sizes="([^"]+)"/) || [])[1] || '(max-width: 833px) 100vw, 340px';
    const clean = tag.replace(/\sdata-sizes="[^"]*"/g, '');
    if (/data-src="/.test(tag)) {
      return clean.replace(/data-src="/, `data-srcset="${srcset}" data-sizes="${sizes}" data-src="`);
    }
    if (isHero) preloads.push({ srcset, sizes });
    return `<picture><source type="image/webp" srcset="${srcset}" sizes="${sizes}">${clean}</picture>`;
  });
  return { html, preloads };
}

/* ---------------- 产物压缩（只压 dist，源文件保持可读） ---------------- */

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/** 折叠空白与注释；script/style/pre/textarea 内容原样保留（压空白可能破坏行注释等） */
function minifyHtml(html) {
  const parts = html.split(
    /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<pre\b[\s\S]*?<\/pre>|<textarea\b[\s\S]*?<\/textarea>)/g
  );
  return parts
    .map((seg, i) =>
      i % 2
        ? seg
        : seg
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\s+/g, ' ')
            .replace(/> </g, '><')
            .trim()
    )
    .join('');
}

/* ---------------- 页面处理 ---------------- */

/** 页面首部 JSON 元信息注释：<!-- {"title":"…","description":"…"} --> */
function parseMeta(html) {
  const m = html.match(/^\s*<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) throw new Error('页面缺少 meta JSON 注释');
  return JSON.parse(m[1]);
}

function buildPage(dirName, site, images) {
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

  // JSON-LD 结构化数据：每页 WebPage + 面包屑；首页附 Organization / WebSite（弊病 4 收尾项）
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: ctx.page.url,
    inLanguage: 'zh-CN',
    isPartOf: { '@id': `${SITE_URL}/#website` },
  };
  if (dirName === 'index') {
    jsonld['@graph'] = [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: site.name,
        url: `${SITE_URL}/`,
        email: site.email,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: site.name,
        url: `${SITE_URL}/`,
        inLanguage: 'zh-CN',
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
    ];
  }
  html = html.replace(
    '</head>',
    `  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n</head>`
  );

  // 图片增强（WebP srcset / picture 回退）+ 首屏 hero preload；无 sharp 时 images 为空原样输出
  const enhanced = enhanceImages(html, images);
  html = enhanced.html;
  if (enhanced.preloads.length) {
    const links = enhanced.preloads
      .map((p) => `<link rel="preload" as="image" imagesrcset="${p.srcset}" imagesizes="${p.sizes}" fetchpriority="high">`)
      .join('');
    html = html.replace('<link rel="stylesheet"', `${links}<link rel="stylesheet"`);
  }
  html = minifyHtml(html);

  const is404 = dirName === '404';
  // 404 页输出为 dist/404.html（Workers not_found_handling: "404-page" 约定）；其余为 <name>/index.html
  const outDir = dirName === 'index' || is404 ? DIST : path.join(DIST, dirName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, is404 ? '404.html' : 'index.html'), html);
  return { slug: is404 ? '/404/' : `/${slug}`, meta };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });

  const site = JSON.parse(read(path.join(DATA_DIR, 'site.json')));
  const images = await scanImages();

  const pageDirs = fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));

  const built = pageDirs.map((d) => buildPage(d, site, images));

  // sitemap.xml（404 不收录；/merchants/ 由 Worker 动态渲染，商户明细另见 /merchants/sitemap.xml）
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
  <url>
    <loc>${SITE_URL}/merchants/</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);

  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\nSitemap: ${SITE_URL}/merchants/sitemap.xml\n`
  );

  // 静态资源
  copyDir(path.join(ROOT, 'public'), DIST);
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));

  // WebP 变体生成（有 sharp 才有 images 清单）
  if (Object.keys(images).length) {
    const n = await generateWebp(images);
    console.log(`  WebP 变体 ${n} 个已生成`);
  } else if (!sharp) {
    console.warn('  ⚠ 未安装 sharp（npm install），跳过 WebP 图片优化');
  }

  // CSS 压缩（须在指纹计算前：?v= 哈希基于压缩产物）
  const cssPath = path.join(DIST, 'assets', 'css', 'style.css');
  fs.writeFileSync(cssPath, minifyCss(read(cssPath)));

  // 资源指纹：CSS/JS 内容变化 → 引用加 ?v=hash。/assets/* 缓存一年 immutable（_headers），
  // 无版本号的话访客会拿到旧样式（浏览器不会重新验证），有版本号则内容一变 URL 即变。
  const hashFile = (p) => createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
  const versions = {
    '/assets/css/style.css': hashFile(path.join(DIST, 'assets/css/style.css')),
    '/assets/js/main.js': hashFile(path.join(DIST, 'assets/js/main.js')),
  };
  const bumpAssetUrls = (file) => {
    let html = read(file);
    for (const [asset, v] of Object.entries(versions)) {
      html = html.replaceAll(asset, `${asset}?v=${v}`);
    }
    fs.writeFileSync(file, html);
  };
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.html')) bumpAssetUrls(p);
    }
  })(DIST);

  // 供主 Worker 渲染 /merchants/* 时复用全站页头/页脚（编译产物，导航改了随构建同步）
  const siteCtx = { site };
  fs.mkdirSync(path.join(DIST, 'partials'), { recursive: true });
  for (const name of ['header', 'footer']) {
    const compiled = render(read(path.join(PARTIALS_DIR, `${name}.html`)), siteCtx);
    fs.writeFileSync(path.join(DIST, 'partials', `${name}.html`), compiled);
  }
  // Worker 页面引用带指纹的 CSS/JS 用
  fs.writeFileSync(path.join(DIST, 'build-meta.json'), JSON.stringify(versions));

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
  console.log(`✔ ${built.length} 页构建完成 → dist/（${Date.now() - t0}ms）`);
  for (const b of built) console.log(`  ${b.slug.padEnd(12)} ${b.meta.title}`);
  console.log(`  sitemap.xml + robots.txt 已生成；首页 HTML ${kb(path.join(DIST, 'index.html'))}KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
