/**
 * 单入口 Worker：www → 裸域 301，其余请求交给静态资产（dist/）。
 * 见 docs/设计架构与方案.md §8.2（www 301 到 @，统一规范主机名）。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.whizzzest.com') {
      url.hostname = 'whizzzest.com';
      return Response.redirect(url, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
