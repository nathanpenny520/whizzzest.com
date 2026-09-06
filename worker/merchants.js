/**
 * /merchants/* 动态渲染（商户功能 M1，docs/商户功能方案.md）
 *  - GET /merchants/                目录页（推荐位 + 分类筛选 + 卡片网格）
 *  - GET /merchants/<slug>/         详情页（LocalBusiness 结构化数据）
 *  - GET /merchants/sitemap.xml     已上线商户 sitemap 片段
 *
 * 内容以 D1 为权威：admin 审核通过即时生效，不依赖构建。
 * HTML 不做边缘缓存——页面浏览要逐次计访客（visits 采集在 index.js 统一处理），
 * 当前量级 D1 直查毫无压力；未来量级上来再切 Cache API + 事件失效。
 * 页头/页脚复用构建产物 dist/partials/*.html（build.js 每次构建同步），样式走带指纹的 style.css。
 */

const CATEGORIES = {
  food: '美食',
  stay: '住宿',
  specialty: '特产',
  fireworks: '花炮',
  other: '其他',
};

const SITE_URL = 'https://whizzzest.com';
const APPLY_URL = 'https://merchant.whizzzest.com/apply';
const APPLY_MAILTO =
  'mailto:whizzzest@outlook.com?subject=' + encodeURIComponent('商户入驻申请 — 焰境·万载');

// 商户图片：R2 对象键 → 主站代理地址；以斜杠开头视为站内静态资源路径，原样使用
const mimg = (v) => (v && !v.startsWith('/') ? '/assets-merchant/' + v : v);

export async function handleMerchants(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } });
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/merchants/sitemap.xml') return merchantsSitemap(env);

  const cat = CATEGORIES[url.searchParams.get('cat')] ? url.searchParams.get('cat') : '';
  if (path === '/merchants' || path === '/merchants/') return merchantsHome(env, url, cat);

  const m = path.match(/^\/merchants\/([a-z0-9-]+)$/);
  if (m) return merchantDetail(env, url, m[1]);

  return notFound(env, url);
}

/* ---------------- 数据 ---------------- */

// 上线商户排序：featured → verified → free，同级按权重/新在上
const ORDER_BY =
  "ORDER BY CASE tier WHEN 'featured' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END, sort_weight DESC, id DESC";

async function approvedMerchants(env, cat) {
  const sql = cat
    ? `SELECT * FROM merchants WHERE status = 'approved' AND category = ?1 ${ORDER_BY}`
    : `SELECT * FROM merchants WHERE status = 'approved' ${ORDER_BY}`;
  const { results } = cat
    ? await env.DB.prepare(sql).bind(cat).all()
    : await env.DB.prepare(sql).all();
  return results || [];
}

async function approvedBySlug(env, slug) {
  return env.DB
    .prepare("SELECT * FROM merchants WHERE status = 'approved' AND slug = ?1")
    .bind(slug)
    .first();
}

/* ---------------- 目录页 ---------------- */

async function merchantsHome(env, url, cat) {
  const chrome = await getChrome(env);
  const list = await approvedMerchants(env, cat);
  const featured = list.filter((x) => x.tier === 'featured');
  const rest = list.filter((x) => x.tier !== 'featured');

  const catTabs = Object.entries(CATEGORIES)
    .map(
      ([key, label]) =>
        `<a class="mc-tab${key === cat ? ' on' : ''}" href="/merchants/${key ? `?cat=${key}` : ''}">${label}</a>`
    )
    .join('');

  const card = (x) => {
    const cover = x.cover
      ? `<img src="${esc(mimg(x.cover))}" alt="${esc(x.name)}" loading="lazy" decoding="async">`
      : `<span class="mc-ph" aria-hidden="true">${esc(x.name.slice(0, 1))}</span>`;
    const badge =
      x.tier === 'featured'
        ? '<span class="mc-badge feat">推荐</span>'
        : x.tier === 'verified'
          ? '<span class="mc-badge">认证商户</span>'
          : '';
    const addr = x.address ? `<p class="mc-addr">${esc(x.address)}</p>` : '';
    return `<a class="mc-card" href="/merchants/${esc(x.slug)}/">
      <div class="mc-media">${cover}${badge}</div>
      <div class="mc-body">
        <h3>${esc(x.name)}</h3>
        <p class="mc-intro">${esc(x.intro)}</p>
        ${addr}
        <span class="mc-cat">${esc(CATEGORIES[x.category] || '其他')}</span>
      </div>
    </a>`;
  };

  const featuredStrip = featured.length
    ? `<div class="mc-feat"><h2 class="mc-feat-title">✦ 推荐好店</h2><div class="mc-grid">${featured.map(card).join('')}</div></div>`
    : '';

  const grid = rest.length
    ? `<div class="mc-grid">${rest.map(card).join('')}</div>`
    : featured.length
      ? ''
      : `<div class="mc-empty"><p>首批商户入驻审核中，敬请期待。</p><p class="sub">商家朋友想抢先展示？欢迎联系我们。</p></div>`;

  const html = pageShell(chrome, {
    title: '焰境好店 — 万载本地商户推荐 | 焰境·万载',
    description: '焰境·万载精选本地好店：美食、住宿、特产、花炮，游客与本地人都在用的万载商户指南。商户入驻合作请联系我们。',
    url: `${SITE_URL}/merchants/`,
    body: `
    <section class="mc-hero">
      <div class="container">
        <p class="mc-kicker">焰境好店</p>
        <h1>万载本地商户推荐</h1>
        <p class="mc-sub">吃得地道、住得舒心、带得走的万载 —— 游客与本地人都在用。</p>
        <a class="btn btn-light mc-apply" href="${APPLY_MAILTO}">商户入驻</a>
      </div>
    </section>
    <section class="mc-main">
      <div class="container">
        <nav class="mc-tabs" aria-label="商户分类">${catTabs}</nav>
        ${featuredStrip}
        ${grid}
        <div class="mc-cta">
          <h2>你是万载的店家？</h2>
          <p>把你的店展示给每一位来万载的游客。认证商户享独立详情页、电话微信直达与专属数据看板。</p>
          <a class="btn btn-primary" href="${APPLY_MAILTO}">立即入驻</a>
        </div>
      </div>
    </section>`,
  });
  return htmlResponse(html);
}

/* ---------------- 详情页 ---------------- */

async function merchantDetail(env, url, slug) {
  const item = await approvedBySlug(env, slug);
  if (!item) return notFound(env, url);

  const chrome = await getChrome(env);
  const detailHtml = (item.detail || '')
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');

  const infoRows = [
    ['地址', item.address],
    ['电话', item.phone],
    ['微信', item.wechat],
    ['营业时间', item.hours],
  ].filter(([, v]) => v);

  const infoList = infoRows.length
    ? `<ul class="md-info">${infoRows
        .map(
          ([k, v]) =>
            `<li><span class="k">${k}</span><span class="v">${esc(v)}</span><button class="copy" type="button" data-copy="${esc(v)}">复制</button></li>`
        )
        .join('')}</ul>`
    : '';

  const related = (await approvedMerchants(env, item.category))
    .filter((x) => x.id !== item.id)
    .slice(0, 3);
  const relatedHtml = related.length
    ? `<section class="md-related"><div class="container">
        <h2>同类好店</h2>
        <div class="mc-grid">${related.map(relatedCard).join('')}</div>
      </div></section>`
    : '';

  let gallery = [];
  try { gallery = JSON.parse(item.images || '[]'); } catch { /* 忽略坏数据 */ }
  const coverHtml = item.cover
    ? `<div class="md-cover"><img src="${esc(mimg(item.cover))}" alt="${esc(item.name)}" loading="eager" decoding="async"></div>`
    : '';
  const galleryHtml = gallery.length
    ? `<div class="md-gallery">${gallery.map((k, i) => `<img src="${esc(mimg(k))}" alt="${esc(item.name)} 图${i + 1}" loading="lazy" decoding="async">`).join('')}</div>`
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: item.name,
    description: item.intro,
    ...(item.address ? { address: item.address } : {}),
    ...(item.phone ? { telephone: item.phone } : {}),
    url: `${SITE_URL}/merchants/${item.slug}/`,
  };

  const html = pageShell(chrome, {
    title: `${item.name} — 焰境好店 | 焰境·万载`,
    description: item.intro,
    url: `${SITE_URL}/merchants/${item.slug}/`,
    jsonLd,
    body: `
    <section class="md-page">
      <div class="container">
        <nav class="md-crumb" aria-label="面包屑"><a href="/">首页</a><span>/</span><a href="/merchants/">商户</a><span>/</span><b>${esc(item.name)}</b></nav>
        ${coverHtml}
        ${galleryHtml}
        <div class="md-head">
          <h1>${esc(item.name)}</h1>
          ${item.tier === 'featured' ? '<span class="mc-badge feat">推荐</span>' : item.tier === 'verified' ? '<span class="mc-badge">认证商户</span>' : ''}
          <span class="mc-cat">${esc(CATEGORIES[item.category] || '其他')}</span>
        </div>
        <p class="md-intro">${esc(item.intro)}</p>
        ${detailHtml ? `<div class="md-detail">${detailHtml}</div>` : ''}
        ${infoList}
      </div>
    </section>
    ${relatedHtml}`,
  });
  return htmlResponse(html);
}

function relatedCard(x) {
  const cover = x.cover
    ? `<img src="${esc(mimg(x.cover))}" alt="${esc(x.name)}" loading="lazy" decoding="async">`
    : `<span class="mc-ph" aria-hidden="true">${esc(x.name.slice(0, 1))}</span>`;
  return `<a class="mc-card" href="/merchants/${esc(x.slug)}/">
    <div class="mc-media">${cover}</div>
    <div class="mc-body"><h3>${esc(x.name)}</h3><p class="mc-intro">${esc(x.intro)}</p></div>
  </a>`;
}

/* ---------------- sitemap 片段 ---------------- */

async function merchantsSitemap(env) {
  const { results } = await env.DB
    .prepare("SELECT slug, updated_at FROM merchants WHERE status = 'approved' ORDER BY id DESC")
    .all();
  const urls = (results || [])
    .map(
      (x) => `  <url>
    <loc>${SITE_URL}/merchants/${x.slug}/</loc>
    <lastmod>${String(x.updated_at || '').slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } }
  );
}

/* ---------------- 页面骨架 ---------------- */

async function getChrome(env) {
  if (getChrome.c) return getChrome.c;
  const asset = (p) => env.ASSETS.fetch(new Request('https://assets.whizzzest.local' + p));
  const [header, footer, meta] = await Promise.all([
    asset('/partials/header.html').then((r) => r.text()),
    asset('/partials/footer.html').then((r) => r.text()),
    asset('/build-meta.json').then((r) => r.json()),
  ]);
  getChrome.c = { header, footer, meta };
  return getChrome.c;
}

function pageShell(chrome, { title, description, url, body, jsonLd }) {
  const cssV = chrome.meta['/assets/css/style.css'] || '';
  const jsV = chrome.meta['/assets/js/main.js'] || '';
  const ogImage = '/assets/img/longhu_yanhuowanhui.jpeg';
  const ld = jsonLd
    ? `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta name="theme-color" content="#fbfbfd">
  <meta property="og:site_name" content="焰境·万载">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${SITE_URL}${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/assets/css/style.css?v=${esc(cssV)}">
${ld}</head>
<body>
  ${chrome.header}
  <main id="main">
${body}
  </main>
  ${chrome.footer}
  <script type="module" src="/assets/js/main.js?v=${esc(jsV)}"></script>
  <script>
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.copy') : null;
    if (!btn) return;
    var text = btn.getAttribute('data-copy') || '';
    function done() { btn.textContent = '已复制'; setTimeout(function () { btn.textContent = '复制'; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) {}
      document.body.removeChild(ta);
    }
  });
})();
  </script>
</body>
</html>`;
}

async function notFound(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL('/404.html', url.origin)));
  return new Response(r.body, { status: 404, headers: r.headers });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
