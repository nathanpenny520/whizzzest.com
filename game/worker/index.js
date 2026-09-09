/**
 * 焰境游戏 — game.whizzzest.com Worker（docs/游戏方案.md §1，docs/游戏整合方案.md §1.7）
 *
 * 静态资产优先：命中资产的请求由 Workers Static Assets 直接服务（不过 Worker，省调用，
 * 安全头由 public/_headers 统一补）；未命中的进到这里做显式路由
 * （wrangler.jsonc 已关 html_handling：默认 auto-trailing-slash 会对 *.html 直接取用回 307，
 *   ASSETS.fetch 不跟随，故 / 与 /play/* 必须在这里重写）：
 *   - /            → /index.html（游戏库列表页）
 *   - /play/<id>/  → /play/app.html（统一运行页壳；游戏 id 由前端 JS 校验并渲染「未找到」态）
 *   - /en、/en/    → /index.html（英文列表页；同一份页面，前端 i18n 按路径切文案）
 *   - /en/play/<id>/ → /play/app.html（英文运行页，同上）
 *   - 其余 /en/*   → 直接交还资产层：miss 时 not_found_handling 返回 /404.html（404 状态），
 *                    页面 JS 按浏览器地址的 /en 前缀自动渲染英文 404（docs/游戏英文版方案.md §3.3）
 *   - /g/*         → R2 桶 whizzzest-game 反代（第三方游戏包托管，docs/游戏整合方案.md §1.1/§1.7）
 *   - 其余         → 交还资产层（无匹配时按 not_found_handling 返回 /404.html）
 * 阶段二绑定：R2（第三方游戏包，后续模拟器内核/ROM 同桶）；D1（云存档）仍按方案 §6 后置。
 */
const PLAY_RE = /^\/play\/(?:[\w.-]+)?\/?$/; // 允许 id 含点（minecraft-1.8）；仍不含斜杠，防路径穿越
const PLAY_RE_EN = /^\/en\/play\/(?:[\w.-]+)?\/?$/; // 英文运行页同规则（前端 boot 的 id 提取正则允许 /en 前缀）

/* /g/* Content-Type 兜底表（正常情况上传时已带 metadata，这里只兜漏网之鱼） */
const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8', xml: 'application/xml',
};

/* 第三方游戏包反代（R2 直读，对标主站 /assets-merchant/ 实现）：
 * 键 = pathname 去掉 /g/ 前缀（上传脚本 game/scripts/upload-games.mjs 与此约定一致）。
 * 缓存策略（收录迭代期以「更新即时可见」优先）：文本/代码 no-cache（ETag 条件请求，命中 304），
 * 媒体类日缓存；游戏包文件名不带 hash，不能用长强缓存——曾因 js 24h 强缓存让用户端
 * 在修复后继续吃到坏文件一天。nosniff 对齐 _headers 规范。
 * 注意：游戏包会被自家 iframe 引用，绝不能在这里补 X-Frame-Options。 */
const TEXT_EXT = new Set(['html', 'json', 'webmanifest', 'js', 'mjs', 'css', 'txt', 'xml']);

async function handleGameAsset(request, url, env) {
  let key;
  try {
    key = decodeURIComponent(url.pathname.slice('/g/'.length));
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!key || key.endsWith('/') || key.includes('..') || key.includes('\\')) {
    return new Response(null, { status: 404 });
  }
  const obj = await env.GAMEDATA.get(key);
  if (!obj) return new Response(null, { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  const ext = (key.split('.').pop() || '').toLowerCase();
  if (!headers.has('content-type')) headers.set('content-type', MIME[ext] || 'application/octet-stream');
  headers.set('etag', obj.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', TEXT_EXT.has(ext) ? 'no-cache' : 'public, max-age=86400');
  if (request.headers.get('if-none-match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/g/')) {
      return handleGameAsset(request, url, env);
    }
    let asset = request;
    if (url.pathname === '/' || url.pathname === '') {
      asset = new Request(new URL('/index.html', url.origin), request);
    } else if (PLAY_RE.test(url.pathname)) {
      asset = new Request(new URL('/play/app.html', url.origin), request);
    } else if (url.pathname === '/en' || url.pathname === '/en/') {
      // 英文列表页：同一份 index.html，前端 i18n 按 /en 前缀切换文案（零英文页面副本）
      asset = new Request(new URL('/index.html', url.origin), request);
    } else if (PLAY_RE_EN.test(url.pathname)) {
      asset = new Request(new URL('/play/app.html', url.origin), request);
    }
    // 其余 /en/* 不拦：交还资产层后 miss → not_found_handling 返回 /404.html（404 状态），
    // 404 页里的 i18n.js 读浏览器地址栏前缀自动出英文
    return env.ASSETS.fetch(asset);
  },
};
