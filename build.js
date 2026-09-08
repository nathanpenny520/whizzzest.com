#!/usr/bin/env node
/**
 * build.js — 焰境·万载 零依赖构建脚本
 *
 * 职责：
 *  1. 拼接公共片段（partials）+ 渲染模板变量 / #each 循环
 *  2. 每个页面按 locale 循环构建（docs/英文版方案.md §1.2）：
 *     默认语言（zh）产物在根路径；其他 locale 产物在 dist/<urlPrefix>/…
 *     正文数据 src/data/<code>/<路径>.json 不存在 → 该页不产出该语言（不做中文兜底，防孤儿页）
 *  3. 生成 sitemap.xml（hreflang 互指）/ robots.txt；per-locale manifest.webmanifest；
 *     /<code>/offline.html 离线兜底双语
 *  4. 构建期校验：非默认语言页面站内链接巡检 + 翻译覆盖率报告（断链默认失败，--loose 放行）
 *  5. 复制 public/ 与 src/assets/ → dist/
 *
 * 运行：node build.js [--loose]   （无任何 npm 依赖，仅 Node 内置模块）
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

/* ---------------- 多语言（docs/英文版方案.md §1.2 / §1.5） ----------------
 * Locale 注册表 = 唯一事实源：路由前缀、html lang、hreflang、og:locale、
 * 语言切换器、per-locale manifest、sitemap alternate、覆盖率报告全部由本表驱动。
 * 新增语言 = 这里注册一行 + src/data/<code>/ 补 site/strings/页面数据，不碰其他代码。
 * 除本表与数据文件外，任何地方不得硬编码 locale 判断。 */
const LOCALES = [
  { code: 'zh', urlPrefix: '', htmlLang: 'zh-CN', hreflang: 'zh-CN', ogLocale: 'zh_CN', label: '中文' },
  { code: 'en', urlPrefix: 'en', htmlLang: 'en', hreflang: 'en', ogLocale: 'en_US', label: 'English' },
];
const DEFAULT_LOCALE = LOCALES[0];
// 已知 Worker 动态板块（zh-only，二期出 EN）：EN 页链接到它们降级为中文页，计入报告不拦截
const DYNAMIC_ZH_ROUTES = ['/merchants', '/tv', '/library', '/music', '/attractions', '/pay', '/api'];
const LOOSE = process.argv.includes('--loose');

// 资产/杂项路径前缀：链接巡检时跳过
const ASSET_PREFIXES = ['/assets/', '/icons/', '/favicon.svg', '/manifest', '/sw.js', '/offline'];

/** 页脚社交图标库（SVG innerHTML）：数据驱动页脚（site.footer.socials[].icon → 此表）。
 *  新平台 = 这里加一项 + 数据文件里引用 icon 名。 */
const SOCIAL_ICONS = {
  bilibili:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"/></svg>',
  'wechat-channel':
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.3 8.6v6.8L15.9 12Z"/></svg>',
  'wechat-official':
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg>',
  douyin:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
  xiaohongshu:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M22.405 9.879c.002.016.01.02.07.019h.725a.797.797 0 0 0 .78-.972.794.794 0 0 0-.884-.618.795.795 0 0 0-.692.794c0 .101-.002.666.001.777zm-11.509 4.808c-.203.001-1.353.004-1.685.003a2.528 2.528 0 0 1-.766-.126.025.025 0 0 0-.03.014L7.7 16.127a.025.025 0 0 0 .01.032c.111.06.336.124.495.124.66.01 1.32.002 1.981 0 .01 0 .02-.006.023-.015l.712-1.545a.025.025 0 0 0-.024-.036zM.477 9.91c-.071 0-.076.002-.076.01a.834.834 0 0 0-.01.08c-.027.397-.038.495-.234 3.06-.012.24-.034.389-.135.607-.026.057-.033.042.003.112.046.092.681 1.523.787 1.74.008.015.011.02.017.02.008 0 .033-.026.047-.044.147-.187.268-.391.371-.606.306-.635.44-1.325.486-1.706.014-.11.021-.22.03-.33l.204-2.616.022-.293c.003-.029 0-.033-.03-.034zm7.203 3.757a1.427 1.427 0 0 1-.135-.607c-.004-.084-.031-.39-.235-3.06a.443.443 0 0 0-.01-.082c-.004-.011-.052-.008-.076-.008h-1.48c-.03.001-.034.005-.03.034l.021.293c.076.982.153 1.964.233 2.946.05.4.186 1.085.487 1.706.103.215.223.419.37.606.015.018.037.051.048.049.02-.003.742-1.642.804-1.765.036-.07.03-.055.003-.112zm3.861-.913h-.872a.126.126 0 0 1-.116-.178l1.178-2.625a.025.025 0 0 0-.023-.035l-1.318-.003a.148.148 0 0 1-.135-.21l.876-1.954a.025.025 0 0 0-.023-.035h-1.56c-.01 0-.02.006-.024.015l-.926 2.068c-.085.169-.314.634-.399.938a.534.534 0 0 0-.02.191.46.46 0 0 0 .23.378.981.981 0 0 0 .46.119h.59c.041 0-.688 1.482-.834 1.972a.53.53 0 0 0-.023.172.465.465 0 0 0 .23.398c.15.092.342.12.475.12l1.66-.001c.01 0 .02-.006.023-.015l.575-1.28a.025.025 0 0 0-.024-.035zm-6.93-4.937H3.1a.032.032 0 0 0-.034.033c0 1.048-.01 2.795-.01 6.829 0 .288-.269.262-.28.262h-.74c-.04.001-.044.004-.04.047.001.037.465 1.064.555 1.263.01.02.03.033.051.033.157.003.767.009.938-.014.153-.02.3-.06.438-.132.3-.156.49-.419.595-.765.052-.172.075-.353.075-.533.002-2.33 0-4.66-.007-6.991a.032.032 0 0 0-.032-.032zm11.784 6.896c0-.014-.01-.021-.024-.022h-1.465c-.048-.001-.049-.002-.05-.049v-4.66c0-.072-.005-.07.07-.07h.863c.08 0 .075.004.075-.074V8.393c0-.082.006-.076-.08-.076h-3.5c-.064 0-.075-.006-.075.073v1.445c0 .083-.006.077.08.077h.854c.075 0 .07-.004.07.07v4.624c0 .095.008.084-.085.084-.37 0-1.11-.002-1.304 0-.048.001-.06.03-.06.03l-.697 1.519s-.014.025-.008.036c.006.01.013.008.058.008 1.748.003 3.495.002 5.243.002.03-.001.034-.006.035-.033v-1.539zm4.177-3.43c0 .013-.007.023-.02.024-.346.006-.692.004-1.037.004-.014-.002-.022-.01-.022-.024-.005-.434-.007-.869-.01-1.303 0-.072-.006-.071.07-.07l.733-.003c.041 0 .081.002.12.015.093.025.16.107.165.204.006.431.002 1.153.001 1.153zm2.67.244a1.953 1.953 0 0 0-.883-.222h-.18c-.04-.001-.04-.003-.042-.04V10.21c0-.132-.007-.263-.025-.394a1.823 1.823 0 0 0-.153-.53 1.533 1.533 0 0 0-.677-.71 2.167 2.167 0 0 0-1-.258c-.153-.003-.567 0-.72 0-.07 0-.068.004-.068-.065V7.76c0-.031-.01-.041-.046-.039H17.93s-.016 0-.023.007c-.006.006-.008.012-.008.023v.546c-.008.036-.057.015-.082.022h-.95c-.022.002-.028.008-.03.032v1.481c0 .09-.004.082.082.082h.913c.082 0 .072.128.072.128V11.19s.003.117-.06.117h-1.482c-.068 0-.06.082-.06.082v1.445s-.01.068.064.068h1.457c.082 0 .076-.006.076.079v3.225c0 .088-.007.081.082.081h1.43c.09 0 .082.007.082-.08v-3.27c0-.029.006-.035.033-.035l2.323-.003c.098 0 .191.02.28.061a.46.46 0 0 1 .274.407c.008.395.003.79.003 1.185 0 .259-.107.367-.33.367h-1.218c-.023.002-.029.008-.028.033.184.437.374.871.57 1.303a.045.045 0 0 0 .04.026c.17.005.34.002.51.003.15-.002.517.004.666-.01a2.03 2.03 0 0 0 .408-.075c.59-.18.975-.698.976-1.313v-1.981c0-.128-.01-.254-.034-.38 0 .078-.029-.641-.724-.998z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  facebook:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>',
  discord:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
};

/* ---------------- 小工具 ---------------- */

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

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

/** deep-merge：src 覆盖 base（对象递归合并，其余 src 有值即覆盖）；strings 回退链用 */
function deepMerge(base, src) {
  const out = { ...base };
  for (const [k, v] of Object.entries(src || {})) {
    out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** locale 数据/配置文件路径：默认语言在 src/data/ 根，其他在 src/data/<code>/ */
function localeDataPath(loc, relPath) {
  return loc.code === DEFAULT_LOCALE.code
    ? path.join(DATA_DIR, relPath)
    : path.join(DATA_DIR, loc.code, relPath);
}

/** locale 的 URL 前缀：zh → '/'，en → '/en/' */
const localePrefix = (loc) => (loc.urlPrefix ? `/${loc.urlPrefix}/` : '/');

/** 页面在该 locale 下的 slug：zh /about/ → en /en/about/ */
const pageSlug = (loc, dirName) => {
  const base = dirName === 'index' ? '' : `${dirName}/`;
  return `${localePrefix(loc)}${base}`;
};

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
 *   {{#each expr [as name]}}…{{/each}}   循环（可嵌套，as name 命名循环变量，默认 item）
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
    const sizes = isHero ? '100vw' : (tag.match(/data-sizes="([^"]*)"/) || [])[1] || '(max-width: 833px) 100vw, 340px';
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

/**
 * 构建单页 × 单 locale。
 * 非默认 locale：数据文件 src/data/<code>/<dir>.json 不存在 → 返回 null（该页不产出该语言）；
 * 页面 meta（title/description）必须取自该数据文件的 meta 字段，缺失即构建失败。
 */
function buildPage(loc, dirName, site, strings, images, alternates, ogAlternates, localesForSwitcher) {
  const pagePath = path.join(PAGES_DIR, dirName, 'index.html');
  let html = read(pagePath);
  const zhMeta = parseMeta(html);
  html = html.replace(/^\s*<!--\s*\{[\s\S]*?\}\s*-->/, '');

  const isDefault = loc.code === DEFAULT_LOCALE.code;
  const locDataFile = localeDataPath(loc, `${dirName}.json`);
  if (!isDefault && !exists(locDataFile)) return null;
  const data = exists(locDataFile) ? JSON.parse(read(locDataFile)) : {};

  let meta = zhMeta;
  if (!isDefault) {
    const m = data.meta || {};
    if (!m.title || !m.description) {
      throw new Error(`[${loc.code}] ${dirName} 数据文件缺 meta.title / meta.description（src/data/${loc.code}/${dirName}.json）`);
    }
    meta = { ...zhMeta, ...m };
  }

  const slug = pageSlug(loc, dirName);
  const ctx = {
    site,
    data,
    t: strings,
    page: {
      locale: loc.code,
      htmlLang: loc.htmlLang,
      ogLocale: loc.ogLocale,
      manifestHref: `${localePrefix(loc)}manifest.webmanifest`,
      isDefaultLocale: isDefault,
      slug,
      url: `${SITE_URL}${slug}`,
      title: meta.title,
      description: meta.description,
      ogType: dirName === 'index' ? 'website' : 'article',
      ogImage: meta.ogImage || '/assets/img/longhu_yanhuowanhui.jpeg',
      themeColor: meta.themeColor || '#fbfbfd',
      css: meta.css || '',
      alternates,
      ogAlternates,
      locales: localesForSwitcher,
      // JS 文案（main.js / ai-chat.js / fireworks 经 window.__I18N 取串）
      i18n: JSON.stringify({ locale: loc.code, ...strings.js }),
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
    inLanguage: loc.htmlLang,
    isPartOf: { '@id': `${SITE_URL}/#website` },
  };
  if (dirName === 'about') {
    // 关于页：AboutPage + 挂载团队实体（与首页 Organization 同 @id 关联）
    jsonld['@type'] = 'AboutPage';
    jsonld.mainEntity = {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: site.name,
      url: `${SITE_URL}${localePrefix(loc)}`,
      email: site.email,
    };
  }
  if (dirName === 'index') {
    jsonld['@graph'] = [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: site.name,
        url: `${SITE_URL}${localePrefix(loc)}`,
        email: site.email,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: site.name,
        url: `${SITE_URL}${localePrefix(loc)}`,
        inLanguage: loc.htmlLang,
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
  // 404 页输出为 dist/[<prefix>/]404.html（zh 由 Workers not_found_handling 约定；en 由 Worker 改送，见 worker/index.js）；
  // 其余为 [<prefix>/]<name>/index.html
  const outDir = path.join(DIST, loc.urlPrefix, is404 || dirName === 'index' ? '' : dirName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, is404 ? '404.html' : 'index.html'), html);
  return { dir: dirName, locale: loc.code, slug, meta, html };
}

/* ---------------- 构建期校验（docs/英文版方案.md Phase 1，防烂尾） ---------------- */

/**
 * 非默认语言页面站内链接巡检 + 翻译覆盖率报告。
 * 断链（zh 也没有的目标）→ 构建失败（--loose 降级为警告）；
 * 目标存在但无对应语言产物 → 降级中文，计入覆盖率报告。
 */
function validateBuilt(built, producedDirs) {
  const zhSlugs = new Set(built.filter((b) => b.locale === DEFAULT_LOCALE.code).map((b) => b.slug.replace(/\/$/, '') || '/'));
  const total = built.filter((b) => b.locale === DEFAULT_LOCALE.code).length;
  const problems = [];
  const coverage = [];

  for (const loc of LOCALES) {
    if (loc.code === DEFAULT_LOCALE.code) continue;
    const pages = built.filter((b) => b.locale === loc.code);
    const producedSet = new Set(pages.map((b) => b.slug.replace(/\/$/, '') || '/'));
    let degraded = 0;
    coverage.push(
      `${loc.code} ${pages.length}/${total} 页（${pages.map((p) => p.dir).join(', ') || '暂无'}）`
    );

    for (const b of pages) {
      const hrefs = [...b.html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
      for (const raw of hrefs) {
        const target = raw.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
        if (ASSET_PREFIXES.some((p) => target.startsWith(p) || target === p)) continue;
        if (loc.urlPrefix && (target === `/${loc.urlPrefix}` || target.startsWith(`/${loc.urlPrefix}/`))) {
          // 本语言内部链接：剥离 locale 前缀后按资产/页面判断
          const inner = target === `/${loc.urlPrefix}` ? '/' : target.slice(`/${loc.urlPrefix}`.length);
          if (ASSET_PREFIXES.some((p) => inner.startsWith(p) || inner === p)) continue;
          if (!producedSet.has(target)) {
            problems.push(`[${loc.code}] ${b.slug} → ${raw}（${loc.code} 未产出）`);
          }
          continue;
        }
        if (DYNAMIC_ZH_ROUTES.some((r) => target === r || target.startsWith(`${r}/`))) continue;
        // zh 目标必须存在（真断链），存在但无对应语言产物 → 降级中文（计入报告）
        if (!zhSlugs.has(target)) {
          problems.push(`[${loc.code}] ${b.slug} → ${raw}（zh 也不存在，断链）`);
        } else {
          degraded++;
        }
      }
    }
    if (degraded) coverage[coverage.length - 1] += `，站内链接降级中文 ${degraded} 个（翻译推进后归零）`;
  }
  return { problems, coverage };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });

  // 每语言 site / strings：strings 按回退链 deep-merge（en 缺 key 回退 zh，UI 永远完整）
  const sites = {};
  const stringsByLocale = {};
  for (const loc of LOCALES) {
    const siteFile = localeDataPath(loc, 'site.json');
    if (!exists(siteFile)) throw new Error(`locale ${loc.code} 已注册但缺 ${path.relative(ROOT, siteFile)}`);
    const site = JSON.parse(read(siteFile));
    // 页脚社交数据驱动：icon 名 → SVG（docs/英文版方案.md Phase 1 页脚改造）
    for (const s of site.footer?.socials || []) {
      if (!SOCIAL_ICONS[s.icon]) throw new Error(`site.footer.socials 未知图标: ${s.icon}（${loc.code}）`);
      s.svg = SOCIAL_ICONS[s.icon];
    }
    sites[loc.code] = site;

    const zhStrings = JSON.parse(read(localeDataPath(DEFAULT_LOCALE, 'strings.json')));
    stringsByLocale[loc.code] =
      loc.code === DEFAULT_LOCALE.code ? zhStrings : deepMerge(zhStrings, JSON.parse(read(localeDataPath(loc, 'strings.json'))));
  }

  const images = await scanImages();

  /** 递归收集页面目录（相对 PAGES_DIR 路径；含 index.html 的目录才算一页，如 heritage、heritage/fireworks） */
  const listPageDirs = (dir, prefix = '') => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (exists(path.join(dir, entry.name, 'index.html'))) out.push(rel);
      out.push(...listPageDirs(path.join(dir, entry.name), rel));
    }
    return out;
  };
  const pageDirs = listPageDirs(PAGES_DIR).sort((a, b) =>
    a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)
  );

  // Pass 1：确定每个页面各语言的产出集合（非默认语言有数据文件才产出 → 未翻译页不产出）
  const producedDirs = new Map(); // dir -> locale codes[]
  for (const dir of pageDirs) {
    const codes = [];
    for (const loc of LOCALES) {
      if (loc.code === DEFAULT_LOCALE.code || exists(localeDataPath(loc, `${dir}.json`))) codes.push(loc.code);
    }
    producedDirs.set(dir, codes);
  }

  /** hreflang alternate（含 x-default → 默认语言）；单语言页返回 []（head 不输出） */
  const alternatesFor = (dir) => {
    const codes = producedDirs.get(dir) || [];
    if (codes.length < 2) return [];
    return [
      ...codes.map((code) => {
        const loc = LOCALES.find((l) => l.code === code);
        return { hreflang: loc.hreflang, href: `${SITE_URL}${pageSlug(loc, dir)}` };
      }),
      { hreflang: 'x-default', href: `${SITE_URL}${pageSlug(DEFAULT_LOCALE, dir)}` },
    ];
  };

  // Pass 2：逐页 × 逐 locale 构建
  const built = [];
  for (const dir of pageDirs) {
    for (const loc of LOCALES) {
      if (!(producedDirs.get(dir) || []).includes(loc.code)) continue;
      const otherLocs = (producedDirs.get(dir) || [])
        .filter((code) => code !== loc.code)
        .map((code) => LOCALES.find((l) => l.code === code));
      const page = buildPage(
        loc,
        dir,
        sites[loc.code],
        stringsByLocale[loc.code],
        images,
        alternatesFor(dir),
        otherLocs.map((l) => l.ogLocale),
        otherLocs.map((l) => ({ label: l.label, hreflang: l.hreflang, href: pageSlug(l, dir) }))
      );
      if (page) built.push(page);
    }
  }

  // sitemap.xml（404 不收录；/merchants/ 由 Worker 动态渲染，商户明细另见 /merchants/sitemap.xml；
  // 多语言页附 xhtml:link alternate，hreflang 成对互指——由产出集合天然保证）
  const zhPages = built.filter((b) => b.locale === DEFAULT_LOCALE.code && b.dir !== '404');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${zhPages
  .map((p) => {
    const alts = alternatesFor(p.dir)
      .map((a) => `\n    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
      .join('');
    return `  <url>
    <loc>${SITE_URL}${p.slug}</loc>${alts}
    <changefreq>monthly</changefreq>
  </url>`;
  })
  .join('\n')}
  <url>
    <loc>${SITE_URL}/merchants/</loc>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>${SITE_URL}/tv/</loc>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>${SITE_URL}/library/</loc>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>${SITE_URL}/music/</loc>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>${SITE_URL}/attractions/</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`;
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);

  fs.writeFileSync(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\nSitemap: ${SITE_URL}/merchants/sitemap.xml\nSitemap: ${SITE_URL}/tv/sitemap.xml\nSitemap: ${SITE_URL}/library/sitemap.xml\nSitemap: ${SITE_URL}/attractions/sitemap.xml\n`
  );

  // 静态资源
  copyDir(path.join(ROOT, 'public'), DIST);
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));

  // 离线兜底页双语：public/offline.html 是模板（{{t.offline.*}}），按 locale 渲染到
  // dist/offline.html 与 dist/<prefix>/offline.html；sw.js 按导航路径前缀选兜底页
  const offlineTpl = read(path.join(DIST, 'offline.html'));
  for (const loc of LOCALES) {
    const outDir = path.join(DIST, loc.urlPrefix);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'offline.html'),
      render(offlineTpl, { t: stringsByLocale[loc.code], page: { htmlLang: loc.htmlLang } })
    );
  }

  // per-locale manifest：public/manifest.webmanifest 为默认语言模板；其他 locale 用
  // site.manifest 覆盖文案字段，id/start_url/scope 挂到 /<prefix>/
  const manifestBase = JSON.parse(read(path.join(DIST, 'manifest.webmanifest')));
  for (const loc of LOCALES) {
    const m = { ...manifestBase, ...(sites[loc.code].manifest || {}) };
    if (loc.urlPrefix) {
      m.id = `/${loc.urlPrefix}/`;
      m.start_url = `/${loc.urlPrefix}/`;
      m.scope = `/${loc.urlPrefix}/`;
    }
    m.lang = loc.htmlLang;
    fs.writeFileSync(path.join(DIST, loc.urlPrefix, 'manifest.webmanifest'), JSON.stringify(m, null, 2));
  }

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
  const aiCssPath = path.join(DIST, 'assets', 'css', 'ai-chat.css');
  fs.writeFileSync(aiCssPath, minifyCss(read(aiCssPath)));

  // 烟花模拟器（/digital-fireworks/）：14 个零依赖 JS 依依赖顺序拼接为单文件
  // （globals 协作，顺序即加载顺序；mid-file 的 "use strict" 字面量无副作用），CSS 一并压缩
  const FIREWORKS_JS_ORDER = [
    'fscreen', 'Stage', 'MyMath',                                       // lib
    'config', 'store', 'background-library', 'background-manager', 'ui', // app
    'runtime', 'shells', 'interaction', 'simulation', 'audio', 'engine', // fireworks
  ];
  const fwDir = path.join(SRC, 'assets', 'js', 'fireworks');
  fs.writeFileSync(
    path.join(DIST, 'assets', 'js', 'fireworks.js'),
    FIREWORKS_JS_ORDER.map((n) => read(path.join(fwDir, `${n}.js`))).join('\n')
  );
  const fwCssPath = path.join(DIST, 'assets', 'css', 'fireworks.css');
  fs.writeFileSync(fwCssPath, minifyCss(read(fwCssPath)));

  // 资源指纹：CSS/JS 内容变化 → 引用加 ?v=hash。/assets/* 缓存一年 immutable（_headers），
  // 无版本号的话访客会拿到旧样式（浏览器不会重新验证），有版本号则内容一变 URL 即变。
  const hashFile = (p) => createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
  const versions = {
    '/assets/css/style.css': hashFile(path.join(DIST, 'assets/css/style.css')),
    '/assets/js/main.js': hashFile(path.join(DIST, 'assets/js/main.js')),
    '/assets/css/fireworks.css': hashFile(path.join(DIST, 'assets/css/fireworks.css')),
    '/assets/js/fireworks.js': hashFile(path.join(DIST, 'assets/js/fireworks.js')),
    '/assets/css/ai-chat.css': hashFile(path.join(DIST, 'assets/css/ai-chat.css')),
    '/assets/js/ai-chat.js': hashFile(path.join(DIST, 'assets/js/ai-chat.js')),
  };
  // 供主 Worker 渲染 /tv /library /music /attractions /merchants 时复用全站页头/页脚
  // （编译产物，导航改了随构建同步）。须在指纹回写前生成，页脚里的 ai-chat 引用才能拿到 ?v=。
  // 动态页暂为 zh-only：用默认语言的 site 与 strings 编译（切换器 page.locales 无上下文 → 不渲染）
  const siteCtx = { site: sites[DEFAULT_LOCALE.code], t: stringsByLocale[DEFAULT_LOCALE.code] };
  fs.mkdirSync(path.join(DIST, 'partials'), { recursive: true });
  for (const name of ['header', 'footer']) {
    const compiled = render(read(path.join(PARTIALS_DIR, `${name}.html`)), siteCtx);
    fs.writeFileSync(path.join(DIST, 'partials', `${name}.html`), compiled);
  }

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

  // Worker 页面引用带指纹的 CSS/JS 用
  fs.writeFileSync(path.join(DIST, 'build-meta.json'), JSON.stringify(versions));

  // PWA Service Worker（docs/PWA应用方案.md §3.2）：public/sw.js 是模板，预缓存清单与脏戳
  // 由构建注入 → dist/sw.js。清单带 ?v= 指纹、脏戳取指纹哈希——任一资产内容变化 SW 字节即变，
  // 浏览器自动重装换新缓存，与页面 ?v= 同一套失效逻辑。多语言：全部 locale 页面 + 双语 offline
  // + 双语 manifest 一并入预缓存。
  const swStamp = createHash('md5').update(JSON.stringify(versions)).digest('hex').slice(0, 8);
  const precache = [
    ...built.filter((b) => b.dir !== '404').map((b) => b.slug),
    ...LOCALES.map((l) => `${localePrefix(l)}offline.html`),
    ...LOCALES.map((l) => `${localePrefix(l)}manifest.webmanifest`),
    '/favicon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/maskable-192.png',
    '/icons/maskable-512.png',
    '/icons/apple-touch-icon.png',
    ...Object.keys(versions).map((a) => `${a}?v=${versions[a]}`),
  ];
  fs.writeFileSync(
    path.join(DIST, 'sw.js'),
    read(path.join(ROOT, 'public', 'sw.js'))
      .replace("'__BUILD__'", JSON.stringify(`v-${swStamp}`))
      .replace('__PRECACHE__', JSON.stringify(precache))
  );

  // 构建期校验：EN 页链接巡检（断链失败，--loose 放行）+ 翻译覆盖率报告
  const { problems, coverage } = validateBuilt(built, producedDirs);
  const hasProblems = problems.length > 0;
  for (const p of problems) console.error(`  ✗ ${p}`);
  for (const c of coverage) console.log(`  覆盖率: ${c}`);

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
  console.log(`✔ ${built.length} 页构建完成（${LOCALES.map((l) => `${l.code}×${built.filter((b) => b.locale === l.code).length}`).join(' + ')}）→ dist/（${Date.now() - t0}ms）`);
  for (const b of built) console.log(`  ${b.slug.padEnd(14)} ${b.meta.title}`);
  console.log(`  sitemap.xml + robots.txt 已生成；首页 HTML ${kb(path.join(DIST, 'index.html'))}KB`);

  if (hasProblems && !LOOSE) {
    console.error(`✗ 构建校验失败：${problems.length} 处断链（--loose 仅限灰度期显式放行）`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
