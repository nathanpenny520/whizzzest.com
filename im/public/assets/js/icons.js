/**
 * 焰境密语 — 内联 SVG 图标集（UI v2，方案 docs/IM-UI改版方案.md）
 * 零依赖：不引图标字体/CDN；stroke=currentColor 随 CSS 变量变色。
 */

const stroke = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const solid = (d) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  chats: stroke('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  users: stroke('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  gear: stroke('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  search: stroke('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  newchat: stroke('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  dots: solid('<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>'),
  back: stroke('<path d="m15 18-6-6 6-6"/>'),
  info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  send: stroke('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  check: stroke('<path d="m4.5 12.5 5 5 10-11"/>'),
  checks: stroke('<path d="m2 13 4.5 4.5L16 8"/><path d="m9.5 15.5 2 2L21.5 7.5"/>'),
  clock: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  x: stroke('<path d="M18 6 6 18M6 6l12 12"/>'),
  flag: stroke('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>'),
  ban: stroke('<circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/>'),
  trash: stroke('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  logout: stroke('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  user: stroke('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  userplus: stroke('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  userminus: stroke('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 11h6"/>'),
  edit: stroke('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  shield: stroke('<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/>'),
  copy: stroke('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  flame: stroke('<path d="M12 22c4.4 0 7-2.8 7-6.5 0-3-2-4.6-3-6.6-1.4 1.4-2.1 2.6-2.1 4.1C12.4 11 11 7.5 11.5 4 8 6 5 10.5 5 15.5 5 19.2 7.6 22 12 22z"/>'),
  chevron: stroke('<path d="m9 6 6 6-6 6"/>'),
};

/** 按名字取图标 HTML（size 像素；未知名回退空串） */
export function icon(name, size = 22) {
  const svg = ICONS[name];
  return svg ? svg.replace('<svg ', `<svg width="${size}" height="${size}" `) : '';
}
