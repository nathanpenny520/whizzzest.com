/**
 * 焰境游戏 — i18n 运行时（源码级统一主站架构，docs/游戏英文版方案.md §8.7，2026-09-09 二次修订）
 *
 * 分工（与主站完全同构）：
 *  - 静态文案：构建期由 game/scripts/build-game.mjs 烘进 HTML（模板 + game/strings/ 双语字典），
 *    页面源码即最终语言，零 JS 依赖；
 *  - 动态文案（toast/存档面板/游戏内串）：EN 页构建期注入 window.__I18N，本模块 t() 查注入字典；
 *    zh 页无注入，走调用点第二参的中文兜底——对齐主站「build.js 注入 __I18N，无注入走 zh」；
 *  - locale 以 <html lang> 为准（构建期写定：zh-CN / en），不做任何运行时路径嗅探；
 *  - 顶层不碰浏览器 API —— Node import 冒烟测试安全（game-save 依赖）。
 */

/** 当前语言：构建期写进 <html lang>，运行时只读（Node 冒烟环境无 document，按 zh） */
export const LANG = typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'zh';

/**
 * 取串：EN 页查构建期注入的 __I18N 字典，缺失或 zh 页落回 zh 兜底（决策③）。
 * 字典值与兜底串都支持 {name} 占位符（params 提供）。
 */
export function t(key, zhFallback, params) {
  const dict = globalThis.__I18N || null;
  let s = dict && dict[key] != null ? dict[key] : zhFallback;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  return s;
}
