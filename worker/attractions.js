/**
 * /attractions/* 旅游景点（2026-09-06）
 *  - GET /attractions/               瀑布流推荐栏（封面原比例卡片，CSS columns；标签 + 一句话简介）
 *  - GET /attractions/<slug>/        详情页（大封面 + 信息行 + 分段正文 + 周边线路/相关视频轻关联）
 *  - GET /attractions/sitemap.xml    已上线景点 sitemap 片段
 *
 * 内容以 D1 为权威（attractions，admin「景点」Tab 维护）：后台发布即时生效，对标 /tv/* /library/*。
 * 正文为空行分段纯文本，渲染时 esc 包 <p>——白名单结构，天然免疫 XSS（同文库）。
 * 封面：R2 whizzzest-media（attra/ 前缀）经 /media/* 代理，或站内路径 /assets/img/…。
 */

const SITE_URL = 'https://whizzzest.com';

const PUB_WHERE = "status = 'published'";

export async function handleAttractions(request, env, url, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } });
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/attractions/sitemap.xml') return attraSitemap(env);

  if (path === '/attractions') return attraHome(env, url, ctx);

  const m = path.match(/^\/attractions\/([a-z0-9-]+)$/);
  if (m) return attraDetail(env, url, ctx, m[1]);

  return notFound(env, url);
}

/* ---------------- 数据 ---------------- */

const aCover = (c) => (c ? (c.startsWith('/') ? c : '/media/' + c) : '');
const fmtDate = (d) => String(d || '').slice(0, 10);

const parseTags = (t) =>
  String(t || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

/** 正文渲染：空行分段纯文本 → esc 包 <p>（白名单结构防 XSS） */
function bodyHtml(body) {
  return String(body || '')
    .split(/\n{2,}/)
    .map((seg) => {
      const t = seg.trim();
      return t ? `<p>${esc(t)}</p>` : '';
    })
    .join('');
}

/* ---------------- 瀑布流列表页 ---------------- */

async function attraHome(env, url, ctx) {
  const chrome = await getChrome(env);
  const { results } = await env.DB
    .prepare(`SELECT slug, name, summary, tags, cover FROM attractions WHERE ${PUB_WHERE} ORDER BY sort, id DESC LIMIT 120`)
    .all();
  const list = results || [];

  const cards = list
    .map((a) => {
      const cover = aCover(a.cover);
      const tags = parseTags(a.tags)
        .map((t) => `<span>${esc(t)}</span>`)
        .join('');
      return `<a class="at-card" href="/attractions/${esc(a.slug)}/">
        <div class="at-media">${cover ? `<img src="${esc(cover)}" alt="${esc(a.name)}" loading="lazy" decoding="async">` : '<span class="at-ph" aria-hidden="true">游</span>'}</div>
        <div class="at-body">
          <h2>${esc(a.name)}</h2>
          <p>${esc(a.summary)}</p>
          ${tags ? `<p class="at-tags">${tags}</p>` : ''}
        </div>
      </a>`;
    })
    .join('');

  const body = `
    <div class="at-page">
    <section class="at-hero">
      <div class="container-wide">
        <p class="at-kicker">旅游景点 · WANZHAI SCENERY</p>
        <h1>游万载 · 古城山水焰火间</h1>
        <p class="at-sub">${list.length ? `${list.length} 处景点 · 万载古城、竹山洞、九龙原始森林……一城焰火，满目山水` : '景点整理中，敬请期待'}</p>
      </div>
    </section>
    <section class="at-main"><div class="container-wide">
      ${list.length ? `<div class="masonry at-grid">${cards}</div>` : '<div class="at-empty"><p>景点整理中，敬请期待。</p><p class="sub">万载古城、竹山洞、九龙原始森林……正在逐一上新。</p></div>'}
    </div></section>
    </div>`;

  return htmlResponse(
    pageShell(chrome, {
      title: '旅游景点 — 万载古城 / 竹山洞 / 九龙原始森林 | 焰境·万载',
      description:
        '万载旅游景点推荐：万载古城、竹山洞、九龙原始森林、恒晖艺术农业、龙湖公园——古城山水焰火间，一朝相逢，便是万载。',
      url: `${SITE_URL}/attractions/`,
      body,
    })
  );
}

/* ---------------- 详情页 ---------------- */

async function attraDetail(env, url, ctx, slug) {
  const a = await env.DB.prepare(`SELECT * FROM attractions WHERE ${PUB_WHERE} AND slug = ?1`)
    .bind(slug)
    .first();
  if (!a) return notFound(env, url);

  const chrome = await getChrome(env);

  // 上一篇/下一篇：全量取已上线 (slug, name) 按展示序排，量级小（数十）一次查完
  const { results: order } = await env.DB
    .prepare(`SELECT slug, name FROM attractions WHERE ${PUB_WHERE} ORDER BY sort, id DESC`)
    .all();
  const idx = (order || []).findIndex((x) => x.slug === slug);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const pager = (x, cls, label) =>
    x
      ? `<a class="${cls}" href="/attractions/${esc(x.slug)}/"><i>${label}</i><b>${esc(x.name)}</b></a>`
      : `<span class="${cls} off"><i>${label}</i><b>—</b></span>`;

  const tags = parseTags(a.tags)
    .map((t) => `<span>${esc(t)}</span>`)
    .join('');

  const infoRows = [
    ['地址', a.address],
    ['开放时间', a.hours],
    ['门票', a.tickets],
    ['交通', a.transport],
  ].filter(([, v]) => v);
  const infoHtml = infoRows.length
    ? `<div class="at-info">${infoRows
        .map(([k, v]) => `<div class="at-info-row"><b>${k}</b><span>${esc(v)}</span></div>`)
        .join('')}</div>`
    : '';

  const cover = aCover(a.cover);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: a.name,
    description: a.summary,
    url: `${SITE_URL}/attractions/${a.slug}/`,
    ...(cover ? { image: `${SITE_URL}${cover}` } : {}),
    ...(a.address ? { address: { '@type': 'PostalAddress', streetAddress: a.address, addressRegion: '江西', addressCountry: 'CN' } } : {}),
  };

  const body = `
    <div class="at-page">
    <section class="at-detail"><div class="container">
      <nav class="at-crumb" aria-label="面包屑"><a href="/">首页</a><span>/</span><a href="/attractions/">旅游景点</a><span>/</span><b>${esc(a.name)}</b></nav>
      <figure class="at-heroimg">${cover ? `<img src="${esc(cover)}" alt="${esc(a.name)}" loading="eager" fetchpriority="high">` : '<span class="at-ph" aria-hidden="true">游</span>'}</figure>
      <div class="at-head">
        <h1>${esc(a.name)}</h1>
        ${tags ? `<p class="at-tags">${tags}</p>` : ''}
        <p class="at-summary">${esc(a.summary)}</p>
      </div>
      ${infoHtml}
      ${a.body ? `<div class="at-article">${bodyHtml(a.body)}</div>` : ''}
      <div class="at-links">
        <a class="at-link" href="/tourism/">周边线路 · 旅游线路 →</a>
        <a class="at-link" href="/tv/?cat=tourism">万载视频 · 相关视频 →</a>
      </div>
      <nav class="at-pager" aria-label="景点翻页">
        ${pager(prev, 'at-pager-item at-prev', '上一处')}
        <a class="at-all" href="/attractions/">全部景点</a>
        ${pager(next, 'at-pager-item at-next', '下一处')}
      </nav>
    </div></section>
    </div>`;

  return htmlResponse(
    pageShell(chrome, {
      title: `${a.name} — 万载旅游景点 | 焰境·万载`,
      description: `${a.summary}——${a.name}旅游攻略、地址与交通，尽在焰境·万载。`,
      url: `${SITE_URL}/attractions/${a.slug}/`,
      jsonLd,
      body,
    })
  );
}

/* ---------------- sitemap 片段 ---------------- */

async function attraSitemap(env) {
  const { results } = await env.DB
    .prepare(`SELECT slug, updated_at FROM attractions WHERE ${PUB_WHERE} ORDER BY id DESC`)
    .all();
  const urls = (results || [])
    .map(
      (x) => `  <url>
    <loc>${SITE_URL}/attractions/${x.slug}/</loc>
    <lastmod>${String(x.updated_at || '').slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
  </url>`
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } }
  );
}

/* ---------------- 页面骨架（对标 tv.js） ---------------- */

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
  <meta property="og:type" content="article">
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
</body>
</html>`;
}

async function notFound(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL('/404.html', url.origin)));
  return new Response(r.body, { status: 404, headers: r.headers });
}

/** HTML 响应；逐次计访客（index.js 统一处理），不做边缘缓存（后台发布即时生效） */
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
