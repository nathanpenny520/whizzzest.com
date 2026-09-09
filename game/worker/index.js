/**
 * 焰境游戏 — game.whizzzest.com Worker（docs/游戏方案.md §1）
 *
 * 静态资产优先：命中资产的请求由 Workers Static Assets 直接服务（不过 Worker，省调用，
 * 安全头由 public/_headers 统一补）；未命中的进到这里做显式路由
 * （wrangler.jsonc 已关 html_handling：默认 auto-trailing-slash 会对 *.html 直接取用回 307，
 *   ASSETS.fetch 不跟随，故 / 与 /play/* 必须在这里重写）：
 *   - /            → /index.html（游戏库列表页）
 *   - /play/<id>/  → /play/app.html（统一运行页壳；游戏 id 由前端 JS 校验并渲染「未找到」态）
 *   - 其余         → 交还资产层（无匹配时按 not_found_handling 返回 /404.html）
 * 阶段一零后端逻辑、零绑定；阶段二/三再加 R2 / D1（docs/游戏方案.md §5/§6）。
 */
const PLAY_RE = /^\/play\/(?:[\w-]+)?\/?$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let asset = request;
    if (url.pathname === '/' || url.pathname === '') {
      asset = new Request(new URL('/index.html', url.origin), request);
    } else if (PLAY_RE.test(url.pathname)) {
      asset = new Request(new URL('/play/app.html', url.origin), request);
    }
    return env.ASSETS.fetch(asset);
  },
};
